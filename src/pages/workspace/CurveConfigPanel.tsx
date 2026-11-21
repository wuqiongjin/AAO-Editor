// 曲线工具配置面板（issue 114 抽出；issue 235 图形化选型；issue 241 连续参数；展开态档位/自由在胶囊顶栏，分类为下划线 Tab）。
import { useRef, useState } from 'react';
import {
  CURVE_PRECISIONS, EASING_FAMILIES, EASING_TYPES,
  type CurvePrecision, type EasingFamily, type EasingType,
} from '../../chart/editing/Easing';
import {
  SHAPE_TEMPLATES,
  TEMPLATE_CATEGORIES,
  TEMPLATE_DENSITIES,
  TEMPLATE_DENSITY_RANGE,
  TEMPLATE_SCALES,
  TEMPLATE_SCALE_RANGE,
  clampTemplateNumber,
  resolveTemplateExtra,
  shapeTemplateById,
  stripDefaultTemplateExtra,
  templateSupportsAmplitude,
  templateSupportsMirror,
  type TemplateCategory,
  type TemplateExtraParamSpec,
  type TemplateNumberRange,
} from '../../chart/editing/ShapeTemplates';
import type { TemplateExtraValue } from '../../chart/types';
import type { CurveConfig } from '../../chart/editing/CurveTool';
import { t, type MessageKey } from '../../i18n';
import { MiniEasingSvg, MiniTemplateSvg } from './CurveMiniSvg';
import { formatTemplateNumber, shapeLabel, shapeTooltip } from './curveLabels';
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
  const [catFilter, setCatFilter] = useState<'all' | TemplateCategory>('all');
  const lastTemplateIdRef = useRef<string>('s-curve');
  if (config.templateId && shapeTemplateById(config.templateId)) {
    lastTemplateIdRef.current = config.templateId;
  }

  const currentTemplate = config.templateId ? shapeTemplateById(config.templateId) : undefined;
  const templateActive = currentTemplate !== undefined;
  const isFreeMode = config.templateParamMode === 'free';
  const mirrored = !!config.templateMirrored;
  const ampScale = config.templateScale ?? 1;
  const densityScale = config.templateDensity ?? 1;
  const showMirror = currentTemplate ? templateSupportsMirror(currentTemplate) : false;
  const showAmplitude = currentTemplate ? templateSupportsAmplitude(currentTemplate) : false;
  const resolvedExtra = currentTemplate
    ? resolveTemplateExtra(currentTemplate, config.templateExtras?.[currentTemplate.id])
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

  const filteredTemplates = SHAPE_TEMPLATES.filter(
    (tp) => catFilter === 'all' || tp.category === catFilter,
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
          onClick={() => onChange({ ...config, templateId: currentTemplate?.id ?? lastTemplateIdRef.current })}
        >
          {t('curve.mode.template')}
        </button>
      </div>

      {templateActive && currentTemplate ? (
        <>
          <div className="ccp__tabs" role="tablist" aria-label={t('curve.templateShort')}>
            {(['all', ...TEMPLATE_CATEGORIES] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={catFilter === cat}
                className={`ccp__tab${catFilter === cat ? ' is-active' : ''}`}
                onClick={() => setCatFilter(cat)}
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
                  onClick={() => onChange({ ...config, templateId: tp.id })}
                >
                  <MiniTemplateSvg
                    template={tp}
                    width={46}
                    height={48}
                    mirrored={mirrored}
                    ampScale={ampScale}
                    densityScale={densityScale}
                    extra={config.templateExtras?.[tp.id]}
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
                onChange={(val) => updateExtra(spec.key, val)}
              />
            ))}
          </div>
        </>
      ) : (
        /* 缓动函数视图：实时轨迹预览 + 族/型下拉 + 精度胶囊 */
        <div className="ccp__easing-box">
          <div className="ccp__easing-preview">
            <MiniEasingSvg family={config.family} type={config.type} width={76} height={96} />
          </div>
          <div className="ccp__easing-form">
            <label className="ccp__row" title={t('curve.family')}>
              <span className="ccp__label">{t('curve.family')}</span>
              <select
                className="ccp__select"
                value={config.family}
                onChange={(e) => onChange({ ...config, family: e.target.value as EasingFamily })}
              >
                {EASING_FAMILIES.map((f) => (
                  <option key={f} value={f}>{t(`easing.family.${f}` as MessageKey)}</option>
                ))}
              </select>
            </label>
            <label className="ccp__row" title={t('curve.type')}>
              <span className="ccp__label">{t('curve.type')}</span>
              <select
                className="ccp__select"
                value={config.type}
                onChange={(e) => onChange({ ...config, type: e.target.value as EasingType })}
              >
                {EASING_TYPES.map((tp) => (
                  <option key={tp} value={tp}>{t(`easing.type.${tp}` as MessageKey)}</option>
                ))}
              </select>
            </label>
            <div className="ccp__row" title={t('curve.precision')}>
              <span className="ccp__label">{t('curve.precisionShort')}</span>
              <PrecisionPills
                precision={config.precision}
                onSelect={(p) => onChange({ ...config, precision: p })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
