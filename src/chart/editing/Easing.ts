// SP 绿条缓动函数库（issue 09 S2 / ADR-0009 §2）——纯函数表，零依赖。
//
// 对齐 Bestdori 制谱器曲线工具（CommunityChartsNew bundle 逐函数比对）：
// - 10 族（family）= 标准 Penner 集的 **easeIn** 形态作为基函数 a(t)：
//     sine   1-cos(πt/2)
//     quad   t²
//     cubic  t³
//     quart  t⁴
//     quint  t⁵
//     expo   2^(10t-10)（t=0 修正为 0）
//     circ   1-√(1-t²)
//     back   c3·t³ - c1·t²（c1=1.70158, c3=c1+1）
//     elastic -2^(10t-10)·sin((10t-10.75)·2π/3)（边界修正 0/1）
//     bounce 1 - easeOutBounce(1-t)
// - 4 型（type）由基函数派生（与 bundle 分派式逐字同构）：
//     in      a(p)
//     out     1 - a(1-p)
//     inOut   p<.5 ? a(2p)/2 : 1 - a(2-2p)/2
//     outIn   p<.5 ? (1-a(1-2p))/2 : (1+a(2p-1))/2
// 契约：每个组合 easing(family, type) 满足 f(0)=0、f(1)=1（边界精确）；
// 定义域 0..1 之外不保证（调用方钳制进度）。

export type EasingFamily =
  | 'sine' | 'quad' | 'cubic' | 'quart' | 'quint'
  | 'expo' | 'circ' | 'back' | 'elastic' | 'bounce';

export type EasingType = 'in' | 'out' | 'inOut' | 'outIn';

export const EASING_FAMILIES: readonly EasingFamily[] = [
  'sine', 'quad', 'cubic', 'quart', 'quint', 'expo', 'circ', 'back', 'elastic', 'bounce',
];

export const EASING_TYPES: readonly EasingType[] = ['in', 'out', 'inOut', 'outIn'];

/** 采样精度三档（用户口径对标 Bestdori curvePrecision）：每拍 1/16、1/32、1/64 */
export type CurvePrecision = 16 | 32 | 64;

export const CURSE_PRECISIONS: readonly CurvePrecision[] = [16, 32, 64];

/** 标准easeOutBounce（bundle bounce 基函数的补形，也供锁测对照） */
export function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/** 基函数 a(t)：各族的标准 easeIn 形态 */
const EASE_IN: Record<EasingFamily, (t: number) => number> = {
  sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  quad: (t) => t * t,
  cubic: (t) => t * t * t,
  quart: (t) => t * t * t * t,
  quint: (t) => t * t * t * t * t,
  expo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  circ: (t) => 1 - Math.sqrt(1 - t * t),
  back: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  elastic: (t) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    const c4 = (2 * Math.PI) / 3;
    return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
  },
  bounce: (t) => 1 - easeOutBounce(1 - t),
};

/** 单族缓动：in 基函数 → 4 型分派（bundle 同构） */
function dispatch(family: EasingFamily, type: EasingType): (p: number) => number {
  const a = EASE_IN[family];
  switch (type) {
    case 'in': return (p) => a(p);
    case 'out': return (p) => 1 - a(1 - p);
    case 'inOut': return (p) => (p < 0.5 ? a(2 * p) / 2 : 1 - a(2 - 2 * p) / 2);
    case 'outIn': return (p) => (p < 0.5 ? (1 - a(1 - 2 * p)) / 2 : (1 + a(2 * p - 1)) / 2);
  }
}

/** 组合缓存（40 项，模块级一次性构建） */
const TABLE = new Map<string, (p: number) => number>();

/** 取缓动函数：easing('cubic','out')(0.5) 等；进度越界由调用方钳制（本函数不钳） */
export function easing(family: EasingFamily, type: EasingType): (p: number) => number {
  const key = `${family}:${type}`;
  let f = TABLE.get(key);
  if (!f) {
    f = dispatch(family, type);
    TABLE.set(key, f);
  }
  return f;
}

/** 单调非递减的族（back/elastic/bounce 有过冲/震荡，不参与此不变量锁测） */
export const MONOTONIC_FAMILIES: readonly EasingFamily[] = [
  'sine', 'quad', 'cubic', 'quart', 'quint', 'expo', 'circ',
];
