// 音符层离屏瓦片缓存（issue 10 性能核心 / 候选 3 缓存有主）：
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
// 缩放手势策略：手势期间（rc.zoomGesture）stale 瓦片按逐帧时间预算渐进重建
// （预算内现建、超预算才按比例 blit），250ms settle 后的重渲只兜底残余 —— 全程无"糊→清晰"的整批突替换切。
// issue 173：预算中断的位置记在游标里，下一帧从断点续建（轮转），不再每帧从 lo 重扫 —— 否则慢机/被抢占时
// 视口上方的瓦片帧帧排在后面、整个手势期都轮不到，settle 一次性集中重建（正是上面要消灭的跳变）。
// 同时给单块重建加成本上限（GESTURE_TILE_COST_CAP_MS），把最坏帧成本压到「预算 + 一块」。
//
// 候选 3（缓存有主）：本缓存是**实例**（`createNoteLayerCache`），不再是模块级可变单例 ——
// 工作台画布与离屏导出 / 未来预览各持一份，互不顶掉（见 `../RenderTarget`）。
import { renderNotes, renderSelectionOverlay } from '../render';
import { makeCoords } from '../coords';
import { bufferSizeFor } from '../rasterScale';
import type { RenderCtx } from '../types';
import { VIEWPORT_PADDING, type GeometryBounds } from '../../chart/geometry/ChartGeometry';
import type { BpmTimelineEvent } from '../../chart/geometry/BpmTimeline';
import type { ChartNote, SlideNote } from '../../chart/types';
import { perf } from '../../chart/perf';

/** 瓦片的 pos 空间高度（timeline 像素） */
export const TILE_PX = 512;
/** 超过此 es 才直渲。工具栏上限 300%（es=3）；倒流 SP 扫描线在直渲下每帧都付（issue 140），故阈值盖住 UI 最大缩放。 */
const MAX_CACHE_ES = 3;
/** |es/refScale − 1| 超过该值视为 stale，需要（手势结束后）高清重建 */
const STALE_TOL = 0.02;
/** 默认基准帧间隔（ms）：标准 60Hz 屏（1000 / 60 ≈ 16.67ms） */
export const DEFAULT_FRAME_INTERVAL_MS = 1000 / 60;
/** 60Hz 默认手势重建时间预算（ms）：预算内把 stale 瓦片逐帧现建（轻谱 1-2 帧内全部转新、无"糊→清晰"跳变），
 *  超预算退回比例 blit；重谱逐帧锐化、单帧成本有界。 */
export const BASE_GESTURE_REBUILD_BUDGET_MS = 4;
/** 60Hz 默认单块重建成本上限（ms，issue 173）：一块瓦片的实测建造成本超过它，本帧立刻收手（余下的留到后续帧）。
 *  正常机器单块 ≈0.3~0.5ms，永不触发；只在进程被抢占 / 极慢机上生效，把"一帧连建 N 块"
 *  的最坏帧成本从「不可控」压到「预算 + 一块」。 */
export const BASE_GESTURE_TILE_COST_CAP_MS = 8;

/**
 * 帧率自适应瓦片排水延迟计算（issue 213）：
 * - 静止期 delay 恒为 0（最快速度在空闲期排空）；
 * - 播放期：
 *   - 60Hz（>12ms）：保持既有 16ms（~1 帧）延时，保护低性能设备不变量；
 *   - 高刷屏（<=12ms，如 90Hz/120Hz/144Hz/240Hz）：
 *     缩短至 Math.max(1, Math.min(4, Math.floor(frameInterval / 2)))，消除跨帧饥饿断层。
 */
export function computeDrainDelay(frameInterval: number, isPlaying: boolean): number {
  if (!isPlaying) return 0;
  if (frameInterval > 12) return 16;
  return Math.max(1, Math.min(4, Math.floor(frameInterval / 2)));
}

/**
 * 帧率自适应手势重建预算与单块上限计算（issue 213）：
 * - 单片重建预算不超过当前帧预算的 25%（60Hz 下 4.0ms，120Hz 下约 2.08ms）；
 * - 单块成本上限不超过当前帧预算的 50%（60Hz 下 8.0ms，120Hz 下约 4.16ms），防止单块瓦片耗尽单帧预算。
 */
export function computeRebuildBudget(frameInterval: number): { gestureBudgetMs: number; tileCostCapMs: number } {
  return {
    gestureBudgetMs: Math.min(BASE_GESTURE_REBUILD_BUDGET_MS, frameInterval * 0.25),
    tileCostCapMs: Math.min(BASE_GESTURE_TILE_COST_CAP_MS, frameInterval * 0.5),
  };
}

/**
 * 根据实测 rAF 帧间隔归一化到离散标准刷新率档位（issue 213）：
 * - 240Hz：~4.17ms（<= 5.2ms）
 * - 144Hz：~6.94ms（5.2ms ~ 7.5ms）
 * - 120Hz：~8.33ms（7.5ms ~ 10.0ms，Apple ProMotion / Windows 120Hz）
 * - 90Hz：~11.11ms（10.0ms ~ 13.5ms）
 * - 60Hz：~16.67ms（> 13.5ms，标准屏基线）
 */
export function classifyRefreshInterval(measuredDeltaMs: number): number {
  if (measuredDeltaMs <= 5.2) return 1000 / 240;
  if (measuredDeltaMs <= 7.5) return 1000 / 144;
  if (measuredDeltaMs <= 10.0) return 1000 / 120;
  if (measuredDeltaMs <= 13.5) return 1000 / 90;
  return DEFAULT_FRAME_INTERVAL_MS;
}

/**
 * 屏幕物理刷新率动态平滑估算器（issue 213）：
 * - 接收连续 rAF timestamp，过滤极端异常值（休眠/切标签）；
 * - 维护滑动窗口中位数，防止单帧卡顿（hitch）导致刷新率跳变（flapping）；
 * - 只有当多次测量稳定指向新档位时，才触发回调。
 */
export class RefreshRateEstimator {
  private prevTime: number | null = null;
  private readonly samples: number[] = [];
  private currentInterval = DEFAULT_FRAME_INTERVAL_MS;
  private readonly onIntervalChange?: (intervalMs: number) => void;

  constructor(onIntervalChange?: (intervalMs: number) => void) {
    this.onIntervalChange = onIntervalChange;
  }

  sample(timestamp: number): number {
    if (this.prevTime !== null) {
      const delta = timestamp - this.prevTime;
      // 过滤休眠、卡死、切标签等极端异常值（> 40ms 或 < 3ms）
      if (delta >= 3 && delta <= 40) {
        this.samples.push(delta);
        if (this.samples.length > 8) this.samples.shift();
        if (this.samples.length >= 5) {
          const sorted = [...this.samples].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          const classified = classifyRefreshInterval(median);
          if (classified !== this.currentInterval) {
            this.currentInterval = classified;
            this.onIntervalChange?.(classified);
          }
        }
      }
    }
    this.prevTime = timestamp;
    return this.currentInterval;
  }

  getInterval(): number {
    return this.currentInterval;
  }
}
/** 瓦片总内存预算（字节，按 RGBA 4B/px 估算），超出按插入序淘汰。
 *  issue 36：96MB → 64MB（密集谱下瓦片缓存是常驻内存增量的主体；配合瓦片 dpr 上限下调） */
const BYTES_BUDGET = 64 * 1024 * 1024;
/** 瓦片数量上限（兜底，正常情况下字节预算先生效） */
const MAX_TILES = 64;
/** 瓦片位图 dpr 上限（issue 212）：开放 2.0x 整数倍光栅化，对齐 Retina 2.0x 标准屏与 Windows 各常用 DPI（1.0/1.25/1.5/1.75/2.0），
 *  消除 1.5x 上限在 2.0x 画布上的 1.333x 放大失真与重采样模糊；
 *  配合 LRU 瓦片数量上限与 64MiB 显存预算，防范超大视口爆显存。 */
export const TILE_DPR_CAP = 2.0;

/**
 * 瓦片有效 DPR（issue 212）：
 * - 对 2.0x 及以下屏幕开放完整 DPR（含 Retina 2.0x 与 Windows 125%/150%/175%/200%），
 *   使瓦片位图与主画布物理像素达到 1:1 直绘，彻底消除非整数缩放拉伸；
 * - 超过 2.0x（如 3.0x/4.0x 超高分屏）封顶为 2.0x，防范超大视口爆显存。
 */
export function getEffectiveDpr(dpr: number): number {
  return Math.min(Math.max(1, dpr), TILE_DPR_CAP);
}

export interface TileBlitSmoothingParams {
  dpr: number;
  tileDpr: number;
  es: number;
  refScale: number;
  surfaceW: number;
  tileW: number;
  dx?: number;
  dy?: number;
  dw?: number;
  dh?: number;
  sx?: number;
  sy?: number;
  sw?: number;
  sh?: number;
}

/**
 * issue 222（抗畸变根治）：瓦片 blit 自适应平滑策略
 * - 浮点 DPR（Windows 125%/150%/175% 等）或缩放拉伸态（手势期 es !== refScale）下，强制开启高阶滤波平滑，消除亚像素锯齿与黑斑；
 * - 仅当物理像素严格 1:1 整数对齐（如标准 1.0x 或 Retina 2.0x 且无缩放拉伸）时，才关闭平滑以最大化填充性能。
 */
export function shouldEnableTileBlitSmoothing(p: TileBlitSmoothingParams): boolean {
  if (p.dx !== undefined && Math.abs(p.dx - Math.round(p.dx)) > 1e-4) return true;
  if (p.dy !== undefined && Math.abs(p.dy - Math.round(p.dy)) > 1e-4) return true;
  if (p.dw !== undefined && Math.abs(p.dw - Math.round(p.dw)) > 1e-4) return true;
  if (p.dh !== undefined && Math.abs(p.dh - Math.round(p.dh)) > 1e-4) return true;
  if (p.sx !== undefined && Math.abs(p.sx - Math.round(p.sx)) > 1e-4) return true;
  if (p.sy !== undefined && Math.abs(p.sy - Math.round(p.sy)) > 1e-4) return true;
  if (p.sw !== undefined && Math.abs(p.sw - Math.round(p.sw)) > 1e-4) return true;
  if (p.sh !== undefined && Math.abs(p.sh - Math.round(p.sh)) > 1e-4) return true;
  const isDprInteger = Math.abs(p.dpr - Math.round(p.dpr)) < 1e-5;
  const isTileDprInteger = Math.abs(p.tileDpr - Math.round(p.tileDpr)) < 1e-5;
  if (!isDprInteger || !isTileDprInteger) return true;
  if (Math.abs(p.dpr - p.tileDpr) > 1e-5) return true;
  if (Math.abs(p.es - p.refScale) > 1e-5) return true;
  if (Math.abs(p.surfaceW - p.tileW) > 1e-5) return true;
  return false;
}


interface Tile {
  canvas: HTMLCanvasElement | OffscreenCanvas | null;
  refScale: number;
  /** 渲染该瓦片时的 surface 宽度（CSS 像素）：位图与当时的画布同宽。
   *  issue 36 F3a：surface 变化不再清空瓦片，blit 按此宽度缩放并绕当前宽度居中（X 精确）。 */
  surfaceW: number;
  bytes: number;
  empty: boolean;
  /** issue 146：内容已被音符变更作废（旧位图不代表当前 notes）。位图留着当过渡帧，
   *  重建产出的是没有本标记的新 Tile（`renderTile` 整块替换）。 */
  dirty?: boolean;
}

/** 最近一次 `draw` 的瓦片账 */
interface NoteLayerStats {
  layerMode: 'tiles' | 'direct';
  rebuilt: number;
  blitted: number;
  lo: number;
  hi: number;
  blitCssPx: number;
  /** 本帧结束后仍然 stale / 待建的可见瓦片数（issue 173：手势被预算掐断时的积压量）。
   *  0 = 可见瓦片全部与当前 es 一致 → 紧接着的 settle 帧不会再重建任何东西。 */
  backlog: number;
}

export interface NoteLayerCache {
  /** 绘制音符层（renderChart 调用，替代原先的直接 renderNotes）。 */
  draw(ctx: CanvasRenderingContext2D, rc: RenderCtx): void;
  /** 丢弃全部瓦片与失效依据（播放队列一并清空）。 */
  reset(): void;
  /** 设置当前屏幕帧间隔（ms，issue 213 由 rAF 采样注入） */
  setFrameInterval(intervalMs: number): void;
  /** 获取当前生效的帧间隔（ms） */
  getFrameInterval(): number;
  /** 测试注入点：瓦片位图工厂（浏览器用 canvas，测试可注入假实现）。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 假位图只需形状兼容（见 tests/support/canvas.ts）
  __setCanvasFactoryForTests(factory: () => any): void;
  /** 测试专用：读取当前瓦片表（判断某拍区间的瓦片是否被重建） */
  __getTilesForTests(): ReadonlyMap<number, Tile>;
  /** 测试专用：最近一次 draw 的瓦片账 */
  __getLastNoteLayerStats(): NoteLayerStats;
  /** 测试专用：同步清空播放瓦片队列（drain 到空）。 */
  __flushPlayingTileQueueForTests(): void;
}

/** BPM 事件表内容相等（事件数通常 ≤ 个位数）：surface 变化时组件会重建 geometry 实例，
 *  但时间线内容未变 → 瓦片续用，故失效依据按内容而非实例比较（issue 36 F3a） */
const bpmEventsEqual = (a: readonly BpmTimelineEvent[], b: readonly BpmTimelineEvent[]) =>
  a === b || (a.length === b.length && a.every((e, i) => e.beat === b[i].beat && e.bpm === b[i].bpm));

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

/** pos 空间可见范围（单一提供者 = ChartGeometry.posRange；viewportBounds 已含 VIEWPORT_PADDING 外扩） */
export function posRangeOf(rc: RenderCtx): { posMin: number; posMax: number } {
  return rc.geometry.posRange(rc.viewport);
}

/** [posMin, posMax] 覆盖的瓦片序号闭区间 */
export function tileIndexRange(posMin: number, posMax: number): { lo: number; hi: number } {
  const lo = Math.max(0, Math.floor(posMin / TILE_PX));
  const hi = Math.max(lo, Math.floor(Math.max(posMin, posMax) / TILE_PX));
  return { lo, hi };
}

/** 获取全谱首个非空实体音符所在的瓦片序号；无实体音符返回 null（issue 167 靶向预热用） */
export function firstNonEmptyTileIdOf(rc: RenderCtx): number | null {
  const minPos = rc.geometry.firstNotePosition(rc.notes, rc.beatDisplay);
  if (minPos === null) return null;
  return Math.max(0, Math.floor(minPos / TILE_PX));
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

/**
 * 单块瓦片位图的**估算字节数**（issue 195）：与 `renderTile` 同一口径
 * （宽 = surface.w，高 = TILE_PX·es，dpr 上限 TILE_DPR_CAP，RGBA 4B/px）。
 * 用于在预取前按 64MiB 预算做容量规划；空瓦片实际 0 字节，这里按满块保守估计。
 */
export function tileBytesFor(surfaceW: number, es: number, dpr: number): number {
  const tileDpr = getEffectiveDpr(dpr);
  const { w, h } = bufferSizeFor({ w: Math.max(0, surfaceW), h: Math.max(0, TILE_PX * es) }, tileDpr);
  return w * h * 4;
}

/** 当前 surface/es 下 64MiB 预算能容纳的整块瓦片数（至少 1，封顶 MAX_TILES） */
export function maxTilesForBudget(surfaceW: number, es: number, dpr: number): number {
  const bytes = tileBytesFor(surfaceW, es, dpr);
  if (bytes <= 0) return MAX_TILES;
  return Math.max(1, Math.min(MAX_TILES, Math.floor(BYTES_BUDGET / bytes)));
}

/**
 * 瓦片是否与**实际视口**相交（issue 195）：与 `tileBlitRect` 同一映射，
 * **不含** `VIEWPORT_PADDING` 外扩。用于区分「本帧必须画出来的块」与「padding 预热块」。
 */
export function tileIntersectsViewport(tileId: number, es: number, anchorY: number, viewH: number): boolean {
  const h = TILE_PX * es;
  const top = anchorY - (tileId + 1) * h;
  return top + h > 0 && top < viewH;
}

export interface PrefetchPlanInput {
  lo: number;
  hi: number;
  firstTile: number | null;
  surfaceW: number;
  surfaceH: number;
  es: number;
  dpr: number;
  /** 与 `draw` 同口径：`(chartEndVirtualY − scrollY)·es + surface.h` */
  anchorY: number;
}

/**
 * 静止/播放帧的预取计划（issue 195）：**先保证视口覆盖块**，再按预算塞入
 * 「向上 2 块 → padding → 首音符窗口」；超出预算的远端预热（尤其高倍下的
 * `firstTile..+4`）直接让位，避免 `evictOverBudget` 在预取和视口块之间来回互杀。
 *
 * 顺序即队列顺序：视口缺块最先补；预算不足时优先保住播放方向的 `hi+1/hi+2`，
 * 而不是把容量花在看不见的远端首音符窗口。视口块即使数量超过预算也全部保留
 * （`evictOverBudget` 另有视口保护，正确性优先于 64MiB 软上限）。
 */
export function planPrefetchTiles(input: PrefetchPlanInput): number[] {
  const { lo, hi, firstTile, surfaceW, surfaceH, es, dpr, anchorY } = input;
  const max = maxTilesForBudget(surfaceW, es, dpr);
  const out: number[] = [];
  const add = (id: number) => {
    if (id < 0 || out.length >= max || out.includes(id)) return;
    out.push(id);
  };
  // 1) 本帧必须出像素的视口覆盖块（不裁剪；通常 1~2 块）
  for (let id = lo; id <= hi; id++) {
    if (tileIntersectsViewport(id, es, anchorY, surfaceH) && !out.includes(id)) out.push(id);
  }
  // 2) 播放滚动方向的前瞻：视口上方 2 块
  for (let id = hi + 1; id <= hi + 2; id++) add(id);
  // 3) 视口 padding 内剩余块（近处，优先于远端首音符）
  for (let id = lo; id <= hi; id++) add(id);
  // 4) 全谱首个实体音符窗口（issue 167/179/188）：预算够才加
  if (firstTile !== null) {
    for (let id = firstTile; id <= firstTile + 4; id++) add(id);
  }
  return out;
}

/**
 * 把瓦片 dest 矩形裁到视口再映射到位图源矩形（issue 140）。
 * 高倍下 cssH = TILE_PX·es 可超过视口一倍多；整张 blit 会把屏外像素也送去缩放。
 */
export function clipTileDrawRect(
  dest: { x: number; y: number; w: number; h: number },
  viewW: number,
  viewH: number,
  bitmapW: number,
  bitmapH: number,
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } | null {
  if (dest.w <= 0 || dest.h <= 0 || bitmapW <= 0 || bitmapH <= 0) return null;
  const dx0 = Math.max(0, dest.x);
  const dy0 = Math.max(0, dest.y);
  const dx1 = Math.min(viewW, dest.x + dest.w);
  const dy1 = Math.min(viewH, dest.y + dest.h);
  const dw = dx1 - dx0;
  const dh = dy1 - dy0;
  if (dw <= 0 || dh <= 0) return null;
  return {
    sx: (dx0 - dest.x) / dest.w * bitmapW,
    sy: (dy0 - dest.y) / dest.h * bitmapH,
    sw: dw / dest.w * bitmapW,
    sh: dh / dest.h * bitmapH,
    dx: dx0,
    dy: dy0,
    dw,
    dh,
  };
}

/** 默认瓦片位图工厂（实例可注入替身）。 */
function createTileCanvasDefault() {
  return document.createElement('canvas');
}

/**
 * 创建一个音符瓦片缓存实例（候选 3）：瓦片表 / 失效依据 / 播放瓦片队列与计时器 / 统计全在实例内，
 * 不与其它渲染目标共享 —— 见 `../RenderTarget`。
 */
export function createNoteLayerCache(): NoteLayerCache {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- 测试注入点：假位图只需结构兼容 */
  let createTileCanvas: () => any = createTileCanvasDefault;
  const tiles = new Map<number, Tile>();

  /** 播放帧 miss / 预取下一格：paint 后再建，避免同步光栅打进 present。 */
  const playTileQueue: number[] = [];
  let playTileSnap: { rc: RenderCtx; es: number } | null = null;
  let playTileTimer: ReturnType<typeof setTimeout> | null = null;
  /** 当前屏幕帧间隔（ms，issue 213）：默认 16.67ms（60Hz 基线），由 rAF 采样注入 */
  let frameInterval = DEFAULT_FRAME_INTERVAL_MS;

  function setFrameInterval(intervalMs: number) {
    if (Number.isFinite(intervalMs) && intervalMs > 0) {
      frameInterval = intervalMs;
    }
  }

  function getFrameInterval(): number {
    return frameInterval;
  }

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
    /** issue 104：瓦片位图活在**布局坐标空间**，其原点 = chartEndVirtualY（画布高度由秒直出），
     *  故失效依据按它比较，而不是按派生出来的 chartEndBeat */
    chartEndVirtualY: number; beatDisplay: number; dpr: number; skinVersion: number;
    /** issue 39：节奏图示大小 / 长压线不透明度烘进音符瓦片，变化时需全量失效 */
    noteSize: number; slideOpacity: number;
    /** issue 39 #3：同时点击线烘进音符瓦片，变化时需全量失效 */
    simultaneousClickLines: boolean;
    /** issue 39 #4：色觉辅助改变 tap 款式（实拍/虚拍位图），变化时需全量失效 */
    colorAssist: boolean;
    /** chart-preview 08：轨道镜像翻转音符位置与方向键，变化时需全量失效 */
    mirror: boolean;
    /** issue 39 #5：纵向比例改变 timeline 高度 → pos 空间平移，需全量失效 */
    verticalRatio: number;
  } | null = null;

  let lastNoteLayerStats: NoteLayerStats = { layerMode: 'tiles', rebuilt: 0, blitted: 0, lo: 0, hi: -1, blitCssPx: 0, backlog: 0 };

  /** 手势期「上次因预算/单块超支而中断」的瓦片 id（issue 173）：下一帧从它续建，而不是每帧都从 lo 重扫。
   *  旧行为下预算被抢占吃光时，id 更大（视口上方）的瓦片帧帧排在后面 → 整个手势期都轮不到，
   *  松手 settle 时集中重建 = 「糊 → 清晰整批替换」跳变。null = 没有积压。 */
  let rebuildCursor: number | null = null;
  /** issue 195：本帧与**实际视口**相交的瓦片 id —— 淘汰时优先保护，避免暂停帧重建 padding 块时
   *  把唯一覆盖视口的块挤掉（那会得到 `blitted=0` 的整屏空白帧）。 */
  let protectedTiles: ReadonlySet<number> = new Set();

  function isTileStale(t: Tile, es: number): boolean {
    return !t.empty && Math.abs(es / t.refScale - 1) > STALE_TOL;
  }

  function drainOnePlayingTile() {
    const snap = playTileSnap;
    const id = playTileQueue.shift();
    if (id === undefined || !snap) return;
    const cur = tiles.get(id);
    // issue 146：不再是「只有没建过的才补」——打脏的也要换下来，否则旧音符一直挂着。
    // issue 199：尺度过期的瓦片（stale）也必须换下来，否则播放中缩放后锁定在旧 scale 发糊。
    if (cur && !cur.dirty && !isTileStale(cur, snap.es)) return;
    renderTile(id, snap.rc, snap.es);
  }

  function schedulePlayTileDrain() {
    if (playTileTimer !== null || playTileQueue.length === 0) return;
    const isPlaying = playTileSnap?.rc.playing === true;
    // issue 167 / issue 213：播放期根据屏幕帧率自适应排水延迟（120Hz 下为 4ms 消除饥饿，60Hz 下保持 16ms 保护既有不变量）；
    // 静止期 delay 恒为 0，以最快速度在空闲期排空预热队列。
    const delay = computeDrainDelay(frameInterval, isPlaying);
    playTileTimer = setTimeout(() => {
      playTileTimer = null;
      drainOnePlayingTile();
      schedulePlayTileDrain();
    }, delay);
  }

  /** issue 188：命中瓦片时刷新 Map 插入序为 MRU，使 evictOverBudget 真正按 LRU 淘汰而非 FIFO */
  function touchTile(id: number, t: Tile) {
    tiles.delete(id);
    tiles.set(id, t);
  }

  function enqueuePlayingTiles(ids: number[], rc: RenderCtx, es: number) {
    playTileSnap = { rc, es };
    for (const id of ids) {
      if (id < 0) continue;
      // issue 146：存在但未打脏的才跳过；打脏的要进队列换下来。
      // issue 188：已命中的活跃/靶向预热瓦片同步刷新为 MRU，防止漫游后被 FIFO 提前淘汰。
      // issue 199：尺度过期（stale）的瓦片同样不能跳过，排入队列异步平滑换新。
      const cur = tiles.get(id);
      if (cur && !cur.dirty && !isTileStale(cur, es)) {
        touchTile(id, cur);
        continue;
      }
      if (!playTileQueue.includes(id)) playTileQueue.push(id);
    }
    schedulePlayTileDrain();
  }

  function reset() {
    tiles.clear();
    basis = null;
    rebuildCursor = null;
    protectedTiles = new Set();
    lastNoteLayerStats = { layerMode: 'tiles', rebuilt: 0, blitted: 0, lo: 0, hi: -1, blitCssPx: 0, backlog: 0 };
    playTileQueue.length = 0;
    playTileSnap = null;
    if (playTileTimer !== null) {
      clearTimeout(playTileTimer);
      playTileTimer = null;
    }
  }

  /**
   * 删除覆盖 [minBeat, maxBeat] 的瓦片。外扩余量 = 瓦片渲染时的 VIEWPORT_PADDING
   * （跨瓦片音符会在相邻瓦片重复绘制）+ 音符半高/选中圈，保证所有画过这些音符的瓦片都被失效。
   *
   * issue 36 修复：区间端点顺序（低拍 → 小 pos）曾颠倒，跨多拍变更只失效一端 → "Slide 后半截
   * 渲染不出来"。**issue 104 更正**：pos = positionOfBeat(beat) **不再随 beat 单调**（倒流区回退），
   * 故不再由两端相减求范围，改走 `positionRangeOfBeats`（分段线性正向极值，把折返的回落点一并纳入）。
   */
  function invalidateTilesForBeatRange(minBeat: number, maxBeat: number, rc: RenderCtx) {
    const es = rc.viewport.scale;
    // issue 104 修法 4：拍区间 → 布局坐标区间走时间轴的**正向分段线性极值**
    // （`positionRangeOfBeats`：折返的峰值也在区间内），不再端到端相减——倒流区里 pos 非单调，
    // 两端相减会漏掉折返段覆盖到的瓦片（复现 issue 36 那个"陈旧瓦片"的 bug 形态）。
    const { min, max } = rc.geometry.timeline.positionRangeOfBeats(Math.max(0, minBeat), Math.max(0, maxBeat));
    const margin = (VIEWPORT_PADDING + 48) / es;
    const { lo, hi } = tileIndexRange(min - margin, max + margin);
    // issue 146：**打脏而不是 `tiles.delete`**。播放帧的瓦片 miss 偏偏不做同步光栅
    // （本文件下方 `draw` 的 playing 分支 —— 见 `e289e8e` defer play-time raster），
    // 删除就等于「接下来若干帧这块瓦片没有任何像素」；而 margin = (VIEWPORT_PADDING+48)/es ≈ 248
    // pos px 常常覆盖全部可见内容瓦片 → 用户看到的是**整屏音符消失一瞬**，任何编辑动作都触发。
    // 打脏后本帧仍 blit 上一版位图（内容不新但连续），队列异步重建完换下。
    // issue 232：仅与视口相交的可见块打脏保留；对于离开当前视口的远端失效瓦片，直接 delete 淘汰，
    // 杜绝回滚后编辑将远端瓦片滞留为 dirty，在随后开播时引发排空风暴与旧音符残影闪烁。
    const anchorY = (rc.geometry.chartEndVirtualY - rc.viewport.scrollY) * es + rc.surface.h;
    for (let id = lo; id <= hi; id++) {
      const t = tiles.get(id);
      if (t) {
        if (tileIntersectsViewport(id, es, anchorY, rc.surface.h)) {
          t.dirty = true;
        } else {
          tiles.delete(id);
          const qIdx = playTileQueue.indexOf(id);
          if (qIdx !== -1) playTileQueue.splice(qIdx, 1);
        }
      }
    }
  }

  /** issue 146 / 232：变更收敛不到拍区间（undo/redo 整份换引用等）—— 视口内打脏，视口外直接淘汰 */
  function markAllTilesDirty(rc: RenderCtx) {
    const es = rc.viewport.scale;
    const anchorY = (rc.geometry.chartEndVirtualY - rc.viewport.scrollY) * es + rc.surface.h;
    for (const [id, t] of [...tiles.entries()]) {
      if (tileIntersectsViewport(id, es, anchorY, rc.surface.h)) {
        t.dirty = true;
      } else {
        tiles.delete(id);
        const qIdx = playTileQueue.indexOf(id);
        if (qIdx !== -1) playTileQueue.splice(qIdx, 1);
      }
    }
  }

  function evictOverBudget() {
    let total = 0;
    for (const t of tiles.values()) total += t.bytes;
    if (total <= BYTES_BUDGET && tiles.size <= MAX_TILES) return;
    // issue 195：先淘汰非视口块；视口覆盖块即使让总量略超 64MiB 软上限也保留 ——
    // 正确性优先（否则暂停帧重建 padding 块会把唯一出像素的块挤掉，整屏空白一瞬）。
    for (const id of [...tiles.keys()]) {
      if (total <= BYTES_BUDGET && tiles.size <= MAX_TILES) break;
      if (protectedTiles.has(id)) continue;
      const t = tiles.get(id);
      if (!t) continue;
      total -= t.bytes;
      tiles.delete(id);
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
    // issue 212：瓦片有效 dpr 走 getEffectiveDpr，Retina 2.0x 与 Windows 100%~200% 开放 1:1 直通，消除 1.333x 放大失真。
    const tileDpr = getEffectiveDpr(rc.dpr);
    // buffer = css × dpr，尺寸口径走 rasterScale 唯一处
    const { w: bw, h: bh } = bufferSizeFor({ w: cssW, h: cssH }, tileDpr);
    canvas.width = bw;
    canvas.height = bh;
    const tctx = canvas.getContext('2d');
    // issue 98：transform 按「位图实际尺寸 / css 尺寸」取，而非恒 tileDpr——
    // round(css·tileDpr) 与 css·tileDpr 的整数量化差若留在画面上，会以「距瓦片顶边线性增长」的
    // 压缩形式呈现（≤±0.5/tileDpr px，每个 es 重掷 → 快速缩放时音符相对网格瞬态跳动 ≤1px）。
    // 按实际比例绘制后内容恰好填满整数位图，blit（目标高 = cssH）逐像素精确，瓦片接缝数学不动。
    tctx.setTransform(bw / cssW, 0, 0, bh / cssH, 0, 0);
    // issue 40（渲染质量）：瓦片承载音符精灵，与主画布同一平滑策略（显式置 true，与默认一致不改观感）。
    // issue 212：开放 Retina 2.0x 瓦片直通，1:1 绘制无需二次拉伸，配合 64MiB 预算与 LRU 保护显存。
    tctx.imageSmoothingEnabled = true;
    // issue 40：与主画布同用高阶滤波，压低缩小时精灵边缘的子像素混色/杂色
    tctx.imageSmoothingQuality = 'high';
    const fakeSurface = { w: cssW, h: cssH };
    const fakeRc: RenderCtx = { ...rc, viewport: vp, surface: fakeSurface };
    const c = makeCoords(rc.geometry, vp, rc.beatDisplay, rc.notes, rc.display?.mirror === true);
    // F1：瓦片不含选中态（选中/hover 高亮由主画布叠加层绘制，选择变化不再重建瓦片）
    renderNotes(tctx, c, fakeRc, vis);
    const tile: Tile = { canvas, refScale: es, surfaceW: cssW, bytes: bw * bh * 4, empty: false };
    tiles.set(tileId, tile);
    evictOverBudget();
    return tile;
  }

  /**
   * 绘制音符层入口（renderChart 调用，替代原先的直接 renderNotes）：
   * - `rc.directNotes` → 直接渲染（预览面板 / 宽图导出：一次性出图，不要瓦片的中转与最近邻 blit）；
   * - es > MAX_CACHE_ES → 直接渲染（仅高于工具栏最大缩放；issue 140 起 300% 仍走瓦片）；
   * - 否则走瓦片缓存：miss 的瓦片以当前 es 渲染（播放帧受时间预算，issue 101）；stale 瓦片在手势/播放期间按逐帧预算渐进重建
   *   （超预算的残余先按比例 blit，settle 帧兜底收尾）。
   */
  function draw(ctx: CanvasRenderingContext2D, rc: RenderCtx) {
    const es = rc.viewport.scale;
    if (rc.directNotes || es > MAX_CACHE_ES) {
      // 直渲并丢掉瓦片（缩回瓦片模式时会全量重建）
      if (tiles.size > 0) {
        tiles.clear();
        basis = null;
      }
      rebuildCursor = null;
      protectedTiles = new Set();
      const c = makeCoords(rc.geometry, rc.viewport, rc.beatDisplay, rc.notes, rc.display?.mirror === true);
      const vis = rc.geometry.visibleNotes(rc.notes, rc.viewport, rc.beatDisplay);
      renderNotes(ctx, c, rc, vis);
      // 选中/hover 叠加层（issue 56）：直渲路径与瓦片路径共用同一描边实现
      renderSelectionOverlay(ctx, c, rc, vis);
      lastNoteLayerStats = { layerMode: 'direct', rebuilt: 0, blitted: 0, lo: 0, hi: -1, blitCssPx: 0, backlog: 0 };
      perf.info({ layerMode: 'direct', visibleNotes: vis.length });
      return;
    }

    const nb = {
      notes: rc.notes,
      bpmEvents: rc.geometry.bpmEvents,
      chartEndVirtualY: rc.geometry.chartEndVirtualY,
      beatDisplay: rc.beatDisplay, dpr: rc.dpr,
      skinVersion: rc.skinVersion ?? 0,
      noteSize: rc.display?.noteSize ?? 1,
      slideOpacity: rc.display?.slideOpacity ?? 1,
      simultaneousClickLines: rc.display?.simultaneousClickLines ?? false,
      colorAssist: rc.display?.colorAssist ?? false,
      mirror: rc.display?.mirror === true,
      verticalRatio: rc.geometry.verticalRatio,
    };
    let fullInvalidated = false;
    if (
      !basis || basis.chartEndVirtualY !== nb.chartEndVirtualY || basis.beatDisplay !== nb.beatDisplay ||
      basis.dpr !== nb.dpr || basis.skinVersion !== nb.skinVersion ||
      basis.noteSize !== nb.noteSize || basis.slideOpacity !== nb.slideOpacity ||
      basis.simultaneousClickLines !== nb.simultaneousClickLines ||
      basis.colorAssist !== nb.colorAssist ||
      basis.mirror !== nb.mirror ||
      basis.verticalRatio !== nb.verticalRatio ||
      !bpmEventsEqual(basis.bpmEvents, nb.bpmEvents)
    ) {
      // 时间线内容/节拍显示/dpr/皮肤/音符大小/长压线不透明度/同时点击线/色觉辅助/镜像/纵向比例变化 → pos 空间或位图语义变化，全量失效。
      // 注意：surface 宽高与 geometry 实例不在失效依据内（issue 36 F3a，见 basis 注释）。
      tiles.clear();
      basis = nb;
      // 全量失效帧保持旧口径：本帧把 [lo,hi] 全部同步重建（一次性事件，非 hover 热路径）。
      fullInvalidated = true;
    } else if (basis.notes !== nb.notes) {
      // F3：notes 引用变化 → 结构共享 diff，仅失效覆盖变更拍区间的瓦片
      const diff = diffNotes(basis.notes, rc.notes, rc.beatDisplay);
      if (diff.kind === 'full') markAllTilesDirty(rc);                                     // issue 146：不清空
      else if (diff.kind === 'range') invalidateTilesForBeatRange(diff.minBeat, diff.maxBeat, rc);
      basis = nb;
    }

    const { posMin, posMax } = posRangeOf(rc);
    const { lo, hi } = tileIndexRange(posMin, posMax);
    // issue 195：anchorY 与 blit 同一口径；先算视口覆盖块并登记为淘汰保护对象。
    const anchorY = (rc.geometry.chartEndVirtualY - rc.viewport.scrollY) * es + rc.surface.h;
    const viewIds: number[] = [];
    for (let id = lo; id <= hi; id++) {
      if (tileIntersectsViewport(id, es, anchorY, rc.surface.h)) viewIds.push(id);
    }
    protectedTiles = new Set(viewIds);

    let rebuilt = 0, blitted = 0, staleBlit = false, blitCssPx = 0;
    const prevSmooth = ctx.imageSmoothingEnabled;
    const prevQuality = ctx.imageSmoothingQuality;

    // ---- 1) 先重建（issue 173：游标轮转 + 单块成本上限），blit 再统一取本帧最新瓦片 ----
    const pending: number[] = [];
    if (!rc.playing) {
      // 播放期不同步光栅：miss 交给队列（本帧无像素，见 issue 101 起始口）；
      // 打脏的让位给队列（`enqueuePlayingTiles` 已把它排进去），本帧 blit 旧位图过渡、不留下空白帧。
      for (let id = lo; id <= hi; id++) {
        const t = tiles.get(id);
        const onScreen = viewIds.includes(id);
        const dirty = t?.dirty === true;
        // issue 195：非手势的静止帧只在**视口覆盖块**上同步补 missing/stale；padding 块不要求本帧像素，
        // 交给预取队列。否则鼠标移动触发的暂停帧会为了补 padding 块把视口块挤出预算 → 整层音符空白一瞬。
        // 打脏块仍保留同步语义（issue 146：停止播放后编辑内容立即换新），并有视口保护兜底；
        // basis 全量失效帧也保持旧口径（一次性事件，不算 hover 热路径）。
        if (!rc.zoomGesture && !fullInvalidated && !onScreen && !dirty) continue;
        if (!t || dirty) { pending.push(id); continue; }
        if (isTileStale(t, es)) pending.push(id);
      }
    }
    if (pending.length > 0) {
      // 起点：手势期从上次中断处续建（否则每帧都从 lo 重扫 → 视口上方的瓦片永远轮不到）；
      // settle / 非手势帧预算为 Infinity，起点无关紧要（全部都会建）。
      let startIdx = 0;
      if (rc.zoomGesture && rebuildCursor !== null) {
        const at = pending.indexOf(rebuildCursor);
        const next = at >= 0 ? at : pending.findIndex((id) => id >= rebuildCursor!);
        startIdx = next >= 0 ? next : 0;
      }
      const { gestureBudgetMs, tileCostCapMs } = computeRebuildBudget(frameInterval);
      const budgetEnd = rc.zoomGesture ? performance.now() + gestureBudgetMs : Infinity;
      let deferred: number | null = null;
      for (let k = 0; k < pending.length; k++) {
        const id = pending[(startIdx + k) % pending.length];
        // 首块恒建（保证每帧都有进展、不会因预算为 0 而饿死）；其余按预算 / 单块成本上限收手。
        if (k > 0 && performance.now() >= budgetEnd) { deferred = id; break; }
        const t0 = performance.now();
        renderTile(id, rc, es);
        rebuilt++;
        // 单块成本上限**只对手势帧**生效：手势期是"锐化速度换帧时间"；settle / 静止帧要的是
        // 一次收尾（预算本来就是 Infinity），在这里收手会让瓦片永远停在旧的 es 上。
        if (rc.zoomGesture && performance.now() - t0 > tileCostCapMs) {
          // 单块就超支：本帧不再建，下一帧从它的下一块接着来（保证轮转，不会饿死高 id）
          deferred = pending[(startIdx + k + 1) % pending.length];
          break;
        }
      }
      rebuildCursor = rc.zoomGesture ? deferred : null;
    } else {
      // 本帧没有积压（含播放帧 / settle 已收尾）：游标清空
      rebuildCursor = null;
    }

    // ---- 2) blit：用本帧重建后的瓦片（顺序 lo→hi，旧的"重建即 blit"语义不变） ----
    for (let id = lo; id <= hi; id++) {
      const t = tiles.get(id);
      if (!t) continue;
      touchTile(id, t);
      if (t.empty || !t.canvas) continue;
      if (isTileStale(t, es)) staleBlit = true;
      const r = tileBlitRect(id, es, t.refScale, anchorY, rc.surface.w, t.surfaceW);
      const clipped = clipTileDrawRect(r, rc.surface.w, rc.surface.h, t.canvas.width, t.canvas.height);
      if (!clipped) continue;
      // issue 222：瓦片 blit 自适应平滑（浮点 DPI / 缩放拉伸开启 high，仅整数 1:1 关闭）
      const smooth = shouldEnableTileBlitSmoothing({
        dpr: rc.dpr,
        tileDpr: getEffectiveDpr(rc.dpr),
        es,
        refScale: t.refScale,
        surfaceW: rc.surface.w,
        tileW: t.surfaceW,
        dx: clipped.dx,
        dy: clipped.dy,
        dw: clipped.dw,
        dh: clipped.dh,
        sx: clipped.sx,
        sy: clipped.sy,
        sw: clipped.sw,
        sh: clipped.sh,
      });
      ctx.imageSmoothingEnabled = smooth;
      if (smooth) ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(t.canvas, clipped.sx, clipped.sy, clipped.sw, clipped.sh, clipped.dx, clipped.dy, clipped.dw, clipped.dh);
      blitted++;
      blitCssPx += clipped.dw * clipped.dh;
    }
    ctx.imageSmoothingEnabled = prevSmooth;
    ctx.imageSmoothingQuality = prevQuality;
    // 预取统一走预算规划（issue 195）：
    // - issue 165/167/179/188：保留向上 hi+1/hi+2 前瞻与首音符 `[firstTile, firstTile+4]` 窗口；
    // - 但高倍下瓦片字节随 es 增长（240% ≈16.3MiB/块，64MiB 只容 3 块），先保证视口覆盖块，
    //   余量才给前瞻/padding/首音符窗口，避免「预取把视口块挤掉」的持续互杀。
    // - 顺序 = 队列顺序：视口缺块最先补；预算不足时远端首音符窗口直接让位。
    enqueuePlayingTiles(planPrefetchTiles({
      lo, hi,
      // 播放帧沿用旧口径：不重复做首音符扫描（静止期已预热）；静止帧才补首音符窗口。
      firstTile: rc.playing ? null : firstNonEmptyTileIdOf(rc),
      surfaceW: rc.surface.w, surfaceH: rc.surface.h,
      es, dpr: rc.dpr, anchorY,
    }), rc, es);
    // F1：选中/hover 叠加层（瓦片不含选中态，O(选中∩可见) 逐帧绘制，与瓦片 blit 逐像素对齐）
    // issue 67：`|| rc.selectionBox` —— 框选手势期间 selectedItems 还是空的（选区要等 mouseup）、
    // hoverItem 也常为 null，漏了这一项会让"框选实时预览"整个不画（首版就栽在这里）。
    if (rc.selectedItems.length > 0 || rc.hoverItem || rc.selectionBox) {
      const c = makeCoords(rc.geometry, rc.viewport, rc.beatDisplay, rc.notes, rc.display?.mirror === true);
      renderSelectionOverlay(ctx, c, rc, c.getVisibleNotes());
    }
    lastNoteLayerStats = { layerMode: 'tiles', rebuilt, blitted, lo, hi, blitCssPx, backlog: pending.length - rebuilt };
    perf.info({ layerMode: 'tiles', tiles: tiles.size, blitted, rebuilt, staleBlit, blitCssPx });
  }

  function __flushPlayingTileQueueForTests() {
    if (playTileTimer !== null) {
      clearTimeout(playTileTimer);
      playTileTimer = null;
    }
    while (playTileQueue.length > 0) drainOnePlayingTile();
  }

  function __setCanvasFactoryForTests(factory: () => unknown) {
    createTileCanvas = factory;
  }

  return {
    draw,
    reset,
    setFrameInterval,
    getFrameInterval,
    __setCanvasFactoryForTests,
    __getTilesForTests: () => tiles,
    __getLastNoteLayerStats: () => lastNoteLayerStats,
    __flushPlayingTileQueueForTests,
  };
}
