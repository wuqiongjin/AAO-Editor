// 曲线工具配置面板（issue 114：从 Toolbar 抽出 + 表驱动）。
//
// 表驱动的目的不是"少写几行"，而是**给未来的模板扩展留插槽**（自定义模板 / 形态预览 /
// 独立弹窗）：往 `CURVE_FIELDS` 里插一项即可，不必再动 Toolbar。
// 渲染序 = 数组序：缓动族 → 缓动型 → 采样精度 → 形状模板（模板是"另一条生成路径"，放最后）。
import SectionHeader from './ToolbarSection';
import {
  CURVE_PRECISIONS, EASING_FAMILIES, EASING_TYPES,
  EASING_FAMILY_LABELS, EASING_TYPE_LABELS,
  type CurvePrecision, type EasingFamily, type EasingType,
} from '../../chart/editing/Easing';
import { SHAPE_TEMPLATES } from '../../chart/editing/ShapeTemplates';
import type { CurveConfig } from '../../chart/editing/ToolActionMatrix';

/** 模板下拉的"不选模板"哨兵：select 的 value 只能是字符串，空串 → `templateId: null` */
const NO_TEMPLATE_VALUE = '';

interface CurveFieldDef {
  id: string;
  title: string;
  options: { value: string; label: string }[];
  /** 当前值（统一用字符串承载 select 的 value） */
  read: (c: CurveConfig) => string;
  /** 选中后写回配置（整份替换，保持 CurveConfig 不可变） */
  write: (c: CurveConfig, value: string) => CurveConfig;
}

const CURVE_FIELDS: readonly CurveFieldDef[] = [
  {
    id: 'family',
    title: '缓动族',
    options: EASING_FAMILIES.map((f) => ({ value: f, label: EASING_FAMILY_LABELS[f] })),
    read: (c) => c.family,
    write: (c, v) => ({ ...c, family: v as EasingFamily }),
  },
  {
    id: 'type',
    title: '缓动型',
    options: EASING_TYPES.map((t) => ({ value: t, label: EASING_TYPE_LABELS[t] })),
    read: (c) => c.type,
    write: (c, v) => ({ ...c, type: v as EasingType }),
  },
  {
    id: 'precision',
    title: '采样精度（每拍采样点数）',
    options: CURVE_PRECISIONS.map((p) => ({ value: String(p), label: `1/${p}` })),
    read: (c) => String(c.precision),
    write: (c, v) => ({ ...c, precision: Number(v) as CurvePrecision }),
  },
  {
    id: 'templateId',
    title: '形状模板（内置相对形状库）',
    options: [
      { value: NO_TEMPLATE_VALUE, label: '不使用模板' },
      ...SHAPE_TEMPLATES.map((tp) => ({ value: tp.id, label: tp.label })),
    ],
    read: (c) => c.templateId ?? NO_TEMPLATE_VALUE,
    write: (c, v) => ({ ...c, templateId: v || null }),
  },
];

export default function CurveConfigPanel({
  config,
  onChange,
}: {
  config: CurveConfig;
  onChange: (next: CurveConfig) => void;
}) {
  // 模板优先（ADR-0009 §2）：选了模板 → 缓动三字段被忽略，置灰但仍可见（不隐藏、不做模式切换）
  const templateActive = config.templateId != null;
  return (
    <div>
      <SectionHeader>曲线配置</SectionHeader>
      {CURVE_FIELDS.map((field) => (
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
