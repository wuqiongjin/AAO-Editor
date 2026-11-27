// SP 段形状模板库（issue 09 S4 / ADR-0009 §2 三来源之三；issue 223 连续自适应采样；issue 235 18 款扩充 + 三维参数）——纯函数，零 UI 依赖。
//
// 模板 = **归一化相对形状**：点列 { t, off }，t ∈ [0,1] 为段内时间进度（beat 弱单调递增：普通曲线严格递增，同拍跃迁段允许 t[i] === t[i-1]），
// off 为相对**弦**（两端可见结点连线）的横向偏移比例；相对弦偏移型套用时
// × TEMPLATE_AMPLITUDE(2 轨) × amplitudeScale × (sign × off + (baseline/100) × half)。
// 套用产物 = 密集 hidden 采样点，端点不动；参数记 `SpanTemplateParam`，
// 与缓动段同走 visibleCount 护栏与"一动就自由化"。

import type { ConnectionNote, SpanTemplateParam, TemplateExtraValue } from '../types';
import type { CurvePrecision } from './Easing';

/** 模板偏移振幅基准：off = ±1 ↔ 横向 ±2 轨 */
export const TEMPLATE_AMPLITUDE = 2;

/** 连续平滑模板采样份数上限（防止超长段造成谱面体积过度膨胀） */
export const TEMPLATE_MAX_POINTS = 128;

/** 分段/高频震动/锁链/面筋模板采样点数上限 */
export const TEMPLATE_SEGMENTED_MAX_POINTS = 256;

export type TemplateCategory = 'smooth' | 'rhythm' | 'special';

export type TemplateMappingMode = 'chord-offset' | 'endpoint-interp';

export type TemplateExtraParamSpec =
  | {
      kind: 'choice';
      key: string;
      labelKey: string;
      hintKey?: string;
      defaultValue: string;
      options: readonly { value: string; labelKey: string }[];
      mirrorValue?: (value: string) => string;
    }
  | {
      kind: 'range';
      key: string;
      labelKey: string;
      hintKey?: string;
      defaultValue: number;
      min: number;
      max: number;
      step: number;
      unit?: string;
      presets?: readonly { value: number; labelKey: string }[];
      mirrorValue?: (value: number) => number;
    };

export const TEMPLATE_CATEGORIES: readonly TemplateCategory[] = ['smooth', 'rhythm', 'special'];

export interface TemplateNumberRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly defaultValue: number;
}

export const TEMPLATE_SCALES = [0.5, 1, 1.5] as const;
export type TemplateScale = (typeof TEMPLATE_SCALES)[number];
export const TEMPLATE_SCALE_RANGE: TemplateNumberRange = { min: 0.1, max: 3, step: 0.05, defaultValue: 1 };

export const TEMPLATE_DENSITIES = [0.5, 1, 2] as const;
export type TemplateDensity = (typeof TEMPLATE_DENSITIES)[number];
export const TEMPLATE_DENSITY_RANGE: TemplateNumberRange = { min: 0.25, max: 4, step: 0.05, defaultValue: 1 };

/** 振荡基线范围（相对各模板特征半幅的百分比）：跨模板通用单值，不随模板 ID 分记 */
export const TEMPLATE_BASELINE_RANGE: TemplateNumberRange = { min: -200, max: 200, step: 5, defaultValue: 0 };

export interface ShapeTemplate {
  id: string;
  label: string;
  category: TemplateCategory;
  /** 映射模型：'chord-offset'（相对弦偏移，默认）| 'endpoint-interp'（端点插值，同轨退化直线） */
  mappingMode?: TemplateMappingMode;
  /** 是否支持「偏向」调节（端点插值型默认 false） */
  supportsMirror?: boolean;
  /** 是否支持「幅度」调节（端点插值型默认 false） */
  supportsAmplitude?: boolean;
  /** 是否响应「精度」档位（1/16, 1/32, 1/64） */
  precisionSensitive: boolean;
  /** 是否响应「段密」档位（稀疏 0.5 / 标准 1 / 稠密 2） */
  adjustableDensity: boolean;
  /** 是否含同拍零高横跳（Δt = 0） */
  hasZeroBeatJump?: boolean;
  /** 模板专属参数声明（用于动态渲染面板控件与持久化校验） */
  extraParams?: readonly TemplateExtraParamSpec[];
  /**
   * 绕弦双侧摆动的特征半幅（归一化 |off| 峰值）。声明后烘焙按
   * `AMP × ampScale × (sign × off + (baseline/100) × oscillationHalf)` 叠加振荡基线偏移。
   */
  oscillationHalf?: number;
  /** 默认点列（用于无参数静态兜底） */
  points: { t: number; off: number }[];
  /** 动态采样生成器：平滑类按 precision 细分，分段/面筋/锁链按 densityScale 调节段落密度 */
  sample?: (
    spanBeats: number,
    precision?: CurvePrecision,
    densityScale?: number,
    extra?: Record<string, TemplateExtraValue>,
  ) => { t: number; off: number }[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** 连续模板数值规整：有限数值按 [min, max] 钳制并保留两位小数；非法值回落 fallback */
export function clampTemplateNumber(
  raw: unknown,
  range: TemplateNumberRange,
  fallback = range.defaultValue,
): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Number(clamp(raw, range.min, range.max).toFixed(2));
}

export const templateMappingMode = (tp: ShapeTemplate): TemplateMappingMode =>
  tp.mappingMode ?? 'chord-offset';

export const templateSupportsMirror = (tp: ShapeTemplate): boolean =>
  tp.supportsMirror ?? (templateMappingMode(tp) === 'chord-offset');

export const templateSupportsAmplitude = (tp: ShapeTemplate): boolean =>
  tp.supportsAmplitude ?? (templateMappingMode(tp) === 'chord-offset');

/** 模板是否声明了「振荡基线」（跨模板通用项；声明即渲染，唯一判定处） */
export const templateSupportsBaseline = (tp: ShapeTemplate): boolean =>
  tp.extraParams?.some((spec) => spec.key === 'baseline') ?? false;

type NumericRange = Pick<TemplateNumberRange, 'min' | 'max' | 'step'>;

function snapRangeValue(range: NumericRange, raw: number): number {
  const clamped = clamp(raw, range.min, range.max);
  if (!(range.step > 0)) return clamped;
  const steps = Math.round((clamped - range.min) / range.step);
  // 消除浮点步进误差（如 0.30000000000000004）
  const snapped = Number((range.min + steps * range.step).toFixed(6));
  return clamp(snapped, range.min, range.max);
}

/** 按范围钳制并吸附步长；非法值回落范围的默认值（跨模板通用单值的归一化入口） */
export function snapTemplateRangeValue(raw: unknown, range: TemplateNumberRange): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return range.defaultValue;
  return snapRangeValue(range, raw);
}

/** 解析并校验模板专属参数（缺省或非法项回落默认值） */
export function resolveTemplateExtra(
  tp: ShapeTemplate,
  raw?: Record<string, unknown>,
): Record<string, TemplateExtraValue> {
  const out: Record<string, TemplateExtraValue> = {};
  if (!tp.extraParams?.length) return out;
  for (const spec of tp.extraParams) {
    const val = raw?.[spec.key];
    if (spec.kind === 'choice') {
      out[spec.key] = typeof val === 'string' && spec.options.some((o) => o.value === val)
        ? val
        : spec.defaultValue;
    } else {
      out[spec.key] = typeof val === 'number' && Number.isFinite(val)
        ? snapRangeValue(spec, val)
        : spec.defaultValue;
    }
  }
  return out;
}

/** 仅保留合法且偏离默认值的模板专属参数；全为默认时返回 undefined */
export function stripDefaultTemplateExtra(
  tp: ShapeTemplate,
  raw?: Record<string, unknown>,
): Record<string, TemplateExtraValue> | undefined {
  if (!tp.extraParams?.length) return undefined;
  const resolved = resolveTemplateExtra(tp, raw);
  const out: Record<string, TemplateExtraValue> = {};
  for (const spec of tp.extraParams) {
    if (resolved[spec.key] !== spec.defaultValue) {
      out[spec.key] = resolved[spec.key]!;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 水平镜像专属参数（按 schema 可选 mirrorValue 钩子变换，未配置则保持原样） */
export function mirrorTemplateExtra(
  tp: ShapeTemplate,
  raw?: Record<string, TemplateExtraValue>,
): Record<string, TemplateExtraValue> | undefined {
  if (!tp.extraParams?.length) return undefined;
  const resolved = resolveTemplateExtra(tp, raw);
  const next: Record<string, TemplateExtraValue> = {};
  for (const spec of tp.extraParams) {
    const val = resolved[spec.key]!;
    next[spec.key] = spec.kind === 'choice'
      ? (spec.mirrorValue ? spec.mirrorValue(val as string) : val)
      : (spec.mirrorValue ? spec.mirrorValue(val as number) : val);
  }
  return stripDefaultTemplateExtra(tp, next);
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

/** 连续模板各精度档位保底细分段数 */
export const TEMPLATE_MIN_SEGMENTS: Record<string, Record<CurvePrecision, number>> = {
  'arc':          { 16: 16, 32: 24, 64: 32 },
  's-curve':      { 16: 32, 32: 48, 64: 64 },
  'wave':         { 16: 48, 32: 64, 64: 96 },
  'double-arc':   { 16: 40, 32: 56, 64: 80 },
  'soft-elastic': { 16: 48, 32: 64, 64: 96 },
  'hook-tail':    { 16: 32, 32: 48, 64: 64 },
  'hook-head':    { 16: 32, 32: 48, 64: 64 },
  'heart':        { 16: 32, 32: 48, 64: 64 },
};

/** 模板各精度档位的智能保底细分段数 */
export function templateMinSegments(id: string, precision: CurvePrecision = 16): number {
  return TEMPLATE_MIN_SEGMENTS[id]?.[precision] ?? (precision === 64 ? 64 : precision === 32 ? 48 : 32);
}

/** 兼容旧命名导出 */
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

/** 心形归一化常数 (3 * sqrt(3) / 4) */
const CARDIOID_NORM = (3 * Math.sqrt(3)) / 4;

/**
 * 半心弧几何函数（心形半叶外轮廓）：
 * t ∈ [0, 1] 恒单向外凸，t ≈ 0.65 达肩部峰值 1.0。
 */
export function halfHeartOffset(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  const theta = Math.PI * t;
  const cardioid = (Math.sin(theta) * (1 - Math.cos(theta))) / CARDIOID_NORM;
  const lobe = Math.sin(theta);
  return clamp((0.75 * cardioid + 0.25 * lobe) / 0.982, 0, 1);
}

/** 兼容旧导出别名 */
export const heartShapeOffset = halfHeartOffset;

/**
 * 柔弹弧（Elastic-Out 缓动优化版）：
 * 主峰推迟至 t ≈ 0.265 圆润外弹（+1.0），约 t = 0.60 舒缓回弹（-0.50），平稳衰减收敛。
 */
export function softElasticOffset(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  return (Math.sin(3 * Math.PI * Math.pow(t, 1.35)) * Math.pow(1 - t, 1.15)) / 0.702;
}

const makeContinuousSample = (
  id: string,
  fn: (t: number) => number,
) => (spanBeats: number, precision: CurvePrecision = 16) =>
  adaptiveTemplatePoints(fn, spanBeats, templateMinSegments(id, precision), precision);

const positiveOrOne = (v?: number) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;

/** 双侧摆动模板共用的振荡基线声明：取值源是跨模板单值 `CurveConfig.templateBaseline` */
export const OSCILLATION_BASELINE_SPEC: Extract<TemplateExtraParamSpec, { kind: 'range' }> = {
  kind: 'range',
  key: 'baseline',
  labelKey: 'curve.extra.baseline',
  hintKey: 'curve.extra.baselineHint',
  defaultValue: TEMPLATE_BASELINE_RANGE.defaultValue,
  min: TEMPLATE_BASELINE_RANGE.min,
  max: TEMPLATE_BASELINE_RANGE.max,
  step: TEMPLATE_BASELINE_RANGE.step,
  unit: '%',
  presets: [
    { value: -100, labelKey: 'curve.extra.baseline.left' },
    { value: 0, labelKey: 'curve.extra.baseline.center' },
    { value: 100, labelKey: 'curve.extra.baseline.right' },
  ],
  mirrorValue: (v) => -v,
};

/** 18 款内置形状模板目录（三分类；老 5 ID 全数保留向后兼容） */
export const SHAPE_TEMPLATES: ShapeTemplate[] = [
  // === 1. 平滑弧弯（smooth，8 款） ===
  {
    id: 'arc',
    label: '大弧',
    category: 'smooth',
    precisionSensitive: true,
    adjustableDensity: false,
    points: sample((t) => Math.sin(Math.PI * t), 16),
    sample: makeContinuousSample('arc', (t) => Math.sin(Math.PI * t)),
  },
  {
    id: 's-curve',
    label: 'S 形',
    category: 'smooth',
    precisionSensitive: true,
    adjustableDensity: false,
    points: sample((t) => Math.sin(2 * Math.PI * t), 32),
    sample: makeContinuousSample('s-curve', (t) => Math.sin(2 * Math.PI * t)),
  },
  {
    id: 'wave',
    label: '双波浪',
    category: 'smooth',
    precisionSensitive: true,
    adjustableDensity: false,
    points: sample((t) => Math.sin(4 * Math.PI * t), 48),
    sample: makeContinuousSample('wave', (t) => Math.sin(4 * Math.PI * t)),
  },
  {
    id: 'double-arc',
    label: '双峰弧',
    category: 'smooth',
    precisionSensitive: true,
    adjustableDensity: false,
    points: sample((t) => Math.abs(Math.sin(2 * Math.PI * t)), 40),
    sample: makeContinuousSample('double-arc', (t) => Math.abs(Math.sin(2 * Math.PI * t))),
  },
  {
    id: 'soft-elastic',
    label: '柔弹弧',
    category: 'smooth',
    precisionSensitive: true,
    adjustableDensity: false,
    points: sample(softElasticOffset, 48),
    sample: makeContinuousSample('soft-elastic', softElasticOffset),
  },
  {
    id: 'hook-tail',
    label: '甩尾钩',
    category: 'smooth',
    precisionSensitive: true,
    adjustableDensity: false,
    points: sample((t) => Math.pow(t, 2.2) * Math.sin(Math.PI * t) * 2.15, 32),
    sample: makeContinuousSample('hook-tail', (t) => Math.pow(t, 2.2) * Math.sin(Math.PI * t) * 2.15),
  },
  {
    id: 'hook-head',
    label: '起手钩',
    category: 'smooth',
    precisionSensitive: true,
    adjustableDensity: false,
    points: sample((t) => Math.pow(1 - t, 2.2) * Math.sin(Math.PI * t) * 2.15, 32),
    sample: makeContinuousSample('hook-head', (t) => Math.pow(1 - t, 2.2) * Math.sin(Math.PI * t) * 2.15),
  },
  {
    id: 'heart',
    label: '半心弧',
    category: 'smooth',
    precisionSensitive: true,
    adjustableDensity: false,
    points: sample(halfHeartOffset, 32),
    sample: makeContinuousSample('heart', halfHeartOffset),
  },

  // === 2. 节奏 / 震动（rhythm，4 款） ===
  {
    id: 'zigzag',
    label: '震动条',
    category: 'rhythm',
    precisionSensitive: false,
    adjustableDensity: true,
    oscillationHalf: 0.45,
    extraParams: [OSCILLATION_BASELINE_SPEC],
    points: [],
    sample: (span, _p, density) => {
      const teeth = Math.max(4, Math.min(TEMPLATE_SEGMENTED_MAX_POINTS, Math.round(span * 16 * positiveOrOne(density))));
      const out: { t: number; off: number }[] = [];
      for (let k = 1; k < teeth; k++) {
        out.push({ t: k / teeth, off: (k % 2 === 1 ? 1 : -1) * 0.45 });
      }
      return out;
    },
  },
  {
    id: 'damped',
    label: '余震条',
    category: 'rhythm',
    precisionSensitive: false,
    adjustableDensity: true,
    oscillationHalf: 0.75,
    extraParams: [OSCILLATION_BASELINE_SPEC],
    points: [],
    sample: (span, _p, density) => {
      const teeth = Math.max(6, Math.min(TEMPLATE_SEGMENTED_MAX_POINTS, Math.round(span * 16 * positiveOrOne(density))));
      const out: { t: number; off: number }[] = [];
      for (let k = 1; k < teeth; k++) {
        const t = k / teeth;
        const env = Math.pow(1 - t, 1.15);
        out.push({ t, off: (k % 2 === 1 ? 1 : -1) * 0.75 * env });
      }
      return out;
    },
  },
  {
    id: 'pulse',
    label: '尖刺',
    category: 'rhythm',
    precisionSensitive: false,
    adjustableDensity: true,
    extraParams: [
      {
        kind: 'range',
        key: 'pulsePos',
        labelKey: 'curve.extra.pulsePos',
        hintKey: 'curve.extra.pulsePosHint',
        defaultValue: 50,
        min: 0,
        max: 100,
        step: 1,
        unit: '%',
        presets: [
          { value: 0, labelKey: 'curve.extra.pulsePos.start' },
          { value: 50, labelKey: 'curve.extra.pulsePos.center' },
          { value: 100, labelKey: 'curve.extra.pulsePos.end' },
        ],
      },
    ],
    points: [],
    sample: (span, _p, density, extra) => {
      const count = Math.max(1, Math.min(80, Math.round(span * 2 * positiveOrOne(density))));
      const rawPos = typeof extra?.pulsePos === 'number' && Number.isFinite(extra.pulsePos) ? extra.pulsePos : 50;
      const pos = clamp(rawPos, 0, 100) / 100;
      const hw = 0.2;
      const out: { t: number; off: number }[] = [];
      for (let k = 0; k < count; k++) {
        const a = k / count;
        const w = 1 / count;
        const tL = a + w * Math.max(0, pos - hw);
        const tPeak = a + w * pos;
        const tR = a + w * Math.min(1, pos + hw);
        if (pos <= 0) {
          if (k > 0) out.push({ t: a, off: 0 });
          out.push({ t: a, off: 1 });
          out.push({ t: tR, off: 0 });
        } else if (pos >= 1) {
          out.push({ t: tL, off: 0 });
          out.push({ t: a + w, off: 1 });
          if (k < count - 1) out.push({ t: a + w, off: 0 });
        } else {
          if (tL > 1e-9) out.push({ t: tL, off: 0 });
          out.push({ t: tPeak, off: 1 });
          if (tR < 1 - 1e-9) out.push({ t: tR, off: 0 });
        }
      }
      return out;
    },
  },
  {
    id: 'step',
    label: '阶梯',
    category: 'rhythm',
    mappingMode: 'endpoint-interp',
    supportsMirror: false,
    supportsAmplitude: false,
    precisionSensitive: false,
    adjustableDensity: true,
    extraParams: [
      {
        kind: 'choice',
        key: 'stepStyle',
        labelKey: 'curve.extra.stepStyle',
        hintKey: 'curve.extra.stepStyleHint',
        defaultValue: 'sloped',
        options: [
          { value: 'sloped', labelKey: 'curve.extra.stepStyle.sloped' },
          { value: 'sharp', labelKey: 'curve.extra.stepStyle.sharp' },
        ],
      },
    ],
    points: [],
    sample: (span, _p, density, extra) => {
      const levels = Math.max(2, Math.min(120, Math.round(span * 3 * positiveOrOne(density))));
      const sharp = extra?.stepStyle === 'sharp';
      const out: { t: number; off: number }[] = [];
      const halfSlope = (1 / levels) * 0.1;
      for (let k = 0; k < levels - 1; k++) {
        const b = (k + 1) / levels;
        const p0 = k / (levels - 1);
        const p1 = (k + 1) / (levels - 1);
        if (sharp) {
          out.push({ t: b, off: p0 });
          out.push({ t: b, off: p1 });
        } else {
          out.push({ t: b - halfSlope, off: p0 });
          out.push({ t: b + halfSlope, off: p1 });
        }
      }
      return out;
    },
  },

  // === 3. 面筋 / 锁链（special，6 款） ===
  {
    id: 'gluten-spindle',
    label: '面筋·螺旋',
    category: 'special',
    precisionSensitive: false,
    adjustableDensity: true,
    oscillationHalf: 0.85,
    extraParams: [OSCILLATION_BASELINE_SPEC],
    points: [],
    sample: (span, _p, density) => {
      const steps = Math.max(8, Math.min(TEMPLATE_SEGMENTED_MAX_POINTS, Math.round(span * 16 * positiveOrOne(density))));
      const out: { t: number; off: number }[] = [];
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        const env = Math.sin(Math.PI * t);
        out.push({ t, off: (k % 2 === 1 ? 1 : -1) * 0.85 * env });
      }
      return out;
    },
  },
  {
    id: 'gluten-saw',
    label: '面筋·斜纹',
    category: 'special',
    precisionSensitive: false,
    adjustableDensity: true,
    hasZeroBeatJump: true,
    oscillationHalf: 0.75,
    extraParams: [OSCILLATION_BASELINE_SPEC],
    points: [],
    sample: (span, _p, density) => {
      const ribs = Math.max(4, Math.min(128, Math.round(span * 8 * positiveOrOne(density))));
      const out: { t: number; off: number }[] = [];
      for (let k = 0; k < ribs; k++) {
        const t0 = k / ribs;
        const t1 = (k + 1) / ribs;
        if (k > 0) {
          out.push({ t: t0, off: 0.75 });
          out.push({ t: t0, off: -0.75 });
        } else {
          out.push({ t: 0.002, off: -0.75 });
        }
        if (k === ribs - 1) {
          out.push({ t: Math.min(0.998, Math.max(t0 + 0.002, t1 - 0.002)), off: 0.75 });
        }
      }
      return out;
    },
  },
  {
    id: 'gluten-comb',
    label: '面筋·梳齿',
    category: 'special',
    precisionSensitive: false,
    adjustableDensity: true,
    hasZeroBeatJump: true,
    points: [],
    sample: (span, _p, density) => {
      // 每循环至多产出 7 个点（首循环 5 点），限制循环上限以守住 TEMPLATE_SEGMENTED_MAX_POINTS (256)
      const maxCycles = Math.floor((TEMPLATE_SEGMENTED_MAX_POINTS + 2) / 7);
      const cycles = Math.max(2, Math.min(maxCycles, Math.round(span * 4 * positiveOrOne(density))));
      const out: { t: number; off: number }[] = [];
      const spineOff = (t: number) => -0.32 * Math.sin(Math.PI * t);
      const railOff = 0.72;
      const ticks: readonly { sub: number; kind: 'both' | 'spine' | 'rail' }[] = [
        { sub: 0, kind: 'both' },
        { sub: 3, kind: 'spine' },
        { sub: 4, kind: 'rail' },
        { sub: 6, kind: 'spine' },
        { sub: 8, kind: 'rail' },
        { sub: 9, kind: 'spine' },
      ];
      for (let c = 0; c < cycles; c++) {
        for (const tk of ticks) {
          const t = (c * 12 + tk.sub) / (cycles * 12);
          if (t <= 1e-6 || t >= 1 - 1e-6) continue;
          if (tk.kind === 'both') {
            out.push({ t, off: railOff });
            out.push({ t, off: spineOff(t) });
          } else if (tk.kind === 'rail') {
            out.push({ t, off: railOff });
          } else {
            out.push({ t, off: spineOff(t) });
          }
        }
      }
      return out;
    },
  },
  {
    id: 'chain-square',
    label: '锁链·方波',
    category: 'special',
    precisionSensitive: false,
    adjustableDensity: true,
    oscillationHalf: 0.55,
    extraParams: [OSCILLATION_BASELINE_SPEC],
    points: [],
    sample: (span, _p, density) => {
      const links = Math.max(4, Math.min(128, Math.round(span * 8 * positiveOrOne(density))));
      const out: { t: number; off: number }[] = [];
      for (let k = 0; k < links; k++) {
        const t0 = k / links;
        const t1 = (k + 1) / links;
        const dt = (t1 - t0) * 0.14;
        const side = (k % 2 === 0 ? 1 : -1) * 0.55;
        out.push({ t: Math.min(0.995, Math.max(0.005, t0 + dt)), off: side });
        out.push({ t: Math.min(0.998, Math.max(0.008, t1 - dt)), off: side });
      }
      return out;
    },
  },
  {
    id: 'chain-bead',
    label: '锁链·竹节',
    category: 'special',
    precisionSensitive: false,
    adjustableDensity: true,
    points: [],
    sample: (span, precision = 16, density) => {
      const lobes = Math.max(2, Math.min(48, Math.round(span * 4 * positiveOrOne(density))));
      const n = Math.min(TEMPLATE_SEGMENTED_MAX_POINTS, Math.max(Math.ceil(span * precision), lobes * 14));
      return sample((t) => Math.pow(Math.abs(Math.sin(lobes * Math.PI * t)), 0.55) * 0.75, n);
    },
  },
  {
    id: 'chain-alt',
    label: '锁链·拉链',
    category: 'special',
    precisionSensitive: false,
    adjustableDensity: true,
    hasZeroBeatJump: true,
    oscillationHalf: 0.6,
    extraParams: [OSCILLATION_BASELINE_SPEC],
    points: [],
    sample: (span, _p, density) => {
      const segs = Math.max(4, Math.min(128, Math.round(span * 8 * positiveOrOne(density))));
      const out: { t: number; off: number }[] = [];
      for (let k = 0; k < segs; k++) {
        const t0 = k / segs;
        const t1 = (k + 1) / segs;
        const side = (k % 2 === 0 ? 1 : -1) * 0.6;
        const s = k === 0 ? 0.002 : t0;
        const e = k === segs - 1 ? 0.998 : t1;
        out.push({ t: s, off: side });
        out.push({ t: e, off: side });
      }
      return out;
    },
  },
];

// 静态兜底 points 对无 points 预填的模板以默认 1 拍采样填充，保证 direct `.points` 读取兼容
for (const tp of SHAPE_TEMPLATES) {
  if (tp.points.length === 0 && tp.sample) {
    tp.points = tp.sample(1, 16, 1);
  }
}

export const shapeTemplateById = (id: string): ShapeTemplate | undefined =>
  SHAPE_TEMPLATES.find((tp) => tp.id === id);

/**
 * 相对弦横向偏移量（归一化 off 单位）：`sign × off + (baseline/100) × half`。
 * 基线加在 sign 外侧，与偏向正交。烘焙与 SVG 预览共用，避免口径分叉。
 */
export function relativeChordOffset(
  off: number,
  mirrored: boolean,
  template: ShapeTemplate,
  extra: Record<string, TemplateExtraValue>,
): number {
  const sign = mirrored ? -1 : 1;
  const baseline = typeof extra.baseline === 'number' ? extra.baseline : 0;
  const half = templateSupportsBaseline(template) ? (template.oscillationHalf ?? 0) : 0;
  return sign * off + (baseline / 100) * half;
}

/**
 * 套用模板：段两端可见结点之间按点列生成 hidden 采样点（不含端点）。
 * - 相对弦偏移型：lane = 弦插值 + AMP × ampScale × (sign × off + (baseline/100) × half)，钳制 0..6；
 * - 端点插值型：lane = from.lane + (to.lane - from.lane) × off（同轨退化为直线）；
 * beat = t 线性映射（普通曲线严格递增；同拍跃迁模板弱单调递增）。
 */
export function bakeTemplatePoints(
  from: { lane: number },
  to: { lane: number },
  fromBeat: number,
  toBeat: number,
  template: ShapeTemplate,
  precision: CurvePrecision = 16,
  mirrored = false,
  amplitudeScale = 1,
  densityScale = 1,
  extra?: Record<string, TemplateExtraValue>,
): ConnectionNote[] {
  const span = toBeat - fromBeat;
  if (!(span > 0)) return [];
  const mode = templateMappingMode(template);
  if (mode === 'endpoint-interp' && from.lane === to.lane) {
    return [];
  }
  const resolvedExtra = resolveTemplateExtra(template, extra);
  const pts = template.sample
    ? template.sample(span, precision, densityScale, resolvedExtra)
    : template.points;
  const mapBeat = (t: number) =>
    t <= 0 ? fromBeat : t >= 1 ? toBeat : clamp(fromBeat + t * span, fromBeat, toBeat);
  if (mode === 'endpoint-interp') {
    const dLane = to.lane - from.lane;
    return pts.map(({ t, off }) => ({
      beat: mapBeat(t),
      lane: clamp(from.lane + dLane * off, 0, 6),
      hidden: true as const,
    }));
  }
  const ampScale = positiveOrOne(amplitudeScale);
  return pts.map(({ t, off }) => ({
    beat: mapBeat(t),
    lane: clamp(
      from.lane
        + (to.lane - from.lane) * t
        + TEMPLATE_AMPLITUDE * ampScale * relativeChordOffset(off, mirrored, template, resolvedExtra),
      0,
      6,
    ),
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
  return bakeTemplatePoints(
    from,
    to,
    fromBeat,
    toBeat,
    tp,
    param.precision ?? 16,
    !!param.mirrored,
    param.amplitudeScale ?? 1,
    param.densityScale ?? 1,
    param.extra,
  );
}
