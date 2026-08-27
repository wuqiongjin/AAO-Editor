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
import { DEFAULT_BACKGROUND_OPACITY } from '../utils/AppSettings';
import type { RenderCtx } from './types';
import type { BpmTimelineEvent } from '../utils/BpmTimeline';

let cacheCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;

/** 失效依据：任一变化才重建位图（bpmEvents 按内容比较——geometry 实例在 surface
 *  变化时会被组件重建，但时间线内容未变时静态层像素与旧位图完全一致，可续用；
 *  bg = 背景皮肤（issue 29 Q4）：生效标志 + revision，开/关/换图任一变化即重建） */
let basis: {
  bpmEvents: readonly BpmTimelineEvent[];
  chartEndBeat: number;
  scale: number;
  scrollY: number;
  beatDisplay: number;
  surfaceW: number;
  surfaceH: number;
  dpr: number;
  bgActive: boolean;
  bgRevision: number;
  bgOpacity: number;
  bgFit: 'cover' | 'contain';
  bgScope: 'outsideTrack' | 'fullCanvas';
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
 * 背景图绘制几何（issue 29 Q4 + 扩展配置 2026-08-27）：等比缩放后居中。
 * - cover：scale = max → 完全覆盖目标区、超出裁剪；
 * - contain：scale = min → 完整显示、不足处留底色（黑边）。
 * 返回目标矩形（CSS px）。mode 非法/尺寸非正时按 cover 处理并退化为原尺寸矩形。
 */
export function computeBackgroundDrawRect(sw: number, sh: number, iw: number, ih: number, mode: 'cover' | 'contain' = 'cover'): { dx: number; dy: number; dw: number; dh: number } {
  if (!(iw > 0) || !(ih > 0) || !(sw > 0) || !(sh > 0)) return { dx: 0, dy: 0, dw: sw, dh: sh };
  const scale = mode === 'contain' ? Math.min(sw / iw, sh / ih) : Math.max(sw / iw, sh / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  return { dx: (sw - dw) / 2, dy: (sh - dh) / 2, dw, dh };
}

/** 背景不透明度归一化（issue 29 修订 2026-08-27）：0..1，缺失/非法回退默认值（与 settings 域同一默认，观感连续） */
export function normalizeBackgroundOpacity(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_BACKGROUND_OPACITY;
}

/** 未启用/无图时的轨道底色与启用背景时的轨道再压暗色 */
const TRACK_BG_COLOR = '#00000A';
const TRACK_BG_OVER_IMAGE = 'rgba(0, 0, 10, 0.45)';

/**
 * 绘制静态层入口（renderChart 调用，替代原先的 清屏+背景+轨道底+网格+起止线 直绘）。
 * 输出与旧直恒等：黑底 →（背景皮肤层:cover 铺满 + 按 opacity 以图片自身 alpha 合成，黑色占比 = 1-opacity）
 * → 轨道底色（启用背景时半透明压暗）→ 网格 → 起止线，绘制进离屏位图后 blit 到主画布。
 */
export function drawStaticLayer(ctx: CanvasRenderingContext2D, rc: RenderCtx) {
  const bg = rc.background ?? null;
  const bgActive = !!(bg && bg.source && bg.width > 0 && bg.height > 0);
  const bgOpacity = normalizeBackgroundOpacity(bg?.opacity);
  const bgFit: 'cover' | 'contain' = bg?.fit === 'contain' ? 'contain' : 'cover';
  const bgScope: 'outsideTrack' | 'fullCanvas' = bg?.scope === 'fullCanvas' ? 'fullCanvas' : 'outsideTrack';
  const nb = {
    bpmEvents: rc.geometry.bpmEvents,
    chartEndBeat: rc.geometry.chartEndBeat,
    scale: rc.viewport.scale,
    scrollY: rc.viewport.scrollY,
    beatDisplay: rc.beatDisplay,
    surfaceW: rc.surface.w,
    surfaceH: rc.surface.h,
    dpr: rc.dpr,
    bgActive,
    bgRevision: bg?.revision ?? -1,
    bgOpacity,
    bgFit,
    bgScope,
  };
  const hit = basis !== null &&
    basis.scale === nb.scale && basis.scrollY === nb.scrollY &&
    basis.beatDisplay === nb.beatDisplay && basis.chartEndBeat === nb.chartEndBeat &&
    basis.surfaceW === nb.surfaceW && basis.surfaceH === nb.surfaceH && basis.dpr === nb.dpr &&
    // 背景皮肤五要素参与失效判定（issue 29 问题1根因：此前漏加背景字段，换图/调参被缓存命中吞掉，滚一下才重建）
    basis.bgActive === nb.bgActive && basis.bgRevision === nb.bgRevision && basis.bgOpacity === nb.bgOpacity &&
    basis.bgFit === nb.bgFit && basis.bgScope === nb.bgScope &&
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
    if (nb.bgActive && bg) {
      // 背景皮肤层（issue 29 Q4 + 扩展配置 2026-08-27）：按 fit 等比缩放居中，opacity 以图片自身 alpha
      // 合成于黑底之上（0 = 纯黑，1 = 原图全亮；黑色占比 = 1-opacity）。
      // scope 决定轨道区处理：
      //   outsideTrack（默认）= 轨道区重涂不透明原始底色，背景只出现在左右沟槽 —— 完全不影响作谱（用户 grill 定案）；
      //   fullCanvas = 轨道区半透明压暗保留纵深（原全画布行为）。
      const { dx, dy, dw, dh } = computeBackgroundDrawRect(nb.surfaceW, nb.surfaceH, bg.width, bg.height, bgFit);
      cctx.globalAlpha = bgOpacity;
      cctx.drawImage(bg.source as CanvasImageSource, dx, dy, dw, dh);
      cctx.globalAlpha = 1; // 立即还原，后续轨道底色/网格必须不透明绘制
      cctx.fillStyle = bgScope === 'outsideTrack' ? TRACK_BG_COLOR : TRACK_BG_OVER_IMAGE;
      cctx.fillRect(trackBgX, 0, trackBgWidth, nb.surfaceH);
    } else {
      cctx.fillStyle = TRACK_BG_COLOR;
      cctx.fillRect(trackBgX, 0, trackBgWidth, nb.surfaceH);
    }
    renderGrid(cctx, c, rc);
    renderBoundLines(cctx, c, rc);
    basis = nb;
  }
  // basis 命中时 cacheCanvas 必非空（不变量：basis 与 cacheCanvas 同生共死）
  ctx.drawImage(cacheCanvas!, 0, 0, rc.surface.w, rc.surface.h);
}
