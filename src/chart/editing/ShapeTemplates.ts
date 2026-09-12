// SP 段形状模板库（issue 09 S4 / ADR-0009 §2 三来源之三）——纯函数，零 UI 依赖。
//
// 模板 = **归一化相对形状**：点列 { t, off }，t ∈ [0,1] 为段内时间进度（beat 单调递增硬约束）、
// off ∈ [-1,1] 为相对**弦**（两端可见结点连线）的横向偏移比例，套用时 × TEMPLATE_AMPLITUDE(2 轨)。
// 套用产物 = 密集 hidden 采样点（点列即采样），端点不动；参数记 `SpanTemplateParam`（模板 id），
// 与缓动段同走 visibleCount 护栏与"一动就自由化"。
// 注意：谱面数据 lane 是 beat 的**单值函数**（beat 严格递增），闭合轮廓（如整颗心）不可表达——
// 模板库只收单值形状；"心形"为双弧近似。

import type { ConnectionNote, SpanTemplateParam } from '../types';

/** 模板偏移振幅：off = ±1 ↔ 横向 ±2 轨（内置预设按此振幅设计） */
export const TEMPLATE_AMPLITUDE = 2;

export interface ShapeTemplate {
  id: string;
  label: string;
  /** 相对形状点列：t 严格递增、首尾不含（t=0/1 = 两端可见结点本身） */
  points: { t: number; off: number }[];
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

/** 内置预设库（ADR-0009 §2：缓动弧线预设 = 40 种缓动本身，走缓动路径，不入本表） */
export const SHAPE_TEMPLATES: ShapeTemplate[] = [
  {
    id: 's-curve',
    label: 'S 形',
    // 单周期正弦：0 → +峰 → 0 → -峰 → 0
    points: sample((t) => Math.sin(2 * Math.PI * t), 16),
  },
  {
    id: 'wave',
    label: '波浪 ×2',
    points: sample((t) => Math.sin(4 * Math.PI * t), 24),
  },
  {
    id: 'zigzag',
    label: '震动条',
    // 高频三角波（对标官方谱 hidden 交替震动条）
    points: sample((t) => (Math.floor(t * 12) % 2 === 0 ? 1 : -1) * 0.9, 25),
  },
  {
    id: 'arc',
    label: '大弧',
    // 半正弦弓：0 → +1 → 0
    points: sample((t) => Math.sin(Math.PI * t), 12),
  },
  {
    id: 'heart',
    label: '心形（双弧近似）',
    // 左弧外翻 + 右弧外翻（lane 单值函数的近似；圆整心不可表达——beat 单向）
    points: [
      ...sample((t) => -Math.sin(Math.PI * t * 2), 8),
      ...sample((t) => Math.sin(Math.PI * (t * 2 - 1)), 8).map((p) => ({ t: 0.5 + p.t / 2, off: p.off })),
    ],
  },
];

export const shapeTemplateById = (id: string): ShapeTemplate | undefined =>
  SHAPE_TEMPLATES.find((tp) => tp.id === id);

/**
 * 套用模板：段两端可见结点之间按点列生成 hidden 采样点（不含端点）。
 * lane = 弦插值 + off × 振幅，钳制 0..6 允许小数；beat = t 线性映射（严格递增）。
 */
export function bakeTemplatePoints(
  from: { lane: number },
  to: { lane: number },
  fromBeat: number,
  toBeat: number,
  template: ShapeTemplate,
): ConnectionNote[] {
  const span = toBeat - fromBeat;
  if (!(span > 0)) return [];
  return template.points.map(({ t, off }) => ({
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
  return bakeTemplatePoints(from, to, fromBeat, toBeat, tp);
}
