// 曲线工具配置面板（issue 114：从 Toolbar 抽出 + 表驱动）。
import SectionHeader from './ToolbarSection';
import {
  CURVE_PRECISIONS, EASING_FAMILIES, EASING_TYPES,
  type CurvePrecision, type EasingFamily, type EasingType,
} from '../../chart/editing/Easing';
import { SHAPE_TEMPLATES } from '../../chart/editing/ShapeTemplates';
import type { CurveConfig } from '../../chart/editing/CurveTool';
import { t, type MessageKey } from '../../i18n';

const NO_TEMPLATE_VALUE = '';

const SHAPE_LABEL_KEYS: Record<string, MessageKey> = {
  's-curve': 'shape.s-curve',
  wave: 'shape.wave',
  zigzag: 'shape.zigzag',
  arc: 'shape.arc',
  heart: 'shape.heart',
};

interface CurveFieldDef {
  id: string;
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
  const curveFields: readonly CurveFieldDef[] = [
    {
      id: 'family',
      title: t('curve.family'),
      options: EASING_FAMILIES.map((f) => ({ value: f, label: t(`easing.family.${f}` as MessageKey) })),
      read: (c) => c.family,
      write: (c, v) => ({ ...c, family: v as EasingFamily }),
    },
    {
      id: 'type',
      title: t('curve.type'),
      options: EASING_TYPES.map((tp) => ({ value: tp, label: t(`easing.type.${tp}` as MessageKey) })),
      read: (c) => c.type,
      write: (c, v) => ({ ...c, type: v as EasingType }),
    },
    {
      id: 'precision',
      title: t('curve.precision'),
      options: CURVE_PRECISIONS.map((p) => ({ value: String(p), label: `1/${p}` })),
      read: (c) => String(c.precision),
      write: (c, v) => ({ ...c, precision: Number(v) as CurvePrecision }),
    },
    {
      id: 'templateId',
      title: t('curve.template'),
      options: [
        { value: NO_TEMPLATE_VALUE, label: t('curve.noTemplate') },
        ...SHAPE_TEMPLATES.map((tp) => ({ value: tp.id, label: t(SHAPE_LABEL_KEYS[tp.id] ?? 'curve.noTemplate') })),
      ],
      read: (c) => c.templateId ?? NO_TEMPLATE_VALUE,
      write: (c, v) => ({ ...c, templateId: v || null }),
    },
  ];
  return (
    <div>
      <SectionHeader>{t('curve.title')}</SectionHeader>
      {curveFields.map((field) => (
        <select
          key={field.id}
          value={field.read(config)}
          disabled={templateActive && field.id !== 'templateId'}
          onChange={(e) => onChange(field.write(config, e.target.value))}
          className="toolbar__beat-select"
          title={field.title}
        >
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}
    </div>
  );
}
