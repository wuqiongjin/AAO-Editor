/**
 * 画布滚轮纯函数（issue 248 缩小滚动加速；issue 255 Ctrl+滚轮缩放倍率）。
 * 滚动：视觉位移 ≈ DOM 像素 × 生效缩放，缩小时按 1/scale 补偿，上限 4 倍。
 * 缩放：Ctrl+滚轮每格 ×1.15，缩小取其倒数；工具栏 ± 仍是 ±0.1。
 */
export const MAX_WHEEL_SCROLL_BOOST = 4;

export function wheelScrollBoost(effectiveScale: number): number {
  if (!Number.isFinite(effectiveScale) || effectiveScale <= 0) return 1;
  return Math.min(MAX_WHEEL_SCROLL_BOOST, Math.max(1, 1 / effectiveScale));
}

/** 行/页模式的滚轮 delta 折算成像素；其余模式原样返回。 */
export function wheelDeltaPx(delta: number, deltaMode: number, viewportPx: number): number {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * Math.max(1, viewportPx);
  return delta;
}

/**
 * Ctrl+滚轮每格倍率（issue 255）。放大 1.15；缩小取其倒数，往返不漂。
 * 只作用于画布 Ctrl+滚轮，工具栏 ± 仍是 ±0.1。
 */
export const CTRL_WHEEL_ZOOM_IN = 1.15;
export const CTRL_WHEEL_ZOOM_OUT = 1 / CTRL_WHEEL_ZOOM_IN;

export function ctrlWheelZoomFactor(deltaY: number): number {
  return deltaY > 0 ? CTRL_WHEEL_ZOOM_OUT : CTRL_WHEEL_ZOOM_IN;
}
