// 谱面渲染纯模块（ADR-0003 候选 B + 候选 3）：把 FinalVirtualCanvas 的 15 个 render* 函数
// 从组件闭包中提出为依赖注入的纯函数。组件每次 RAF 组装 view，`frameFor(target, view)`
// 装配成帧、`renderChart(target, view)` 一次调用出帧。
// 本模块不含任何 React 状态；性能热路径（视口剔除/缓存/增量重绘）将来在此落地。
import type { ChartNote, SelectionItem, SlideNote } from '../chart/types';
import { LANES, LANE_WIDTH, TRACK_CHROME_TOTAL, type ChartGeometry, type GeometryViewport } from '../chart/geometry/ChartGeometry';
import type { BpmBeatRange } from '../chart/geometry/BpmTimeline';
import { isPastChartEnd, trueBeat } from '../chart/editing/ChartEndBounds';
import { indexOfTrailingNegativeBpm } from '../chart/editing/BpmTail';
import { shiftGroupToAnchor, mirrorNote, countNotesUpToBeat, comboNodePreciseBeats } from '../chart/editing/NoteEditing';
import { perf } from '../chart/perf';
import { formatInMinuteTime, formatTimeCompact } from '../chart/geometry/TimeFormat';
import { makeCoords, type Coords } from './coords';
import { computeItemsInBox, computeBpmLinesInBox, findItemAt } from './hitTest/hitTest';
import { slideUsesSpBand, displayConnections, visibleEnds, projectedSlideSpans } from '../chart/editing/SlideSegments';
import { freezeGestureCursor } from '../chart/editing/CanvasGesture';
import { bandPolygonAt, rasterBandRuns, splitBandAtFolds, type BandRasterClipCss } from './slideBandGeometry';
import { previewSpanConnections } from '../chart/editing/SpanCurve';
import { spanParamFromCurveConfig } from '../chart/editing/CurveTool';
import { bufferSizeFor } from './rasterScale';
import type { RenderTarget } from './RenderTarget';
import { drawGutterLabel, drawBpmSummary, layoutGutterLabel, layoutGutterLabelRight, layoutBpmGutter, clampGutterLabelX, clampGutterLabelRightX, clampGutterLabelY, bpmGutterYIntersectsCanvas, bpmLabelAnchorY, measureGutterLabelWidth, GUTTER_LABEL_FONT_PX } from './gutterLabels';
import { GRID_STYLES, GRID_TIER_ORDER, gridBpmLineColor, gridBpmNegativeColor, gridDivisionOf, gridLineDash, gridTierOf, gridThemeBpmColor, normalizeGridStyle, type GridTier } from './gridStyle';
import { SELECTION_COLORS, SELECTION_OUTLINE } from './selectionStyle';
import type { ActiveNoteIcons, DirGroupVisual } from './skin/noteSkin';
import type { FrameView, RenderCtx } from './types';
import CanvasSpriteIcon, { type SpriteIconConfig } from '../ui/CanvasSpriteIcon';

/**
 * 音符 / 滑条结点**选款**真正读到的输入：图标集 + 细分档 + 色觉辅助与镜向两个开关。
 * 收成结构子集是为了让**仿真场**（chart-preview 05）用同一份选款口径 —— 那边没有 `RenderCtx`
 * （不是编辑器画布），只有这几样；编辑器侧传完整帧天然满足，调用点不用改。
 */
export interface IconChoiceCtx {
  noteIcons: ActiveNoteIcons;
  beatDisplay: number;
  display?: { colorAssist?: boolean; mirror?: boolean } | undefined;
}

// 音符大小配置 —— **唯一定义在 `./primitives/noteMetrics`**（issue 82：与 hitTest 命中尺寸同源，
// 各写一份必然漂移）；此处 re-export 以兼容既有引用。
import {
  NOTE_ICON_SIZE, SLIDE_ICON_SIZE, DIRECTIONAL_ICON_SIZE,
  NOTE_HEIGHT_SCALE, SLIDE_HEIGHT_SCALE, DIRECTIONAL_HEIGHT_SCALE,
} from './primitives/noteMetrics';
export {
  NOTE_ICON_SIZE, SLIDE_ICON_SIZE, DIRECTIONAL_ICON_SIZE,
  NOTE_HEIGHT_SCALE, SLIDE_HEIGHT_SCALE, DIRECTIONAL_HEIGHT_SCALE,
};

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
  // issue 158：右键过阈值后的框 = 删除工具框选，同样要预告 BPM。
  const withBpm = rc.armedTool === 'delete' || rc.rightButtonHeld === true
    ? [...items, ...computeBpmLinesInBox(rc.selectionBox, deps)]
    : items;
  return buildSets(withBpm);
};
const isNoteSelected = (sel: SelectionSets, index: number) => sel.notes.has(index);

export const PLAYBACK_MARKER_COLOR = '#55d6d0';
/** 悬停色刻意拉到近白（issue 152 二轮：原来的 #b8fffa 与常态色几乎分不出）。 */
export const PLAYBACK_MARKER_HOVER_COLOR = '#eafffd';
/** 悬停时线宽也加一档，配合旗帜本体的 filter 提亮，让 hover 可发现。 */
const PLAYBACK_MARKER_LINE_WIDTH = 2;
const PLAYBACK_MARKER_HOVER_LINE_WIDTH = 3;

/**
 * 播放起点（ADR-0004 §4 / issue 152）：Canvas 只绘制定位横线，旗帜由共享 SVG 叠加。
 * 起点是**时间轴锚定**：`markerSeconds` 直读布局轴，不经 BPM 换算。
 */
export function renderPlaybackMarker(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  if (rc.markerSeconds === null) return;
  const { trackStartX } = c.trackGeometry(rc.viewport.scale);
  const markerCanvasY = c.virtualToCanvas(0, c.secondsToVirtualY(rc.markerSeconds)).y;
  if (markerCanvasY < -20 || markerCanvasY > rc.surface.h + 20) return;
  const color = rc.markerHovered ? PLAYBACK_MARKER_HOVER_COLOR : PLAYBACK_MARKER_COLOR;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = rc.markerHovered ? PLAYBACK_MARKER_HOVER_LINE_WIDTH : PLAYBACK_MARKER_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(0, markerCanvasY);
  // 只到轨道外壳外沿；不要把标记线画进轨道 chrome 或轨道内容。
  ctx.lineTo(trackStartX, markerCanvasY);
  ctx.stroke();
  ctx.restore();
}

/**
 * 视口可见**拍区间集合**（issue 10 性能 + issue 104 修法 4，纯函数供单测）：
 * 由视口**布局坐标**边界正向求出每个 BPM 段内落进窗口的拍区间，网格只迭代这些区间
 * 而非 [0, chartEndBeat] 全量。倒流区里同一 y 会被多个拍经过 → **多段区间**（旧实现反解成
 * 单个 beat 窗口，折返带上"该画的没画"）；单调谱面下退化为单个区间，与旧口径等价。
 */
export function visibleBeatRanges(
  geometry: ChartGeometry,
  viewport: GeometryViewport,
  chartEndBeat: number,
  viewHeightCss?: number,
): BpmBeatRange[] {
  const out: BpmBeatRange[] = [];
  for (const r of geometry.visibleBeatRanges(viewport, viewHeightCss)) {
    const start = Math.max(0, r.start);
    const end = Math.min(chartEndBeat, r.end);
    if (end >= start) out.push({ start, end });
  }
  return out;
}

/** 轨道竖线 + 左右边条（屏幕空间，不随 scrollY）。 */
export function renderTrackChrome(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  const { trackStartX } = c.trackGeometry(rc.viewport.scale);

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
}

/** 节拍横线贴画布顶/底时收到线宽内侧，避免判定线处整拍被裁没。 */
function snapStrokeY(y: number, surfaceH: number, lineWidth: number): number | null {
  const half = Math.max(lineWidth, 1) / 2;
  if (y < -half || y > surfaceH + half) return null;
  return Math.min(Math.max(y, half), surfaceH - half);
}

/** 节拍/子节拍横线。`rc.surface.h` 与 `viewport.scrollY` 决定枚举窗与 clip（pos 条带可加高）。 */
export function renderGridBeatLines(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  const { trackBgX, trackBgWidth } = c.trackGeometry(rc.viewport.scale);
  const ranges = visibleBeatRanges(rc.geometry, rc.viewport, rc.chartEndBeat, rc.surface.h);
  const es = rc.viewport.scale;
  const style = GRID_STYLES[normalizeGridStyle(rc.display?.gridStyle)];
  const lineShapeTiers = rc.display?.lineShapeTiers === true;
  const gridOpacity = rc.display?.gridOpacity ?? 1; // 轨道线透明度（第三轮补，用户可调）
  // 网格细节档（chart-preview 03 起 / 08 扩成"画到第几级细分"）：'off' 不画横网格；
  // 数字 N = 只画约分分母 ≤ N 的线（1 = 只整拍线）；'all' = 按 beatDisplay 全量（编辑器现状）
  const gridDetail = rc.display?.gridDetail ?? 'all';
  if (gridDetail === 'off') return;
  const maxDivision = gridDetail === 'all' ? Infinity : gridDetail;

  interface GridCandidate { y: number; tier: GridTier }
  const candidates: GridCandidate[] = [];
  // issue 104 修法 4：按**布局坐标派生的拍区间**逐段枚举（每段内 pos 单调、区间连续）；
  // 每个候选独立求 y，不做任何"pos 随 beat 递增"的假设。
  for (const range of ranges) {
    for (let beat = Math.floor(range.start + 1e-9); beat <= range.end + 1e-9; beat++) {
      if (beat < 0 || isPastChartEnd(beat, rc.chartEndBeat)) continue;
      const y = c.virtualToCanvas(0, c.beatToVirtualY(beat)).y;
      if (y >= -8 && y <= rc.surface.h + 8) candidates.push({ y, tier: 'beat' });
      if (maxDivision <= 1) continue;
      for (let subBeat = 1; subBeat < rc.beatDisplay; subBeat++) {
        if (gridDivisionOf(subBeat, rc.beatDisplay) > maxDivision) continue;
        const preciseBeat = trueBeat(beat, subBeat, rc.beatDisplay);
        if (isPastChartEnd(preciseBeat, rc.chartEndBeat)) continue;
        const subY = c.virtualToCanvas(0, c.beatToVirtualY(preciseBeat)).y;
        if (subY < -8 || subY > rc.surface.h + 8) continue;
        candidates.push({ y: subY, tier: gridTierOf(subBeat, rc.beatDisplay) });
      }
    }
  }

  const drawn: number[] = [];
  const tooClose = (y: number, threshold: number) => {
    for (const d of drawn) if (Math.abs(d - y) < threshold) return true;
    return false;
  };

  for (const tier of GRID_TIER_ORDER) {
    const s = style[tier];
    const threshold = tier === 'beat' ? 2 : 5;
    const lw = tier === 'beat' ? Math.max(0.75, s.width * es) : Math.max(0.5, s.width * es);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = lw;
    ctx.globalAlpha = (s.alpha ?? 1) * gridOpacity;
    const dash = gridLineDash(tier, lineShapeTiers, es);
    ctx.setLineDash(dash ?? []);
    // issue 78：虚线相位从路径起点起算，而线长 L = trackBgWidth = 210·es 恰为周期（10·es）的整数倍
    // → 右端点正好落在"下一段 dash 的起点"，末端前 [L−gap, L) 是空档：左端贴边、右端缺一段。
    // 左移半个 dash 长，使左右端相位相同（L ≡ 0 mod period 时两端都被 dash 覆盖到轨道边缘）。
    ctx.lineDashOffset = dash && dash.length > 0 ? dash[0] / 2 : 0;
    for (const cand of candidates) {
      if (cand.tier !== tier) continue;
      const y = snapStrokeY(cand.y, rc.surface.h, lw);
      if (y == null) continue;
      if (tooClose(y, threshold)) continue;
      ctx.beginPath();
      ctx.moveTo(trackBgX, y);
      ctx.lineTo(trackBgX + trackBgWidth, y);
      ctx.stroke();
      drawn.push(y);
    }
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0; // issue 78：ctx 状态，必须复位，否则污染后续虚线（如 renderBoundLines）
  ctx.globalAlpha = 1;
}

/** 绘制网格（轨道竖线 + 节拍/子节拍横线）。只迭代可见拍范围；极小间距时按像素间距抽稀。 */
export function renderGrid(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  renderTrackChrome(ctx, c, rc);
  renderGridBeatLines(ctx, c, rc);
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

/**
 * 单键主精灵选款（与 renderNotes 同口径：描边贴合实际绘制的那枚墨迹）。
 * **标记优先级**：flick > skill > tapVirtual > tap —— issue 147 定案：只有**不带 flick 的单键**
 * 才会变成技能键款式，滑键自身带 `skill` 仍是滑键。幽灵预览（`renderNoteGhost`）也走这里，
 * 保证「幽灵 = 画布实绘同形」（ADR-0002 §4）。
 * 导出仅为可测（与 `slideNodeIconConfig` 同款）。
 */
export function singleIconConfig(rc: IconChoiceCtx, note: { lane: number; beat: number; subBeat?: number; flick?: boolean; skill?: boolean }): SpriteIconConfig {
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
/** 导出仅为可测（与 `computeBackgroundDrawRect` 同款）：实绘/描边/幽灵/待连接锚点四处共用它。 */
export function slideNodeIconConfig(rc: IconChoiceCtx, conn: { lane: number; flick?: boolean; skill?: boolean }, isFirst: boolean, isLast: boolean): SpriteIconConfig {
  const icons = rc.noteIcons;
  const isEndpoint = isFirst || isLast;
  const base = isEndpoint ? icons.slideEndpointFor(conn.lane) : icons.slideAmongFor(conn.lane);
  // issue 145 #3：flick/skill 只有**端点**才渲染（中间结点一律按普通中间结点画）。
  // 数据仍允许带这些标记（谱面代码可改、导出原样），只是画布不表现 —— 实机也不表现。
  if (!isEndpoint) return base;
  // issue 147：端点同时带 flick + skill 时按**与单键同一份优先级**（flick 胜出）。
  // 此前这里 skill 在 spread 顺序上盖住 flick，与 `singleIconConfig` 相反 —— 两端点出现
  // 「技能键底图」而单键出现「滑键 + 箭头」，同一份标记在两种音符上表现不一致。
  if (conn.flick) return { ...base, ...icons.flickFor(conn.lane) };
  if (conn.skill) return { ...base, ...icons.skillFor(conn.lane) };
  return base;
}

/**
 * C4（用户 2026-09-09 修正）：hover **在任何工具态都画**（放置/粘贴/镜像的幽灵态同样画，
 * 与 Q6=A 的"幽灵 + 描边叠加"一致）。hidden 结点在 findItemAt 侧已跳过（A6），
 * BPM 在下方按 Q14：普通工具不参与 hover；删除 / 右键按住除外（issue 163 / 74）。
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
  // issue 89：**删除持工具态这一状态本身**就把整个选区变成"待删预告"（切到删除工具即转红，
  // 不必等鼠标悬停上去）。只认 armedTool 这一源 —— 右键按住（issue 74）只作用光标下那一个对象，
  // 把整片选区染红是误导，故 `rightButtonHeld` 不参与本项。
  const deleteToolArmed = rc.armedTool === 'delete';
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
      // issue 89：删除持工具态下，**选区本身**即走 danger —— 形态与"删除 hover"同款
      // （危险红 + hover 线宽 + hover α，见 renderSelectionOverlay 按 mode 分派），
      // 于是"切到删除工具"= 立刻看到"点它就删"的预告；切回非删除工具自动回落 selected。
      const dangerMode = danger || (dangerTool && inPreviewBox) || (deleteToolArmed && inSel);
      if (inSel) push(dangerMode ? 'danger' : 'selected');
      if (isHoverPart) push(dangerMode ? 'danger' : 'hover');
    };

    if (note.type === 'BPM') {
      // issue 71：BPM 不进选区。框选预览只在删除态画（框选真会删）。
      // issue 74 / 163：右键按住或删除工具命中 → 危险色。普通工具仍无 hover。
      const bpmActHover = hv !== null && (rc.rightButtonHeld === true || deleteToolArmed);
      if (!whole && !previewWhole && !bpmActHover) continue;
      const y = c.virtualToCanvas(0, c.getNoteVirtualY(note.beat)).y;
      const { trackBgX, trackBgWidth } = c.trackGeometry(rc.viewport.scale);
      // 框选预览仍转红（issue 67 / 71：删除框选真会删 BPM）。
      out.push({
        shape: 'line', x1: trackBgX, y1: y, x2: trackBgX + trackBgWidth, y2: y,
        // issue 89：删除持工具态下"已入选的整条线"同样是待删预告 → 与其它类型一致走 danger
        mode: whole && !deleteToolArmed ? 'selected' : (dangerTool ? 'danger' : 'hover'),
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
      const len = note.length;
      const side = dirSideOf(rc, note.type === 'LDirectional');
      const group = rc.noteIcons.dirGroup(side, len);
      // 本体精灵框内左右有透明留白 → 用构建期实测墨迹（dirInk，与同时点击线同一口径）收紧到可见墨迹
      const ink = rc.noteIcons.dirInk(side);
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
      // issue 106：端点款判据按**可见**结点（不再是下标 0 / 末位）——首尾 hidden 的外部数据不再被拒收，
      // 且"只剩 1 个可见结点"的退化滑条按单键（端点）款画（实机同形）；全 hidden → 无可画。
      const ends = visibleEnds(conns);
      if (ends.first < 0) continue;
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
        const cfg = slideNodeIconConfig(rc, conn, ci === ends.first, ci === ends.last);
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
      // issue 106：段的取点走**显示投影**（与实绘 / 命中同源），但选中/hover 的身份仍用**原数组下标**
      // （`view.src` 换算）——否则非单调点序的滑条会"亮的那段不是画的那段"。
      const proj = projectedSlideSpans(conns);
      for (const sp of proj.regions) {
        const realStart = sp.connIndex;
        const inSel = whole || regions?.has(realStart) === true;
        // issue 67：框选预览（整条被框住 → 所有段；或该段单独被框住）。
        // 与"鼠标 hover 仅限删除/音符代码工具"不同：框选是"即将入选"的预告，
        // 段确实会被选入 → 一律给反馈，所见即所得。
        const inPreviewBox = previewWhole || previewRegions?.has(realStart) === true; // 被框住 → 决定颜色
        const inPreview = !inSel && inPreviewBox;                              // 未选中才额外多画一圈
        // 段（连接带）默认不是可点对象 → 只在**会对它表态的工具**下给 hover 反馈：
        //   ① 删除工具：拆条语义需要"这一段会被拆"的预告（用户 2026-09-09）；
        //   ② 音符代码工具：点段会打开所属滑条的代码视图（§4 回退整条），段同样是"点得动"的目标。
        // 其余工具态段完全不参与 hover，只有真正的结点有。
        // 段被框选入选时照常按选中态绘制（inSel 分支，不受此限）。
        const isHoverPart = (dangerTool || rc.armedTool === 'noteCode')
            && hv?.kind === 'slideRegion' && hv.connIndex === realStart;
        if (!inSel && !isHoverPart && !inPreview) continue;
        // 该段的轮廓 = **一整条封闭图形**（issue 77 三轮，用户截图反馈）：
        // 跨过 hidden 的整段是一条折线带，中间的拐点不能各自封口 —— 否则 hidden 处会多出
        // 一道横向的"衔接线"（观感上段被切成两个图形）。两侧各串成一条折线，只有首尾封口。
        const cents: { x: number; y: number }[] = [];
        for (let ci = sp.start; ci <= sp.end; ci++) {
          const cc = proj.conns[ci]!;
          cents.push(c.virtualToCanvas(c.getNoteVirtualX(cc.lane), c.getNoteVirtualY(cc.beat, cc.subBeat || 0)));
        }
        // 横截面口径与带体实绘 / 命中区同源（`slideBandGeometry`，issue 09 验收反馈六轮）
        const points = bandPolygonAt(cents, half);
        // 段（连接带）的描边 = compact（用户 2026-09-09 二轮反馈）：不外扩、不画暗底，
        // 亮面贴平行四边形边即可，避免外圈盖住带子造成"段被截断"的观感。
        // 段与结点同款：所有"贴在带子上"的描边都用 compact 让带子自由穿过。
        emit(inSel, isHoverPart || inPreview, (mode) => out.push({ shape: 'quad', points, mode, compact: true }), inPreviewBox);
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
 * 方向键的侧别（只区分"组内几何朝哪边"）：预览镜像下左右互换（照 Bestdori `styleMirror` 的
 * `isLeft` 取反），因此调用方一律经本函数取图标组，别自己写 `isLeft ? 'L' : 'R'`。
 */
export const dirSideOf = (rc: IconChoiceCtx, isLeft: boolean): 'L' | 'R' =>
  isLeft !== (rc.display?.mirror === true) ? 'L' : 'R';

/**
 * 绘制方向键整组（issue 29 视觉修订 2026-08-24）：N 条覆盖轨道各贴一枚扁平本体 +
 * note_flick_top_l/r 箭头组合到最外侧（几何由构建期墨迹推导，见 noteSkin.ts）。
 * 本体轨道间距只随视口 scale（贴轨道）；箭头重叠量随 spriteScale（随 noteSize 等比）。
 */
function renderDirGroup(ctx: CanvasRenderingContext2D, rc: RenderCtx, group: DirGroupVisual, anchorX: number, anchorY: number, spriteScale: number) {
  // 预览镜像（chart-preview 08）：整组连箭头一起翻到另一侧 —— **锚点**由 Coords 镜像（lane → 6-lane）、
  // **侧别**由 dirSideOf 互换（组内偏移/箭头朝向是相对锚点定义的，随侧别自然翻过去，别再取反一次）。
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
  // issue 160：滑条两轮 — 先全谱段（后放置者在上），再全谱可见结点 + flick 挂件。
  // 不再一条 renderSlideBody 原子画完，否则后放滑条的段会盖住先放端点。
  visibleNotes.forEach(({ note }) => {
    if (note.type !== "Slide" && note.type !== "Long") return;
    const connections = (note as SlideNote).connections;
    if (visibleEnds(connections).first < 0) return;
    renderSpanBands(ctx, c, rc, connections, rc.display?.slideOpacity ?? 1);
  });
  visibleNotes.forEach(({ note }) => {
    if (note.type === "Slide" || note.type === "Long") {
      renderSlideBody(ctx, c, rc, note);
    }
  });

  // 键型在全体滑条之上（issue 85 ①）
  visibleNotes.forEach(({ note }) => {
    if ((note.type === "Single" || note.type === "LDirectional" || note.type === "RDirectional") && note.beat < 0) {
      return;
    }
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
      // 镜像由 renderDirGroup 内部取反（组内偏移 + 侧别），调用方只负责传组
      const subBeat = note.subBeat || 0;
      const canvasPos = c.virtualToCanvas(c.getNoteVirtualX(note.lane), c.getNoteVirtualY(note.beat, subBeat));
      // issue 29：N 条覆盖轨道扁平本体 + 最外侧箭头（dirGroup 几何由墨迹推导）
      const len = note.length;
      renderDirGroup(ctx, rc, icons.dirGroup(dirSideOf(rc, note.type === "LDirectional"), len), canvasPos.x, canvasPos.y, spriteScale);
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

/** 渲染一条滑条/长条的可见结点 + flick 挂件（段由 renderNotes 全谱先画，issue 160） */
function renderSlideBody(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, note: ChartNote) {
  const connections = (note as SlideNote).connections;
  // issue 106：可见结点 < 2 不再被校验拒收 → 这里按"有无可见结点"收口：全 hidden 时画布上没有任何效果；
  // 只剩 1 个可见结点时它按端点（= 单键皮肤）款画（`visibleEnds` 里 first === last）。
  const ends = visibleEnds(connections);
  if (ends.first < 0) return;
  // issue 39 #1：slide 结点（起止/中间）图标随节奏图示大小缩放；连接带是线条，不随。
  const spriteScale = rc.viewport.scale * (rc.display?.noteSize ?? 1);
  const icons = rc.noteIcons;

  connections.forEach((conn, i) => {
    const canvasPos = c.virtualToCanvas(c.getNoteVirtualX(conn.lane), c.getNoteVirtualY(conn.beat, conn.subBeat || 0));
    if (conn.hidden) return;
    // 端点 = 单键皮肤（定案），结点带 flick/skill 时换对应图（spread 覆盖 src/矩形）；
    // 选款与描边收集端共用（描边贴合实际绘制的墨迹）
    const iconConfig = slideNodeIconConfig(rc, conn, i === ends.first, i === ends.last);
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
    connections.forEach((conn, i) => {
      // issue 145 #3：与主精灵同口径 —— 中间结点的 flick 不画箭头（只端点补）
      if (!conn.flick || !(i === ends.first || i === ends.last)) return;
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
 * 连接带的**单车道横截面平行四边形**贴图画法。三处共用：单 region 段实绘（`renderSpanBands`）、
 * issue 65④ 段幽灵、滑条工具两击 live 预览（`renderSegmentBand`）——幽灵 = 实绘同形（ADR-0002 §4）。
 *
 * **横截面口径 = 车道横向**（`p.x ± half`，issue 09 验收反馈六轮，用户以"选中 hover 轮廓"为预期口径拍板）：
 * 与 hover 轮廓（`collectSelectionOutlines`）、命中区（`hitTest.findItemAt`）**同一套几何**，于是
 * 带体的端点封口 = 过结点中心的**水平线段**（宽 2·half = 30·s < 端点图标墨迹宽 36·s）→ 整条封口藏在
 * 端点图标底下，带子观感为"穿进图标里"。四/五轮的**垂直法线**口径把端点封口转成斜线，其纵向伸出量
 * half·cosθ 在 θ < 44° 时超过图标墨迹半高 10.8·s → 一头戳出菱形、另一头留出楔形背景缺口（用户图1的台阶）。
 *
 * **贴图映射 = 平行四边形剪切**（不是旋转）：贴图 X（横截面：左右两条亮绿描边 + 中间光泽剖面）→ 世界横向，
 * 恰好铺到平行四边形两条斜边上（亮边沿带子两侧，三轮质感定案不变）；贴图 Y（沿带方向；普通带"两端实
 * 中间虚"纵向渐变，SP 带沿长度恒定 = seamless）→ 世界段向。旋转映射会把亮边甩到斜边之外（带角缺色）故弃用；
 * 剪切把单位矩形精确铺成该平行四边形，连 clip 都不需要。
 * @param band 连接带材质（普通 `slideBand` / SP `slideBandSp`，ADR-0009 §5 整条传染，由调用方选择）
 * @param alpha 连接带不透明度；`undefined` = 沿用调用方的 `globalAlpha`（幽灵态由此继承 0.35/0.5）
 */
function drawBandQuad(
  ctx: CanvasRenderingContext2D,
  rc: RenderCtx,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  half: number,
  band: SpriteIconConfig,
  alpha?: number,
) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  // 退化零长（同位结点）与纯横向（同拍段）不画：横向口径下其平行四边形面积为 0，与命中区同判据
  // （hitTest 的 quad 同样退化 → 点不中）→ 所见 = 所点。
  if (len < 0.5 || Math.abs(dy) < 0.5) return;
  ctx.save();
  // issue 39 #2：长压线不透明度（slide 线条透明度，1 = 完全不透明）
  if (alpha !== undefined) ctx.globalAlpha = alpha;
  ctx.transform(1, 0, dx / len, dy / len, p1.x, p1.y);
  rc.spriteIcon.render(ctx, {
    ...band,
    canvasX: 0, canvasY: len / 2,
    canvasSize: len, canvasWidth: 2 * half, canvasHeight: len,
    scale: 1,
  });
  ctx.restore();
}

/** 两击预览入口（虚拟坐标 → 画布坐标）：成条后的实绘走 `renderSpanBands`，两者同一 `drawBandQuad` 画法 */
function renderSegmentBand(
  ctx: CanvasRenderingContext2D,
  c: Coords,
  rc: RenderCtx,
  from: { lane: number; beat: number; subBeat?: number },
  to: { lane: number; beat: number; subBeat?: number },
  band: SpriteIconConfig,
  alpha?: number,
) {
  const p1 = c.virtualToCanvas(c.getNoteVirtualX(from.lane), c.getNoteVirtualY(from.beat, from.subBeat || 0));
  const p2 = c.virtualToCanvas(c.getNoteVirtualX(to.lane), c.getNoteVirtualY(to.beat, to.subBeat || 0));
  // issue 39 #1 补修：连接带宽度与结点图标同步 × noteSize，避免调大小后带与结点脱节
  const half = (LANE_WIDTH * rc.viewport.scale * (rc.display?.noteSize ?? 1)) / 2;
  drawBandQuad(ctx, rc, p1, p2, half, band, alpha);
}

/**
 * 按逻辑段渲染连接带（材质选择 = ADR-0009 §5 整条传染；几何口径 = 六轮统一的**车道横向截面**）。
 * - **单 region 段**（无 hidden，普通滑条）：`drawBandQuad` 剪切贴图，一段铺满，无拼接。
 * - **含 hidden 的段**（SP 段/画笔/导入）：`renderSpBandStrip` **扫描线光栅化**（八轮 #1）——
 *   横截面 α 是 `|x−cx(y)|/half` 的连续函数，逐设备像素写入离屏缓冲后 1:1 贴回；每像素至多一次
 *   写入（自叠在像素内合成）→ 数学上零接缝。此前"16 层半透明同心环带逐层 fill"的画法在任何
 *   相邻层边界必留一道暗发丝线（半透明两笔覆盖同一像素的固有亏缺），放大=黑条纹、常态=发虚。
 * 两类共用同一横截面口径 ⇒ ① 带体轮廓与 hover 轮廓 / 命中区逐顶点重合（所见 = 所点）；② 相邻逻辑段在
 * 共享可见结点上天然连续（两端都是过结点的水平封口，同宽同位）——五轮为消除"段间台阶"引入的
 * **跨段共享角平分线法线整套作废删除**，台阶的根源（各段独立法线）不复存在；③ 端点/中间结点的封口
 * 落在图标墨迹内 → 与端点的衔接由图标遮住。带体贴合采样折线（七轮定案：实绘/描边/命中**顶点同源**，
 * 不做渲染期平滑）。
 */
export function renderSpanBands(
  ctx: CanvasRenderingContext2D,
  c: Coords,
  rc: RenderCtx,
  connections: SlideNote['connections'],
  alpha?: number,
) {
  const half = (LANE_WIDTH * rc.viewport.scale * (rc.display?.noteSize ?? 1)) / 2;
  // issue 106：画布按实机口径做**显示投影**（稳定排序 + 掐首尾 hidden，数据一字不动）——
  // 实绘 / 描边 / 命中三处共用它，非单调点序在画布上只表现为横向折线，永不画出回头弯。
  const proj = projectedSlideSpans(connections);
  const dconns = proj.conns;
  const spans = proj.regions;
  if (spans.length === 0) return;
  const band = slideUsesSpBand(connections) ? rc.noteIcons.slideBandSp : rc.noteIcons.slideBand;
  for (const sp of spans) {
    const pts: { x: number; y: number }[] = [];
    for (let i = sp.start; i <= sp.end; i++) {
      const cn = dconns[i]!;
      pts.push(c.virtualToCanvas(c.getNoteVirtualX(cn.lane), c.getNoteVirtualY(cn.beat, cn.subBeat || 0)));
    }
    if (sp.end - sp.start > 1) {
      renderSpBandStrip(ctx, pts, half, band, alpha);
    } else {
      drawBandQuad(ctx, rc, pts[0]!, pts[1]!, half, band, alpha);
    }
  }
}

/**
 * SP 带剖面（从带贴图横截面采样；src → 参数缓存）：center→edge 17 点不透明度 + 体色。
 * 剖面即贴图本来的设计（skin00：中心 0.38 → 亮缘 ~0.9 → 最外 1px 软边），由
 * `rasterBandRuns` 按连续插值逐像素复现（八轮 #1，环带分层画法作废），横截面口径见
 * `slideBandGeometry`；不再手工近似。
 */
interface BandStripStyle {
  color: string;
  /** 体色 RGB（光栅化写像素用，免每帧解析 color） */
  rgb: readonly [number, number, number];
  profile: number[];
}
const STRIP_STYLE_FRACS = Array.from({ length: 17 }, (_, i) => i / 16);
const STRIP_STYLE_CACHE = new Map<string, BandStripStyle>();
/** skin00/longNoteLine2 像素实测兜底（采样未就绪/失败时使用；其余皮肤采样后自动覆盖） */
const STRIP_STYLE_DEFAULT: BandStripStyle = {
  color: '#4be371',
  rgb: [0x4b, 0xe3, 0x71],
  profile: [0.38, 0.38, 0.39, 0.40, 0.41, 0.43, 0.45, 0.48, 0.52, 0.56, 0.61, 0.67, 0.74, 0.82, 0.89, 0.62, 0.25],
};

function bandStripStyle(band: SpriteIconConfig, createCanvas?: () => HTMLCanvasElement | null): BandStripStyle {
  const cached = STRIP_STYLE_CACHE.get(band.src);
  if (cached) return cached;
  const sample = (img: HTMLImageElement) => {
    if (!createCanvas && typeof document === 'undefined') return;
    try {
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (!w || !h) return;
      const cv = createCanvas ? createCanvas() : document.createElement('canvas');
      if (!cv) return;
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d');
      if (!cx) return;
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, w, h).data;
      const colAvg = (x: number) => {
        const xx = Math.max(0, Math.min(w - 1, x));
        let s = 0;
        for (let y = 0; y < h; y++) s += d[(y * w + xx) * 4 + 3];
        return s / h / 255;
      };
      const midX = w >> 1;
      const midRow = Math.floor(h / 2) * w;
      let r = d[(midRow + midX) * 4]!;
      let g = d[(midRow + midX) * 4 + 1]!;
      let b = d[(midRow + midX) * 4 + 2]!;
      if (colAvg(midX) < 0.01) { // 中心不透明（部分皮肤贴图如此）→ 体色取亮缘列
        const bright = midX + Math.round(0.875 * (w / 2 - 1));
        r = d[(midRow + bright) * 4]!; g = d[(midRow + bright) * 4 + 1]!; b = d[(midRow + bright) * 4 + 2]!;
      }
      const profile = STRIP_STYLE_FRACS.map((f) => {
        const off = Math.round(f * (w / 2 - 1));
        return (colAvg(midX - off) + colAvg(midX + off)) / 2;
      });
      STRIP_STYLE_CACHE.set(band.src, { color: `rgb(${r},${g},${b})`, rgb: [r, g, b], profile });
    } catch { /* 采样失败保持兜底/上次值 */ }
  };
  const preloaded = CanvasSpriteIcon.getCachedImage(band.src);
  if (preloaded && (preloaded.naturalWidth || preloaded.width) > 0) {
    sample(preloaded);
    return STRIP_STYLE_CACHE.get(band.src) ?? STRIP_STYLE_DEFAULT;
  }
  if (typeof Image === 'undefined') return STRIP_STYLE_DEFAULT; // 无 DOM（node 单测/SSR）→ 实测常量兜底剖面
  const img = new Image();
  img.src = band.src;
  if (img.complete && (img.naturalWidth || img.width) > 0) {
    sample(img);
    return STRIP_STYLE_CACHE.get(band.src) ?? STRIP_STYLE_DEFAULT;
  }
  img.decode?.().then(() => sample(img)).catch(() => undefined);
  return STRIP_STYLE_DEFAULT;
}

/**
 * 预采样当前音符皮肤的普通 / SP 连接带横截面剖面（issue 179）：
 * 在皮肤图集预加载完成时提前写入 `STRIP_STYLE_CACHE`，消除首次绘制含 hidden 滑条瓦片时
 * 在渲染热路径内同步新建 canvas + getImageData 回读 GPU 像素的突发卡顿。
 */
export function warmupBandStripStyles(
  icons: Pick<ActiveNoteIcons, 'slideBand' | 'slideBandSp'>,
  createCanvas?: () => HTMLCanvasElement | null,
): void {
  bandStripStyle(icons.slideBand, createCanvas);
  bandStripStyle(icons.slideBandSp, createCanvas);
}

/** 当前画布在 CSS 空间的可见矩形（逆变换；无位图尺寸则不裁，走整条 bbox）。issue 138 */
function canvasClipCss(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): BandRasterClipCss | undefined {
  const cv = ctx.canvas;
  if (!cv || !cv.width || !cv.height) return undefined;
  return {
    minX: (0 - tx) / sx,
    maxX: (cv.width - tx) / sx,
    minY: (0 - ty) / sy,
    maxY: (cv.height - ty) / sy,
  };
}

/**
 * SP 段条带 = **扫描线光栅 + 离屏 1:1 贴回**（`rasterBandRuns`，issue 09 验收反馈八轮 #1）。
 *
 * 七轮及以前 = 16 层半透明同心环带逐层 `fill()`：相邻层共享边界被两侧各覆盖约一半，
 * `1−(1−½a₁)(1−½a₂)` 低于任一侧目标 α → 每条边界一道暗发丝线（默认带宽下缝距 ~0.8 CSS px
 * 整体混叠 = "发虚"；曲率拉伸到 1px 级 = 放大可见的"黑色条纹"）。半透明多笔叠涂数学上
 * 无法两全（重叠=亮缝、相接=暗缝），故改为**每像素至多一笔**：横截面 α 作为 `|x−cx(y)|/half`
 * 的连续插值函数逐设备像素写入离屏缓冲（自叠臂在像素内 screen 合成 = 保持七轮"叠亮"口径），
 * 再按当前变换缩放 1:1 贴回（不重采样）。几何不变量（车道横向 ±half、端点水平封口、回折切分、
 * 顶点同源不细分）全部由纯函数 `rasterBandRuns` 承载并锁测。
 *
 * 亮度口径与七轮逐层 `globalAlpha=a` 一致：**不吃调用方 globalAlpha**（幽灵 0.35 只作用于
 * 结点图标与普通带贴图，SP 带体保持剖面本体亮度，slideOpacity 经 alpha 参数生效）。
 * node 环境（单测/SSR）无 DOM/变换 → 静默跳过；离屏画布模块级复用，尺寸只增不减。
 */
function renderSpBandStrip(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  half: number,
  band: SpriteIconConfig,
  alpha?: number,
) {
  if (typeof document === "undefined" || typeof ctx.getTransform !== "function") return;
  const st = bandStripStyle(band);
  const t = ctx.getTransform();
  const sx = t.a, sy = t.d;
  if (!sx || !sy) return;
  // 回折（导入谱拍位倒退）切成 y 单调 run：逐行光栅天然处理自叠（同像素两臂 screen 合成 = 叠亮）
  const runs = splitBandAtFolds(pts);
  const clipCss = canvasClipCss(ctx, sx, sy, t.e, t.f);
  const raster = rasterBandRuns({ runs, half, profile: st.profile, rgb: st.rgb, sx, sy, baseAlpha: alpha ?? 1, clipCss });
  if (!raster) return;
  const off = ensureRasterScratch(raster.bw, raster.bh);
  const octx = off.getContext("2d");
  if (!octx) return;
  octx.clearRect(0, 0, raster.bw, raster.bh);
  const img = octx.createImageData(raster.bw, raster.bh);
  img.data.set(raster.data);
  octx.putImageData(img, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // 贴回按设备像素 1:1，横截面已在正确分辨率烘焙
  ctx.globalAlpha = 1;
  ctx.drawImage(off, 0, 0, raster.bw, raster.bh, raster.bxDev, raster.byDev, raster.bw, raster.bh);
  ctx.restore();
}

let rasterScratch: HTMLCanvasElement | null = null;
function ensureRasterScratch(w: number, h: number): HTMLCanvasElement {
  if (!rasterScratch) rasterScratch = document.createElement("canvas");
  if (rasterScratch.width < w) rasterScratch.width = w;
  if (rasterScratch.height < h) rasterScratch.height = h;
  return rasterScratch;
}

/** 渲染一条滑条的完整外观幽灵（连接带 + 各结点图标） */
function renderSlideGhost(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, note: { connections: SlideNote['connections'] }) {
  const conns = note.connections;
  const ends = visibleEnds(conns);
  if (ends.first < 0) return; // issue 106：全 hidden → 幽灵也无（幽灵 = 实绘同形）
  // 与实绘同口径（幽灵 = 实绘同形）：同一个 renderSpanBands（逻辑段分组 + SP 材质 + 车道横向截面）
  renderSpanBands(ctx, c, rc, conns);
  conns.forEach((conn, i) => {
    if (conn.hidden) return; // 与 renderSlideBody 同口径：重合衔接点不画图标（幽灵 = 实绘同形）
    const cpt = c.virtualToCanvas(c.getNoteVirtualX(conn.lane), c.getNoteVirtualY(conn.beat, conn.subBeat || 0));
    // issue 65①：端点/中间结点各取各自款式（旧实现一律端点款 → 中间结点在幽灵里像单键）
    const icon = slideNodeIconConfig(rc, conn, i === ends.first, i === ends.last);
    renderSpriteGhost(ctx, rc, icon, cpt.x, cpt.y, SLIDE_ICON_SIZE, SLIDE_HEIGHT_SCALE);
  });
}

/** 渲染一个音符的完整外观幽灵（真实图标；方向键保留 length 变体） */
function renderNoteGhost(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, note: ChartNote) {
  const icons = rc.noteIcons;
  if (note.type === "Single") {
    const cpt = c.virtualToCanvas(c.getNoteVirtualX(note.lane), c.getNoteVirtualY(note.beat, note.subBeat || 0));
    // issue 147：选款并入 `singleIconConfig`（含色觉辅助的虚拍款），与实绘共用一份优先级，
    // 不再在这里重写一遍标记链（重写过一次就已经漂过一次的方向）。
    const icon = singleIconConfig(rc, note);
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
    // issue 29：与 renderNotes 同构（扁平本体 ×N + 外侧箭头）；侧别交给 dirSideOf（镜像会互换）
    const len = note.length;
    renderDirGroup(ctx, rc, icons.dirGroup(dirSideOf(rc, note.type === "LDirectional"), len), cpt.x, cpt.y, rc.viewport.scale);
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
  // issue 09 验收反馈八轮 #2：**画笔草稿幽灵不依赖光标落点合法性**。
  // penPreview = 起手以来捕获的采样（光标越界时按既定口径冻结在界内最后位置），
  // 必须始终可见——旧实现把整支预览层放在"光标落点合法"闸门之后，光标一出轨道
  // （轨外/越过谱末端/移出画布）pos=null 直接 return → 已画部分整体消失、回来才恢复（视觉断裂）。
  // 依赖光标坐标的"落点端点幽灵 / live 缓动段"仍在闸门之后走。
  if (rc.armedTool === 'curve' && rc.penActive) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    if (rc.penPreview && rc.penPreview.connections.length >= 2) {
      renderSlideGhost(ctx, c, rc, rc.penPreview);
    }
    ctx.restore();
    return;
  }

  // livePos 合法与否都继续：越界时若有进行中锚点，冻结到最后合法位（见下）。
  const livePos = rc.hoverPos ? c.getLaneBeatFromCanvas(rc.hoverPos.cx, rc.hoverPos.cy) : null;
  // issue 09 验收反馈九轮 #2：光标越出轨道（轨外 lane / 越过谱末端 / 移出画布）时，**有进行中
  // 锚点**（滑条首击 / 曲线链草稿已挂点）→ 落点冻结到最后一个合法位，放置/链式 live 预览保持成形，
  // 不再整条消失；纯 hover 无锚点 → pos=null 照旧隐藏（"这里不能放"的诚实信号）。与画笔同一口径，
  // 共用 freezeGestureCursor。
  const anchored =
    (rc.armedTool === 'slide' && rc.slideBuffer !== null) ||
    (rc.armedTool === 'curve' && (rc.curveDraft?.points.length ?? 0) > 0);
  const pos = freezeGestureCursor(
    livePos,
    rc.frozenCursor ? { lane: rc.frozenCursor.lane, preciseBeat: rc.frozenCursor.preciseBeat } : null,
    anchored,
  );
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
      // 两击预览 = 纯直线段（无 hidden）→ 恒普通带；曲线工具的缓动预览自带动材质（issue 09 S2）
      renderSegmentBand(ctx, c, rc,
        { lane: buf.lane, beat: buf.beat, subBeat: buf.subBeat || 0 },
        { lane: pos.lane, beat: pos.preciseBeat, subBeat: 0 },
        rc.noteIcons.slideBand);
    }
    // 落点端 = 滑条端点款幽灵（第一击前只有这一枚；第一击后与带子同时出现）
    const cpt = c.virtualToCanvas(c.getNoteVirtualX(pos.lane), c.getNoteVirtualY(pos.preciseBeat, 0));
    renderSpriteGhost(ctx, rc, slideNodeIconConfig(rc, { lane: pos.lane }, true, true),
      cpt.x, cpt.y, SLIDE_ICON_SIZE, SLIDE_HEIGHT_SCALE);
    ctx.restore();
    return;
  }

  // issue 09 S2（ADR-0009 §3）：曲线工具预览——最近锚点→光标的缓动段（按当前配置实时烘焙）。
  // 画笔进行中已在函数入口提前返回（八轮 #2：不依赖光标落点合法），此处只处理非画笔态。
  if (rc.armedTool === 'curve') {
    // 落点端点幽灵（与滑条工具同款）
    const cpt = c.virtualToCanvas(c.getNoteVirtualX(pos.lane), c.getNoteVirtualY(pos.preciseBeat, 0));
    renderSpriteGhost(ctx, rc, slideNodeIconConfig(rc, { lane: pos.lane }, true, true),
      cpt.x, cpt.y, SLIDE_ICON_SIZE, SLIDE_HEIGHT_SCALE);
    // live 段：最近锚点（草稿末点）→ 光标，按当前缓动配置烘焙预览（所见即成条所得）。
    // 倒向（光标早于锚点）仅首段合法（两点排序后成条，验收反馈 #4）→ 预览按排序后的正向段画；
    // 链式第 3 击起倒退会被取消，倒向不画预览（画了也是放不出来的形态）。
    const anchor = rc.curveDraft?.points.at(-1) ?? null;
    const cfg = rc.curveConfig;
    if (anchor && cfg) {
      const anchorBeat = anchor.beat + (anchor.subBeat || 0) / rc.beatDisplay;
      const cursorBeat = pos.preciseBeat;
      const forward = cursorBeat > anchorBeat + 1e-6;
      const backwardLegal = (rc.curveDraft?.points.length ?? 0) <= 1;
      if (forward || (backwardLegal && cursorBeat < anchorBeat - 1e-6)) {
        const from = forward
          ? { beat: anchorBeat, lane: anchor.lane }
          : { beat: cursorBeat, lane: pos.lane };
        const to = forward
          ? { beat: cursorBeat, lane: pos.lane }
          : { beat: anchorBeat, lane: anchor.lane };
        const conns = previewSpanConnections(from, to, spanParamFromCurveConfig(cfg), rc.beatDisplay);
        renderSlideGhost(ctx, c, rc, { connections: conns });
      }
    }
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
    } else if (rc.hoverPos) {
      // noteSize 必须与画布七处命中同口径（issue 82：命中盒随节奏图示大小缩放），
      // 否则 noteSize≠1 时镜像 hover 幽灵的命中范围与实际绘制不符。
      const hit = findItemAt(rc.hoverPos.cx, rc.hoverPos.cy, { geometry: rc.geometry, viewport: rc.viewport, beatDisplay: rc.beatDisplay, notes: rc.notes, noteSize: rc.display?.noteSize });
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
 * 渲染 BPM 标线（issue 163）：专用弱紫/蓝紫实线，细于整拍、α 0.5；末条非法负值警示色。
 * 横跨轨道宽度。**由 renderChart 编排在音符层之下**（用户反馈：BPM 线不得覆盖音符，
 * 与轨道线同层语义）；数值文字由 renderBpmLabels 在沟槽层绘制。
 * issue 10：基于可见集而非全量 notes.filter（省 O(n) 扫描与数组分配）。
 */
export function renderBpmLines(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, visibleNotes: { note: ChartNote; index: number }[]) {
  const { trackBgX, trackBgWidth } = c.trackGeometry(rc.viewport.scale);
  const lineColor = gridBpmLineColor(normalizeGridStyle(rc.display?.gridStyle));
  const es = rc.viewport.scale;
  const lw = Math.max(1, es);
  // issue 142：末条 BPM 为负（导出后 Bestdori 打不开）→ 那条线一并改警示色，与数值文字同口径。
  const tailIdx = indexOfTrailingNegativeBpm(rc.notes);
  for (const { note, index } of visibleNotes) {
    if (note.type !== "BPM") continue;
    const y = c.virtualToCanvas(0, c.getNoteVirtualY(note.beat)).y;
    if (y < -50 || y > rc.surface.h + 50) continue;
    const warning = index === tailIdx;
    ctx.strokeStyle = warning ? BPM_TAIL_WARNING_COLOR : lineColor;
    ctx.lineWidth = lw;
    ctx.globalAlpha = warning ? 1 : 0.5;
    ctx.beginPath();
    ctx.moveTo(trackBgX, y);
    ctx.lineTo(trackBgX + trackBgWidth, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/**
 * 渲染 BPM 数值（issue 51 + 第二轮修订）：仅数值（不带 "BPM" 前缀），内带锚定
 * （贴轨道左外缘 8px）、默认垂直居中于线；撞 y 时纵向错开（issue 159）。
 * 字号 = 21px × labelScale。同位组（线 y 相同）折成摘要；展开后钉线错开、画布裁切。
 * 由 renderChart 编排在沟槽层（音符之上，沟槽内无音符）。
 */
export function renderBpmLabels(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  // chart-preview 03 预览显示档：沟槽常显文字可整体关掉（窄面板下它们本来也放不下，
  // drawGutterLabel 会自己隐藏；这里省掉整套布局与测量）
  if (rc.display?.gutterLabels === false) return;
  const preset = normalizeGridStyle(rc.display?.gridStyle);
  const positiveColor = gridThemeBpmColor(preset);
  // issue 105 修法 1：**负值（倒流区）数值换色** —— 倒流区唯一的视觉标识（不做区域底纹）。
  // 作用域 = 只作用于数值文字；横线走 `gridBpmLineColor`（issue 163）。
  // 折返带里正/负事件在画布上常常同位（同一 y 逆序排列），数值色是区分两者的唯一线索。
  const negativeColor = gridBpmNegativeColor(preset);
  // issue 142：末条 BPM 为负（导出后 Bestdori 打不开）→ 数值改**警示色**并附 `!`，
  // 与「倒流区负值」（只换倒流色、无后缀）区分开 —— 两者语义不同：后者是合法写法，前者是打不开的谱。
  const tailIdx = indexOfTrailingNegativeBpm(rc.notes);
  const scale = rc.viewport.scale;
  const userLabelScale = rc.display?.labelScale ?? 1;
  const fontPx = Math.round(GUTTER_LABEL_FONT_PX * userLabelScale * scale);
  const expandedKey = rc.expandedBpmGroupKey ?? null;
  const layoutModel = layoutBpmGutter(
    rc.notes,
    (beat) => c.virtualToCanvas(0, c.getNoteVirtualY(beat)).y,
    (beat) => c.getNoteVirtualY(beat),
    fontPx,
    expandedKey,
  );
  const colorOf = (bpm: number, noteIndex?: number) =>
    noteIndex === tailIdx ? BPM_TAIL_WARNING_COLOR : (bpm < 0 ? negativeColor : positiveColor);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, rc.surface.w, rc.surface.h);
  ctx.clip();
  for (const sum of layoutModel.summaries) {
    const minBeat = Math.min(...sum.memberIndexes.map((i) => {
      const n = rc.notes[i];
      return n && 'beat' in n ? n.beat : Infinity;
    }));
    const y = bpmLabelAnchorY(minBeat, sum.lineCanvasY, fontPx, rc.surface.h);
    if (!bpmGutterYIntersectsCanvas(y, fontPx, rc.surface.h)) continue;
    const gl = layoutGutterLabel(c, rc.viewport.scale, y, 'centered', 'bpm', userLabelScale);
    drawBpmSummary(ctx, gl, sum.tokens, (bpm) => {
      const warning = sum.memberIndexes.some((i) => {
        const n = rc.notes[i];
        return i === tailIdx && n && n.type === 'BPM' && (n as ChartNote & { bpm: number }).bpm === bpm;
      });
      return warning ? BPM_TAIL_WARNING_COLOR : (bpm < 0 ? negativeColor : positiveColor);
    });
  }
  for (const num of layoutModel.numerals) {
    const note = rc.notes[num.noteIndex];
    if (!note || note.type !== 'BPM') continue;
    if (rc.bpmEditBeat !== null && rc.bpmEditBeat !== undefined
        && Math.abs(note.beat - rc.bpmEditBeat) < 1e-9) continue;
    const y = bpmLabelAnchorY(note.beat, num.y, fontPx, rc.surface.h);
    if (!bpmGutterYIntersectsCanvas(y, fontPx, rc.surface.h)) continue;
    const gl = layoutGutterLabel(c, rc.viewport.scale, y, 'centered', 'bpm', userLabelScale);
    const bpm = (note as ChartNote & { bpm: number }).bpm;
    drawGutterLabel(ctx, gl, String(bpm), colorOf(bpm, num.noteIndex));
  }
  ctx.restore();
}

/** 沟槽标记配色（chart-preview 08 的 Time 标记 / Combo 标记共用）：中性灰，比 BPM 数值弱一档
 *  （读谱参考，不是谱面信息） */
const MARKER_TEXT_COLOR = 'rgba(203, 213, 224, 0.7)';
/** 时间刻度贴轨道左缘的长度（CSS px） */
const TIME_MARK_TICK_PX = 4;
/** 刻度枚举上限（可见秒区间 ÷ 间隔的理论值远小于它；防脏 interval 把循环拖死） */
const TIME_MARK_MAX = 400;

/**
 * 沟槽时间刻度（chart-preview 08「Time 标记」，照 Bestdori 的 `chartTime`）：
 * 每 N 秒（1 / 2 / 5 / 10）在**轨道左侧沟槽**画一枚贴轨道左缘的短刻度线 + 时间文字（`0:25` / `1:05`）。
 * - 落点走**秒 → 布局轴**（`secondsToVirtualY`）而不是"秒 → 拍 → 布局轴"：倒流区里拍多解、秒单值（ADR-0010）；
 * - 锚定与字号沿用沟槽文字那套（右对齐到轨道左外缘 − 8px、`21px × labelScale`），
 *   但标签盒越出画布左缘时**钳制**而不是隐藏（`clampGutterLabelX`）——预览面板沟槽只有 ~30px；
 * - 由 renderChart 编排在沟槽层（与 BPM 数值同带，后画的 BPM 数值盖在上面）。
 */
export function renderTimeMarks(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  const interval = rc.display?.timeMarks ?? 0;
  if (!Number.isFinite(interval) || interval <= 0) return;
  const es = rc.viewport.scale;
  const userLabelScale = rc.display?.labelScale ?? 1;
  const fontPx = Math.round(GUTTER_LABEL_FONT_PX * userLabelScale * es);
  const { trackStartX } = c.trackGeometry(es);
  // 可见秒区间：画布底 = 时间更早、画布顶 = 更晚（y → 秒恒单值且单调）；上下各留一屏外余量
  const margin = fontPx + Math.round(16 * es);
  const secBottom = c.virtualYToSeconds(c.canvasToVirtual(0, rc.surface.h + margin).y);
  const secTop = c.virtualYToSeconds(c.canvasToVirtual(0, -margin).y);
  const lo = Math.min(secBottom, secTop);
  const hi = Math.max(secBottom, secTop);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, rc.surface.w, rc.surface.h);
  ctx.clip();
  ctx.fillStyle = MARKER_TEXT_COLOR;
  ctx.strokeStyle = MARKER_TEXT_COLOR;
  ctx.lineWidth = 1;
  let count = 0;
  const tickPx = Math.max(1, Math.round(TIME_MARK_TICK_PX * es));
  for (let seconds = Math.ceil(lo / interval - 1e-9) * interval; seconds <= hi + 1e-9; seconds += interval) {
    if (count++ >= TIME_MARK_MAX) break;
    const y = c.virtualToCanvas(0, c.secondsToVirtualY(seconds)).y;
    if (y < -fontPx || y > rc.surface.h + fontPx) continue;
    ctx.beginPath();
    ctx.moveTo(trackStartX - tickPx, y);
    ctx.lineTo(trackStartX - 1, y);
    ctx.stroke();
    const text = formatTimeCompact(seconds);
    const layout = clampGutterLabelX(
      layoutGutterLabel(c, es, y, 'centered', 'bpm', userLabelScale),
      measureGutterLabelWidth(text, fontPx, ctx),
    );
    drawGutterLabel(ctx, layout, text, MARKER_TEXT_COLOR);
  }
  ctx.restore();
}

/** Combo 标记的间隔（照 Bestdori `chartCombo`：每 50 combo 一枚） */
export const COMBO_MARK_INTERVAL = 50;

/**
 * 沟槽 Combo 刻度（chart-preview 08「Combo 标记」，照 Bestdori `chartCombo`）：
 * 每 `COMBO_MARK_INTERVAL` 个 combo 在**轨道右侧沟槽**写一个数字（50 / 100 / …）。
 * - 落点 = 第 N 个**可击打结点**的位置（`comboNodePreciseBeats`，与 `countNotesUpToBeat` 同一枚举：
 *   单键/方向键各 1、滑条逐结点、BPM/System 不计）；
 * - 横向越出画布右缘时左移（`clampGutterLabelRightX`），纵向居中并钳进画布（照 Bestdori 的钳制）；
 * - 由 renderChart 编排在沟槽层（与 Time 标记同带、分居两侧）。
 */
export function renderComboMarks(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  if (rc.display?.comboMarks !== true) return;
  const beats = comboNodePreciseBeats(rc.notes, rc.beatDisplay);
  if (beats.length < COMBO_MARK_INTERVAL) return;
  const es = rc.viewport.scale;
  const userLabelScale = rc.display?.labelScale ?? 1;
  const fontPx = Math.round(GUTTER_LABEL_FONT_PX * userLabelScale * es);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, rc.surface.w, rc.surface.h);
  ctx.clip();
  for (let combo = COMBO_MARK_INTERVAL; combo <= beats.length; combo += COMBO_MARK_INTERVAL) {
    const y = c.virtualToCanvas(0, c.beatToVirtualY(beats[combo - 1]!)).y;
    // 画布外的刻度直接跳过（长谱面 40+ 枚里通常只有几枚可见）
    if (y < -fontPx || y > rc.surface.h + fontPx) continue;
    const text = String(combo);
    const layout = clampGutterLabelY(
      clampGutterLabelRightX(
        layoutGutterLabelRight(c, es, y, userLabelScale),
        measureGutterLabelWidth(text, fontPx, ctx),
        rc.surface.w,
      ),
      rc.surface.h,
      fontPx,
    );
    drawGutterLabel(ctx, layout, text, MARKER_TEXT_COLOR);
  }
  ctx.restore();
}

/**
 * **末条 BPM 为负**的警示色（issue 142）：与倒流色（品红/紫，合法写法）区分开——
 * 这条 = 「导出后 Bestdori 打不开」，故取危险红（与 START 青 / END 橙 / 选中黄 / 倒流紫 都不同相）。
 */
export const BPM_TAIL_WARNING_COLOR = '#FF5A5A';

/** 起始线/结束线配色（issue 52：低饱和青蓝 / 暖橙；END 文字同色系更亮一档） */
export const START_LINE_COLOR = '#53b8c9';
export const END_LINE_COLOR = '#d97b5a';
export const END_TEXT_COLOR = '#f0a07e';

/**
 * 谱面起始线 / 结束线（issue 52 线样式 + issue 151 文字）：
 * - 线 = 低饱和青蓝 / 暖橙虚线，**只画轨道两侧沟槽段**；
 * - 起始线不画字；结束线 `END` 在线下方、外带锚定，文字盒钳制在画布内。
 */
export function renderBoundLines(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  // chart-preview 03 预览显示档：起止线（含 END 文字）可整体关掉（预览 panelW≈130 时属"编辑器装饰"）
  if (rc.display?.boundLines === false) return;
  const drawLine = (beat: number, lineColor: string): number | null => {
    const canvasY = c.virtualToCanvas(0, c.beatToVirtualY(beat)).y;
    if (canvasY < -24 || canvasY > rc.surface.h + 24) return null;
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
    return canvasY;
  };
  drawLine(0, START_LINE_COLOR);
  const endY = drawLine(rc.chartEndBeat, END_LINE_COLOR);
  if (endY == null) return;
  const es = rc.viewport.scale;
  const userLabelScale = rc.display?.labelScale ?? 1;
  const fontPx = Math.round(GUTTER_LABEL_FONT_PX * userLabelScale * es);
  const layout = clampGutterLabelY(
    layoutGutterLabel(c, es, endY, 'below', 'bound', userLabelScale),
    rc.surface.h, fontPx,
  );
  drawGutterLabel(ctx, layout, 'END', END_TEXT_COLOR);
}

/** 实时显示线线色（issue 54：中性白半透明细线，不占用主题色——主题色留给常显装饰） */
const HOVER_LINE_COLOR = 'rgba(240, 244, 248, 0.55)';
/** 实时信息文字（issue 54 + 第二轮 Q1=A）：基准 11px（比常显标线 14px 小一档）× labelScale、
 *  等宽（数值变化不跳动）、中性白半透明——"临时读数 ≠ 常显装饰" */
const HOVER_INFO_FONT_PX = 16.5;
const HOVER_INFO_FONT = (labelScale: number) => `${HOVER_INFO_FONT_PX * labelScale}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
const HOVER_INFO_COLOR = 'rgba(232, 238, 244, 0.65)';
const HOVER_INFO_GAP_PX = 8;
/** 读数盒贴画布缘的最小留白（钳制用；见 clampHoverInfoX） */
const HOVER_INFO_EDGE_PX = 2;

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

/** 实时读数文字宽度（等宽字体）：给 ctx 精确测量，否则按 0.62em 估算（与沟槽文字同一套估法） */
function measureHoverInfoWidth(text: string, fontPx: number, font: string, ctx: CanvasRenderingContext2D): number {
  const measured = (ctx.font = font, ctx.measureText(text)?.width ?? 0);
  return measured > 0 ? measured : Math.max(text.length * fontPx * 0.62, fontPx);
}

/**
 * 读数盒在画布内的横坐标钳制（chart-preview 03）：右对齐盒左缘越出画布就右移、左对齐盒右缘越出就左移。
 * 窄画布（预览面板 ~130px）里宁可让读数压一点轨道，也不切掉字；宽画布（工作台）上钳制从不触发，
 * 位置与既有口径逐像素一致。
 */
function clampHoverInfoX(anchorX: number, textWidth: number, surfaceW: number, align: 'right' | 'left'): number {
  if (align === 'right') return Math.max(anchorX, textWidth + HOVER_INFO_EDGE_PX);
  return Math.min(anchorX, surfaceW - textWidth - HOVER_INFO_EDGE_PX);
}

/**
 * 实时显示线两侧沟槽信息（issue 54）：左 = 分内时间 `SS.ss`（00.00–59.99 循环），
 * 右 = 已过音符数 `♪ N`（与判定线计数同口径 countNotesUpToBeat：含恰好在线上的音符、
 * 滑条算 1 条、BPM/System 不计）。由 renderChart 编排在常显装饰文字（BPM 数值/END）
 * **之上**——临时浮动信息优先于常显装饰。
 */
export function renderHoverInfo(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  if (!rc.hoverPos) return;
  const es = rc.viewport.scale;
  const { trackStartX, totalTrackWidth } = c.trackGeometry(es);
  const userLabelScale = rc.display?.labelScale ?? 1;
  const effectiveLabelScale = userLabelScale * es;
  const virtualY = c.canvasToVirtual(rc.hoverPos.cx, rc.hoverPos.cy).y;
  // issue 104 修法 3：秒读数走布局轴**直读**（倒流区里「y → 拍」多值，经 beat 往返会取到错层的拍，
  // 读数在折返带上会跳）。已过音符数仍按拍口径（最大 beat 解所在层），与播放 HUD 的
  // countNotesUpToBeat 同源——这是拍域定义，本票不改。
  const seconds = c.virtualYToSeconds(virtualY);
  const count = countNotesUpToBeat(rc.notes, c.virtualYToBeat(virtualY));
  const font = HOVER_INFO_FONT(effectiveLabelScale);
  const fontPx = HOVER_INFO_FONT_PX * effectiveLabelScale;
  const timeText = formatInMinuteTime(seconds);
  const countText = `♪ ${count}`;
  const gap = Math.max(2, Math.round(HOVER_INFO_GAP_PX * es));
  ctx.save();
  ctx.fillStyle = HOVER_INFO_COLOR;
  ctx.textBaseline = 'middle';
  // 左边锚轨道**左外缘**（含外框 chrome）之外，右边锚轨道**右外缘**之外（用户反馈：锚内容边缘会陷进边条）
  const leftX = clampHoverInfoX(
    trackStartX - gap,
    measureHoverInfoWidth(timeText, fontPx, font, ctx),
    rc.surface.w,
    'right',
  );
  const rightX = clampHoverInfoX(
    trackStartX + totalTrackWidth + gap,
    measureHoverInfoWidth(countText, fontPx, font, ctx),
    rc.surface.w,
    'left',
  );
  ctx.font = font;
  ctx.textAlign = 'right';
  ctx.fillText(timeText, leftX, rc.hoverPos.cy);
  ctx.textAlign = 'left';
  ctx.fillText(countText, rightX, rc.hoverPos.cy);
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
      // 起止结点参与（中间结点 = slide 中间节点，不参与）；issue 106：走**显示投影**，
      // 两端 = 投影后的首尾（首尾 hidden 的外部数据不再被拒收，可见结点不足时也就是画布上的两端）
      // ——与实绘 / 描边 / 命中同源，别再按数组下标 0 / 末位另判一份。
      const dconns = displayConnections(conns).conns;
      if (dconns.length === 0) continue;
      const first = dconns[0]!, last = dconns[dconns.length - 1]!;
      push(key(first.beat, first.subBeat), first.lane, first.beat, first.subBeat, null);
      if (dconns.length > 1) {
        push(key(last.beat, last.subBeat), last.lane, last.beat, last.subBeat, null);
      }
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
 * 帧构建（候选 3「一帧只有一个构建者」的唯一装配处）：
 * target 注入它拥有的 surface/dpr，view（画什么）其余字段逐条透传 —— 不深拷贝、不支持手搓的 surface/dpr。
 */
export function frameFor(target: RenderTarget, view: FrameView): RenderCtx {
  return { ...view, surface: target.surface, dpr: target.dpr };
}

/**
 * 单次全量绘制编排（ADR-0003 候选 B 的组件薄层入口 / 候选 3 收进 RenderTarget）：
 * 设置画布尺寸 → 静态层 blit（离屏缓存，issue 36 F2）→ 音符（离屏瓦片层）→ BPM → 选择框 → 滑条缓冲 → 工具预览 → 判定线 → 起点标记。
 * 不持有任何 React 状态；虚拟高度同步等副作用由组件自行处理。
 * issue 10：缓冲尺寸仅在变化时重设（每帧重设会强制重分配像素缓冲并清空画布状态）；
 * issue 36 F2 / 139：屏幕层 + pos 条带 blit；仅 scrollY 变不重建网格。
 *
 * 候选 3：画布 / surface / dpr / 两层缓存全归 target —— 本函数只收 target + view（帧由 `frameFor` 装配），
 * 不再接收裸 ctx/canvas，也不再读调用方给的 surface/dpr。
 */
export function renderChart(target: RenderTarget, view: FrameView) {
  // 画布不可用（无 2d 上下文）时不渲染——保护所有依赖 surface 的绘制（几何/缓冲/像素坐标）
  const ctx = target.context();
  if (!ctx) return;
  const t0 = perf.enabled ? performance.now() : 0;
  const frame: RenderCtx = frameFor(target, view);
  // buffer = surface × dpr（ADR-0006 §1，尺寸口径走 rasterScale 唯一处）；此后绘制/命中均用 CSS 像素坐标
  const canvas = target.canvas;
  const { w: bw, h: bh } = bufferSizeFor(target.surface, target.dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  ctx.setTransform(target.dpr, 0, 0, target.dpr, 0, 0);

  // issue 40（渲染质量）：统一/声明精灵图平滑策略——源图缩到音符尺寸用**双线性平滑**缩放
  // （能保留边缘层次，优于 DOM 版的 'pixelated' 硬边；'pixelated' 仅用于工具栏等小 UI 图标的
  // DOM 展示，两者用途不同）。quality='high' 用更高阶滤波（双三次）进一步压低缩小时的
  // 子像素混色/边缘杂色（配合源矩形已收紧到墨迹）。
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 静态层（黑底+轨道底+网格+起止线，含整幅清屏）离屏缓存 blit（issue 36 F2）
  target.staticLayer.draw(ctx, frame);

  const c = makeCoords(frame.geometry, frame.viewport, frame.beatDisplay, frame.notes, frame.display?.mirror === true);

  // BPM 标线（issue 51 + 用户反馈）：在音符层**之下**（与轨道线同层语义，不覆盖音符）
  renderBpmLines(ctx, c, frame, c.getVisibleNotes());
  // 实时显示线（issue 54）：鼠标 Y 水平线，画在音符层之下
  renderHoverLine(ctx, c, frame);

  // 同时点击线只在 renderNotes 内画（进瓦片）。
  // 音符层走离屏瓦片缓存（issue 10）：缩放/滚动帧只 blit 瓦片
  target.noteLayer.draw(ctx, frame);
  // 沟槽标记（chart-preview 08）：Time 在左沟槽、Combo 数字在右沟槽；先画，BPM 数值盖在它上面
  renderTimeMarks(ctx, c, frame);
  renderComboMarks(ctx, c, frame);
  // BPM 数值（issue 51 / 161）：沟槽层，全量布局 + 画布裁切（不按可见集漏画展开叠）
  renderBpmLabels(ctx, c, frame);
  // 实时信息文字（issue 54）：两侧沟槽，画在常显装饰文字之上
  renderHoverInfo(ctx, c, frame);

  if (frame.selectionBox) renderSelectionBox(ctx, frame);
  if (frame.dragGhost) renderDragGhost(ctx, c, frame);
  renderToolPreview(ctx, c, frame);
  // 锚点在语义上是"已经定下的实绘端点"→ 画在滑条 hover 幽灵**之上**（issue 65③④：
  // 否则第一击后那条 35% 透明度的段带会糊在锚点上，看起来像锚点被染色）
  renderSlideBuffer(ctx, c, frame);
  renderPlaybackMarker(ctx, c, frame);

  if (perf.enabled) perf.record(performance.now() - t0);
}
