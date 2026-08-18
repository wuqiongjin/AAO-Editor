// 音符层离屏瓦片缓存（issue 10 性能核心）：
//
// 把「音符主体 + 选中高亮」渲染到 pos 空间（timeline 像素，与缩放无关）的竖向瓦片上，
// 主画布每帧只对可见瓦片做 drawImage blit —— 缩放/滚动帧的成本从 O(可见音符数) 降为 O(瓦片数≈2-4)。
//
// 关键坐标事实（保证 blit 数学精确）：
// - virtualY(beat) = C(es) − pos(beat)，其中 C(es) = chartEndVirtualY + surface.h / es；
// - canvasY(pos) = anchorY − pos·es，anchorY = (chartEndVirtualY − scrollY)·es + surface.h；
// - 瓦片位图在渲染时与当时的主画布【同宽】，renderNotes 经 makeCoords(geometry) 画的 X
//   就是主画布坐标（geometry.surface 与 rc.surface 同源）→ 同尺寸 blit 无水平平移误差。
// - issue 36 F3a：surface 变化后旧瓦片续用——瓦片位图行是纯 pos 空间（伪视口 h 消去），
//   X/Y 布局均绕画布中心线性（x(es) = W/2 + es·A），故按 k = es/refScale、以「瓦片渲染时
//   宽度」为基绕当前画布中心缩放 blit 时 X/Y 仍精确命中（仅分辨率缩放，结算后高清重建）。
//
// 缩放手势策略：手势期间（rc.zoomGesture）对 stale 瓦片只做按比例 blit（可能轻微模糊），
// 手势结束（组件 250ms settle 后触发一次重渲）再以最终 es 高清重建瓦片。
import { renderNotes, renderSelectionOverlay } from './render';
import { makeCoords } from './coords';
import type { RenderCtx } from './types';
import { VIEWPORT_PADDING, type GeometryBounds } from '../utils/ChartGeometry';
import type { BpmTimelineEvent } from '../utils/BpmTimeline';
import type { ChartNote, SlideNote } from '../notes/Charts';
import { perf } from '../utils/perf';

/** 瓦片的 pos 空间高度（timeline 像素） */
export const TILE_PX = 512;
/** 高倍直渲阈值：es 超过它时可见音符很少，直接渲染比维护瓦片更省（也封顶瓦片内存） */
const MAX_CACHE_ES = 1.2;
/** |es/refScale − 1| 超过该值视为 stale，需要（手势结束后）高清重建 */
const STALE_TOL = 0.02;
/** 瓦片总内存预算（字节，按 RGBA 4B/px 估算），超出按插入序淘汰。
 *  issue 36：96MB → 64MB（密集谱下瓦片缓存是常驻内存增量的主体；配合瓦片 dpr 上限下调） */
const BYTES_BUDGET = 64 * 1024 * 1024;
/** 瓦片数量上限（兜底，正常情况下字节预算先生效） */
const MAX_TILES = 64;
/** 瓦片位图 dpr 上限（issue 36）：瓦片只承载音符精灵（无文字），1.5 倍 dpr 在高分屏几乎不可辨，
 *  相比 2.0 内存 -44%、瓦片重建填充也快 ~44%（密集谱下放置延迟同步受益）；主画布仍按完整 dpr。 */
const TILE_DPR_CAP = 1.5;

interface Tile {
  canvas: HTMLCanvasElement | OffscreenCanvas | null;
  refScale: number;
  /** 渲染该瓦片时的 surface 宽度（CSS 像素）：位图与当时的画布同宽。
   *  issue 36 F3a：surface 变化不再清空瓦片，blit 按此宽度缩放并绕当前宽度居中（X 精确）。 */
  surfaceW: number;
  bytes: number;
  empty: boolean;
}

/** 瓦片位图工厂：浏览器用 canvas，测试可注入假实现 */
let createTileCanvas: () => any = () => document.createElement('canvas');
export function __setTileCanvasFactoryForTests(factory: () => any) {
  createTileCanvas = factory;
}

const tiles = new Map<number, Tile>();

/**
 * 缓存失效依据（issue 35 + issue 36 F3a）：
 * - selectedItems 不再参与失效（F1：选中高亮移出瓦片，由主画布叠加层逐帧绘制）；
 * - 时间线内容（BPM 事件 + chartEndBeat）变化 → pos 空间整体平移 → 全量失效；
 * - surface 宽高变化【不再】清空瓦片：位图行是纯 pos 空间（伪视口中 h 完全消去），
 *   X 布局绕画布中心线性——blit 按瓦片渲染时宽度缩放、绕当前宽度居中即精确命中，
 *   窗口缩放结算从「全量重建」降为「纯 blit」（geometry 实例随 surface 重建，但时间线
 *   内容相同则瓦片续用，故此处按内容而非实例比较）；
 * - notes 引用变化走 F3 增量失效：前后数组做前缀/后缀引用 diff（结构共享，F6 保证不可变），
 *   仅删除覆盖「变更拍区间」的瓦片。单次放置从全量 4-5 块重建降为 ≈1 块。
 */
let basis: {
  notes: readonly ChartNote[]; bpmEvents: readonly BpmTimelineEvent[];
  chartEndBeat: number; beatDisplay: number; dpr: number; skinVersion: number;
  /** issue 39：节奏图示大小 / 长压线不透明度烘进音符瓦片，变化时需全量失效 */
  noteSize: number; slideOpacity: number;
  /** issue 39 #5：纵向比例改变 timeline 高度 → pos 空间平移，需全量失效 */
  verticalRatio: number;
} | null = null;

export function resetNoteLayerCache() {
  tiles.clear();
  basis = null;
}

/** BPM 事件表内容相等（事件数通常 ≤ 个位数）：surface 变化时组件会重建 geometry 实例，
 *  但时间线内容未变 → 瓦片续用，故失效依据按内容而非实例比较（issue 36 F3a） */
const bpmEventsEqual = (a: readonly BpmTimelineEvent[], b: readonly BpmTimelineEvent[]) =>
  a === b || (a.length === b.length && a.every((e, i) => e.beat === b[i].beat && e.bpm === b[i].bpm));

/** 测试专用：读取当前瓦片表（判断某拍区间的瓦片是否被重建） */
export function __getTilesForTests(): ReadonlyMap<number, Tile> {
  return tiles;
}

// ---------------- F3：notes 变化 diff → 失效拍区间 ----------------

/** 变更中段音符数超过该阈值 → 视为批量/结构变化，回退全量失效（diff 本身 O(n) 引用比较，代价可忽略） */
const DIFF_FULL_LIMIT = 64;

/** 单个音符覆盖的精确拍区间（滑条取连接点首尾；subBeat 按 beatDisplay 折算） */
function noteBeatSpan(note: ChartNote, beatDisplay: number): { min: number; max: number } | null {
  if (note.type === 'Slide' || note.type === 'Long') {
    const conns = (note as SlideNote).connections;
    if (conns.length === 0) return null;
    let min = Infinity, max = -Infinity;
    for (const cn of conns) {
      const sb = cn.subBeat || 0;
      const b = cn.beat + (sb > 0 ? sb / beatDisplay : 0);
      if (b < min) min = b;
      if (b > max) max = b;
    }
    return { min, max };
  }
  if (note.type === 'Single' || note.type === 'LDirectional' || note.type === 'RDirectional') {
    const sb = note.subBeat || 0;
    const b = note.beat + (sb > 0 ? sb / beatDisplay : 0);
    return { min: b, max: b };
  }
  if (note.type === 'BPM') return { min: note.beat, max: note.beat };
  return null;
}

export type NotesDiff =
  | { kind: 'none' }
  | { kind: 'range'; minBeat: number; maxBeat: number }
  | { kind: 'full' };

/**
 * 前后 notes 数组的结构共享 diff（纯函数，供单测）：
 * 公共前缀/后缀按引用比较（F6 修复在位变异后，未变音符保持同引用），
 * 变更中段收敛为精确拍区间；中段过大（批量粘贴/整体替换）返回 full。
 */
export function diffNotes(oldNotes: readonly ChartNote[], newNotes: readonly ChartNote[], beatDisplay: number): NotesDiff {
  const maxP = Math.min(oldNotes.length, newNotes.length);
  let p = 0;
  while (p < maxP && oldNotes[p] === newNotes[p]) p++;
  let eo = oldNotes.length - 1, en = newNotes.length - 1;
  while (eo >= p && en >= p && oldNotes[eo] === newNotes[en]) { eo--; en--; }
  const nOld = eo - p + 1, nNew = en - p + 1;
  if (nOld <= 0 && nNew <= 0) return { kind: 'none' };
  if (nOld + nNew > DIFF_FULL_LIMIT) return { kind: 'full' };
  let minBeat = Infinity, maxBeat = -Infinity;
  const acc = (note: ChartNote | undefined) => {
    if (!note) return;
    const span = noteBeatSpan(note, beatDisplay);
    if (!span) return;
    if (span.min < minBeat) minBeat = span.min;
    if (span.max > maxBeat) maxBeat = span.max;
  };
  for (let i = p; i <= eo; i++) acc(oldNotes[i]);
  for (let i = p; i <= en; i++) acc(newNotes[i]);
  if (minBeat > maxBeat) return { kind: 'none' }; // 变更均为无渲染痕迹的类型
  return { kind: 'range', minBeat, maxBeat };
}

/**
 * 删除覆盖 [minBeat, maxBeat] 的瓦片。外扩余量 = 瓦片渲染时的 VIEWPORT_PADDING
 * （跨瓦片音符会在相邻瓦片重复绘制）+ 音符半高/选中圈，保证所有画过这些音符的瓦片都被失效。
 *
 * issue 36 修复：pos = cEs − virtualY(beat) = positionOfBeat(beat)，随 beat **递增**
 * （旧注释“pos 随 beat 递减”有误，那是 virtualY 的方向）。旧实现把低拍端算出的较小 pos
 * 命名为 posMax、高拍端较大 pos 命名为 posMin，传给 tileIndexRange 时区间端点顺序颠倒 →
 * 跨多拍区间的变更（滑条/长条创建与合并）只失效区间一端的 1 块瓦片，其余瓦片滞留陈旧，
 * 表现为“Slide 后半截渲染不出来，缩放或附近放置音符后才出现”。
 */
function invalidateTilesForBeatRange(minBeat: number, maxBeat: number, rc: RenderCtx) {
  const es = rc.viewport.scale;
  const cEs = rc.geometry.chartEndVirtualY + rc.surface.h / es;
  const posAtLowBeat = cEs - rc.geometry.beatToVirtualY(Math.max(0, minBeat), es);  // 低拍 → pos 小
  const posAtHighBeat = cEs - rc.geometry.beatToVirtualY(Math.max(0, maxBeat), es); // 高拍 → pos 大
  const margin = (VIEWPORT_PADDING + 48) / es;
  const { lo, hi } = tileIndexRange(posAtLowBeat - margin, posAtHighBeat + margin);
  for (let id = lo; id <= hi; id++) tiles.delete(id);
}

/** pos 空间可见范围：pos = C(es) − virtualY（viewportBounds 已含 VIEWPORT_PADDING 外扩） */
export function posRangeOf(rc: RenderCtx): { posMin: number; posMax: number } {
  const es = rc.viewport.scale;
  const cEs = rc.geometry.chartEndVirtualY + rc.surface.h / es;
  const b = rc.geometry.viewportBounds(rc.viewport);
  return { posMin: cEs - b.maxY, posMax: cEs - b.minY };
}

/** [posMin, posMax] 覆盖的瓦片序号闭区间 */
export function tileIndexRange(posMin: number, posMax: number): { lo: number; hi: number } {
  const lo = Math.max(0, Math.floor(posMin / TILE_PX));
  const hi = Math.max(lo, Math.floor(Math.max(posMin, posMax) / TILE_PX));
  return { lo, hi };
}

/**
 * 瓦片 blit 目标矩形（纯函数，供单测校验数学精确性）：
 * X 绕画布中心缩放（轨道布局绕中心线性 → lane 中心精确），Y 精确映射 pos → canvasY（与 refScale 无关）。
 * issue 36 F3a：tileW = 瓦片渲染时的 surface 宽度（位图 css 宽）。destW = tileW·k 而非当前宽·k，
 * 配合 x = (surfaceW − destW)/2 绕【当前】画布居中——surfaceW 与 tileW 不同（窗口缩放结算后）
 * 时依然精确：bitmapX = tileW/2 + (vx − laneCenter)·refScale 经 blit 线性映射到
 * surfaceW/2 + (vx − laneCenter)·es，任意 k 下误差为 0（chrome 装饰在 X 求和中消去）。
 */
export function tileBlitRect(tileId: number, es: number, refScale: number, anchorY: number, surfaceW: number, tileW: number = surfaceW) {
  const k = es / refScale;
  const destW = tileW * k;
  return {
    x: (surfaceW - destW) / 2,
    y: anchorY - (tileId + 1) * TILE_PX * es,
    w: destW,
    h: TILE_PX * es,
  };
}

function evictOverBudget() {
  let total = 0;
  for (const t of tiles.values()) total += t.bytes;
  while (total > BYTES_BUDGET || tiles.size > MAX_TILES) {
    const oldest = tiles.keys().next();
    if (oldest.done) break;
    total -= tiles.get(oldest.value)?.bytes ?? 0;
    tiles.delete(oldest.value);
  }
}

/** 以 es 渲染一块瓦片（含上下 VIEWPORT_PADDING 外扩，跨瓦片音符在相邻瓦片重复绘制 → 无缝拼接） */
function renderTile(tileId: number, rc: RenderCtx, es: number): Tile {
  tiles.delete(tileId);
  const p0 = tileId * TILE_PX, p1 = p0 + TILE_PX;
  const cssH = TILE_PX * es;
  // 伪视口：让瓦片 pos 区间 [p0, p1] 恰好映射到瓦片画布 [0, cssH]
  const scrollY = rc.geometry.chartEndVirtualY + rc.surface.h / es - p1;
  const vp = { scrollX: 0, scrollY, scale: es, virtualWidth: 0, virtualHeight: 0 };
  const pad = VIEWPORT_PADDING / es;
  const bounds: GeometryBounds = { minX: 0, maxX: Infinity, minY: scrollY - pad, maxY: scrollY + cssH / es + pad };
  const vis = rc.geometry.visibleNotes(rc.notes, vp, rc.beatDisplay, bounds);
  if (vis.length === 0) {
    const empty: Tile = { canvas: null, refScale: es, surfaceW: rc.surface.w, bytes: 0, empty: true };
    tiles.set(tileId, empty);
    return empty;
  }
  // 位图与主画布同宽（cssW = rc.surface.w），无需左右外扩（装饰器/选中圈均在 surface 内）
  const cssW = rc.surface.w;
  const canvas = createTileCanvas();
  // issue 36：瓦片 dpr 上限 1.5（内存与重建成本同时下降；主画布 blit 时按 CSS 尺寸 1:1 绘制）
  const tileDpr = Math.min(rc.dpr, TILE_DPR_CAP);
  const bw = Math.round(cssW * tileDpr), bh = Math.round(cssH * tileDpr);
  canvas.width = bw;
  canvas.height = bh;
  const tctx = canvas.getContext('2d');
  tctx.setTransform(tileDpr, 0, 0, tileDpr, 0, 0);
  const fakeSurface = { w: cssW, h: cssH };
  const fakeRc: RenderCtx = { ...rc, viewport: vp, surface: fakeSurface };
  const c = makeCoords(rc.geometry, vp, rc.beatDisplay, rc.notes);
  // F1：瓦片不含选中态（选中高亮由主画布叠加层绘制，选择变化不再重建瓦片）
  renderNotes(tctx, c, fakeRc, vis, { skipSelection: true });
  const tile: Tile = { canvas, refScale: es, surfaceW: cssW, bytes: bw * bh * 4, empty: false };
  tiles.set(tileId, tile);
  evictOverBudget();
  return tile;
}

/**
 * 绘制音符层入口（renderChart 调用，替代原先的直接 renderNotes）：
 * - es > MAX_CACHE_ES → 直接渲染（高倍下可见音符少）；
 * - 否则走瓦片缓存：miss 的瓦片同步以当前 es 渲染；stale 瓦片在手势期间仅按比例 blit，
 *   手势结束后（zoomGesture=false 的下一帧）高清重建。
 */
export function drawNotesLayer(ctx: CanvasRenderingContext2D, rc: RenderCtx) {
  const es = rc.viewport.scale;
  if (es > MAX_CACHE_ES) {
    // issue 36：高倍直渲时释放全部瓦片位图（常驻可达数十 MB；缩回瓦片模式时会全量重建）
    if (tiles.size > 0) {
      tiles.clear();
      basis = null;
    }
    const c = makeCoords(rc.geometry, rc.viewport, rc.beatDisplay, rc.notes);
    const vis = rc.geometry.visibleNotes(rc.notes, rc.viewport, rc.beatDisplay);
    renderNotes(ctx, c, rc, vis);
    perf.info({ layerMode: 'direct', visibleNotes: vis.length });
    return;
  }

  const nb = {
    notes: rc.notes,
    bpmEvents: rc.geometry.bpmEvents,
    chartEndBeat: rc.geometry.chartEndBeat,
    beatDisplay: rc.beatDisplay, dpr: rc.dpr,
    skinVersion: rc.skinVersion ?? 0,
    noteSize: rc.display?.noteSize ?? 1,
    slideOpacity: rc.display?.slideOpacity ?? 1,
    verticalRatio: rc.geometry.verticalRatio,
  };
  if (
    !basis || basis.chartEndBeat !== nb.chartEndBeat || basis.beatDisplay !== nb.beatDisplay ||
    basis.dpr !== nb.dpr || basis.skinVersion !== nb.skinVersion ||
    basis.noteSize !== nb.noteSize || basis.slideOpacity !== nb.slideOpacity ||
    basis.verticalRatio !== nb.verticalRatio ||
    !bpmEventsEqual(basis.bpmEvents, nb.bpmEvents)
  ) {
    // 时间线内容/节拍显示/dpr/皮肤/音符大小/长压线不透明度/纵向比例变化 → pos 空间或位图语义变化，全量失效。
    // 注意：surface 宽高与 geometry 实例不在失效依据内（issue 36 F3a，见 basis 注释）。
    tiles.clear();
    basis = nb;
  } else if (basis.notes !== nb.notes) {
    // F3：notes 引用变化 → 结构共享 diff，仅失效覆盖变更拍区间的瓦片
    const diff = diffNotes(basis.notes, rc.notes, rc.beatDisplay);
    if (diff.kind === 'full') tiles.clear();
    else if (diff.kind === 'range') invalidateTilesForBeatRange(diff.minBeat, diff.maxBeat, rc);
    basis = nb;
  }

  const { posMin, posMax } = posRangeOf(rc);
  const { lo, hi } = tileIndexRange(posMin, posMax);
  const allowRebuild = !rc.zoomGesture; // 手势期间不重建 stale 瓦片（只 blit），settle 后重建

  let rebuilt = 0, blitted = 0, staleBlit = false;
  for (let id = lo; id <= hi; id++) {
    let t = tiles.get(id);
    if (!t || (!t.empty && Math.abs(es / t.refScale - 1) > STALE_TOL && allowRebuild)) {
      t = renderTile(id, rc, es);
      rebuilt++;
    }
    if (t.empty || !t.canvas) continue;
    if (Math.abs(es / t.refScale - 1) > STALE_TOL) staleBlit = true;
    const anchorY = (rc.geometry.chartEndVirtualY - rc.viewport.scrollY) * es + rc.surface.h;
    const r = tileBlitRect(id, es, t.refScale, anchorY, rc.surface.w, t.surfaceW);
    if (r.y > rc.surface.h || r.y + r.h < 0) continue; // 屏外瓦片（padding 外扩可能引入）
    ctx.drawImage(t.canvas, r.x, r.y, r.w, r.h);
    blitted++;
  }
  // F1：选中高亮叠加层（瓦片不含选中态，O(选中∩可见) 逐帧绘制，与瓦片 blit 逐像素对齐）
  if (rc.selectedItems.length > 0) {
    const c = makeCoords(rc.geometry, rc.viewport, rc.beatDisplay, rc.notes);
    renderSelectionOverlay(ctx, c, rc, c.getVisibleNotes());
  }
  perf.info({ layerMode: 'tiles', tiles: tiles.size, blitted, rebuilt, staleBlit });
}
