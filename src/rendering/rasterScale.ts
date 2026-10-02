// 栅格尺度解析（候选 3「dpr / 尺寸解析从 5 处收成 1 处」）：
// 位图缓冲的**唯一**尺寸/倍率提供者 —— 主画布、静态层屏幕层、pos 条带、音符瓦片共用这几个纯函数。
//
// 背景：dpr 取值（画质档 → 上限）与缓冲尺寸（round(css × dpr)）此前散在 5 处
// （组件内联策略 / renderChart 主缓冲 / 静态层两处 ensureBitmap / 瓦片 renderTile），
// 加一档画质或改一处量化要同步多处。
//
// 与 ADR-0006 §1 不冲突：dpr 数值口径以 issue 39 #6 / issue 40 定案为基（上限 devicePixelRatio）。
// 档位口径两轮演变：03 三轮改整数阶梯 1×/2×/4×（2.5× 这类非整档在 dpr-1/2 屏必然非整数重采样）；
// 08 四轮（ADR-0017）再进一步立**不变量「位图:物理 = 整数」**——整数性要落在 density/dpr 上，
// 不是 density 上：整数阶梯在 dpr 1.25 屏全档位非整数（1.6/2.4/3.2），正是残留锯齿根因。
// 于是两套口径分工：
// - 工作台画布 = `resolveCanvasDpr`（min(设备像素比, 整数阶梯)）——逐帧按物理像素直绘，本来 1:1，不变；
// - 静态位图（预览面板 / 工具栏小图标）= `dpr × imageQualitySupersample`（ADR-0017 §1/§2），
//   浏览器做干净整数倍盒式下采样，不跳采样点。
import type { SurfaceSize } from '../chart/geometry/ChartGeometry';

/**
 * 画质档 → 渲染密度（issue 39 #6 / issue 40 定案；03 三轮改整数阶梯）：流畅 1× / 标准 2× / 高清 4×
 * （缺省 / 非法 = 标准）。**只服务工作台画布的 min(设备像素比, 档位) 上限口径**；
 * 静态位图链路（预览面板 / 工具栏小图标）用 `imageQualitySupersample`（ADR-0017 §2）。
 */
export function imageQualityDensity(imageQuality: string | undefined): number {
  return imageQuality === 'smooth' ? 1 : imageQuality === 'hd' ? 4 : 2;
}

/**
 * 画质档 → 静态位图**相对物理像素的超采样倍数**（ADR-0017 §2）：流畅 1 / 标准 1 / 高清 2。
 * `density = dpr × 它` 保证 位图:物理 = 整数（干净盒式下采样）：
 * - dpr 1.25：标准 1.25（1:1 物理，零重采样）、高清 2.5（2× 盒式）；
 * - dpr 2：标准 2、高清 4（与 03 三轮整数阶梯完全一致）；
 * - dpr 1：标准/高清 = 1 / 2 —— 标准档从 2× 余量变 1:1（超采样余量不再是必需品，Q8 用户接受）。
 */
export function imageQualitySupersample(imageQuality: string | undefined): number {
  return imageQuality === 'hd' ? 2 : 1;
}

/**
 * 画布 dpr 策略（issue 39 #6 / issue 40）：
 * - 流畅 `smooth` → 上限 1；标准（含缺省/非法档）→ 2；高清 `hd` → 4（见 `imageQualityDensity`）；
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
