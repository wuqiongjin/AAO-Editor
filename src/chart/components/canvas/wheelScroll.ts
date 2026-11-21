/**
 * 画布滚轮滚动的速度补偿（issue：缩小滚动加速）。
 * 视觉位移 ≈ DOM 像素 × 生效缩放，故缩小时按 1/scale 补偿，让每格滚轮的
 * 画面推进量大致恒定；上限 4 倍，避免最小缩放时一格跳过整屏。
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
