// 曲线配置的展示文案（面板与画布胶囊共用）。
import {
  resolveTemplateExtra,
  shapeTemplateById,
  templateSupportsAmplitude,
  templateSupportsMirror,
  type ShapeTemplate,
} from '../../chart/editing/ShapeTemplates';
import type { CurveConfig } from '../../chart/editing/CurveTool';
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

/** 胶囊摘要：跳过当前模板不支持的通用项，并展示专属项短值；缓动模式「族 · 型 · 1/精度」 */
export function curveConfigSummary(c: CurveConfig): string {
  const tp = c.templateId != null ? shapeTemplateById(c.templateId) : undefined;
  if (tp) {
    const parts = [shapeLabel(tp.id)];
    if (templateSupportsMirror(tp)) {
      parts.push(t(c.templateMirrored ? 'curve.dirLeft' : 'curve.dirRight'));
    }
    if (templateSupportsAmplitude(tp)) {
      parts.push(t(SCALE_KEYS[c.templateScale ?? 1] ?? 'curve.scale.1'));
    }
    if (tp.adjustableDensity) {
      parts.push(t(DENSITY_KEYS[c.templateDensity ?? 1] ?? 'curve.density.1'));
    }
    if (tp.extraParams?.length) {
      const resolved = resolveTemplateExtra(tp, c.templateExtras?.[tp.id]);
      for (const spec of tp.extraParams) {
        const val = resolved[spec.key];
        if (spec.kind === 'choice') {
          const opt = spec.options.find((o) => o.value === val);
          if (opt) parts.push(t(opt.labelKey as MessageKey));
        } else {
          parts.push(`${val}${spec.unit ?? ''}`);
        }
      }
    }
    return parts.join(' · ');
  }
  const family = bare(t(`easing.family.${c.family}` as MessageKey));
  const type = bare(t(`easing.type.${c.type}` as MessageKey));
  return `${family} · ${type} · 1/${c.precision}`;
}
