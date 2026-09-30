// 栅格尺度解析（候选 3「dpr / 尺寸解析从 5 处收成 1 处」）：
// 位图缓冲的**唯一**尺寸/倍率提供者 —— 主画布、静态层屏幕层、pos 条带、音符瓦片共用这两个纯函数。
//
// 背景：dpr 取值（画质档 → 上限）与缓冲尺寸（round(css × dpr)）此前散在 5 处
// （组件内联策略 / renderChart 主缓冲 / 静态层两处 ensureBitmap / 瓦片 renderTile），
// 加一档画质或改一处量化要同步多处。
//
// 与 ADR-0006 §1 不冲突：dpr 数值口径以 issue 39 #6 / issue 40 定案为准（流畅 1× / 标准 2.5× / 高清 3×，
// 上限 devicePixelRatio），本模块只是它的唯一实现处，不改取值。
import type { SurfaceSize } from '../chart/geometry/ChartGeometry';

/**
 * 画质档 → 渲染密度（issue 39 #6 / issue 40 定案）：流畅 1× / 标准 2.5× / 高清 3×（缺省 / 非法 = 标准）。
 * 两个方向各取所需，取值只有这一处：
 * - 工作台画布把它当**上限**（`resolveCanvasDpr` = min(设备像素比, 它)）；
 * - 预览面板把它当**目标密度**（`preview/static/panelPainter` 的 `resolvePanelDpr` = max(设备像素比, 它)）——
 *   面板是静态位图，1× 屏上那套 min() 一点超采样余量都没有。
 */
export function imageQualityDensity(imageQuality: string | undefined): number {
  return imageQuality === 'smooth' ? 1 : imageQuality === 'hd' ? 3 : 2.5;
}

/**
 * 画布 dpr 策略（issue 39 #6 / issue 40）：
 * - 流畅 `smooth` → 上限 1；标准（含缺省/非法档）→ 2.5；高清 `hd` → 3（见 `imageQualityDensity`）；
 * - 再与设备像素比取 min（`devicePixelRatio` 缺省 1，与组件原口径一致）。
 */
export function resolveCanvasDpr(
  imageQuality: string | undefined,
  devicePixelRatio: number = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
): number {
  return Math.min(devicePixelRatio, imageQualityDensity(imageQuality));
}

/** 位图缓冲尺寸（整数）：buffer = CSS 尺寸 × dpr（ADR-0006 §1）。 */
export function bufferSizeFor(surface: SurfaceSize, dpr: number): { w: number; h: number } {
  return { w: Math.round(surface.w * dpr), h: Math.round(surface.h * dpr) };
}
