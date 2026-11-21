// 曲线配置的展示文案（面板与画布胶囊共用）。
import {
  resolveTemplateExtra,
  shapeTemplateById,
  templateSupportsAmplitude,
  templateSupportsMirror,
  type ShapeTemplate,
} from '../../chart/editing/ShapeTemplates';
import { curveConfigExtraView, type CurveConfig } from '../../chart/editing/CurveTool';
import { t, type MessageKey } from '../../i18n';

export const shapeLabel = (id: string): string => {
  const tp = shapeTemplateById(id);
  return tp ? t(`shape.${tp.id}` as MessageKey) : t('curve.noTemplate');
};

export const shapeTooltip = (tp: ShapeTemplate): string => t(`shapeTip.${tp.id}` as MessageKey);

/** 去掉族 / 型标签里的括号释义：「Sine（正弦）」→「Sine」 */
const bare = (label: string) => label.replace(/（.*?）|\(.*?\)/g, '').trim();

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
  const family = bare(t(`easing.family.${c.family}` as MessageKey));
  const type = bare(t(`easing.type.${c.type}` as MessageKey));
  return `${family} · ${type} · 1/${c.precision}`;
}
