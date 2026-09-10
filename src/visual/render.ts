// 谱面渲染纯模块（ADR-0003 候选 B）：把 FinalVirtualCanvas 的 15 个 render* 函数
// 从组件闭包中提出为依赖注入的纯函数。组件每次 RAF 组装 RenderCtx 调用 renderChart。
// 本模块不含任何 React 状态；性能热路径（视口剔除/缓存/增量重绘）将来在此落地。
import type { ChartNote, SelectionItem, SlideNote } from '../chart/types';
import { LANES, LANE_WIDTH, TRACK_CHROME_TOTAL, type ChartGeometry, type GeometryViewport } from '../chart/geometry/ChartGeometry';
import { shiftGroupToAnchor, mirrorNote, countNotesUpToBeat } from '../chart/editing/NoteEditing';
import { perf } from '../chart/perf';
import { beatToSeconds, getBpmEvents } from '../audio/AudioTiming';
import { formatInMinuteTime } from '../chart/geometry/TimeFormat';
import { makeCoords, type Coords } from './coords';
import { computeItemsInBox, computeBpmLinesInBox, findItemAt } from './hitTest';
import { slideSpans } from '../chart/editing/SlideSegments';
import { drawNotesLayer } from './noteLayerCache';
import { drawStaticLayer } from './staticLayerCache';
import { drawGutterLabel, layoutGutterLabel, clampGutterLabelY, GUTTER_LABEL_FONT_PX } from './gutterLabels';
import { GRID_STYLES, GRID_TIER_ORDER, gridLineDash, gridTierOf, gridThemeBpmColor, normalizeGridStyle, type GridTier } from './gridStyle';
import { SELECTION_COLORS, SELECTION_OUTLINE } from './selectionStyle';
import type { DirGroupVisual } from './noteSkin';
import type { RenderCtx } from './types';
import type { SpriteIconConfig } from '../ui/CanvasSpriteIcon';

// 音符大小配置（与 hitTest 命中尺寸保持一致）
export const NOTE_ICON_SIZE = 36;
export const DIRECTIONAL_ICON_SIZE = 45;
export const SLIDE_ICON_SIZE = 36;

// 音符高度压缩配置（导出供选中描边 ink 矩形的单测对齐）
export const NOTE_HEIGHT_SCALE = 0.6;
export const DIRECTIONAL_HEIGHT_SCALE = 0.33;
export const SLIDE_HEIGHT_SCALE = 0.6;

/** 选中状态判定辅助（ADR-0001 §6：整条/结点/区域）。一次构建 Set/Map，密集音符下避免每音符 O(选择数) 扫描 */
interface SelectionSets {
  notes: Set<number>;
  slideNodes: Map<number, Set<number>>;
  slideRegions: Map<number, Set<number>>;
}
const buildSets = (items: readonly SelectionItem[]): SelectionSets => {
  const notes = new Set<number>();
  const slideNodes = new Map<number, Set<number>>();
  const slideRegions = new Map<number, Set<number>>();
  for (const it of items) {
    if (it.kind === 'note') notes.add(it.noteIndex);
    else if (it.kind === 'slideNode') {
      (slideNodes.get(it.noteIndex) ?? slideNodes.set(it.noteIndex, new Set()).get(it.noteIndex)!).add((it as { connIndex: number }).connIndex);
    } else if (it.kind === 'slideRegion') {
      (slideRegions.get(it.noteIndex) ?? slideRegions.set(it.noteIndex, new Set()).get(it.noteIndex)!).add((it as { connIndex: number }).connIndex);
    }
  }
  return { notes, slideNodes, slideRegions };
};
const buildSelectionSets = (rc: RenderCtx): SelectionSets => buildSets(rc.selectedItems);

/**
 * issue 67：**框选预览集** —— 左键按住（未松手）期间，用 `computeItemsInBox` 实时算出
 * "当前这个矩形会纳入哪些音符"，给**尚未真正入选**的那部分即时加 hover 描边，
 * 让用户松手前就看清"会选中谁"（真实选区要到 mouseup 才由 `applyBoxAction` 建立）。
 * null = 无框选手势。判据与真实框选同源（BPM 整线覆盖、hidden 跳过），不另写一套。
 */
const buildPreviewSets = (rc: RenderCtx): SelectionSets | null => {
  if (!rc.selectionBox) return null;
  const deps = {
    geometry: rc.geometry,
    viewport: rc.viewport,
    beatDisplay: rc.beatDisplay,
    notes: rc.notes,
  };
  const items = computeItemsInBox(rc.selectionBox, deps);
  // issue 71：BPM 不进选区 → 非删除态**不预览**它（画了却选不中 = 误导）。
  // 删除态例外：框选删除会真删掉被整条框住的 BPM 线，故仍要预告（并转危险红）。
  const withBpm = rc.armedTool === 'delete'
    ? [...items, ...computeBpmLinesInBox(rc.selectionBox, deps)]
    : items;
  return buildSets(withBpm);
};
const isNoteSelected = (sel: SelectionSets, index: number) => sel.notes.has(index);

/** 临时起点标记（ADR-0004 §4）：左沟槽竖向标记线；选中时高亮 */
export function renderStartMarker(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  if (rc.markerBeat === null) return;
  const { trackBgX } = c.trackGeometry(rc.viewport.scale);
  const markerCanvasY = c.virtualToCanvas(0, c.beatToVirtualY(rc.markerBeat)).y;
  if (markerCanvasY < -20 || markerCanvasY > rc.surface.h + 20) return;
  const color = rc.markerSelected ? '#ffd166' : '#9ca3af';
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3 * rc.viewport.scale;
  ctx.beginPath();
  ctx.moveTo(0, markerCanvasY);
  ctx.lineTo(trackBgX, markerCanvasY);
  ctx.stroke();
  // 左侧小旗标
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, markerCanvasY);
  ctx.lineTo(14 * rc.viewport.scale, markerCanvasY - 7 * rc.viewport.scale);
  ctx.lineTo(14 * rc.viewport.scale, markerCanvasY + 7 * rc.viewport.scale);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * 视口可见拍范围（issue 10 性能，纯函数供单测）：
 * 由视口虚拟Y边界反解 beat 窗口（含半拍余量），网格只迭代该窗口而非 [0, chartEndBeat] 全量。
 */
export function visibleBeatRange(geometry: ChartGeometry, viewport: GeometryViewport, chartEndBeat: number): { min: number; max: number } {
  const b = geometry.viewportBounds(viewport);
  const lo = geometry.virtualYToBeat(b.maxY, viewport.scale);
  const hi = geometry.virtualYToBeat(b.minY, viewport.scale);
  return { min: Math.max(0, Math.floor(lo - 0.5)), max: Math.min(chartEndBeat, Math.ceil(hi + 0.5)) };
}

/** 绘制网格（轨道竖线 + 节拍/子节拍横线）。只迭代可见拍范围；极小间距时按像素间距抽稀。 */
export function renderGrid(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  const { trackBgX, trackBgWidth, trackStartX } = c.trackGeometry(rc.viewport.scale);

  for (let lane = 0; lane <= LANES; lane++) {
    const x = trackStartX + TRACK_CHROME_TOTAL * rc.viewport.scale + lane * LANE_WIDTH * rc.viewport.scale;
    if (lane === 0 || lane === LANES) {
      const borderColors = ['#004C4C', '#004D4D', '#009898', '#00A6A6', '#008186', '#003D44'];
      const borderWidths = [1, 4, 1, 1, 1, 1];
      let currentOffset = 0;
      const isRightBorder = lane === LANES;
      borderColors.forEach((color, index) => {
        const width = borderWidths[index] * rc.viewport.scale;
        const rectX = isRightBorder ? (x + currentOffset) : (x - currentOffset - width);
        ctx.fillStyle = color;
        ctx.fillRect(rectX, 0, width, rc.surface.h);
        currentOffset += width;
      });
    } else {
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rc.surface.h);
      ctx.stroke();
    }
  }

  // 网格横线（issue 53 分层样式，第二轮修订）：分母分层（整拍 > 1/2 > 1/4 > 1/8 > 1/16），
  // 层级靠**颜色**区分（主题亮度沿层级递减、下限远离黑）；形态阶梯改为可选开关
  // lineShapeTiers（默认关 = 全实线），开启后叠加线形阶梯。透明度恒 1（避免暗上加暗跌近黑）。
  // 抽稀按层级从高到低进行：与任一已绘制线过近的候选被跳过（优先保留高层级）。
  const { min: beatFrom, max: beatTo } = visibleBeatRange(rc.geometry, rc.viewport, rc.chartEndBeat);
  const es = rc.viewport.scale;
  const style = GRID_STYLES[normalizeGridStyle(rc.display?.gridStyle)];
  const lineShapeTiers = rc.display?.lineShapeTiers === true;
  const gridOpacity = rc.display?.gridOpacity ?? 1; // 轨道线透明度（第三轮补，用户可调）

  interface GridCandidate { y: number; tier: GridTier }
  const candidates: GridCandidate[] = [];
  for (let beat = beatFrom; beat <= beatTo; beat++) {
    const y = c.virtualToCanvas(0, c.beatToVirtualY(beat)).y;
    if (y >= 0 && y <= rc.surface.h) candidates.push({ y, tier: 'beat' });
    for (let subBeat = 1; subBeat < rc.beatDisplay; subBeat++) {
      const preciseBeat = beat + subBeat / rc.beatDisplay;
      if (preciseBeat > rc.chartEndBeat + 1e-6) continue;
      const subY = c.virtualToCanvas(0, c.beatToVirtualY(preciseBeat)).y;
      if (subY < 0 || subY > rc.surface.h) continue;
      candidates.push({ y: subY, tier: gridTierOf(subBeat, rc.beatDisplay) });
    }
  }

  const drawn: number[] = [];
  const tooClose = (y: number, threshold: number) => {
    for (const d of drawn) if (Math.abs(d - y) < threshold) return true;
    return false;
  };

  for (const tier of GRID_TIER_ORDER) {
    const s = style[tier];
    const threshold = tier === 'beat' ? 2 : 5; // 抽稀阈值：拍线保持旧 2px 密度，子拍线 5px
    ctx.strokeStyle = s.color;
    ctx.lineWidth = tier === 'beat' ? Math.max(2, s.width * es) : Math.max(0.5, s.width * es);
    ctx.globalAlpha = (s.alpha ?? 1) * gridOpacity;
    const dash = gridLineDash(tier, lineShapeTiers, es);
    ctx.setLineDash(dash ?? []);
    // issue 78：虚线相位从路径起点起算，而线长 L = trackBgWidth = 210·es 恰为周期（10·es）的整数倍
    // → 右端点正好落在"下一段 dash 的起点"，末端前 [L−gap, L) 是空档：左端贴边、右端缺一段。
    // 左移半个 dash 长，使左右端相位相同（L ≡ 0 mod period 时两端都被 dash 覆盖到轨道边缘）。
    ctx.lineDashOffset = dash && dash.length > 0 ? dash[0] / 2 : 0;
    for (const cand of candidates) {
      if (cand.tier !== tier) continue;
      if (tooClose(cand.y, threshold)) continue;
      ctx.beginPath();
      ctx.moveTo(trackBgX, cand.y);
      ctx.lineTo(trackBgX + trackBgWidth, cand.y);
      ctx.stroke();
      drawn.push(cand.y);
    }
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0; // issue 78：ctx 状态，必须复位，否则污染后续虚线（如 renderBoundLines）
  ctx.globalAlpha = 1;
}

// ---------------- issue 56：选中态视觉（a）+ hover 层级（c） ----------------
// 形态 = 贴合 sprite ink 矩形的圆角矩形描边（双色：外侧暗底 + 内侧亮面，不用 shadowBlur）；
// 废除旧的正圆黄圈。滑条段沿平行四边形四边描边（斜段描斜的，不退化为轴对齐包围盒）；
// BPM 整条改浅黄 + 加粗。选中 / hover / 删除态危险色共用同一形态，仅配色与 α 分档。
// hover 适用范围 = **任何工具态**（C4 原"幽灵态不画"已被用户 2026-09-09 推翻）。

/** 描边模式：真实选中 = 暗底+亮面；hover = 亮面 α0.7；删除持工具态 hover = 危险红亮面 α0.7 */
export type SelectionOutlineMode = 'selected' | 'hover' | 'danger';

/** 一条描边图形：ink 圆角矩形 / 滑条段的平行四边形 / BPM 整条横线 */
export type SelectionOutline =
  | { shape: 'rect'; x: number; y: number; w: number; h: number; mode: SelectionOutlineMode; compact?: boolean }
  | { shape: 'quad'; points: [number, number][]; mode: SelectionOutlineMode; compact?: boolean }
  | { shape: 'line'; x1: number; y1: number; x2: number; y2: number; mode: SelectionOutlineMode };

/** 单键主精灵选款（与 renderNotes 同口径：描边贴合实际绘制的那枚墨迹） */
function singleIconConfig(rc: RenderCtx, note: { lane: number; beat: number; subBeat?: number; flick?: boolean; skill?: boolean }): SpriteIconConfig {
  const icons = rc.noteIcons;
  if (note.flick) return icons.flickFor(note.lane);
  if (note.skill) return icons.skillFor(note.lane);
  // 色觉辅助（issue 39 #4）：款式会变 → ink 矩形可能随之变，描边跟着实际绘制走（配色不变，A8）
  if (rc.display?.colorAssist && !isHalfBeatAligned(note.beat, note.subBeat || 0, rc.beatDisplay)) return icons.tapVirtualFor(note.lane);
  return icons.tapFor(note.lane);
}

/** 滑条结点精灵选款（端点基底 / 中间结点 + flick·skill 覆盖）
 * **实绘（renderSlideBody）/ 选中描边（collectSelectionOutlines）/ 幽灵（renderSlideGhost、
 * slide 态 hover）/ 待连接锚点（renderSlideBuffer）四处共用这一份**（issue 65①）——
 * 旧 `renderSlideGhost` 对所有结点一律取端点款，拖中间结点时"中间那颗长得像单键"，
 * 违反 ADR-0002 §4 的既有不变式「幽灵 = 画布实绘同形」。 */
function slideNodeIconConfig(rc: RenderCtx, conn: { lane: number; flick?: boolean; skill?: boolean }, isFirst: boolean, isLast: boolean): SpriteIconConfig {
  const icons = rc.noteIcons;
  const base = isFirst || isLast ? icons.slideEndpointFor(conn.lane) : icons.slideAmongFor(conn.lane);
  return { ...base, ...(conn.flick ? icons.flickFor(conn.lane) : {}), ...(conn.skill ? icons.skillFor(conn.lane) : {}) };
}

/**
 * C4（用户 2026-09-09 修正）：hover **在任何工具态都画**（放置/粘贴/镜像的幽灵态同样画，
 * 与 Q6=A 的"幽灵 + 描边叠加"一致）。hidden 结点在 findItemAt 侧已跳过（A6），
 * BPM 在下方按 Q14 不参与 hover。
 */
function hoverItemForRender(rc: RenderCtx): SelectionItem | null {
  return rc.hoverItem ?? null;
}

/**
 * 收集本次要画的选中 / hover 描边（纯函数，供单测）：
 * 逐音符按「选中范围 ∪ hover 子部分」决定每条描边的模式，同一图形可叠两圈（选中 + hover 外圈）。
 */
export function collectSelectionOutlines(c: Coords, rc: RenderCtx, visibleNotes: { note: ChartNote; index: number }[]): SelectionOutline[] {
  const sel = buildSelectionSets(rc);
  const hover = hoverItemForRender(rc);
  // issue 67：框选预览集（按住未松手期间实时算"框里有什么"），null = 无框选手势
  const preview = buildPreviewSets(rc);
  if (sel.notes.size === 0 && sel.slideNodes.size === 0 && sel.slideRegions.size === 0 && !hover && !preview) return [];
  // A5：描边随 noteSize 缩放（与音符本体同一 spriteScale），永远贴合外边缘
  const ns = rc.display?.noteSize ?? 1;
  const s = rc.viewport.scale * ns;
  // issue 74：右键按住（未松手）时，光标下对象的 hover 也要用删除红 ——
  // 右键 = 删除该对象，按住期间就该用与"删除工具"同款的 danger 反馈作预览。
  // 与"删除持工具态"是同一形态的两种触发源，故合并成一个开关。
  const dangerTool = rc.armedTool === 'delete' || rc.rightButtonHeld === true;
  const out: SelectionOutline[] = [];

  for (const { note, index } of visibleNotes) {
    const hv = hover && hover.noteIndex === index ? hover : null;
    const whole = isNoteSelected(sel, index);
    // issue 67：本音符是否落在框选矩形内（尚未真正入选 —— 入选要等 mouseup）
    const previewWhole = preview ? isNoteSelected(preview, index) : false;
    const previewNodes = preview?.slideNodes.get(index);
    const previewRegions = preview?.slideRegions.get(index);
    // Q51：删除持工具态下 hover 到某个音符 → 该轮廓整体转红（覆盖浅黄选中色）
    const danger = dangerTool && hv !== null;
    /**
     * 同一图形叠圈：连续重复的模式只画一次（选中 + 危险 hover 都是红 → 一圈）。
     *
     * @param inPreviewBox 该对象**被框选矩形覆盖**（**不论是否已选中**）。
     *   删除工具态下即为"这些会被删"的预告 → 用**危险红**（`danger`），与鼠标 hover 同款
     *   （Q49 同形态换色；Q51 已选中被框住也**整体转红**、覆盖浅黄选中色）。
     *   注意它决定的是**颜色**，与第 2 参（决定是否**额外多画一圈**）是两回事 ——
     *   已选中的对象被框住时不再多画一圈，但颜色照样要转红。
     */
    const emit = (
      inSel: boolean,
      isHoverPart: boolean,
      make: (mode: SelectionOutlineMode) => void,
      inPreviewBox = false,
    ) => {
      let prev: SelectionOutlineMode | null = null;
      const push = (m: SelectionOutlineMode) => { if (m === prev) return; prev = m; make(m); };
      const dangerMode = danger || (dangerTool && inPreviewBox);
      if (inSel) push(dangerMode ? 'danger' : 'selected');
      if (isHoverPart) push(dangerMode ? 'danger' : 'hover');
    };

    if (note.type === 'BPM') {
      // Q45：完整框选入选 → 整条线改浅黄 + 加粗（细线描边不明显）。
      // Q14=A：BPM 线左键单击在所有态下都无效果 → **不参与鼠标 hover 反馈**（C5 的删除态情形是同一理由），
      // 否则"整条亮起却点不动"是误导。
      // issue 71 修订：BPM **不再入选**，其通路只剩「右键删除 / 删除工具（单击+框选）/
      // 沟槽数字就地编辑」。故框选预览只在**删除态**画它（那时框选真会删掉它），
      // 非删除态画了却选不中 = 误导（判据见 `buildPreviewSets` + `computeBpmLinesInBox`）。
      // issue 74：右键按住时 BPM 也要给反馈 —— 右键能删它，与"鼠标 hover 不画（点了没反应）"区分开。
      // 只认**右键按住**这一源：删除工具态下 BPM 的鼠标 hover 不画是既有定案（issue 56 C5），不动它。
      const dangerHover = rc.rightButtonHeld === true && hv !== null;
      if (!whole && !previewWhole && !dangerHover) continue;
      const y = c.virtualToCanvas(0, c.getNoteVirtualY(note.beat)).y;
      const { trackBgX, trackBgWidth } = c.trackGeometry(rc.viewport.scale);
      // 删除态下 BPM 的**鼠标 hover** 不画红（C5：单击无效果），但**框选预览**要画红 ——
      // 框选 BPM 是真会入选、进而可被删的（issue 67：预览 = "这些会被删"的预告）。
      out.push({
        shape: 'line', x1: trackBgX, y1: y, x2: trackBgX + trackBgWidth, y2: y,
        mode: whole ? 'selected' : (dangerTool ? 'danger' : 'hover'),
      });
      continue;
    }

    if (note.type === 'Single') {
      if (!whole && !hv && !previewWhole) continue;
      const p = c.virtualToCanvas(c.getNoteVirtualX(note.lane), c.getNoteVirtualY(note.beat, note.subBeat || 0));
      const cfg = singleIconConfig(rc, note);
      const w = (cfg.out?.w ?? NOTE_ICON_SIZE) * s;
      const h = (cfg.out?.h ?? NOTE_ICON_SIZE * NOTE_HEIGHT_SCALE) * s;
      // issue 66 §2：与 Slide 结点/段同口径走 **compact** —— 不外扩、不画暗底，亮面贴 ink 边。
      // 旧的"外扩 outset + 暗底 halo"会盖住紧邻的其它音符（用户复报的"一圈遮罩"），全类型统一消除。
      // issue 67：`previewWhole && !whole` = 在框里但还没真入选 → hover 档（松手才转 selected）。
      emit(whole, hv !== null || (previewWhole && !whole), (mode) => out.push({ shape: 'rect', x: p.x - w / 2, y: p.y - h / 2, w, h, mode, compact: true }), previewWhole);
      continue;
    }

    if (note.type === 'LDirectional' || note.type === 'RDirectional') {
      if (!whole && !hv && !previewWhole) continue;
      const p = c.virtualToCanvas(c.getNoteVirtualX(note.lane), c.getNoteVirtualY(note.beat, note.subBeat || 0));
      const len = Math.min(Math.max(note.length || 1, 1), 3);
      const isLeft = note.type === 'LDirectional';
      const group = rc.noteIcons.dirGroup(isLeft ? 'L' : 'R', len);
      // 本体精灵框内左右有透明留白 → 用构建期实测墨迹（dirInk，与同时点击线同一口径）收紧到可见墨迹
      const ink = rc.noteIcons.dirInk(isLeft ? 'L' : 'R');
      const bodyW = DIRECTIONAL_ICON_SIZE * (ink.w > 0 ? Math.max(0, (ink.w - ink.inkLeft - ink.inkRight) / ink.w) : 1) * s;
      const inkCenterOffset = DIRECTIONAL_ICON_SIZE * (ink.w > 0 ? (ink.inkLeft - ink.inkRight) / 2 / ink.w : 0) * s;
      const h = DIRECTIONAL_ICON_SIZE * DIRECTIONAL_HEIGHT_SCALE * s;
      // 方向键 = **一个整体矩形**（用户 2026-09-09）：所有本体 + 最外侧箭头 围成的最小外接矩形
      // 原 A4「每条本体各一个矩形」改为整体 —— 多段分开的环不像一个连体滑键。
      const bodyCenters = group.bodies.map(b => p.x + b.offsetVirtualX * rc.viewport.scale + inkCenterOffset);
      let minX = Infinity, maxX = -Infinity;
      for (const cx of bodyCenters) {
        if (cx - bodyW / 2 < minX) minX = cx - bodyW / 2;
        if (cx + bodyW / 2 > maxX) maxX = cx + bodyW / 2;
      }
      if (group.chevron) {
        const cv = group.chevron;
        const chevCx = p.x + cv.offsetVirtualX * rc.viewport.scale + cv.extraDesignX * s;
        const chevHalfW = cv.drawW * s / 2;
        if (chevCx - chevHalfW < minX) minX = chevCx - chevHalfW;
        if (chevCx + chevHalfW > maxX) maxX = chevCx + chevHalfW;
      }
      const w = maxX - minX;
      // issue 66 §2：方向键同样走 compact（同单键）——整组最小外接矩形不外扩、不画暗底。
      // issue 67：框选预览同单键（在框里未入选 → hover 档）。
      emit(whole, hv !== null || (previewWhole && !whole), (mode) => out.push({ shape: 'rect', x: minX, y: p.y - h / 2, w, h, mode, compact: true }), previewWhole);
      continue;
    }

    if (note.type === 'Slide' || note.type === 'Long') {
      const conns = (note as SlideNote).connections;
      if (conns.length < 2) continue;
      const nodes = sel.slideNodes.get(index);
      const regions = sel.slideRegions.get(index);
      if (!whole && !nodes && !regions && !hv && !previewWhole && !previewNodes && !previewRegions) continue;
      conns.forEach((conn, ci) => {
        if (conn.hidden) return; // A6：hidden 结点不画（findItemAt/computeItemsInBox 已跳过，选不中自然画不出）
        const inSel = whole || nodes?.has(ci) === true;
        // issue 67：框选预览（整条被框住 → 所有结点；或该结点单独被框住）
        const inPreviewBox = previewWhole || previewNodes?.has(ci) === true; // 被框住（不论选中与否）→ 决定颜色
        const inPreview = !inSel && inPreviewBox;                            // 未选中才额外多画一圈
        const isHoverPart = hv?.kind === 'slideNode' && hv.connIndex === ci;
        if (!inSel && !isHoverPart && !inPreview) return;
        const p = c.virtualToCanvas(c.getNoteVirtualX(conn.lane), c.getNoteVirtualY(conn.beat, conn.subBeat || 0));
        const cfg = slideNodeIconConfig(rc, conn, ci === 0, ci === conns.length - 1);
        const w = (cfg.out?.w ?? SLIDE_ICON_SIZE) * s;
        const h = (cfg.out?.h ?? SLIDE_ICON_SIZE * SLIDE_HEIGHT_SCALE) * s;
        // 滑条结点紧贴连接带：选中外圈（暗底 + outset）会盖住带子造成"段被截断"的观感（用户 2026-09-09）
        // → 结点矩形用 compact：不外扩、不画暗底，亮面贴 ink 边即可，带子自由穿过。
        emit(inSel, isHoverPart || inPreview, (mode) => out.push({ shape: 'rect', x: p.x - w / 2, y: p.y - h / 2, w, h, mode, compact: true }), inPreviewBox);
      });
      // 段带宽与连接带同宽（× noteSize，A5）
      const half = (LANE_WIDTH * rc.viewport.scale * ns) / 2;
      // issue 77 二轮：段以**逻辑段**为单位（跨过 hidden 的整段一起亮/一起灭），
      // 逐子块描边（斜段拼斜段），但选中/命中/预览的判据用的是同一段起点下标。
      for (const sp of slideSpans(conns)) {
        const inSel = whole || regions?.has(sp.start) === true;
        // issue 67：框选预览（整条被框住 → 所有段；或该段单独被框住）。
        // 与"鼠标 hover 仅限删除/音符代码工具"不同：框选是"即将入选"的预告，
        // 段确实会被选入 → 一律给反馈，所见即所得。
        const inPreviewBox = previewWhole || previewRegions?.has(sp.start) === true; // 被框住 → 决定颜色
        const inPreview = !inSel && inPreviewBox;                              // 未选中才额外多画一圈
        // 段（连接带）默认不是可点对象 → 只在**会对它表态的工具**下给 hover 反馈：
        //   ① 删除工具：拆条语义需要"这一段会被拆"的预告（用户 2026-09-09）；
        //   ② 音符代码工具：点段会打开所属滑条的代码视图（§4 回退整条），段同样是"点得动"的目标。
        // 其余工具态段完全不参与 hover，只有真正的结点有。
        // 段被框选入选时照常按选中态绘制（inSel 分支，不受此限）。
        const isHoverPart = (dangerTool || rc.armedTool === 'noteCode')
            && hv?.kind === 'slideRegion' && hv.connIndex === sp.start;
        if (!inSel && !isHoverPart && !inPreview) continue;
        // 该段的每个子块各描一条平行四边形（跨过 hidden 的整段 = 多条拼起来，
        // 但共用同一 mode/判据 —— 所以整段一起亮、不会出现"只亮半段"）
        for (let ci = sp.start; ci < sp.end; ci++) {
          const c1 = conns[ci], c2 = conns[ci + 1];
          const p1 = c.virtualToCanvas(c.getNoteVirtualX(c1.lane), c.getNoteVirtualY(c1.beat, c1.subBeat || 0));
          const p2 = c.virtualToCanvas(c.getNoteVirtualX(c2.lane), c.getNoteVirtualY(c2.beat, c2.subBeat || 0));
          // A4：段是斜的必须描斜的 —— 沿平行四边形四边描边封口，禁止退化成轴对齐包围盒
          const points: [number, number][] = [
            [p1.x - half, p1.y], [p1.x + half, p1.y], [p2.x + half, p2.y], [p2.x - half, p2.y],
          ];
          // 段（连接带）的描边 = compact（用户 2026-09-09 二轮反馈）：不外扩、不画暗底，
          // 亮面贴平行四边形边即可，避免外圈盖住带子造成"段被截断"的观感。
          // 段与结点同款：所有"贴在带子上"的描边都用 compact 让带子自由穿过。
          emit(inSel, isHoverPart || inPreview, (mode) => out.push({ shape: 'quad', points, mode, compact: true }), inPreviewBox);
        }
      }
    }
  }
  return out;
}

/** 圆角矩形路径（不依赖 ctx.roundRect 的浏览器支持） */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 凸多边形等距外扩（滑条斜段用）：顶点沿相邻两边外法线的合成方向外移 */
function offsetConvexPolygon(pts: readonly [number, number][], d: number): [number, number][] {
  const n = pts.length;
  if (d === 0 || n < 3) return pts.map(p => [p[0], p[1]] as [number, number]);
  // 绕向（带符号面积）定外法线朝向：(dx,dy) 的外法线 = (dy,-dx)（正面积时）
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    area2 += x1 * y2 - x2 * y1;
  }
  const sign = area2 >= 0 ? 1 : -1;
  const normals: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    normals.push([(sign * dy) / len, (-sign * dx) / len]);
  }
  const cap = SELECTION_OUTLINE.miterLimit * Math.abs(d);
  return pts.map((_, i) => {
    const a = normals[(i - 1 + n) % n], b = normals[i];
    const denom = 1 + (a[0] * b[0] + a[1] * b[1]);
    const f = Math.abs(denom) < 1e-6 ? 0 : d / denom;
    let mx = (a[0] + b[0]) * f, my = (a[1] + b[1]) * f;
    // 近水平的细段（锐角）外扩会拉出长尖刺 → 按 miter 上限裁剪位移
    const len = Math.hypot(mx, my);
    if (len > cap) { const k = cap / len; mx *= k; my *= k; }
    return [pts[i][0] + mx, pts[i][1] + my] as [number, number];
  });
}

/** 按外扩量铺一条描边路径（矩形圆角、平行四边形保斜、BPM 线不扩） */
function traceOutline(ctx: CanvasRenderingContext2D, o: SelectionOutline, outset: number, radius: number) {
  ctx.beginPath();
  if (o.shape === 'rect') {
    roundRectPath(ctx, o.x - outset, o.y - outset, o.w + outset * 2, o.h + outset * 2, radius);
  } else if (o.shape === 'quad') {
    const pts = outset !== 0 ? offsetConvexPolygon(o.points, outset) : o.points;
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  } else {
    ctx.moveTo(o.x1, o.y1);
    ctx.lineTo(o.x2, o.y2);
  }
}

/**
 * 选中 / hover 高亮叠加层（issue 35 F1 + issue 56）：
 * 瓦片不含选中态，选中与 hover 一律由主画布在瓦片 blit 之上逐帧叠加 → 选择/hover 变化 0 瓦片重建。
 * 层级（C3）：真实选中（暗底 + 亮面）> hover 亮面（α0.7）> 幽灵（0.35，由 renderToolPreview 绘制）。
 */
export function renderSelectionOverlay(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, visibleNotes: { note: ChartNote; index: number }[]) {
  const outlines = collectSelectionOutlines(c, rc, visibleNotes);
  if (outlines.length === 0) return;
  const s = rc.viewport.scale * (rc.display?.noteSize ?? 1);
  const lw = Math.max(1, SELECTION_OUTLINE.lineWidth * s);
  // hover / 危险描边更粗一档（与删除红区分；用户 2026-09-09 反馈）
  const hoverLw = Math.max(lw, SELECTION_OUTLINE.hoverLineWidth * s);
  const darkLw = lw + 2 * Math.max(0.5, SELECTION_OUTLINE.darkBand * s);
  const bpmLw = Math.max(2, SELECTION_OUTLINE.bpmLineWidth * s);
  const radius = SELECTION_OUTLINE.radius * s;
  const selectedOutset = SELECTION_OUTLINE.outset * s;
  const hoverOutset = (SELECTION_OUTLINE.outset + SELECTION_OUTLINE.hoverOutset) * s;
  ctx.save();
  ctx.lineJoin = 'round';
  for (const o of outlines) {
    const width = o.shape === 'line' ? bpmLw : (o.mode === 'selected' ? lw : hoverLw);
    // compact（滑条结点/段）不外扩、不画暗底：避免外圈压住紧邻的连接带
    const compact = (o.shape === 'rect' || o.shape === 'quad') && o.compact === true;
    const outset = compact ? 0 : (o.mode === 'selected' ? selectedOutset : hoverOutset);
    // 暗底：只给真实选中（Q11：hover 只画亮面）；BPM 线无外圈；compact 跳过。
    // 暗底画在**更外侧**的路径上（外扩 +darkBand）→ 内缘与亮面内缘齐平，暗色整圈落在音符外，不压墨迹。
    if (o.mode === 'selected' && o.shape !== 'line' && !compact) {
      ctx.globalAlpha = SELECTION_OUTLINE.selectedAlpha;
      ctx.strokeStyle = SELECTION_COLORS.dark;
      ctx.lineWidth = darkLw;
      traceOutline(ctx, o, outset + Math.max(0.5, SELECTION_OUTLINE.darkBand * s), radius);
      ctx.stroke();
    }
    ctx.globalAlpha = o.mode === 'selected' ? SELECTION_OUTLINE.selectedAlpha : SELECTION_OUTLINE.hoverAlpha;
    ctx.strokeStyle = o.mode === 'danger' ? SELECTION_COLORS.danger : SELECTION_COLORS.bright;
    ctx.lineWidth = width;
    traceOutline(ctx, o, outset, radius);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 绘制方向键整组（issue 29 视觉修订 2026-08-24）：N 条覆盖轨道各贴一枚扁平本体 +
 * note_flick_top_l/r 箭头组合到最外侧（几何由构建期墨迹推导，见 noteSkin.ts）。
 * 本体轨道间距只随视口 scale（贴轨道）；箭头重叠量随 spriteScale（随 noteSize 等比）。
 */
function renderDirGroup(ctx: CanvasRenderingContext2D, rc: RenderCtx, group: DirGroupVisual, anchorX: number, anchorY: number, spriteScale: number) {
  for (const b of group.bodies) {
    rc.spriteIcon.render(ctx, {
      ...b.config,
      canvasX: anchorX + b.offsetVirtualX * rc.viewport.scale,
      canvasY: anchorY,
      canvasSize: DIRECTIONAL_ICON_SIZE, canvasWidth: DIRECTIONAL_ICON_SIZE,
      canvasHeight: DIRECTIONAL_ICON_SIZE * DIRECTIONAL_HEIGHT_SCALE,
      scale: spriteScale, renderLayer: 'main',
    });
  }
  const cv = group.chevron;
  if (cv) {
    rc.spriteIcon.render(ctx, {
      ...cv.config,
      canvasX: anchorX + cv.offsetVirtualX * rc.viewport.scale + cv.extraDesignX * spriteScale,
      canvasY: anchorY,
      canvasSize: DIRECTIONAL_ICON_SIZE, canvasWidth: cv.drawW, canvasHeight: cv.drawH,
      scale: spriteScale, renderLayer: 'main',
    });
  }
}

/**
 * 色觉辅助（issue 39 #4）半拍判断：音符精确拍位 pos = beat + subBeat/beatDisplay
 * （与 getNoteVirtualY 同一折算口径）是否落在 0.5 拍整数倍上。
 * 实拍（普通）款式 = 半拍整数倍；其余细分（如 1/4 拍的 0.25 偏移）→ 虚拍款式。
 * beatDisplay 含 3/6/12 等非 2 幂网格（1/3 拍二进制不可精确表示），故用容差判整。
 */
export function isHalfBeatAligned(beat: number, subBeat: number, beatDisplay: number): boolean {
  const pos = beat + (subBeat > 0 ? subBeat / beatDisplay : 0);
  return Math.abs(pos * 2 - Math.round(pos * 2)) < 1e-9;
}

/**
 * 绘制音符（第一层：主体；第二层：装饰器）。
 * issue 56 a)：本函数**不画任何选中/hover 描边**——一律由 renderSelectionOverlay 在叠加层绘制，
 * 瓦片与直渲两条路径共用同一实现（issue 35 F1：选择变化 0 瓦片重建）。
 */
export function renderNotes(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, visibleNotes: { note: ChartNote; index: number }[]) {
  // issue 39 #1：节奏图示大小（音符占轨道比例，默认 1）。乘进视图 scale → 图标本体与
  // 组合挂件（方向滑键的装饰器 offset 同乘 scale）整体等比缩放，相对间距不变（修回归）。
  const ns = rc.display?.noteSize ?? 1;
  const spriteScale = rc.viewport.scale * ns;
  // 音符皮肤图标集（issue 29）：按 settings.visual.noteSkin 解析的 per-lane 官方精灵
  const icons = rc.noteIcons;
  // 同时点击线（issue 39 #3）：画在音符层内、音符主体之前 → 与音符同一瓦片/同一缩放基准，
  // 缩放下线随音符一起比例缩放（修回归）；slide 起止端点也参与双押线。
  if (rc.display?.simultaneousClickLines) {
    renderSimultaneousClickLines(ctx, c, rc, visibleNotes);
  }
  // 第一层：普通音符和方向键主体
  visibleNotes.forEach(({ note }) => {
    if (note.type === "Single") {
      const subBeat = note.subBeat || 0;
      const canvasPos = c.virtualToCanvas(c.getNoteVirtualX(note.lane), c.getNoteVirtualY(note.beat, subBeat));
      // 选款与描边收集端共用（描边贴合实际绘制的墨迹）
      const iconConfig = singleIconConfig(rc, note);
      rc.spriteIcon.render(ctx, {
        ...iconConfig,
        canvasX: canvasPos.x, canvasY: canvasPos.y,
        canvasSize: NOTE_ICON_SIZE,
        // issue 40：主音符矩形已收紧到墨迹，绘制尺寸取 out（墨迹屏幕尺寸），默认回退 NOTE_ICON_SIZE
        canvasWidth: iconConfig.out?.w ?? NOTE_ICON_SIZE,
        canvasHeight: iconConfig.out?.h ?? NOTE_ICON_SIZE * NOTE_HEIGHT_SCALE,
        scale: spriteScale, renderLayer: 'main',
      });
    } else if (note.type === "LDirectional" || note.type === "RDirectional") {
      const subBeat = note.subBeat || 0;
      const canvasPos = c.virtualToCanvas(c.getNoteVirtualX(note.lane), c.getNoteVirtualY(note.beat, subBeat));
      const isLeft = note.type === "LDirectional";
      // issue 29：N 条覆盖轨道扁平本体 + 最外侧箭头（dirGroup 几何由墨迹推导）
      const len = Math.min(Math.max(note.length || 1, 1), 3);
      renderDirGroup(ctx, rc, icons.dirGroup(isLeft ? 'L' : 'R', len), canvasPos.x, canvasPos.y, spriteScale);
    } else if (note.type === "Slide" || note.type === "Long") {
      renderSlideBody(ctx, c, rc, note);
    }
  });

  // 第二层：装饰器层 - 确保装饰器在所有音符之上
  // 用户 2026-08-25 反馈：flick 实际放置时无装饰箭头（皮肤预览有，画布没有）。
  // 根因：之前用 renderLayer: 'decorators' 单独渲染 dec，该分支要求主精灵传 decorators
  // 才会触发挂件渲染；直接 ...dec 当主精灵又会被 drawSingle 忽略 offsetX/offsetY。
  // 修法：调 spriteIcon.renderDecorator（专门为"主精灵已画、补一个挂件"设计），
  // offsetX/offsetY 正确按 spriteScale 应用。
  visibleNotes.forEach(({ note }) => {
    if (note.type === "Single" && note.flick) {
      const dec = icons.flickTopDecorator;
      if (!dec) return;
      const subBeat = note.subBeat || 0;
      const canvasPos = c.virtualToCanvas(c.getNoteVirtualX(note.lane), c.getNoteVirtualY(note.beat, subBeat));
      const flickCfg = icons.flickFor(note.lane);
      const anchor = {
        canvasX: canvasPos.x,
        canvasY: canvasPos.y,
        drawW: flickCfg.out?.w ?? NOTE_ICON_SIZE,
        drawH: flickCfg.out?.h ?? NOTE_ICON_SIZE * NOTE_HEIGHT_SCALE,
      };
      rc.spriteIcon.renderDecorator(ctx, anchor, dec, spriteScale);
    }
  });
}

/** 渲染一条滑条/长条：连接带 + 各结点（选中/hover 高亮由叠加层绘制，见 renderSelectionOverlay） */
function renderSlideBody(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, note: ChartNote) {
  const connections = (note as SlideNote).connections;
  if (connections.length < 2) return;
  // issue 39 #1：slide 结点（起止/中间）图标随节奏图示大小缩放；连接带是线条，不随。
  const spriteScale = rc.viewport.scale * (rc.display?.noteSize ?? 1);
  const icons = rc.noteIcons;

  for (let i = 0; i < connections.length - 1; i++) {
    renderSegmentBand(ctx, c, rc, connections[i], connections[i + 1], rc.display?.slideOpacity ?? 1);
  }

  connections.forEach((conn, i) => {
    const canvasPos = c.virtualToCanvas(c.getNoteVirtualX(conn.lane), c.getNoteVirtualY(conn.beat, conn.subBeat || 0));
    if (conn.hidden) return;
    // 端点 = 单键皮肤（定案），结点带 flick/skill 时换对应图（spread 覆盖 src/矩形）；
    // 选款与描边收集端共用（描边贴合实际绘制的墨迹）
    const iconConfig = slideNodeIconConfig(rc, conn, i === 0, i === connections.length - 1);
    rc.spriteIcon.render(ctx, {
      ...iconConfig,
      canvasX: canvasPos.x, canvasY: canvasPos.y,
      canvasSize: SLIDE_ICON_SIZE, canvasWidth: SLIDE_ICON_SIZE,
      canvasHeight: SLIDE_ICON_SIZE * SLIDE_HEIGHT_SCALE,
      scale: spriteScale,
    });
  });

  // 补 flick 装饰箭头（fix: "flick 覆盖 Slide 尾部时装饰箭头缺失"）：
  // 上面 spread 了 flickFor() 替换主精灵,但 flickFor 不含 flickTopDecorator 字段
  // （Single 类型的装饰箭头在调用方 renderChart 的第二层显式补,见 line 290 注释）。
  // slide/long 走 renderSlideBody 单点处理,这里必须自己补,否则尾部带 flick 的
  // connection 画不出墨迹箭头,与 Single flick 视觉不一致。
  const dec = icons.flickTopDecorator;
  if (dec) {
    connections.forEach((conn) => {
      if (!conn.flick) return;
      const pos = c.virtualToCanvas(c.getNoteVirtualX(conn.lane), c.getNoteVirtualY(conn.beat, conn.subBeat || 0));
      const flickCfg = icons.flickFor(conn.lane);
      rc.spriteIcon.renderDecorator(ctx, {
        canvasX: pos.x, canvasY: pos.y,
        drawW: flickCfg.out?.w ?? NOTE_ICON_SIZE,
        drawH: flickCfg.out?.h ?? NOTE_ICON_SIZE * NOTE_HEIGHT_SCALE,
      }, dec, spriteScale);
    });
  }

}

/** 绘制选择框 */
export function renderSelectionBox(ctx: CanvasRenderingContext2D, rc: RenderCtx) {
  if (!rc.selectionBox) return;
  const { x1, y1, x2, y2 } = rc.selectionBox;
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  ctx.fillStyle = 'rgba(0, 123, 255, 0.2)';
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
  ctx.strokeStyle = 'rgba(0, 123, 255, 0.8)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
  ctx.setLineDash([]);
}

/**
 * 绘制待连接锚点（第一击落下的临时滑条端点）。
 * issue 65③：锚点在语义上**就是滑条的起点端点** → 直接画与成条后同一枚端点精灵
 * （旧实现的青色同心圆靶标整体删除，用户定案"不加待连接光环、不加透明度"）。
 */
export function renderSlideBuffer(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  if (!rc.slideBuffer) return;
  const { beat, lane, subBeat } = rc.slideBuffer;
  const { x, y } = c.virtualToCanvas(c.getNoteVirtualX(lane), c.getNoteVirtualY(beat, subBeat || 0));
  const icon = slideNodeIconConfig(rc, { lane }, true, true);
  const spriteScale = rc.viewport.scale * (rc.display?.noteSize ?? 1);
  rc.spriteIcon.render(ctx, {
    ...icon,
    canvasX: x, canvasY: y,
    canvasSize: SLIDE_ICON_SIZE, canvasWidth: SLIDE_ICON_SIZE,
    canvasHeight: SLIDE_ICON_SIZE * SLIDE_HEIGHT_SCALE,
    scale: spriteScale,
  });
}

/** 渲染单个精灵图标（幽灵/预览用；透明度由调用方 ctx.globalAlpha 控制） */
function renderSpriteGhost(ctx: CanvasRenderingContext2D, rc: RenderCtx, icon: SpriteIconConfig, cx: number, cy: number, size: number, heightScale: number) {
  // issue 40：主音符矩形已收紧到墨迹，ghost 也用 out 保持一致；方向滑键等无 out 用传入尺寸
  const w = icon.out?.w ?? size;
  const h = icon.out?.h ?? size * heightScale;
  rc.spriteIcon.render(ctx, {
    ...icon,
    canvasX: cx, canvasY: cy,
    canvasSize: size, canvasWidth: w, canvasHeight: h,
    scale: rc.viewport.scale,
  });
}

/**
 * 渲染滑条的**连接带**（不含结点图标）：实绘 `renderSlideBody` 与 issue 65④ 的"段幽灵"共用同一画法。
 * @param alpha 连接带不透明度；`undefined` = 沿用调用方的 `globalAlpha`（幽灵态由此继承 0.35/0.5）
 */
function renderSegmentBand(
  ctx: CanvasRenderingContext2D,
  c: Coords,
  rc: RenderCtx,
  from: { lane: number; beat: number; subBeat?: number },
  to: { lane: number; beat: number; subBeat?: number },
  alpha?: number,
) {
  const p1 = c.virtualToCanvas(c.getNoteVirtualX(from.lane), c.getNoteVirtualY(from.beat, from.subBeat || 0));
  const p2 = c.virtualToCanvas(c.getNoteVirtualX(to.lane), c.getNoteVirtualY(to.beat, to.subBeat || 0));
  // issue 39 #1 补修：连接带宽度与结点图标同步 × noteSize，避免调大小后带与结点脱节
  const half = (LANE_WIDTH * rc.viewport.scale * (rc.display?.noteSize ?? 1)) / 2;
  const quad = [[p1.x - half, p1.y], [p1.x + half, p1.y], [p2.x + half, p2.y], [p2.x - half, p2.y]];
  const minX = Math.min(p1.x - half, p2.x - half);
  const maxX = Math.max(p1.x + half, p2.x + half);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const w = maxX - minX, h = maxY - minY;
  const sz = Math.max(Math.sqrt(w * w + h * h), Math.max(w, h)) * 1.0;
  ctx.save();
  // issue 39 #2：长压线不透明度（slide 线条透明度，1 = 完全不透明）
  if (alpha !== undefined) ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(quad[0][0], quad[0][1]);
  for (let j = 1; j < quad.length; j++) ctx.lineTo(quad[j][0], quad[j][1]);
  ctx.closePath();
  ctx.clip();
  rc.spriteIcon.render(ctx, {
    ...rc.noteIcons.slideBand,
    canvasX: cx, canvasY: cy, canvasSize: sz, canvasWidth: sz, canvasHeight: h, scale: 1,
  });
  ctx.restore();
}

/** 渲染一条滑条的完整外观幽灵（连接带 + 各结点图标） */
function renderSlideGhost(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, note: { connections: SlideNote['connections'] }) {
  const conns = note.connections;
  if (conns.length < 2) return;
  for (let i = 0; i < conns.length - 1; i++) {
    renderSegmentBand(ctx, c, rc, conns[i], conns[i + 1]);
  }
  conns.forEach((conn, i) => {
    if (conn.hidden) return; // 与 renderSlideBody 同口径：重合衔接点不画图标（幽灵 = 实绘同形）
    const cpt = c.virtualToCanvas(c.getNoteVirtualX(conn.lane), c.getNoteVirtualY(conn.beat, conn.subBeat || 0));
    // issue 65①：端点/中间结点各取各自款式（旧实现一律端点款 → 中间结点在幽灵里像单键）
    const icon = slideNodeIconConfig(rc, conn, i === 0, i === conns.length - 1);
    renderSpriteGhost(ctx, rc, icon, cpt.x, cpt.y, SLIDE_ICON_SIZE, SLIDE_HEIGHT_SCALE);
  });
}

/** 渲染一个音符的完整外观幽灵（真实图标；方向键保留 length 变体） */
function renderNoteGhost(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, note: ChartNote) {
  const icons = rc.noteIcons;
  if (note.type === "Single") {
    const cpt = c.virtualToCanvas(c.getNoteVirtualX(note.lane), c.getNoteVirtualY(note.beat, note.subBeat || 0));
    let icon = icons.tapFor(note.lane);
    if (note.flick) icon = icons.flickFor(note.lane);
    else if (note.skill) icon = icons.skillFor(note.lane);
    // 色觉辅助（issue 39 #4）：与 renderNotes 同口径，幽灵预览同步显示虚拍款
    else if (rc.display?.colorAssist && !isHalfBeatAligned(note.beat, note.subBeat || 0, rc.beatDisplay)) icon = icons.tapVirtualFor(note.lane);
    renderSpriteGhost(ctx, rc, icon, cpt.x, cpt.y, NOTE_ICON_SIZE, NOTE_HEIGHT_SCALE);
    // 滑键幽灵此前只有本体、缺顶部箭头（与画布实绘不一致）→ 补挂件，锚点口径同 renderNotes 的第二层
    if (note.flick && icons.flickTopDecorator) {
      const flickCfg = icons.flickFor(note.lane);
      rc.spriteIcon.renderDecorator(ctx, {
        canvasX: cpt.x, canvasY: cpt.y,
        drawW: flickCfg.out?.w ?? NOTE_ICON_SIZE,
        drawH: flickCfg.out?.h ?? NOTE_ICON_SIZE * NOTE_HEIGHT_SCALE,
      }, icons.flickTopDecorator, rc.viewport.scale);
    }
  } else if (note.type === "LDirectional" || note.type === "RDirectional") {
    const cpt = c.virtualToCanvas(c.getNoteVirtualX(note.lane), c.getNoteVirtualY(note.beat, note.subBeat || 0));
    // issue 29：与 renderNotes 同构（扁平本体 ×N + 外侧箭头）
    const isLeft = note.type === "LDirectional";
    const len = Math.min(Math.max(note.length || 1, 1), 3);
    renderDirGroup(ctx, rc, icons.dirGroup(isLeft ? 'L' : 'R', len), cpt.x, cpt.y, rc.viewport.scale);
  } else if (note.type === "Slide" || note.type === "Long") {
    renderSlideGhost(ctx, c, rc, note);
  }
}

/** 放置工具态幽灵：按工具构造一个代表音符（方向键默认 length=1） */
function ghostNoteForTool(tool: string, lane: number, beat: number): ChartNote | null {
  switch (tool) {
    case 'single': return { type: "Single", lane, beat, subBeat: 0 };
    case 'flick': return { type: "Single", lane, beat, subBeat: 0, flick: true };
    case 'skill': return { type: "Single", lane, beat, subBeat: 0, skill: true };
    case 'ldirectional': return { type: "LDirectional", lane, beat, subBeat: 0, length: 1 };
    case 'rdirectional': return { type: "RDirectional", lane, beat, subBeat: 0, length: 1 };
    default: return null;
  }
}

/** 绘制一组选择条目的镜像结果幽灵（滑条区域保留连接带） */
function drawMirrorGhosts(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, items: SelectionItem[]) {
  for (const it of items) {
    const note = rc.notes[it.noteIndex];
    if (!note) continue;
    if (note.type === "Slide" || note.type === "Long") {
      if (it.kind === 'slideNode') {
        const conn = (note as SlideNote).connections[it.connIndex];
        renderNoteGhost(ctx, c, rc, { type: "Single", lane: 6 - conn.lane, beat: conn.beat, subBeat: conn.subBeat || 0 });
      } else if (it.kind === 'slideRegion') {
        const c1 = (note as SlideNote).connections[it.connIndex];
        const c2 = (note as SlideNote).connections[it.connIndex + 1];
        renderSlideGhost(ctx, c, rc, {
          type: note.type, connections: [
            { ...c1, lane: 6 - c1.lane },
            { ...c2, lane: 6 - c2.lane },
          ],
        } as SlideNote);
      } else {
        renderNoteGhost(ctx, c, rc, mirrorNote(note));
      }
    } else {
      renderNoteGhost(ctx, c, rc, mirrorNote(note));
    }
  }
}

/** 镜像工具态悬停预览：仅预览单个键 */
function drawMirrorHoverGhost(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, hit: SelectionItem) {
  const note = rc.notes[hit.noteIndex];
  if (!note) return;
  if (note.type === "Slide" || note.type === "Long") {
    if (hit.kind !== 'slideNode' && hit.kind !== 'slideRegion') return;
    const conn = (note as SlideNote).connections[hit.connIndex];
    renderNoteGhost(ctx, c, rc, { type: "Single", lane: 6 - conn.lane, beat: conn.beat, subBeat: conn.subBeat || 0 });
  } else {
    renderNoteGhost(ctx, c, rc, mirrorNote(note));
  }
}

/** 工具态预览：光标/框选处绘制低透明度结果幽灵（ADR-0002 §4） */
export function renderToolPreview(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  if (!rc.hoverPos) return;
  const pos = c.getLaneBeatFromCanvas(rc.hoverPos.cx, rc.hoverPos.cy);
  if (!pos) return;

  ctx.save();
  ctx.globalAlpha = 0.35;

  if (rc.armedTool === 'single' || rc.armedTool === 'flick' || rc.armedTool === 'skill'
      || rc.armedTool === 'ldirectional' || rc.armedTool === 'rdirectional') {
    const ghost = ghostNoteForTool(rc.armedTool, pos.lane, pos.preciseBeat);
    if (ghost) renderNoteGhost(ctx, c, rc, ghost);
    ctx.restore();
    return;
  }

  // issue 65④：滑条工具态此前什么都不画 → 补两档 hover 幽灵。
  if (rc.armedTool === 'slide') {
    const buf = rc.slideBuffer;
    const bufBeat = buf ? buf.beat + (buf.subBeat || 0) / rc.beatDisplay : 0;
    // 与锚点同拍（含同轨同位与"横向段"）→ 第二击走的是取消/禁令分支，永远不成段 → 不画带子
    if (buf && Math.abs(pos.preciseBeat - bufBeat) > 1e-6) {
      renderSegmentBand(ctx, c, rc,
        { lane: buf.lane, beat: buf.beat, subBeat: buf.subBeat || 0 },
        { lane: pos.lane, beat: pos.preciseBeat, subBeat: 0 });
    }
    // 落点端 = 滑条端点款幽灵（第一击前只有这一枚；第一击后与带子同时出现）
    const cpt = c.virtualToCanvas(c.getNoteVirtualX(pos.lane), c.getNoteVirtualY(pos.preciseBeat, 0));
    renderSpriteGhost(ctx, rc, slideNodeIconConfig(rc, { lane: pos.lane }, true, true),
      cpt.x, cpt.y, SLIDE_ICON_SIZE, SLIDE_HEIGHT_SCALE);
    ctx.restore();
    return;
  }

  if (rc.armedTool === 'paste' && rc.clipboard && rc.clipboard.length > 0) {
    // 传入 beatDisplay：带 subBeat 的剪贴板结点才能按真实拍位锚定（与粘贴执行路径一致）
    const shifted = shiftGroupToAnchor(rc.clipboard, pos.preciseBeat, pos.lane, rc.beatDisplay);
    for (const n of shifted) renderNoteGhost(ctx, c, rc, n);
    ctx.restore();
    return;
  }

  if (rc.armedTool === 'mirror') {
    if (rc.selectionBox) {
      drawMirrorGhosts(ctx, c, rc, computeItemsInBox(rc.selectionBox, { geometry: rc.geometry, viewport: rc.viewport, beatDisplay: rc.beatDisplay, notes: rc.notes }));
    } else {
      const hit = findItemAt(rc.hoverPos.cx, rc.hoverPos.cy, { geometry: rc.geometry, viewport: rc.viewport, beatDisplay: rc.beatDisplay, notes: rc.notes });
      if (hit) drawMirrorHoverGhost(ctx, c, rc, hit);
    }
  }

  ctx.restore();
}

/**
 * 拖拽移动落点幽灵（ADR-0008 §6）：指针态拖拽期间在吸附落点绘制移动结果的半透明幽灵，
 * 原位置音符保持不动；松手非法（越界/碰撞）幽灵消失 = 回弹。原音符淡出标记由组件在
 * dragGhost 中排除（未动的音符不进 ghost，瓦片层照常绘制）。
 */
export function renderDragGhost(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  if (!rc.dragGhost || rc.dragGhost.length === 0) return;
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (const n of rc.dragGhost) renderNoteGhost(ctx, c, rc, n);
  ctx.restore();
}

/**
 * 渲染 BPM 标线（issue 51 + 第二轮修订）：低饱和主题色实线（跟随轨道颜色主题主色，Q5=B），
 * 横跨轨道宽度。**由 renderChart 编排在音符层之下**（用户反馈：BPM 线不得覆盖音符，
 * 与轨道线同层语义）；数值文字由 renderBpmLabels 在沟槽层绘制。
 * issue 10：基于可见集而非全量 notes.filter（省 O(n) 扫描与数组分配）。
 */
export function renderBpmLines(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, visibleNotes: { note: ChartNote; index: number }[]) {
  const { trackBgX, trackBgWidth } = c.trackGeometry(rc.viewport.scale);
  const color = gridThemeBpmColor(normalizeGridStyle(rc.display?.gridStyle));
  for (const { note } of visibleNotes) {
    if (note.type !== "BPM") continue;
    const y = c.virtualToCanvas(0, c.getNoteVirtualY(note.beat)).y;
    if (y < -50 || y > rc.surface.h + 50) continue;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5 * rc.viewport.scale;
    ctx.beginPath();
    ctx.moveTo(trackBgX, y);
    ctx.lineTo(trackBgX + trackBgWidth, y);
    ctx.stroke();
  }
}

/**
 * 渲染 BPM 数值（issue 51 + 第二轮修订）：仅数值（不带 "BPM" 前缀），内带锚定
 * （贴轨道左外缘 8px）、垂直居中于线、字号 = 14px × labelScale；越出画布时钳制
 * （"都在谱面范围内"）。由 renderChart 编排在沟槽层（音符之上，沟槽内无音符）。
 */
export function renderBpmLabels(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, visibleNotes: { note: ChartNote; index: number }[]) {
  const color = gridThemeBpmColor(normalizeGridStyle(rc.display?.gridStyle));
  const labelScale = rc.display?.labelScale ?? 1;
  for (const { note } of visibleNotes) {
    if (note.type !== "BPM") continue;
    const y = c.virtualToCanvas(0, c.getNoteVirtualY(note.beat)).y;
    if (y < -50 || y > rc.surface.h + 50) continue;
    const layout = clampGutterLabelY(
      layoutGutterLabel(c, rc.viewport.scale, y, 'centered', 'bpm', labelScale),
      rc.surface.h, GUTTER_LABEL_FONT_PX * labelScale,
    );
    drawGutterLabel(ctx, layout, String((note as ChartNote & { bpm: number }).bpm), color);
  }
}

/** 起始线/结束线配色（issue 52 grill 定案：低饱和主题色三线三色，文字同色系更亮一档） */
export const START_LINE_COLOR = '#53b8c9';
export const START_TEXT_COLOR = '#7fd4e5';
export const END_LINE_COLOR = '#d97b5a';
export const END_TEXT_COLOR = '#f0a07e';

/**
 * 谱面起始线 / 结束线（issue 52 + 第二/三/四轮修订）：
 * - 线 = 低饱和青蓝 / 暖橙虚线，**只画轨道两侧沟槽段**（第三轮：覆盖轨道内太影响观感）；
 * - 文字 = START / END：**外带锚定**（动态间距，远离 BPM 数值内带——第二轮 Q2=A），
 *   纵向**居中骑线**（第四轮：与 BPM 数值同位对齐，替代最初的"上/下"定位），
 *   钳制在画布内；字号 = 21px × labelScale。
 */
export function renderBoundLines(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  const labelScale = rc.display?.labelScale ?? 1;
  const draw = (beat: number, lineColor: string, textColor: string, label: string) => {
    const canvasY = c.virtualToCanvas(0, c.beatToVirtualY(beat)).y;
    if (canvasY < -24 || canvasY > rc.surface.h + 24) return;
    const { trackStartX, totalTrackWidth } = c.trackGeometry(rc.viewport.scale);
    ctx.save();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2 * rc.viewport.scale;
    ctx.setLineDash([6 * rc.viewport.scale, 5 * rc.viewport.scale]);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, canvasY);
    ctx.lineTo(trackStartX, canvasY);
    ctx.moveTo(trackStartX + totalTrackWidth, canvasY);
    ctx.lineTo(rc.surface.w, canvasY);
    ctx.stroke();
    ctx.restore();
    const layout = clampGutterLabelY(
      layoutGutterLabel(c, rc.viewport.scale, canvasY, 'centered', 'bound', labelScale),
      rc.surface.h, GUTTER_LABEL_FONT_PX * labelScale,
    );
    drawGutterLabel(ctx, layout, label, textColor);
  };
  draw(0, START_LINE_COLOR, START_TEXT_COLOR, 'START');
  draw(rc.chartEndBeat, END_LINE_COLOR, END_TEXT_COLOR, 'END');
}

/** 实时显示线线色（issue 54：中性白半透明细线，不占用主题色——主题色留给常显装饰） */
const HOVER_LINE_COLOR = 'rgba(240, 244, 248, 0.55)';
/** 实时信息文字（issue 54 + 第二轮 Q1=A）：基准 11px（比常显标线 14px 小一档）× labelScale、
 *  等宽（数值变化不跳动）、中性白半透明——"临时读数 ≠ 常显装饰" */
const HOVER_INFO_FONT_PX = 16.5;
const HOVER_INFO_FONT = (labelScale: number) => `${HOVER_INFO_FONT_PX * labelScale}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
const HOVER_INFO_COLOR = 'rgba(232, 238, 244, 0.65)';
const HOVER_INFO_GAP_PX = 8;

/**
 * 实时显示线（issue 54）：鼠标所在位置的水平线，**只在轨道宽度内绘制**（沟槽不画），
 * 由 renderChart 编排在音符层之下。连续跟随鼠标 Y（不吸附网格）。
 */
export function renderHoverLine(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  if (!rc.hoverPos) return;
  const { trackBgX, trackBgWidth } = c.trackGeometry(rc.viewport.scale);
  ctx.save();
  ctx.strokeStyle = HOVER_LINE_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(trackBgX, rc.hoverPos.cy);
  ctx.lineTo(trackBgX + trackBgWidth, rc.hoverPos.cy);
  ctx.stroke();
  ctx.restore();
}

/**
 * 实时显示线两侧沟槽信息（issue 54）：左 = 分内时间 `SS.ss`（00.00–59.99 循环），
 * 右 = 已过音符数 `♪ N`（与判定线计数同口径 countNotesUpToBeat：含恰好在线上的音符、
 * 滑条算 1 条、BPM/System 不计）。由 renderChart 编排在常显装饰文字（BPM 数值/START/END）
 * **之上**——临时浮动信息优先于常显装饰。
 */
export function renderHoverInfo(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  if (!rc.hoverPos) return;
  const { trackStartX, totalTrackWidth } = c.trackGeometry(rc.viewport.scale);
  const labelScale = rc.display?.labelScale ?? 1;
  const beat = c.virtualYToBeat(c.canvasToVirtual(rc.hoverPos.cx, rc.hoverPos.cy).y);
  const seconds = beatToSeconds(getBpmEvents(rc.notes), beat);
  const count = countNotesUpToBeat(rc.notes, beat);
  ctx.save();
  ctx.font = HOVER_INFO_FONT(labelScale);
  ctx.fillStyle = HOVER_INFO_COLOR;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillText(formatInMinuteTime(seconds), trackStartX - HOVER_INFO_GAP_PX, rc.hoverPos.cy);
  // 右侧锚轨道**右外缘**（含外框 chrome）——锚内容右缘会陷进边条内（用户反馈：向右偏移）
  ctx.textAlign = 'left';
  ctx.fillText(`♪ ${count}`, trackStartX + totalTrackWidth + HOVER_INFO_GAP_PX, rc.hoverPos.cy);
  ctx.restore();
}

/**
 * 同时点击线（issue 39 #3）：同节拍（同一 tick）的水平线音符之间绘制连接线。
 * - 参与音符：Single / 方向滑键 / Slide·Long 的**起止结点**（其内部中间结点即"slide 中间节点"，不参与）；
 *   BPM 不参与。
 * - 按节拍分组（浮点容差），组内按 lane（左→右）链式相邻串联，非全连接；
 * - 普通音符（含 slide 起止结点）端点 = 正中心；方向滑键端点 = 其靠内的边缘（避免线穿过方向图标主体）；
 * - 画在音符主体之前（notes 覆盖过中点的线，故中心连线不"透过"音符本体），颜色 #fefefe 细线贴合水平轨道。
 * - 在 renderNotes 内调用 → 与音符同一瓦片/同一缩放基准，缩放下线随音符一起缩放（修回归）。
 */
export function renderSimultaneousClickLines(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, visibleNotes: { note: ChartNote; index: number }[]) {
  const ns = rc.display?.noteSize ?? 1;
  const base = ns * rc.viewport.scale; // 图标基础缩放（canvas px / 设计尺寸）
  // 方向滑键连接线端点 = 可见墨迹边缘（issue 40）：精灵框内含横向透明留白，若按精灵框边缘定位，
  // 线头会与可见墨迹之间留空隙。这里用规范化后的 inkLeft/inkRight（源像素缩进）换算成
  // 「墨迹边缘距图标中心」的 canvas px，线头天然贴合真实墨迹边缘；普通音符（含 slide 起止结点）仍用正中心。
  type P = { x: number; y: number; dirEdge: { left: number; right: number } | null };
  const groups = new Map<number, P[]>();
  const EPS = 1e-6;
  const key = (beat: number, subBeat?: number): number => beat + (subBeat && subBeat > 0 ? subBeat / rc.beatDisplay : 0);

  const push = (k: number, lane: number, beat: number, subBeat: number | undefined, dirEdge: P['dirEdge']) => {
    const pos = c.virtualToCanvas(c.getNoteVirtualX(lane), c.getNoteVirtualY(beat, subBeat || 0));
    let arr: P[] | undefined;
    for (const [gk, g] of groups) {
      if (Math.abs(gk - k) < EPS) { arr = g; break; }
    }
    if (!arr) { arr = []; groups.set(k, arr); }
    arr.push({ x: pos.x, y: pos.y, dirEdge });
  };

  for (const { note } of visibleNotes) {
    if (note.type === 'Single') {
      push(key(note.beat, note.subBeat), note.lane, note.beat, note.subBeat, null);
    } else if (note.type === 'LDirectional' || note.type === 'RDirectional') {
      // issue 29：墨迹取当前皮肤该轨道方向键精灵的覆写/缺省值
      const ink = rc.noteIcons.dirInk(note.type === 'LDirectional' ? 'L' : 'R');
      push(key(note.beat, note.subBeat), note.lane, note.beat, note.subBeat, {
        left: DIRECTIONAL_ICON_SIZE * base * (0.5 - ink.inkLeft / ink.w),
        right: DIRECTIONAL_ICON_SIZE * base * (0.5 - ink.inkRight / ink.w),
      });
    } else if (note.type === 'Slide' || note.type === 'Long') {
      const conns = (note as SlideNote).connections;
      if (conns.length < 2) continue;
      // 起止结点参与（中间结点 = slide 中间节点，不参与）
      const first = conns[0], last = conns[conns.length - 1];
      if (!first.hidden) push(key(first.beat, first.subBeat), first.lane, first.beat, first.subBeat, null);
      if (!last.hidden) push(key(last.beat, last.subBeat), last.lane, last.beat, last.subBeat, null);
    }
  }

  ctx.save();
  ctx.strokeStyle = '#fefefe';
  ctx.lineWidth = Math.max(1, 1.5 * rc.viewport.scale);
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => a.x - b.x);
    for (let i = 0; i < g.length - 1; i++) {
      const a = g[i], b = g[i + 1];
      // 左端点取 a 的右缘墨迹，右端点取 b 的左缘墨迹；普通音符（含 slide 起止结点）用正中心
      const fromX = a.dirEdge != null ? a.x + a.dirEdge.right : a.x;
      const toX = b.dirEdge != null ? b.x - b.dirEdge.left : b.x;
      ctx.beginPath();
      ctx.moveTo(fromX, a.y);
      ctx.lineTo(toX, b.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * 单次全量绘制编排（ADR-0003 候选 B 的组件薄层入口）：
 * 设置画布尺寸 → 静态层 blit（离屏缓存，issue 36 F2）→ 音符（离屏瓦片层）→ BPM → 选择框 → 滑条缓冲 → 工具预览 → 判定线 → 起点标记。
 * 不持有任何 React 状态；虚拟高度同步等副作用由组件自行处理。
 * issue 10：缓冲尺寸仅在变化时重设（每帧重设会强制重分配像素缓冲并清空画布状态）；
 * issue 36 F2：清屏/背景/轨道底/网格/起止线收敛进 staticLayerCache——交互帧只 blit，
 * 滚动/缩放帧重建一次（与旧直绘同阶），消除密集谱下每帧全量重绘静态层的固定地板成本。
 */
export function renderChart(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, rc: RenderCtx) {
  // issue 50（Q24 a + Q8 a 延伸）：surface 未就绪时（null）不渲染——
  // 保护所有依赖 surface 的绘制（几何/缓冲/像素坐标）
  if (!rc.surface) return;
  const t0 = perf.enabled ? performance.now() : 0;
  // buffer = surface × dpr（ADR-0006 §1）；此后绘制/命中均用 CSS 像素坐标
  const bw = Math.round(rc.surface.w * rc.dpr), bh = Math.round(rc.surface.h * rc.dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  ctx.setTransform(rc.dpr, 0, 0, rc.dpr, 0, 0);

  // issue 40（渲染质量）：统一/声明精灵图平滑策略——源图缩到音符尺寸用**双线性平滑**缩放
  // （能保留边缘层次，优于 DOM 版的 'pixelated' 硬边；'pixelated' 仅用于工具栏等小 UI 图标的
  // DOM 展示，两者用途不同）。quality='high' 用更高阶滤波（双三次）进一步压低缩小时的
  // 子像素混色/边缘杂色（配合源矩形已收紧到墨迹）。
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 静态层（黑底+轨道底+网格+起止线，含整幅清屏）离屏缓存 blit（issue 36 F2）
  drawStaticLayer(ctx, rc);

  const c = makeCoords(rc.geometry, rc.viewport, rc.beatDisplay, rc.notes);

  // BPM 标线（issue 51 + 用户反馈）：在音符层**之下**（与轨道线同层语义，不覆盖音符）
  renderBpmLines(ctx, c, rc, c.getVisibleNotes());
  // 实时显示线（issue 54）：鼠标 Y 水平线，画在音符层之下
  renderHoverLine(ctx, c, rc);

  // 同时点击线（issue 39 #3）：画在音符层之下，音符图标覆盖其中点连线
  if (rc.display?.simultaneousClickLines) {
    renderSimultaneousClickLines(ctx, c, rc, c.getVisibleNotes());
  }
  // 音符层走离屏瓦片缓存（issue 10）：缩放/滚动帧只 blit 瓦片，不逐音符重绘
  drawNotesLayer(ctx, rc);
  // BPM 数值（issue 51）：沟槽层，基于可见集（二分剔除，O(log n + 可见数)）
  const visibleNotes = c.getVisibleNotes();
  renderBpmLabels(ctx, c, rc, visibleNotes);
  // 实时信息文字（issue 54）：两侧沟槽，画在常显装饰文字之上
  renderHoverInfo(ctx, c, rc);

  if (rc.selectionBox) renderSelectionBox(ctx, rc);
  if (rc.dragGhost) renderDragGhost(ctx, c, rc);
  renderToolPreview(ctx, c, rc);
  // 锚点在语义上是"已经定下的实绘端点"→ 画在滑条 hover 幽灵**之上**（issue 65③④：
  // 否则第一击后那条 35% 透明度的段带会糊在锚点上，看起来像锚点被染色）
  renderSlideBuffer(ctx, c, rc);
  renderStartMarker(ctx, c, rc);

  if (perf.enabled) perf.record(performance.now() - t0);
}
