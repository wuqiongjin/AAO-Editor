// 谱面渲染纯模块（ADR-0003 候选 B）：把 FinalVirtualCanvas 的 15 个 render* 函数
// 从组件闭包中提出为依赖注入的纯函数。组件每次 RAF 组装 RenderCtx 调用 renderChart。
// 本模块不含任何 React 状态；性能热路径（视口剔除/缓存/增量重绘）将来在此落地。
import type { ChartNote, SelectionItem, SlideNote } from '../notes/Charts';
import { LANES, LANE_WIDTH, TRACK_CHROME_TOTAL, type ChartGeometry, type GeometryViewport, type GeometryPoint } from '../utils/ChartGeometry';
import { shiftGroupToAnchor, mirrorNote } from '../utils/NoteEditing';
import { perf } from '../utils/perf';
import { makeCoords, type Coords } from './coords';
import { computeItemsInBox, findItemAt } from './hitTest';
import { drawNotesLayer } from './noteLayerCache';
import { drawStaticLayer } from './staticLayerCache';
import type { DirGroupVisual } from './noteSkin';
import type { RenderCtx } from './types';

// 音符大小配置（与 hitTest 命中尺寸保持一致）
export const NOTE_ICON_SIZE = 36;
export const DIRECTIONAL_ICON_SIZE = 45;
export const SLIDE_ICON_SIZE = 36;

// 音符高度压缩配置
const NOTE_HEIGHT_SCALE = 0.6;
const DIRECTIONAL_HEIGHT_SCALE = 0.33;
const SLIDE_HEIGHT_SCALE = 0.6;

/** 选中状态判定辅助（ADR-0001 §6：整条/结点/区域）。一次构建 Set/Map，密集音符下避免每音符 O(选择数) 扫描 */
interface SelectionSets {
  notes: Set<number>;
  slideNodes: Map<number, Set<number>>;
  slideRegions: Map<number, Set<number>>;
}
const buildSelectionSets = (rc: RenderCtx): SelectionSets => {
  const notes = new Set<number>();
  const slideNodes = new Map<number, Set<number>>();
  const slideRegions = new Map<number, Set<number>>();
  for (const it of rc.selectedItems) {
    if (it.kind === 'note') notes.add(it.noteIndex);
    else if (it.kind === 'slideNode') {
      (slideNodes.get(it.noteIndex) ?? slideNodes.set(it.noteIndex, new Set()).get(it.noteIndex)!).add((it as { connIndex: number }).connIndex);
    } else if (it.kind === 'slideRegion') {
      (slideRegions.get(it.noteIndex) ?? slideRegions.set(it.noteIndex, new Set()).get(it.noteIndex)!).add((it as { connIndex: number }).connIndex);
    }
  }
  return { notes, slideNodes, slideRegions };
};
const isNoteSelected = (sel: SelectionSets, index: number) => sel.notes.has(index);
const isSlideNodeSelected = (sel: SelectionSets, index: number, connIndex: number) =>
  sel.slideNodes.get(index)?.has(connIndex) ?? false;
const isSlideRegionSelected = (sel: SelectionSets, index: number, connIndex: number) =>
  sel.slideRegions.get(index)?.has(connIndex) ?? false;

/** 判定线（ADR-0004 §1 + ADR-0006 §2）：固定画布【下边边缘】；常显（停/播同线） */
export function renderJudgeLine(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  const { trackBgX, trackBgWidth } = c.trackGeometry(rc.viewport.scale);
  const y = rc.surface.h; // 判定线 = 画布下边边缘
  ctx.save();
  ctx.strokeStyle = '#e0f7ff';
  ctx.lineWidth = 3 * rc.viewport.scale;
  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur = 12 * rc.viewport.scale;
  ctx.beginPath();
  ctx.moveTo(trackBgX, y);
  ctx.lineTo(trackBgX + trackBgWidth, y);
  ctx.stroke();
  ctx.restore();
}

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
  const borderTotalWidth = TRACK_CHROME_TOTAL;

  for (let lane = 0; lane <= LANES; lane++) {
    const x = trackStartX + borderTotalWidth + lane * LANE_WIDTH * rc.viewport.scale;
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

  // 完整拍实线画到谱面末端覆盖的整数拍（chartEndBeat 为整数时保留其结束拍实线）；
  // 子节拍虚线仅在不超过谱面末端时绘制（避免末端之后多画网格切分）。
  // issue 10：只迭代视口内拍数（原实现从 beat 0 全量迭代到谱面末端，长谱密集缩放下每帧数千次无效循环）。
  const { min: beatFrom, max: beatTo } = visibleBeatRange(rc.geometry, rc.viewport, rc.chartEndBeat);
  let lastBeatY: number | null = null;   // 实线间距抽稀阈值
  let lastSubY: number | null = null;   // 虚线间距抽稀阈值
  for (let beat = beatFrom; beat <= beatTo; beat++) {
    const canvasPos = c.virtualToCanvas(0, c.beatToVirtualY(beat));
    if (canvasPos.y >= 0 && canvasPos.y <= rc.surface.h) {
      if (lastBeatY === null || Math.abs(canvasPos.y - lastBeatY) >= 2) {
        ctx.strokeStyle = '#555555';
        ctx.lineWidth = Math.max(2, 2 * rc.viewport.scale);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(trackBgX, canvasPos.y);
        ctx.lineTo(trackBgX + trackBgWidth, canvasPos.y);
        ctx.stroke();
        lastBeatY = canvasPos.y;
      }
    }
    for (let subBeat = 1; subBeat < rc.beatDisplay; subBeat++) {
      const preciseBeat = beat + subBeat / rc.beatDisplay;
      if (preciseBeat > rc.chartEndBeat + 1e-6) continue;
      const subCanvasPos = c.virtualToCanvas(0, c.beatToVirtualY(preciseBeat));
      if (subCanvasPos.y < 0 || subCanvasPos.y > rc.surface.h) continue;
      // 间距抽稀：子拍线间距 < 5px 时不再逐条绘制（远看即为密实灰带，视觉等价）
      if (lastSubY !== null && Math.abs(subCanvasPos.y - lastSubY) < 5) continue;
      ctx.strokeStyle = '#666666';
      ctx.lineWidth = Math.max(0.5, 1 * rc.viewport.scale);
      ctx.setLineDash([4 * rc.viewport.scale, 6 * rc.viewport.scale]);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(trackBgX, subCanvasPos.y);
      ctx.lineTo(trackBgX + trackBgWidth, subCanvasPos.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0;
      lastSubY = subCanvasPos.y;
    }
  }
}

/** 点音符选中圈（黄圈）：瓦片内与叠加层共用同一实现，保证视觉逐像素一致 */
function strokeSelectedCircle(ctx: CanvasRenderingContext2D, canvasPos: GeometryPoint, iconSize: number, scale: number) {
  ctx.strokeStyle = 'yellow';
  ctx.lineWidth = 3 * scale;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(canvasPos.x, canvasPos.y, iconSize / 2 + 4, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.globalAlpha = 1.0;
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
 * 绘制音符（第一层：主体；第二层：装饰器）。
 * issue 35 F1：opts.skipSelection=true 供离屏瓦片渲染（瓦片不含选中态，选中高亮由主画布叠加层绘制，
 * 选择变化不再使瓦片缓存失效）。
 */
export function renderNotes(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, visibleNotes: { note: ChartNote; index: number }[], opts?: { skipSelection?: boolean }) {
  const sel = buildSelectionSets(rc);
  const skipSelection = opts?.skipSelection === true;
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
  visibleNotes.forEach(({ note, index }) => {
    const isSelected = isNoteSelected(sel, index);
    if (note.type === "Single") {
      const subBeat = note.subBeat || 0;
      const canvasPos = c.virtualToCanvas(c.getNoteVirtualX(note.lane), c.getNoteVirtualY(note.beat, subBeat));
      const iconSize = NOTE_ICON_SIZE * ns * rc.viewport.scale;
      let iconConfig = icons.tapFor(note.lane);
      if (note.flick) iconConfig = icons.flickFor(note.lane);
      else if (note.skill) iconConfig = icons.skillFor(note.lane);
      rc.spriteIcon.render(ctx, {
        ...iconConfig,
        canvasX: canvasPos.x, canvasY: canvasPos.y,
        canvasSize: NOTE_ICON_SIZE,
        // issue 40：主音符矩形已收紧到墨迹，绘制尺寸取 out（墨迹屏幕尺寸），默认回退 NOTE_ICON_SIZE
        canvasWidth: iconConfig.out?.w ?? NOTE_ICON_SIZE,
        canvasHeight: iconConfig.out?.h ?? NOTE_ICON_SIZE * NOTE_HEIGHT_SCALE,
        scale: spriteScale, renderLayer: 'main',
      });
      if (isSelected && !skipSelection) {
        strokeSelectedCircle(ctx, canvasPos, iconSize, rc.viewport.scale);
      }
    } else if (note.type === "LDirectional" || note.type === "RDirectional") {
      const subBeat = note.subBeat || 0;
      const canvasPos = c.virtualToCanvas(c.getNoteVirtualX(note.lane), c.getNoteVirtualY(note.beat, subBeat));
      const iconSize = DIRECTIONAL_ICON_SIZE * ns * rc.viewport.scale;
      const isLeft = note.type === "LDirectional";
      // issue 29：N 条覆盖轨道扁平本体 + 最外侧箭头（dirGroup 几何由墨迹推导）
      const len = Math.min(Math.max(note.length || 1, 1), 3);
      renderDirGroup(ctx, rc, icons.dirGroup(isLeft ? 'L' : 'R', len), canvasPos.x, canvasPos.y, spriteScale);
      if (isSelected && !skipSelection) {
        strokeSelectedCircle(ctx, canvasPos, iconSize, rc.viewport.scale);
      }
    } else if (note.type === "BPM") {
      const virtualY = c.getNoteVirtualY(note.beat);
      const { trackBgX, trackBgWidth } = c.trackGeometry(rc.viewport.scale);
      const y = c.virtualToCanvas(0, virtualY).y;
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 3 * rc.viewport.scale;
      ctx.setLineDash([5 * rc.viewport.scale, 5 * rc.viewport.scale]);
      ctx.beginPath();
      ctx.moveTo(trackBgX, y);
      ctx.lineTo(trackBgX + trackBgWidth, y);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (note.type === "Slide" || note.type === "Long") {
      renderSlideBody(ctx, c, rc, sel, note, index, skipSelection);
    }
  });

  // 第二层：装饰器层 - 确保装饰器在所有音符之上
  visibleNotes.forEach(({ note }) => {
    if (note.type === "Single" && note.flick) {
      // issue 29：滑键 = 本体（第一层已画）+ 顶部箭头挂件（note_flick_top，包未提供时无挂件）
      const subBeat = note.subBeat || 0;
      const canvasPos = c.virtualToCanvas(c.getNoteVirtualX(note.lane), c.getNoteVirtualY(note.beat, subBeat));
      const dec = icons.flickTopDecorator;
      if (dec) {
        rc.spriteIcon.render(ctx, {
          ...dec,
          canvasX: canvasPos.x, canvasY: canvasPos.y,
          canvasSize: NOTE_ICON_SIZE,
          canvasWidth: NOTE_ICON_SIZE,
          canvasHeight: NOTE_ICON_SIZE * NOTE_HEIGHT_SCALE,
          scale: spriteScale, renderLayer: 'decorators',
        });
      }
    }
  });
}

/** 渲染一条滑条/长条：连接带 + 各结点 + 选中高亮（ADR §6 整条/结点/区域）；skipSelection 供瓦片渲染跳过高亮 */
function renderSlideBody(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, sel: SelectionSets, note: ChartNote, index: number, skipSelection?: boolean) {
  const connections = (note as SlideNote).connections;
  if (connections.length < 2) return;
  // issue 39 #1：slide 结点（起止/中间）图标随节奏图示大小缩放；连接带是线条，不随。
  const spriteScale = rc.viewport.scale * (rc.display?.noteSize ?? 1);
  const icons = rc.noteIcons;

  for (let i = 0; i < connections.length - 1; i++) {
    const conn1 = connections[i], conn2 = connections[i + 1];
    const canvasPos1 = c.virtualToCanvas(c.getNoteVirtualX(conn1.lane), c.getNoteVirtualY(conn1.beat, conn1.subBeat || 0));
    const canvasPos2 = c.virtualToCanvas(c.getNoteVirtualX(conn2.lane), c.getNoteVirtualY(conn2.beat, conn2.subBeat || 0));
    // issue 39 #1 补修：连接带宽度与结点图标同步 × noteSize，避免调大小后带与结点脱节
    const halfLaneWidth = (LANE_WIDTH * rc.viewport.scale * (rc.display?.noteSize ?? 1)) / 2;
    const left1 = canvasPos1.x - halfLaneWidth, right1 = canvasPos1.x + halfLaneWidth;
    const left2 = canvasPos2.x - halfLaneWidth, right2 = canvasPos2.x + halfLaneWidth;
    const quadPoints = [[left1, canvasPos1.y], [right1, canvasPos1.y], [right2, canvasPos2.y], [left2, canvasPos2.y]];
    const minX = Math.min(left1, right1, left2, right2);
    const maxX = Math.max(left1, right1, left2, right2);
    const minY = Math.min(canvasPos1.y, canvasPos2.y);
    const maxY = Math.max(canvasPos1.y, canvasPos2.y);
    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
    const width = maxX - minX, height = maxY - minY;
    const diagonalLength = Math.sqrt(width * width + height * height);
    const slideIconSize = Math.max(diagonalLength, Math.max(width, height)) * 1.0;

    ctx.save();
    // issue 39 #2：长压线不透明度（slide 线条透明度，1 = 完全不透明）
    ctx.globalAlpha = rc.display?.slideOpacity ?? 1;
    ctx.beginPath();
    ctx.moveTo(quadPoints[0][0], quadPoints[0][1]);
    for (let j = 1; j < quadPoints.length; j++) ctx.lineTo(quadPoints[j][0], quadPoints[j][1]);
    ctx.closePath();
    ctx.clip();
    rc.spriteIcon.render(ctx, {
      ...icons.slideBand,
      canvasX: centerX, canvasY: centerY, canvasSize: slideIconSize,
      canvasWidth: slideIconSize, canvasHeight: height, scale: 1,
    });
    ctx.restore();
  }

  connections.forEach((conn, i) => {
    const canvasPos = c.virtualToCanvas(c.getNoteVirtualX(conn.lane), c.getNoteVirtualY(conn.beat, conn.subBeat || 0));
    if (conn.hidden) return;
    const isFirst = i === 0, isLast = i === connections.length - 1;
    let iconConfig;
    if (isFirst || isLast) {
      // 端点 = 单键皮肤（定案），结点带 flick/skill 时换对应图（spread 覆盖 src/矩形）
      iconConfig = { ...icons.slideEndpointFor(conn.lane), ...(conn.flick ? icons.flickFor(conn.lane) : {}), ...(conn.skill ? icons.skillFor(conn.lane) : {}) };
    } else {
      iconConfig = { ...icons.slideAmongFor(conn.lane), ...(conn.flick ? icons.flickFor(conn.lane) : {}), ...(conn.skill ? icons.skillFor(conn.lane) : {}) };
    }
    rc.spriteIcon.render(ctx, {
      ...iconConfig,
      canvasX: canvasPos.x, canvasY: canvasPos.y,
      canvasSize: SLIDE_ICON_SIZE, canvasWidth: SLIDE_ICON_SIZE,
      canvasHeight: SLIDE_ICON_SIZE * SLIDE_HEIGHT_SCALE,
      scale: spriteScale,
    });
  });

  if (!skipSelection) drawSlideSelection(ctx, c, rc, sel, note, index);
}

/** 滑条选中高亮（整条黄虚线框 + 结点青圈 + 区域青框）：瓦片内与叠加层共用同一实现，保证视觉逐像素一致 */
function drawSlideSelection(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, sel: SelectionSets, note: ChartNote, index: number) {
  const connections = (note as SlideNote).connections;
  const isSelected = isNoteSelected(sel, index);
  if (isSelected) {
    const xs = connections.map(cn => c.getNoteVirtualX(cn.lane));
    const ys = connections.map(cn => c.getNoteVirtualY(cn.beat, cn.subBeat || 0));
    const minX = Math.min(...xs) - 10, maxX = Math.max(...xs) + 10;
    const minY = Math.min(...ys) - 10, maxY = Math.max(...ys) + 10;
    const canvasMin = c.virtualToCanvas(minX, minY);
    const canvasMax = c.virtualToCanvas(maxX, maxY);
    ctx.strokeStyle = 'yellow';
    ctx.lineWidth = 2 * rc.viewport.scale;
    ctx.setLineDash([5, 5]);
    ctx.globalAlpha = 0.7;
    ctx.strokeRect(canvasMin.x, canvasMin.y, canvasMax.x - canvasMin.x, canvasMax.y - canvasMin.y);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1.0;
  }

  connections.forEach((conn, ci) => {
    if (!isSlideNodeSelected(sel, index, ci)) return;
    const pos = c.virtualToCanvas(c.getNoteVirtualX(conn.lane), c.getNoteVirtualY(conn.beat, conn.subBeat || 0));
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 3 * rc.viewport.scale;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, (SLIDE_ICON_SIZE / 2) * rc.viewport.scale + 6, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  });

  for (let ci = 0; ci < connections.length - 1; ci++) {
    if (!isSlideRegionSelected(sel, index, ci)) continue;
    const c1 = connections[ci], c2 = connections[ci + 1];
    const p1 = c.virtualToCanvas(c.getNoteVirtualX(c1.lane), c.getNoteVirtualY(c1.beat, c1.subBeat || 0));
    const p2 = c.virtualToCanvas(c.getNoteVirtualX(c2.lane), c.getNoteVirtualY(c2.beat, c2.subBeat || 0));
    // 区域高亮框与连接带同宽（× noteSize，与 renderSlideBody 一致）
    const halfLaneWidth = (LANE_WIDTH * rc.viewport.scale * (rc.display?.noteSize ?? 1)) / 2;
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2 * rc.viewport.scale;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(p1.x - halfLaneWidth, p1.y);
    ctx.lineTo(p1.x + halfLaneWidth, p1.y);
    ctx.lineTo(p2.x + halfLaneWidth, p2.y);
    ctx.lineTo(p2.x - halfLaneWidth, p2.y);
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }
}

/**
 * 选中高亮叠加层（issue 35 F1）：瓦片不含选中态，选中后由主画布在瓦片 blit 之上逐帧叠加。
 * 只遍历可见音符并跳过未选中项（O(选中∩可见)），选择变化不再触发瓦片重建；
 * 复用 renderNotes 的同一套高亮绘制（strokeSelectedCircle / drawSlideSelection），视觉逐像素对齐旧实现。
 */
export function renderSelectionOverlay(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, visibleNotes: { note: ChartNote; index: number }[]) {
  if (rc.selectedItems.length === 0) return;
  const sel = buildSelectionSets(rc);
  if (sel.notes.size === 0 && sel.slideNodes.size === 0 && sel.slideRegions.size === 0) return;
  for (const { note, index } of visibleNotes) {
    if (note.type === "Single") {
      if (!isNoteSelected(sel, index)) continue;
      const canvasPos = c.virtualToCanvas(c.getNoteVirtualX(note.lane), c.getNoteVirtualY(note.beat, note.subBeat || 0));
      strokeSelectedCircle(ctx, canvasPos, NOTE_ICON_SIZE * rc.viewport.scale, rc.viewport.scale);
    } else if (note.type === "LDirectional" || note.type === "RDirectional") {
      if (!isNoteSelected(sel, index)) continue;
      const canvasPos = c.virtualToCanvas(c.getNoteVirtualX(note.lane), c.getNoteVirtualY(note.beat, note.subBeat || 0));
      strokeSelectedCircle(ctx, canvasPos, DIRECTIONAL_ICON_SIZE * rc.viewport.scale, rc.viewport.scale);
    } else if (note.type === "Slide" || note.type === "Long") {
      if (!isNoteSelected(sel, index) && !sel.slideNodes.has(index) && !sel.slideRegions.has(index)) continue;
      drawSlideSelection(ctx, c, rc, sel, note, index);
    }
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

/** 绘制滑条缓冲区（待连接的滑条起点/终点） */
export function renderSlideBuffer(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  if (!rc.slideBuffer) return;
  const { beat, lane, subBeat } = rc.slideBuffer;
  const { x, y } = c.virtualToCanvas(c.getNoteVirtualX(lane), c.getNoteVirtualY(beat, subBeat || 0));
  const s = rc.viewport.scale;
  ctx.beginPath();
  ctx.arc(x, y, 15 * s, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(0, 229, 255, 0.12)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 10 * s, 0, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.55)';
  ctx.lineWidth = 2 * s;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 5 * s, 0, 2 * Math.PI);
  ctx.fillStyle = '#00e5ff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - 1.2 * s, y - 1.2 * s, 1.6 * s, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fill();
}

/** 渲染单个精灵图标（幽灵/预览用；透明度由调用方 ctx.globalAlpha 控制） */
function renderSpriteGhost(ctx: CanvasRenderingContext2D, rc: RenderCtx, icon: any, cx: number, cy: number, size: number, heightScale: number) {
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

/** 渲染一条滑条的完整外观幽灵（连接带 + 各结点图标） */
function renderSlideGhost(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, note: { connections: SlideNote['connections'] }) {
  const conns = note.connections;
  if (conns.length < 2) return;
  for (let i = 0; i < conns.length - 1; i++) {
    const c1 = conns[i], c2 = conns[i + 1];
    const p1 = c.virtualToCanvas(c.getNoteVirtualX(c1.lane), c.getNoteVirtualY(c1.beat, c1.subBeat || 0));
    const p2 = c.virtualToCanvas(c.getNoteVirtualX(c2.lane), c.getNoteVirtualY(c2.beat, c2.subBeat || 0));
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
  conns.forEach(conn => {
    const cpt = c.virtualToCanvas(c.getNoteVirtualX(conn.lane), c.getNoteVirtualY(conn.beat, conn.subBeat || 0));
    const icons = rc.noteIcons;
    const icon = { ...icons.slideEndpointFor(conn.lane), ...(conn.flick ? icons.flickFor(conn.lane) : {}), ...(conn.skill ? icons.skillFor(conn.lane) : {}) };
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
    renderSpriteGhost(ctx, rc, icon, cpt.x, cpt.y, NOTE_ICON_SIZE, NOTE_HEIGHT_SCALE);
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

  if (rc.selectedTool === 'single' || rc.selectedTool === 'flick' || rc.selectedTool === 'skill'
      || rc.selectedTool === 'ldirectional' || rc.selectedTool === 'rdirectional') {
    const ghost = ghostNoteForTool(rc.selectedTool, pos.lane, pos.preciseBeat);
    if (ghost) renderNoteGhost(ctx, c, rc, ghost);
    ctx.restore();
    return;
  }

  if (rc.selectedTool === 'paste' && rc.clipboard && rc.clipboard.length > 0) {
    const shifted = shiftGroupToAnchor(rc.clipboard, pos.preciseBeat, pos.lane);
    for (const n of shifted) renderNoteGhost(ctx, c, rc, n);
    ctx.restore();
    return;
  }

  if (rc.selectedTool === 'mirror') {
    if (rc.selectionBox) {
      drawMirrorGhosts(ctx, c, rc, computeItemsInBox(rc.selectionBox, { geometry: rc.geometry, viewport: rc.viewport, beatDisplay: rc.beatDisplay, notes: rc.notes }));
    } else {
      const hit = findItemAt(rc.hoverPos.cx, rc.hoverPos.cy, { geometry: rc.geometry, viewport: rc.viewport, beatDisplay: rc.beatDisplay, notes: rc.notes });
      if (hit) drawMirrorHoverGhost(ctx, c, rc, hit);
    }
  }

  ctx.restore();
}

/** 渲染 BPM 数字（红色横线 + 左侧数值）。issue 10：基于可见集而非全量 notes.filter（省 O(n) 扫描与数组分配） */
export function renderBpmNumbers(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx, visibleNotes: { note: ChartNote; index: number }[]) {
  visibleNotes.forEach(({ note }) => {
    if (note.type !== "BPM") return;
    const canvasPos = c.virtualToCanvas(0, c.getNoteVirtualY(note.beat));
    if (canvasPos.y >= -50 && canvasPos.y <= rc.surface.h + 50) {
      const { trackStartX, trackBgX, trackBgWidth } = c.trackGeometry(rc.viewport.scale);
      ctx.strokeStyle = '#ff6666';
      ctx.lineWidth = 3 * rc.viewport.scale;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(trackBgX, canvasPos.y);
      ctx.lineTo(trackBgX + trackBgWidth, canvasPos.y);
      ctx.stroke();
      const textY = canvasPos.y - 15 * rc.viewport.scale;
      const textX = trackStartX - 80;
      if (textY >= -20 && textY <= rc.surface.h + 20) {
        ctx.fillStyle = '#ff6666';
        ctx.font = `bold ${12 * rc.viewport.scale}px Arial`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`BPM ${(note as ChartNote & { bpm: number }).bpm}`, textX, textY);
      }
    }
  });
}

/** 谱面起始线 / 结束线（Bug3）：标记谱面有效范围的首尾，横跨整个画布宽度（超出轨道本身） */
export function renderBoundLines(ctx: CanvasRenderingContext2D, c: Coords, rc: RenderCtx) {
  const draw = (beat: number, color: string, label: string) => {
    const canvasY = c.virtualToCanvas(0, c.beatToVirtualY(beat)).y;
    if (canvasY < -20 || canvasY > rc.surface.h + 20) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * rc.viewport.scale;
    ctx.setLineDash([6 * rc.viewport.scale, 5 * rc.viewport.scale]);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, canvasY);
    ctx.lineTo(rc.surface.w, canvasY);
    ctx.stroke();
    ctx.setLineDash([]);
    // 左侧小标签
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.95;
    ctx.font = `${11 * rc.viewport.scale}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(label, 4, canvasY);
    ctx.restore();
  };
  draw(0, '#7c9cff', '起始');
  draw(rc.chartEndBeat, '#ff9c7c', '结束');
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

  // 同时点击线（issue 39 #3）：画在音符层之下，音符图标覆盖其中点连线
  if (rc.display?.simultaneousClickLines) {
    renderSimultaneousClickLines(ctx, c, rc, c.getVisibleNotes());
  }
  // 音符层走离屏瓦片缓存（issue 10）：缩放/滚动帧只 blit 瓦片，不逐音符重绘
  drawNotesLayer(ctx, rc);
  // BPM 标注基于可见集（二分剔除，O(log n + 可见数)）
  const visibleNotes = c.getVisibleNotes();
  renderBpmNumbers(ctx, c, rc, visibleNotes);

  if (rc.selectionBox) renderSelectionBox(ctx, rc);
  renderSlideBuffer(ctx, c, rc);
  renderToolPreview(ctx, c, rc);
  renderJudgeLine(ctx, c, rc);
  renderStartMarker(ctx, c, rc);

  if (perf.enabled) perf.record(performance.now() - t0);
}
