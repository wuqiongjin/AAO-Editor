// 曲线工具配置面板（issue 114：从 Toolbar 抽出 + 表驱动；票 182：改为带标签的四行，画布胶囊复用）。
import {
  CURVE_PRECISIONS, EASING_FAMILIES, EASING_TYPES,
  type CurvePrecision, type EasingFamily, type EasingType,
} from '../../chart/editing/Easing';
import { SHAPE_TEMPLATES, shapeTemplateById } from '../../chart/editing/ShapeTemplates';
import type { CurveConfig } from '../../chart/editing/CurveTool';
import { t, type MessageKey } from '../../i18n';
import { shapeLabel } from './curveLabels';
import './CurveConfigPanel.css';

const NO_TEMPLATE_VALUE = '';

interface CurveFieldDef {
  id: string;
  label: string;
  title: string;
  options: { value: string; label: string }[];
  read: (c: CurveConfig) => string;
  write: (c: CurveConfig, value: string) => CurveConfig;
}

export default function CurveConfigPanel({
  config,
  onChange,
}: {
  config: CurveConfig;
  onChange: (next: CurveConfig) => void;
}) {
  const templateActive = config.templateId != null;
  const currentTemplate = config.templateId ? shapeTemplateById(config.templateId) : undefined;
  // 连续模板（具备 sample 动态生成器）支持精度调节；离散固定模板（无 sample，如 zigzag）置灰
  const precisionDisabled = currentTemplate ? !currentTemplate.sample : false;
  const curveFields: readonly CurveFieldDef[] = [
    {
      id: 'family',
      label: t('curve.family'),
      title: t('curve.family'),
      options: EASING_FAMILIES.map((f) => ({ value: f, label: t(`easing.family.${f}` as MessageKey) })),
      read: (c) => c.family,
      write: (c, v) => ({ ...c, family: v as EasingFamily }),
    },
    {
      id: 'type',
      label: t('curve.type'),
      title: t('curve.type'),
      options: EASING_TYPES.map((tp) => ({ value: tp, label: t(`easing.type.${tp}` as MessageKey) })),
      read: (c) => c.type,
      write: (c, v) => ({ ...c, type: v as EasingType }),
    },
    {
      id: 'precision',
      label: t('curve.precisionShort'),
      title: t('curve.precision'),
      options: CURVE_PRECISIONS.map((p) => ({ value: String(p), label: `1/${p}` })),
      read: (c) => String(c.precision),
      write: (c, v) => ({ ...c, precision: Number(v) as CurvePrecision }),
    },
    {
      id: 'templateId',
      label: t('curve.templateShort'),
      title: t('curve.template'),
      options: [
        { value: NO_TEMPLATE_VALUE, label: t('curve.noTemplate') },
        ...SHAPE_TEMPLATES.map((tp) => ({ value: tp.id, label: shapeLabel(tp.id) })),
      ],
      read: (c) => c.templateId ?? NO_TEMPLATE_VALUE,
      write: (c, v) => ({ ...c, templateId: v || null }),
    },
  ];
  return (
    <div className="ccp">
      {curveFields.map((field) => (
        <label key={field.id} className="ccp__row" title={field.title}>
          <span className="ccp__label">{field.label}</span>
          <select
            className="ccp__select"
            value={field.read(config)}
            disabled={field.id === 'precision' ? precisionDisabled : (templateActive && field.id !== 'templateId')}
            onChange={(e) => onChange(field.write(config, e.target.value))}
          >
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
