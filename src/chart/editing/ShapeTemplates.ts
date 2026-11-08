// SP 段形状模板库（issue 09 S4 / ADR-0009 §2 三来源之三；issue 223 连续自适应采样）——纯函数，零 UI 依赖。
//
// 模板 = **归一化相对形状**：点列 { t, off }，t ∈ [0,1] 为段内时间进度（beat 单调递增硬约束）、
// off ∈ [-1,1] 为相对**弦**（两端可见结点连线）的横向偏移比例，套用时 × TEMPLATE_AMPLITUDE(2 轨)。
// 套用产物 = 密集 hidden 采样点，端点不动；参数记 `SpanTemplateParam`（模板 id + 可选 precision），
// 与缓动段同走 visibleCount 护栏与"一动就自由化"。
// 注意：谱面数据 lane 是 beat 的**单值函数**（beat 严格递增），闭合轮廓（如整颗心）不可表达——
// 模板库只收单值形状；"心形"为双弧近似。
//
// 自适应采样（issue 223 / ADR-0009 2026-11-08 修订）：
// - 连续数学模板（S形/波浪/大弧/心形）：提供 `sample(spanBeats, precision)` 生成器，
//   响应用户在工具栏选定的采样精度（1/16、1/32、1/64），结合智能保底与 128 上限细分，
//   彻底消除 1 拍等短段下波峰波谷生硬折角，同时杜绝滥用节点造成的谱面膨胀；
// - 离散特征模板（震动条 zigzag）：无 `sample`，保持固定 25 份采样点列，防止齿纹相位畸变。

import type { ConnectionNote, SpanTemplateParam } from '../types';
import type { CurvePrecision } from './Easing';

/** 模板偏移振幅：off = ±1 ↔ 横向 ±2 轨（内置预设按此振幅设计） */
export const TEMPLATE_AMPLITUDE = 2;

/** 连续模板采样份数上限（防止超长段造成谱面体积过度膨胀） */
export const TEMPLATE_MAX_POINTS = 128;

export interface ShapeTemplate {
  id: string;
  label: string;
  /** 相对形状点列：t 严格递增、首尾不含（t=0/1 = 两端可见结点本身）；离散模板或静态兜底 */
  points: { t: number; off: number }[];
  /** 可选自适应点列生成器：连续数学模板按段拍差动态计算平滑采样 */
  sample?: (spanBeats: number, precision?: CurvePrecision) => { t: number; off: number }[];
}

/** 数值生成器：按份数均匀采样 off(t)（首尾自动剔除） */
function sample(off: (t: number) => number, n: number): { t: number; off: number }[] {
  const out: { t: number; off: number }[] = [];
  for (let k = 1; k < n; k++) {
    const t = k / n;
    out.push({ t, off: off(t) });
  }
  return out;
}

/** 连续模板各精度档位保底细分段数（保证极短段如 1 拍的角度分辨率，同时杜绝无脑超量采样） */
export const TEMPLATE_MIN_SEGMENTS: Record<string, Record<CurvePrecision, number>> = {
  's-curve': { 16: 32, 32: 48, 64: 64 },
  'heart':   { 16: 32, 32: 48, 64: 64 },
  'wave':    { 16: 48, 32: 64, 64: 96 },
  'arc':     { 16: 16, 32: 24, 64: 32 },
};

/**
 * 模板各精度档位的智能保底细分段数：
 * 保证短段（如 1 拍或半拍）在对应精度下依然有足够的角度分辨率消除尖角，同时杜绝无脑超量采样。
 */
export function templateMinSegments(id: string, precision: CurvePrecision = 16): number {
  return TEMPLATE_MIN_SEGMENTS[id]?.[precision] ?? (precision === 64 ? 64 : precision === 32 ? 48 : 32);
}

/** 兼容旧命名导出（外层测试与引用兼容） */
export const templateMinPoints = templateMinSegments;

/** 连续模板自适应采样生成：按段拍差与精度计算段数，结合档位智能保底，保顶 128 */
export function adaptiveTemplatePoints(
  off: (t: number) => number,
  spanBeats: number,
  minSegments: number,
  precision: CurvePrecision = 16,
): { t: number; off: number }[] {
  const n = Math.min(
    Math.max(Math.ceil(spanBeats * precision - 1e-9), minSegments),
    TEMPLATE_MAX_POINTS,
  );
  return sample(off, n);
}

/** 蕵心曲线归一化常数 (3 * sqrt(3) / 4) */
const CARDIOID_NORM = (3 * Math.sqrt(3)) / 4;

/**
 * 半心弧几何函数（心形半叶外轮廓）：
 * - t ∈ [0, 1] 恒单向外凸（off ≥ 0，无反向 S 弯折）；
 * - t = 0 为底部尖角，向上平缓外扩；
 * - t ≈ 0.65 达到饱满心形肩部峰值（off = 1.0）；
 * - t → 1 急剧内收回到中央中缝凹点（off = 0）。
 * 谱师放置一条半心弧，配合镜像翻转即可拼出标准整颗爱心 ❤️。
 */
export function halfHeartOffset(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  const theta = Math.PI * t;
  const cardioid = (Math.sin(theta) * (1 - Math.cos(theta))) / CARDIOID_NORM;
  const lobe = Math.sin(theta);
  return Math.min(Math.max((0.75 * cardioid + 0.25 * lobe) / 0.982, 0), 1);
}

/** 兼容旧导出别名 */
export const heartShapeOffset = halfHeartOffset;

/** 连续模板采样生成器辅助函数 */
const makeContinuousSample = (
  id: string,
  fn: (t: number) => number,
) => (spanBeats: number, precision: CurvePrecision = 16) =>
  adaptiveTemplatePoints(fn, spanBeats, templateMinSegments(id, precision), precision);

/** 内置预设库（ADR-0009 §2；issue 223 连续自适应升级） */
export const SHAPE_TEMPLATES: ShapeTemplate[] = [
  {
    id: 's-curve',
    label: 'S 形',
    // 单周期正弦：0 → +峰 → 0 → -峰 → 0
    points: sample((t) => Math.sin(2 * Math.PI * t), 16),
    sample: makeContinuousSample('s-curve', (t) => Math.sin(2 * Math.PI * t)),
  },
  {
    id: 'wave',
    label: '波浪 ×2',
    points: sample((t) => Math.sin(4 * Math.PI * t), 24),
    sample: makeContinuousSample('wave', (t) => Math.sin(4 * Math.PI * t)),
  },
  {
    id: 'zigzag',
    label: '震动条',
    // 高频三角波（对标官方谱 hidden 交替震动条）：保持固定 25 份离散点列，不自适应
    points: sample((t) => (Math.floor(t * 12) % 2 === 0 ? 1 : -1) * 0.9, 25),
  },
  {
    id: 'arc',
    label: '大弧',
    // 半正弦弓：0 → +1 → 0
    points: sample((t) => Math.sin(Math.PI * t), 12),
    sample: makeContinuousSample('arc', (t) => Math.sin(Math.PI * t)),
  },
  {
    id: 'heart',
    label: '半心弧',
    // 心形半叶外轮廓：单向平滑外凸，与镜像滑条配合拼成整颗爱心
    points: sample(halfHeartOffset, 16),
    sample: makeContinuousSample('heart', halfHeartOffset),
  },
];

export const shapeTemplateById = (id: string): ShapeTemplate | undefined =>
  SHAPE_TEMPLATES.find((tp) => tp.id === id);

/**
 * 套用模板：段两端可见结点之间按点列生成 hidden 采样点（不含端点）。
 * 连续模板调用 sample(span, precision) 自适应细分，离散模板使用固定 points。
 * lane = 弦插值 + off × 振幅，钳制 0..6 允许小数；beat = t 线性映射（严格递增）。
 */
export function bakeTemplatePoints(
  from: { lane: number },
  to: { lane: number },
  fromBeat: number,
  toBeat: number,
  template: ShapeTemplate,
  precision: CurvePrecision = 16,
): ConnectionNote[] {
  const span = toBeat - fromBeat;
  if (!(span > 0)) return [];
  const pts = template.sample ? template.sample(span, precision) : template.points;
  return pts.map(({ t, off }) => ({
    beat: fromBeat + t * span,
    lane: Math.min(Math.max(from.lane + (to.lane - from.lane) * t + off * TEMPLATE_AMPLITUDE, 0), 6),
    hidden: true as const,
  }));
}

/** 模板参数 → 采样点（id 失效/模板不存在 → 直线退化，不抛错） */
export function bakeTemplateParam(
  from: { lane: number },
  to: { lane: number },
  fromBeat: number,
  toBeat: number,
  param: SpanTemplateParam,
): ConnectionNote[] {
  const tp = shapeTemplateById(param.templateId);
  if (!tp) return [];
  return bakeTemplatePoints(from, to, fromBeat, toBeat, tp, param.precision ?? 16);
}
