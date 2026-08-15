// 音符层离屏瓦片缓存（issue 10 性能核心）：
//
// 把「音符主体 + 选中高亮」渲染到 pos 空间（timeline 像素，与缩放无关）的竖向瓦片上，
// 主画布每帧只对可见瓦片做 drawImage blit —— 缩放/滚动帧的成本从 O(可见音符数) 降为 O(瓦片数≈2-4)。
//
// 关键坐标事实（保证 blit 数学精确）：
// - virtualY(beat) = C(es) − pos(beat)，其中 C(es) = chartEndVirtualY + surface.h / es；
// - canvasY(pos) = anchorY − pos·es，anchorY = (chartEndVirtualY − scrollY)·es + surface.h；
// - 瓦片位图与主画布【同宽】（= surface.w），renderNotes 经 makeCoords(geometry) 画的 X
//   就是主画布坐标（geometry.surface 与 rc.surface 同源）→ blit 无水平平移误差。
//   且轨道/音符布局绕画布中心线性（x(es) = W/2 + es·A），故 stale 瓦片按 k = es/refScale
//   绕中心缩放 blit 时 X/Y 均精确命中（仅分辨率缩放，settle 后高清重建）。
//
// 缩放手势策略：手势期间（rc.zoomGesture）对 stale 瓦片只做按比例 blit（可能轻微模糊），
// 手势结束（组件 250ms settle 后触发一次重渲）再以最终 es 高清重建瓦片。
import { renderNotes } from './render';
import { makeCoords } from './coords';
import type { RenderCtx } from './types';
import { VIEWPORT_PADDING, type GeometryBounds } from '../utils/ChartGeometry';
import { perf } from '../utils/perf';

/** 瓦片的 pos 空间高度（timeline 像素） */
export const TILE_PX = 512;
/** 高倍直渲阈值：es 超过它时可见音符很少，直接渲染比维护瓦片更省（也封顶瓦片内存） */
const MAX_CACHE_ES = 1.2;
/** |es/refScale − 1| 超过该值视为 stale，需要（手势结束后）高清重建 */
const STALE_TOL = 0.02;
/** 瓦片总内存预算（字节，按 RGBA 4B/px 估算），超出按插入序淘汰 */
const BYTES_BUDGET = 96 * 1024 * 1024;
/** 瓦片数量上限（兜底，正常情况下字节预算先生效） */
const MAX_TILES = 64;

interface Tile {
  canvas: HTMLCanvasElement | OffscreenCanvas | null;
  refScale: number;
  bytes: number;
  empty: boolean;
}

/** 瓦片位图工厂：浏览器用 canvas，测试可注入假实现 */
let createTileCanvas: () => any = () => document.createElement('canvas');
export function __setTileCanvasFactoryForTests(factory: () => any) {
  createTileCanvas = factory;
}

const tiles = new Map<number, Tile>();

/** 缓存失效依据：任一输入变引用即全量失效（notes 每次编辑都换数组 → 全量重建，成本≈一次直渲） */
let basis: {
  notes: unknown; selectedItems: unknown; geometry: unknown;
  beatDisplay: number; surfaceW: number; dpr: number; skinVersion: number;
} | null = null;

export function resetNoteLayerCache() {
  tiles.clear();
  basis = null;
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
 * X 绕画布中心缩放（位图与主画布同宽，轨道布局绕中心线性 → lane 中心精确），
 * Y 精确映射 pos → canvasY（与 refScale 无关）。
 */
export function tileBlitRect(tileId: number, es: number, refScale: number, anchorY: number, surfaceW: number) {
  const k = es / refScale;
  const destW = surfaceW * k;
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
    const empty: Tile = { canvas: null, refScale: es, bytes: 0, empty: true };
    tiles.set(tileId, empty);
    return empty;
  }
  // 位图与主画布同宽（cssW = rc.surface.w），无需左右外扩（装饰器/选中圈均在 surface 内）
  const cssW = rc.surface.w;
  const canvas = createTileCanvas();
  const bw = Math.round(cssW * rc.dpr), bh = Math.round(cssH * rc.dpr);
  canvas.width = bw;
  canvas.height = bh;
  const tctx = canvas.getContext('2d');
  tctx.setTransform(rc.dpr, 0, 0, rc.dpr, 0, 0);
  const fakeSurface = { w: cssW, h: cssH };
  const fakeRc: RenderCtx = { ...rc, viewport: vp, surface: fakeSurface };
  const c = makeCoords(rc.geometry, vp, rc.beatDisplay, rc.notes);
  renderNotes(tctx, c, fakeRc, vis);
  const tile: Tile = { canvas, refScale: es, bytes: bw * bh * 4, empty: false };
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
    const c = makeCoords(rc.geometry, rc.viewport, rc.beatDisplay, rc.notes);
    const vis = rc.geometry.visibleNotes(rc.notes, rc.viewport, rc.beatDisplay);
    renderNotes(ctx, c, rc, vis);
    perf.info({ layerMode: 'direct', visibleNotes: vis.length });
    return;
  }

  const nb = {
    notes: rc.notes, selectedItems: rc.selectedItems, geometry: rc.geometry,
    beatDisplay: rc.beatDisplay, surfaceW: rc.surface.w, dpr: rc.dpr,
    skinVersion: rc.skinVersion ?? 0,
  };
  if (
    !basis || basis.notes !== nb.notes || basis.selectedItems !== nb.selectedItems ||
    basis.geometry !== nb.geometry || basis.beatDisplay !== nb.beatDisplay ||
    basis.surfaceW !== nb.surfaceW || basis.dpr !== nb.dpr || basis.skinVersion !== nb.skinVersion
  ) {
    tiles.clear();
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
    const r = tileBlitRect(id, es, t.refScale, anchorY, rc.surface.w);
    if (r.y > rc.surface.h || r.y + r.h < 0) continue; // 屏外瓦片（padding 外扩可能引入）
    ctx.drawImage(t.canvas, r.x, r.y, r.w, r.h);
    blitted++;
  }
  perf.info({ layerMode: 'tiles', tiles: tiles.size, blitted, rebuilt, staleBlit });
}
