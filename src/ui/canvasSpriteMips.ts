// 精灵 mip（多级减半位图）采样策略 —— 纯函数层（issue 96）。
// 根因：CanvasSpriteIcon 用单步 drawImage 把高分辨率源图集直接缩到目标尺寸，
// 画布缩放 <100% 时降采样比可达 5~12×，无中间级 → 发糊。本模块只算「用第几级」，
// 级位位图的构建/缓存在 CanvasSpriteIcon（需 DOM canvas，vitest node 环境不可用 → 直绘降级）。
//
// 选取口径：降采样比 = 源/目标 的最大轴比。浏览器对 ≤2× 的单步平滑缩放质量可接受，
// 故 ratio ≤ 2 直接用原图（级 0）；否则取级 L 使 ratio / 2^L 落在 (1, 2]，
// 即 L = ceil(log2(ratio)) − 1，并钳到「级位图任一维 ≥1」的上限内。

/** 级位图任一维的最小值（级链到底） */
export const MIP_MIN_DIM = 1;

/**
 * 给定源矩形尺寸与目标绘制尺寸（设备像素），返回应使用的 mip 级数（0 = 原图）。
 * 放大 / 轻微缩小（ratio ≤ 2）→ 0；大幅缩小 → 级位图后再一次 ≤2× 平滑缩放。
 */
export function mipLevelFor(srcW: number, srcH: number, destW: number, destH: number): number {
    if (!(srcW > 0) || !(srcH > 0) || !(destW > 0) || !(destH > 0)) return 0;
    const ratio = Math.max(srcW / destW, srcH / destH);
    if (ratio <= 2) return 0;
    // 级上限：级位图最小维 ≥ MIP_MIN_DIM（对 2^L 取整余数交给 mipDims 的 floor）
    const maxLevel = Math.floor(Math.log2(Math.min(srcW, srcH) / MIP_MIN_DIM));
    return Math.max(0, Math.min(Math.ceil(Math.log2(ratio)) - 1, Math.max(0, maxLevel)));
}

/** 第 L 级位图的尺寸：基准尺寸逐级减半，最小钳到 MIP_MIN_DIM */
export function mipDims(baseW: number, baseH: number, level: number): { w: number; h: number } {
    const s = Math.pow(2, Math.max(0, level));
    return {
        w: Math.max(MIP_MIN_DIM, Math.floor(baseW / s)),
        h: Math.max(MIP_MIN_DIM, Math.floor(baseH / s)),
    };
}
