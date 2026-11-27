// 曲线配置的展示文案（面板与画布胶囊共用）。
import {
  resolveTemplateExtra,
  shapeTemplateById,
  templateSupportsAmplitude,
  templateSupportsMirror,
  type ShapeTemplate,
} from '../../chart/editing/ShapeTemplates';
import type { EasingFamily, EasingType } from '../../chart/editing/Easing';
import { curveConfigExtraView, type CurveConfig } from '../../chart/editing/CurveTool';
import { t, type MessageKey } from '../../i18n';

export const shapeLabel = (id: string): string => {
  const tp = shapeTemplateById(id);
  return tp ? t(`shape.${tp.id}` as MessageKey) : t('curve.noTemplate');
};

export const shapeTooltip = (tp: ShapeTemplate): string => t(`shapeTip.${tp.id}` as MessageKey);

/**
 * 「Sine（正弦）」→ `{ primary: 'Sine', secondary: '正弦' }`。
 * 中文界面的族/型名带括号释义，卡片要拆成主副两行；英文界面本来就只有英文名（无括号），
 * 于是只有 `primary`、不渲染副行——两处共用同一份拆分口径，免得面板各写一套正则。
 * 半角括号一并认：字典若哪天写成 `Sine (正弦)`，副行不该整条消失。
 */
export function splitBilingualLabel(label: string): { primary: string; secondary?: string } {
  const match = label.match(/^(.+?)[（(](.+?)[）)]$/);
  if (!match) return { primary: label.trim() };
  return { primary: match[1]!.trim(), secondary: match[2]!.trim() };
}

/** 去掉族 / 型标签里的括号释义：「Sine（正弦）」→「Sine」（摘要与胶囊按钮只放英文短名） */
const bare = (label: string) => splitBilingualLabel(label).primary;

/** 缓动族 / 缓动型的完整双语标签（tooltip 与无障碍名）；短名见 {@link easingTypeShort} */
export const easingFamilyLabel = (family: EasingFamily): string => t(`easing.family.${family}` as MessageKey);
export const easingTypeLabel = (type: EasingType): string => t(`easing.type.${type}` as MessageKey);

/** 缓动型按钮上的英文短名：`In-Out（缓入缓出）` → `In-Out` */
export const easingTypeShort = (type: EasingType): string => bare(easingTypeLabel(type));

const SCALE_KEYS: Record<number, MessageKey> = {
  0.5: 'curve.scale.0.5',
  1: 'curve.scale.1',
  1.5: 'curve.scale.1.5',
};

const DENSITY_KEYS: Record<number, MessageKey> = {
  0.5: 'curve.density.0.5',
  1: 'curve.density.1',
  2: 'curve.density.2',
};

/** 规整数值文案（去多余尾零并附带单位，如 `1.00 -> 1×`、`3.50 -> 3.5×`、`25 -> 25%`） */
export const formatTemplateNumber = (value: number, unit = ''): string =>
  `${Number(value.toFixed(2))}${unit}`;

/** 档位模式命中档位就写词，其余（自由模式，或档位模式下的非预设值）写数值 + 单位。 */
const formatParamValue = (
  value: number,
  presetLabelKey: MessageKey | undefined,
  isFree: boolean,
  unit: string,
): string => (!isFree && presetLabelKey ? t(presetLabelKey) : formatTemplateNumber(value, unit));

const formatContinuousParam = (
  value: number,
  presetKeys: Record<number, MessageKey>,
  isFree: boolean,
): string => formatParamValue(value, presetKeys[value], isFree, '×');

/** 胶囊摘要：跳过当前模板不支持的通用项，并按参数模式展示档位词或数值；缓动模式「族 · 型 · 1/精度」。
 *  专属数值项连默认档位也占位——摘要要回答「现在是什么档」，藏掉默认值就答不出；
 *  且各家默认并非都等于「零操作」（基线 `0` 是不偏移、尖刺 `50` 是峰值落在中段），
 *  共用一条「等于默认就跳过」的规则会把两种语义一起吞掉。
 *  `compact`：形状模板只留主名（展开态顶栏，参数已在面板内）；折叠态走完整拼接。 */
export function curveConfigSummary(c: CurveConfig, opts?: { compact?: boolean }): string {
  const tp = c.templateId != null ? shapeTemplateById(c.templateId) : undefined;
  if (tp) {
    if (opts?.compact) return shapeLabel(tp.id);
    const isFree = c.templateParamMode === 'free';
    const parts = [shapeLabel(tp.id)];
    if (templateSupportsMirror(tp)) {
      parts.push(t(c.templateMirrored ? 'curve.dirLeft' : 'curve.dirRight'));
    }
    if (templateSupportsAmplitude(tp)) {
      parts.push(formatContinuousParam(c.templateScale ?? 1, SCALE_KEYS, isFree));
    }
    if (tp.adjustableDensity) {
      parts.push(formatContinuousParam(c.templateDensity ?? 1, DENSITY_KEYS, isFree));
    }
    if (tp.extraParams?.length) {
      const resolved = resolveTemplateExtra(tp, curveConfigExtraView(tp, c));
      for (const spec of tp.extraParams) {
        const val = resolved[spec.key];
        if (spec.kind === 'choice') {
          const opt = spec.options.find((o) => o.value === val);
          if (opt) parts.push(t(opt.labelKey as MessageKey));
        } else {
          const preset = isFree ? undefined : spec.presets?.find((p) => p.value === val);
          parts.push(formatParamValue(
            Number(val), preset?.labelKey as MessageKey | undefined, isFree, spec.unit ?? '',
          ));
        }
      }
    }
    return parts.join(' · ');
  }
  const family = bare(easingFamilyLabel(c.family));
  const type = bare(easingTypeLabel(c.type));
  return `${family} · ${type} · 1/${c.precision}`;
}
