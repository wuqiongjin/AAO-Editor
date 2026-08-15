// 静态层离屏缓存（issue 36 F2 / RC-B）：
//
// 背景/轨道底色/网格（轨道竖线+边框+节拍横线）/谱面起止线只依赖
// (geometry, viewport.scale, scrollY, beatDisplay, chartEndBeat, surface, dpr)，
// 与 notes/选择/悬停/工具预览无关。此前 renderChart 每次交互帧（悬停预览、
// 选择框拖拽、放置后重渲……）都全量重绘这些静态元素，构成密集谱下的固定
// 帧成本地板。缓存到单张离屏画布后：
// - 交互帧（最常见）：basis 命中 → 仅 1 次 drawImage blit；
// - 滚动/缩放帧：basis 未命中 → 重建一次 + blit（与旧全量重绘同阶）。
//
// 位图复用单张 canvas，仅在缓冲尺寸变化时重分配（对齐 renderChart 主画布策略）。
// 判定线/起点标记/BPM 标注/工具预览等动态或与音符相关的层不进此缓存。
import { renderGrid, renderBoundLines } from './render';
import { makeCoords } from './coords';
import type { RenderCtx } from './types';
import type { BpmTimelineEvent } from '../utils/BpmTimeline';

let cacheCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;

/** 失效依据：任一变化才重建位图（bpmEvents 按内容比较——geometry 实例在 surface
 *  变化时会被组件重建，但时间线内容未变时静态层像素与旧位图完全一致，可续用） */
let basis: {
  bpmEvents: readonly BpmTimelineEvent[];
  chartEndBeat: number;
  scale: number;
  scrollY: number;
  beatDisplay: number;
  surfaceW: number;
  surfaceH: number;
  dpr: number;
} | null = null;

/** 离屏位图工厂：浏览器用 canvas，测试可注入假实现 */
let createStaticCanvas: () => any = () => document.createElement('canvas');
export function __setStaticCanvasFactoryForTests(factory: () => any) {
  createStaticCanvas = factory;
}

export function resetStaticLayerCache() {
  cacheCanvas = null;
  basis = null;
}

const bpmEventsEqual = (a: readonly BpmTimelineEvent[], b: readonly BpmTimelineEvent[]) =>
  a === b || (a.length === b.length && a.every((e, i) => e.beat === b[i].beat && e.bpm === b[i].bpm));

/**
 * 绘制静态层入口（renderChart 调用，替代原先的 清屏+背景+轨道底+网格+起止线 直绘）。
 * 输出与旧直恒等：黑底 → 轨道底色 → 网格 → 起止线，绘制进离屏位图后 blit 到主画布。
 */
export function drawStaticLayer(ctx: CanvasRenderingContext2D, rc: RenderCtx) {
  const nb = {
    bpmEvents: rc.geometry.bpmEvents,
    chartEndBeat: rc.geometry.chartEndBeat,
    scale: rc.viewport.scale,
    scrollY: rc.viewport.scrollY,
    beatDisplay: rc.beatDisplay,
    surfaceW: rc.surface.w,
    surfaceH: rc.surface.h,
    dpr: rc.dpr,
  };
  const hit = basis !== null &&
    basis.scale === nb.scale && basis.scrollY === nb.scrollY &&
    basis.beatDisplay === nb.beatDisplay && basis.chartEndBeat === nb.chartEndBeat &&
    basis.surfaceW === nb.surfaceW && basis.surfaceH === nb.surfaceH && basis.dpr === nb.dpr &&
    bpmEventsEqual(basis.bpmEvents, nb.bpmEvents);
  if (!hit) {
    if (!cacheCanvas) cacheCanvas = createStaticCanvas();
    const bitmap: any = cacheCanvas;
    const bw = Math.round(nb.surfaceW * nb.dpr), bh = Math.round(nb.surfaceH * nb.dpr);
    if (bitmap.width !== bw) bitmap.width = bw;
    if (bitmap.height !== bh) bitmap.height = bh;
    const cctx: CanvasRenderingContext2D = bitmap.getContext('2d');
    cctx.setTransform(nb.dpr, 0, 0, nb.dpr, 0, 0);
    cctx.clearRect(0, 0, nb.surfaceW, nb.surfaceH);
    cctx.fillStyle = '#000000';
    cctx.fillRect(0, 0, nb.surfaceW, nb.surfaceH);
    const c = makeCoords(rc.geometry, rc.viewport, rc.beatDisplay, rc.notes);
    const { trackBgX, trackBgWidth } = c.trackGeometry(rc.viewport.scale);
    cctx.fillStyle = '#00000A';
    cctx.fillRect(trackBgX, 0, trackBgWidth, nb.surfaceH);
    renderGrid(cctx, c, rc);
    renderBoundLines(cctx, c, rc);
    basis = nb;
  }
  // basis 命中时 cacheCanvas 必非空（不变量：basis 与 cacheCanvas 同生共死）
  ctx.drawImage(cacheCanvas!, 0, 0, rc.surface.w, rc.surface.h);
}
