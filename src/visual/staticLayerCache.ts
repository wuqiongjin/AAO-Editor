// 静态层离屏缓存（issue 36 F2 / issue 139）：
//
// 拆两层（播放滚动不得每帧 renderGrid）：
// - 屏幕层：黑底 / 背景 / 轨道底 / 竖线 —— 与 scrollY 无关；
// - pos 条带：横网格 + 起止线 —— 按 scrollY 窗口 blit，滚出条带才重建。
// 交互帧（scrollY 也不变）：两层都 blit。倒流多段拍区间仍走 visibleBeatRanges（104/105）。
import { renderTrackChrome, renderGridBeatLines, renderBoundLines } from './render';
import { makeCoords } from './coords';
import { DEFAULT_BACKGROUND_OPACITY } from '../chart/config/AppSettings';
import type { RenderCtx } from './types';
import type { BpmTimelineEvent } from '../chart/geometry/BpmTimeline';
import type { GridStylePreset } from './gridStyle';

let screenCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
let stripCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;

type ScreenBasis = {
  bpmEvents: readonly BpmTimelineEvent[];
  chartEndVirtualY: number;
  scale: number;
  beatDisplay: number;
  verticalRatio: number;
  gridStyle: GridStylePreset;
  lineShapeTiers: boolean;
  gridOpacity: number;
  labelScale: number;
  surfaceW: number;
  surfaceH: number;
  dpr: number;
  bgActive: boolean;
  bgRevision: number;
  bgOpacity: number;
  bgFit: 'cover' | 'contain';
  bgScope: 'outsideTrack' | 'fullCanvas';
};

let screenBasis: ScreenBasis | null = null;
let stripMeta: { originScrollY: number; padCss: number; stripH: number } | null = null;

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- 测试注入点：假位图只需结构兼容 */
let createStaticCanvas: () => any = () => document.createElement('canvas');
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 同上
export function __setStaticCanvasFactoryForTests(factory: () => any) {
  createStaticCanvas = factory;
}

export function resetStaticLayerCache() {
  screenCanvas = null;
  stripCanvas = null;
  screenBasis = null;
  stripMeta = null;
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

const TRACK_BG_COLOR = '#00000A';
const TRACK_BG_OVER_IMAGE = 'rgba(0, 0, 10, 0.45)';

function collectScreenBasis(rc: RenderCtx): ScreenBasis {
  const bg = rc.background ?? null;
  const bgActive = !!(bg && bg.source && bg.width > 0 && bg.height > 0);
  return {
    bpmEvents: rc.geometry.bpmEvents,
    chartEndVirtualY: rc.geometry.chartEndVirtualY,
    scale: rc.viewport.scale,
    beatDisplay: rc.beatDisplay,
    verticalRatio: rc.geometry.verticalRatio,
    gridStyle: rc.display?.gridStyle ?? 'vivid',
    lineShapeTiers: rc.display?.lineShapeTiers === true,
    gridOpacity: rc.display?.gridOpacity ?? 0.8,
    labelScale: rc.display?.labelScale ?? 1,
    surfaceW: rc.surface.w,
    surfaceH: rc.surface.h,
    dpr: rc.dpr,
    bgActive,
    bgRevision: bg?.revision ?? -1,
    bgOpacity: normalizeBackgroundOpacity(bg?.opacity),
    bgFit: bg?.fit === 'contain' ? 'contain' : 'cover',
    bgScope: bg?.scope === 'fullCanvas' ? 'fullCanvas' : 'outsideTrack',
  };
}

function screenHit(a: ScreenBasis, b: ScreenBasis): boolean {
  return a.scale === b.scale &&
    a.beatDisplay === b.beatDisplay && a.chartEndVirtualY === b.chartEndVirtualY &&
    a.verticalRatio === b.verticalRatio &&
    a.gridStyle === b.gridStyle && a.lineShapeTiers === b.lineShapeTiers &&
    a.gridOpacity === b.gridOpacity && a.labelScale === b.labelScale &&
    a.surfaceW === b.surfaceW && a.surfaceH === b.surfaceH && a.dpr === b.dpr &&
    a.bgActive === b.bgActive && a.bgRevision === b.bgRevision && a.bgOpacity === b.bgOpacity &&
    a.bgFit === b.bgFit && a.bgScope === b.bgScope &&
    bpmEventsEqual(a.bpmEvents, b.bpmEvents);
}

function ensureBitmap(
  existing: HTMLCanvasElement | OffscreenCanvas | null,
  cssW: number, cssH: number, dpr: number,
): HTMLCanvasElement {
  const bitmap = (existing ?? createStaticCanvas()) as HTMLCanvasElement;
  const bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
  if (bitmap.width !== bw) bitmap.width = bw;
  if (bitmap.height !== bh) bitmap.height = bh;
  return bitmap;
}

function stripPadCss(surfaceH: number): number {
  return Math.max(256, Math.round(surfaceH * 0.5));
}

function paintScreen(rc: RenderCtx, nb: ScreenBasis) {
  screenCanvas = ensureBitmap(screenCanvas, nb.surfaceW, nb.surfaceH, nb.dpr);
  const cctx = (screenCanvas as HTMLCanvasElement).getContext('2d')!;
  cctx.setTransform(nb.dpr, 0, 0, nb.dpr, 0, 0);
  cctx.clearRect(0, 0, nb.surfaceW, nb.surfaceH);
  cctx.fillStyle = '#000000';
  cctx.fillRect(0, 0, nb.surfaceW, nb.surfaceH);
  const c = makeCoords(rc.geometry, rc.viewport, rc.beatDisplay, rc.notes);
  const { trackBgX, trackBgWidth } = c.trackGeometry(rc.viewport.scale);
  const bg = rc.background ?? null;
  if (nb.bgActive && bg) {
    const { dx, dy, dw, dh } = computeBackgroundDrawRect(nb.surfaceW, nb.surfaceH, bg.width, bg.height, nb.bgFit);
    cctx.globalAlpha = nb.bgOpacity;
    cctx.drawImage(bg.source as CanvasImageSource, dx, dy, dw, dh);
    cctx.globalAlpha = 1;
    cctx.fillStyle = nb.bgScope === 'outsideTrack' ? TRACK_BG_COLOR : TRACK_BG_OVER_IMAGE;
    cctx.fillRect(trackBgX, 0, trackBgWidth, nb.surfaceH);
  } else {
    cctx.fillStyle = TRACK_BG_COLOR;
    cctx.fillRect(trackBgX, 0, trackBgWidth, nb.surfaceH);
  }
  renderTrackChrome(cctx, c, rc);
  screenBasis = nb;
}

function paintStrip(rc: RenderCtx, originScrollY: number, padCss: number) {
  const es = rc.viewport.scale;
  const stripH = rc.surface.h + 2 * padCss;
  const stripVp = { ...rc.viewport, scrollY: originScrollY - padCss / es };
  const stripRc: RenderCtx = { ...rc, viewport: stripVp, surface: { w: rc.surface.w, h: stripH } };
  stripCanvas = ensureBitmap(stripCanvas, rc.surface.w, stripH, rc.dpr);
  const cctx = (stripCanvas as HTMLCanvasElement).getContext('2d')!;
  cctx.setTransform(rc.dpr, 0, 0, rc.dpr, 0, 0);
  cctx.clearRect(0, 0, rc.surface.w, stripH);
  const c = makeCoords(rc.geometry, stripVp, rc.beatDisplay, rc.notes);
  renderGridBeatLines(cctx, c, stripRc);
  renderBoundLines(cctx, c, stripRc);
  stripMeta = { originScrollY, padCss, stripH };
}

/**
 * 绘制静态层入口（renderChart 调用）。
 * 屏幕层 + pos 条带窗口 blit：播放中只变 scrollY 时不跑 renderGrid。
 */
export function drawStaticLayer(ctx: CanvasRenderingContext2D, rc: RenderCtx) {
  const nb = collectScreenBasis(rc);
  const screenOk = screenBasis !== null && screenHit(screenBasis, nb);
  if (!screenOk) {
    paintScreen(rc, nb);
    stripMeta = null;
  }

  const es = rc.viewport.scale;
  const padCss = stripPadCss(nb.surfaceH);
  const sy = rc.viewport.scrollY;
  let srcYCss = 0;
  const stripOk = stripMeta !== null && screenOk &&
    stripMeta.padCss === padCss &&
    Math.abs(stripMeta.stripH - (nb.surfaceH + 2 * padCss)) < 1e-6;
  if (stripOk && stripMeta) {
    srcYCss = (sy - stripMeta.originScrollY) * es + stripMeta.padCss;
    const inWindow = srcYCss >= 0 && srcYCss + nb.surfaceH <= stripMeta.stripH;
    if (!inWindow) {
      paintStrip(rc, sy, padCss);
      srcYCss = padCss;
    }
  } else {
    paintStrip(rc, sy, padCss);
    srcYCss = padCss;
  }

  ctx.drawImage(screenCanvas!, 0, 0, rc.surface.w, rc.surface.h);
  const srcWPx = Math.round(nb.surfaceW * nb.dpr);
  const srcHPx = Math.round(nb.surfaceH * nb.dpr);
  const maxSrcY = Math.max(0, (stripCanvas as HTMLCanvasElement).height - srcHPx);
  const srcYPx = Math.min(Math.max(0, Math.round(srcYCss * nb.dpr)), maxSrcY);
  ctx.drawImage(stripCanvas!, 0, srcYPx, srcWPx, srcHPx, 0, 0, rc.surface.w, rc.surface.h);
}
