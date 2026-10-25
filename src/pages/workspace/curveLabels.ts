// 曲线配置的展示文案（面板与画布胶囊共用）。
import { SHAPE_TEMPLATES } from '../../chart/editing/ShapeTemplates';
import type { CurveConfig } from '../../chart/editing/CurveTool';
import { t, type MessageKey } from '../../i18n';

export const SHAPE_LABEL_KEYS: Record<string, MessageKey> = {
  's-curve': 'shape.s-curve',
  wave: 'shape.wave',
  zigzag: 'shape.zigzag',
  arc: 'shape.arc',
  heart: 'shape.heart',
};

export const shapeLabel = (id: string) => t(SHAPE_LABEL_KEYS[id] ?? 'curve.noTemplate');

/** 去掉族 / 型标签里的括号释义：「Sine（正弦）」→「Sine」 */
const bare = (label: string) => label.replace(/（.*?）|\(.*?\)/g, '').trim();

/** 胶囊摘要：选了模板 = 模板名；否则「族 · 型 · 1/精度」 */
export function curveConfigSummary(c: CurveConfig): string {
  if (c.templateId != null && SHAPE_TEMPLATES.some((tp) => tp.id === c.templateId)) return shapeLabel(c.templateId);
  const family = bare(t(`easing.family.${c.family}` as MessageKey));
  const type = bare(t(`easing.type.${c.type}` as MessageKey));
  return `${family} · ${type} · 1/${c.precision}`;
}
