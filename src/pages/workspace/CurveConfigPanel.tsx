// 曲线工具配置面板（issue 114 抽出；issue 235 图形化选型；issue 241 连续参数；issue 242 缓动页同为图形化选型）。
import { useRef, useState } from 'react';
import {
  CURVE_PRECISIONS, EASING_FAMILIES, EASING_TYPES,
  type CurvePrecision,
} from '../../chart/editing/Easing';
import {
  SHAPE_TEMPLATES,
  TEMPLATE_BASELINE_RANGE,
  TEMPLATE_DENSITIES,
  TEMPLATE_DENSITY_RANGE,
  TEMPLATE_SCALES,
  TEMPLATE_SCALE_RANGE,
  clampTemplateNumber,
  resolveTemplateExtra,
  shapeTemplateById,
  snapTemplateRangeValue,
  stripDefaultTemplateExtra,
  templateSupportsAmplitude,
  templateSupportsMirror,
  type TemplateExtraParamSpec,
  type TemplateNumberRange,
} from '../../chart/editing/ShapeTemplates';
import type { TemplateExtraValue } from '../../chart/types';
import {
  TEMPLATE_CATEGORY_FILTERS, curveConfigExtraView, resolveLastTemplateId,
  type CurveConfig, type TemplateCategoryFilter,
} from '../../chart/editing/CurveTool';
import { t, type MessageKey } from '../../i18n';
import { MiniEasingSvg, MiniTemplateSvg } from './CurveMiniSvg';
import {
  easingFamilyLabel, easingTypeLabel, easingTypeShort,
  formatTemplateNumber, shapeLabel, shapeTooltip, splitBilingualLabel,
} from './curveLabels';
import './CurveConfigPanel.css';

function PrecisionPills({
  precision,
  disabled = false,
  onSelect,
}: {
  precision: CurvePrecision;
  disabled?: boolean;
  onSelect: (p: CurvePrecision) => void;
}) {
  return (
    <div className="ccp__pills" role="group" aria-label={t('curve.precisionShort')}>
      {CURVE_PRECISIONS.map((p) => (
        <button
          key={p}
          type="button"
          disabled={disabled}
          aria-pressed={precision === p}
          className={`ccp__pill-btn${precision === p ? ' is-active' : ''}`}
          onClick={() => onSelect(p)}
        >
          {`1/${p}`}
        </button>
      ))}
    </div>
  );
}

function FreeRangeRow({
  label,
  hint,
  value,
  range,
  unit,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  range: TemplateNumberRange;
  unit: string;
  onChange: (val: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurCommitRef = useRef(false);

  const displayText = draft !== null ? draft : formatTemplateNumber(value);
  const resetHint = t('curve.freeResetRowHint');
  const fullHint = hint ? `${hint} (${resetHint})` : resetHint;

  const commitValue = (raw: number) => {
    const next = clampTemplateNumber(raw, range, value);
    onChange(range.step >= 1 ? Math.round(next) : next);
  };

  const commitDraft = () => {
    if (draft === null) return;
    const trimmed = draft.trim();
    const parsed = Number(trimmed);
    setDraft(null);
    if (!trimmed || !Number.isFinite(parsed)) return;
    commitValue(parsed);
  };

  return (
    <div className="ccp__ctrl-row" title={fullHint}>
      <span
        className="ccp__ctrl-label ccp__ctrl-label--reset"
        onDoubleClick={() => {
          setDraft(null);
          onChange(range.defaultValue);
        }}
      >
        {label}
      </span>
      <div className="ccp__free-ctrl">
        <input
          type="range"
          className="ccp__slider"
          aria-label={label}
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          onChange={(e) => {
            setDraft(null);
            commitValue(Number(e.target.value));
          }}
          onDoubleClick={() => {
            setDraft(null);
            onChange(range.defaultValue);
          }}
        />
        <div className="ccp__num-wrap">
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            className="ccp__num-input"
            aria-label={label}
            value={displayText}
            onFocus={() => setDraft(formatTemplateNumber(value))}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (skipBlurCommitRef.current) {
                skipBlurCommitRef.current = false;
                setDraft(null);
                return;
              }
              commitDraft();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitDraft();
                inputRef.current?.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation?.();
                skipBlurCommitRef.current = true;
                setDraft(null);
                inputRef.current?.blur();
              }
            }}
          />
          {unit && <span className="ccp__unit" aria-hidden="true">{unit}</span>}
        </div>
      </div>
    </div>
  );
}

interface NumberPresetItem {
  value: number;
  label: string;
  tip?: string;
}

function ContinuousParamRow({
  isFree,
  label,
  hint,
  value,
  range,
  unit,
  presets,
  onChange,
}: {
  isFree: boolean;
  label: string;
  hint?: string;
  value: number;
  range: TemplateNumberRange;
  unit: string;
  presets: readonly NumberPresetItem[];
  onChange: (val: number) => void;
}) {
  if (isFree) {
    return (
      <FreeRangeRow
        label={label}
        hint={hint}
        value={value}
        range={range}
        unit={unit}
        onChange={onChange}
      />
    );
  }
  return (
    <div className="ccp__ctrl-row" title={hint}>
      <span className="ccp__ctrl-label">{label}</span>
      <div className="ccp__pills" role="group" aria-label={label}>
        {presets.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={value === item.value}
            title={item.tip}
            className={`ccp__pill-btn${value === item.value ? ' is-active' : ''}`}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ExtraParamRow({
  spec,
  value,
  isFree,
  onChange,
}: {
  spec: TemplateExtraParamSpec;
  value: TemplateExtraValue;
  isFree: boolean;
  onChange: (val: TemplateExtraValue) => void;
}) {
  const label = t(spec.labelKey as MessageKey);
  const hint = spec.hintKey ? t(spec.hintKey as MessageKey) : undefined;
  if (spec.kind === 'range') {
    const presets: NumberPresetItem[] = (spec.presets ?? []).map((p) => ({
      value: p.value,
      label: t(p.labelKey as MessageKey),
    }));
    return (
      <ContinuousParamRow
        isFree={isFree}
        label={label}
        hint={hint}
        value={typeof value === 'number' ? value : spec.defaultValue}
        range={spec}
        unit={spec.unit ?? ''}
        presets={presets}
        onChange={(v) => onChange(v)}
      />
    );
  }
  const items = spec.options.map((opt) => ({ value: opt.value, label: t(opt.labelKey as MessageKey) }));
  return (
    <div className="ccp__ctrl-row" title={hint}>
      <span className="ccp__ctrl-label">{label}</span>
      <div className="ccp__pills" role="group" aria-label={label}>
        {items.map((item) => (
          <button
            key={String(item.value)}
            type="button"
            aria-pressed={value === item.value}
            className={`ccp__pill-btn${value === item.value ? ' is-active' : ''}`}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CurveConfigPanel({
  config,
  onChange,
}: {
  config: CurveConfig;
  onChange: (next: CurveConfig) => void;
}) {
  // issue 242：分类筛选与「上次选用的模板」都是常态偏好，随 settings.curve 跨会话——
  // 组件卸载（胶囊收起 / 切走工具）不该把它们一起丢掉。合法性与迁移口径收在 CurveTool 一处。
  const category: TemplateCategoryFilter = config.templateCategory ?? 'all';
  const lastTemplateId = resolveLastTemplateId(config);

  const currentTemplate = config.templateId ? shapeTemplateById(config.templateId) : undefined;
  const templateActive = currentTemplate !== undefined;
  const isFreeMode = config.templateParamMode === 'free';
  const mirrored = !!config.templateMirrored;
  const ampScale = config.templateScale ?? 1;
  const densityScale = config.templateDensity ?? 1;
  const showMirror = currentTemplate ? templateSupportsMirror(currentTemplate) : false;
  const showAmplitude = currentTemplate ? templateSupportsAmplitude(currentTemplate) : false;
  const resolvedExtra = currentTemplate
    ? resolveTemplateExtra(currentTemplate, curveConfigExtraView(currentTemplate, config))
    : {};

  const updateExtra = (key: string, value: TemplateExtraValue) => {
    if (!currentTemplate) return;
    const merged = { ...(config.templateExtras?.[currentTemplate.id] ?? {}), [key]: value };
    const stripped = stripDefaultTemplateExtra(currentTemplate, merged);
    const nextExtras = { ...(config.templateExtras ?? {}) };
    if (stripped) nextExtras[currentTemplate.id] = stripped;
    else delete nextExtras[currentTemplate.id];
    const nextConfig: CurveConfig = { ...config };
    if (Object.keys(nextExtras).length > 0) nextConfig.templateExtras = nextExtras;
    else delete nextConfig.templateExtras;
    onChange(nextConfig);
  };

  // 振荡基线是跨模板通用单值：写回配置而非按模板 ID 记 extras；范围/步长在出口就收敛
  const updateExtraParam = (spec: TemplateExtraParamSpec, value: TemplateExtraValue) => {
    if (spec.key !== 'baseline') {
      updateExtra(spec.key, value);
      return;
    }
    onChange({ ...config, templateBaseline: snapTemplateRangeValue(value, TEMPLATE_BASELINE_RANGE) });
  };

  const filteredTemplates = SHAPE_TEMPLATES.filter(
    (tp) => category === 'all' || tp.category === category,
  );

  return (
    <div className="ccp">
      {/* 顶部模式切换：缓动函数 | 形状模板 */}
      <div className="ccp__seg" role="tablist" aria-label={t('curve.title')}>
        <button
          type="button"
          role="tab"
          aria-selected={!templateActive}
          className={`ccp__seg-btn${!templateActive ? ' is-active' : ''}`}
          onClick={() => onChange({ ...config, templateId: null })}
        >
          {t('curve.mode.easing')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={templateActive}
          className={`ccp__seg-btn${templateActive ? ' is-active' : ''}`}
          onClick={() => onChange({ ...config, templateId: currentTemplate?.id ?? lastTemplateId })}
        >
          {t('curve.mode.template')}
        </button>
      </div>

      {templateActive && currentTemplate ? (
        <>
          <div className="ccp__tabs" role="tablist" aria-label={t('curve.templateShort')}>
            {TEMPLATE_CATEGORY_FILTERS.map((cat) => (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={category === cat}
                className={`ccp__tab${category === cat ? ' is-active' : ''}`}
                onClick={() => onChange({ ...config, templateCategory: cat })}
              >
                {t(`curve.cat.${cat}` as MessageKey)}
              </button>
            ))}
          </div>

          {/* 4 列 SVG 缩略图网格 */}
          <div className="ccp__grid">
            {filteredTemplates.map((tp) => {
              const active = currentTemplate.id === tp.id;
              const name = shapeLabel(tp.id);
              return (
                <button
                  key={tp.id}
                  type="button"
                  aria-pressed={active}
                  className={`ccp__card${active ? ' is-active' : ''}`}
                  title={shapeTooltip(tp)}
                  onClick={() => onChange({ ...config, templateId: tp.id, lastTemplateId: tp.id })}
                >
                  <MiniTemplateSvg
                    template={tp}
                    width={46}
                    height={48}
                    mirrored={mirrored}
                    ampScale={ampScale}
                    densityScale={densityScale}
                    extra={curveConfigExtraView(tp, config)}
                  />
                  <span className="ccp__card-name">{name}</span>
                </button>
              );
            })}
          </div>

          {/* 底部控制区：按模板能力展示 偏向 + 幅度 + 段密/精度 + 模板专属参数 */}
          <div className="ccp__controls">

            {showMirror && (
              <div className="ccp__ctrl-row" title={t('curve.dirHint')}>
                <span className="ccp__ctrl-label">{t('curve.dir')}</span>
                <div className="ccp__pills" role="group" aria-label={t('curve.dir')}>
                  <button
                    type="button"
                    aria-pressed={mirrored}
                    className={`ccp__pill-btn${mirrored ? ' is-active' : ''}`}
                    onClick={() => onChange({ ...config, templateMirrored: true })}
                  >
                    {`↰ ${t('curve.dirLeft')}`}
                  </button>
                  <button
                    type="button"
                    aria-pressed={!mirrored}
                    className={`ccp__pill-btn${!mirrored ? ' is-active' : ''}`}
                    onClick={() => onChange({ ...config, templateMirrored: false })}
                  >
                    {`${t('curve.dirRight')} ↱`}
                  </button>
                </div>
              </div>
            )}

            {showAmplitude && (
              <ContinuousParamRow
                isFree={isFreeMode}
                label={t('curve.scale')}
                hint={t('curve.scaleHint')}
                value={ampScale}
                range={TEMPLATE_SCALE_RANGE}
                unit="×"
                presets={TEMPLATE_SCALES.map((s) => ({
                  value: s,
                  label: t(`curve.scale.${s}` as MessageKey),
                  tip: t(`curve.scaleTip.${s}` as MessageKey),
                }))}
                onChange={(s) => onChange({ ...config, templateScale: s })}
              />
            )}

            {currentTemplate.adjustableDensity ? (
              <ContinuousParamRow
                isFree={isFreeMode}
                label={t('curve.density')}
                hint={t('curve.densityHint')}
                value={densityScale}
                range={TEMPLATE_DENSITY_RANGE}
                unit="×"
                presets={TEMPLATE_DENSITIES.map((d) => ({
                  value: d,
                  label: t(`curve.density.${d}` as MessageKey),
                  tip: t(`curve.densityTip.${d}` as MessageKey),
                }))}
                onChange={(d) => onChange({ ...config, templateDensity: d })}
              />
            ) : (
              <div className="ccp__ctrl-row" title={t('curve.precision')}>
                <span className="ccp__ctrl-label">{t('curve.precisionShort')}</span>
                <PrecisionPills
                  precision={config.precision}
                  onSelect={(p) => onChange({ ...config, precision: p })}
                />
              </div>
            )}

            {currentTemplate.extraParams?.map((spec) => (
              <ExtraParamRow
                key={spec.key}
                spec={spec}
                isFree={isFreeMode}
                value={resolvedExtra[spec.key] ?? spec.defaultValue}
                onChange={(val) => updateExtraParam(spec, val)}
              />
            ))}
          </div>
        </>
      ) : (
        /* 缓动函数视图（issue 242）：上排缓动型胶囊 → 5×2 缓动族缩略图网格 → 底部精度 */
        <div className="ccp__easing">
          <div className="ccp__pills" role="group" aria-label={t('curve.type')}>
            {EASING_TYPES.map((tp) => (
              <button
                key={tp}
                type="button"
                aria-pressed={config.type === tp}
                title={easingTypeLabel(tp)}
                className={`ccp__pill-btn${config.type === tp ? ' is-active' : ''}`}
                onClick={() => onChange({ ...config, type: tp })}
              >
                {easingTypeShort(tp)}
              </button>
            ))}
          </div>

          <div className="ccp__easing-grid" role="group" aria-label={t('curve.family')}>
            {EASING_FAMILIES.map((family) => {
              const label = easingFamilyLabel(family);
              const { primary, secondary } = splitBilingualLabel(label);
              const active = config.family === family;
              return (
                <button
                  key={family}
                  type="button"
                  aria-pressed={active}
                  title={label}
                  className={`ccp__easing-card${active ? ' is-active' : ''}`}
                  onClick={() => onChange({ ...config, family })}
                >
                  <MiniEasingSvg family={family} type={config.type} width={44} height={46} />
                  <span className="ccp__card-name">{primary}</span>
                  {secondary && <span className="ccp__card-sub">{secondary}</span>}
                </button>
              );
            })}
          </div>

          <div className="ccp__ctrl-row" title={t('curve.precision')}>
            <span className="ccp__ctrl-label">{t('curve.precisionShort')}</span>
            <PrecisionPills
              precision={config.precision}
              onSelect={(p) => onChange({ ...config, precision: p })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
