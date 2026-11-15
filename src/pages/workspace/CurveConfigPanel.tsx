// 曲线工具配置面板（issue 114 抽出；issue 235 升级为图形化选型：缓动函数 | 形状模板两段切换 + 4 列 SVG 网格 + 偏向/幅度/段密胶囊）。
import { useRef, useState } from 'react';
import {
  CURVE_PRECISIONS, EASING_FAMILIES, EASING_TYPES,
  type CurvePrecision, type EasingFamily, type EasingType,
} from '../../chart/editing/Easing';
import {
  SHAPE_TEMPLATES,
  TEMPLATE_CATEGORIES,
  TEMPLATE_DENSITIES,
  TEMPLATE_SCALES,
  shapeTemplateById,
  type TemplateCategory,
} from '../../chart/editing/ShapeTemplates';
import type { CurveConfig } from '../../chart/editing/CurveTool';
import { t, type MessageKey } from '../../i18n';
import { MiniEasingSvg, MiniTemplateSvg } from './CurveMiniSvg';
import { shapeLabel, shapeTooltip } from './curveLabels';
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
  const mirrored = !!config.templateMirrored;
  const ampScale = config.templateScale ?? 1;
  const densityScale = config.templateDensity ?? 1;

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
          {/* 分类筛选 */}
          <div className="ccp__cats" role="group" aria-label={t('curve.templateShort')}>
            {(['all', ...TEMPLATE_CATEGORIES] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                aria-pressed={catFilter === cat}
                className={`ccp__cat${catFilter === cat ? ' is-active' : ''}`}
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
                  />
                  <span className="ccp__card-name">{name}</span>
                </button>
              );
            })}
          </div>

          {/* 底部控制区：偏向 + 幅度 + 上下文第 3 行（段密 / 精度） */}
          <div className="ccp__controls">
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

            <div className="ccp__ctrl-row" title={t('curve.scaleHint')}>
              <span className="ccp__ctrl-label">{t('curve.scale')}</span>
              <div className="ccp__pills" role="group" aria-label={t('curve.scale')}>
                {TEMPLATE_SCALES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={ampScale === s}
                    title={t(`curve.scaleTip.${s}` as MessageKey)}
                    className={`ccp__pill-btn${ampScale === s ? ' is-active' : ''}`}
                    onClick={() => onChange({ ...config, templateScale: s })}
                  >
                    {t(`curve.scale.${s}` as MessageKey)}
                  </button>
                ))}
              </div>
            </div>

            {currentTemplate.adjustableDensity ? (
              <div className="ccp__ctrl-row" title={t('curve.densityHint')}>
                <span className="ccp__ctrl-label">{t('curve.density')}</span>
                <div className="ccp__pills" role="group" aria-label={t('curve.density')}>
                  {TEMPLATE_DENSITIES.map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={densityScale === d}
                      title={t(`curve.densityTip.${d}` as MessageKey)}
                      className={`ccp__pill-btn${densityScale === d ? ' is-active' : ''}`}
                      onClick={() => onChange({ ...config, templateDensity: d })}
                    >
                      {t(`curve.density.${d}` as MessageKey)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="ccp__ctrl-row" title={t('curve.precision')}>
                <span className="ccp__ctrl-label">{t('curve.precisionShort')}</span>
                <PrecisionPills
                  precision={config.precision}
                  onSelect={(p) => onChange({ ...config, precision: p })}
                />
              </div>
            )}
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
