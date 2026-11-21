// 画布左上角的曲线选项胶囊（issue 180 Q15，票 182，issue 235 迷你 SVG 预览）：曲线持工具态时出现，显示实时图标与摘要；
// 点胶囊本体开合（整颗可点）；展开且为形状模板时顶栏只留主名 + 右侧「档位 | 自由」；折叠态拼回完整摘要。
// 展开行为与片段粘贴胶囊共用 `useCanvasCapsule`，外壳样式共用 `CanvasCapsule.css`。
import { memo, type ReactNode, type RefObject } from 'react';
import { ChevronDown } from 'lucide-react';
import { useUI } from '../../app/ProviderTree';
import { shapeTemplateById } from '../../chart/editing/ShapeTemplates';
import type { CurveConfig } from '../../chart/editing/CurveTool';
import { t } from '../../i18n';
import CurveConfigPanel from './CurveConfigPanel';
import { MiniEasingSvg, MiniTemplateSvg } from './CurveMiniSvg';
import { curveConfigSummary } from './curveLabels';
import { useCanvasCapsule } from './useCanvasCapsule';
import './CanvasCapsule.css';
import './CurveOptionsCapsule.css';

function CapsuleToggle({
  open,
  className,
  pillRef,
  onToggle,
  children,
}: {
  open: boolean;
  className?: string;
  pillRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      ref={pillRef}
      type="button"
      className={className ?? 'ccap__pill'}
      aria-label={t('curve.title')}
      aria-expanded={open}
      title={t('curve.title')}
      onClick={onToggle}
    >
      {children}
    </button>
  );
}

function TemplateParamModeSeg({
  mode,
  onChange,
}: {
  mode: 'preset' | 'free';
  onChange: (next: CurveConfig['templateParamMode']) => void;
}) {
  const isFree = mode === 'free';
  return (
    <div className="coc__mode-seg" role="group" aria-label={t('curve.paramMode')}>
      <button
        type="button"
        className={`coc__mode-btn${!isFree ? ' is-active' : ''}`}
        aria-pressed={!isFree}
        title={t('curve.paramModeHint')}
        onClick={() => onChange('preset')}
      >
        {t('curve.paramMode.preset')}
      </button>
      <button
        type="button"
        className={`coc__mode-btn${isFree ? ' is-active' : ''}`}
        aria-pressed={isFree}
        title={t('curve.paramModeHint')}
        onClick={() => onChange('free')}
      >
        {t('curve.paramMode.free')}
      </button>
    </div>
  );
}

export default memo(function CurveOptionsCapsule() {
  const { armedTool, curveConfig, setCurveConfig } = useUI();
  const visible = armedTool === 'curve';
  const { open, toggle, rootRef, pillRef } = useCanvasCapsule(visible);

  if (!visible) return null;

  const activeTemplate = curveConfig.templateId ? shapeTemplateById(curveConfig.templateId) : undefined;
  const openOnTemplate = open && activeTemplate !== undefined;
  const paramMode = curveConfig.templateParamMode ?? 'preset';

  const pillInner = (
    <>
      <span className="ccap__tag">{t('tool.curve')}</span>
      <span className="coc__glyph">
        {activeTemplate ? (
          <MiniTemplateSvg
            template={activeTemplate}
            width={20}
            height={20}
            mirrored={!!curveConfig.templateMirrored}
            ampScale={curveConfig.templateScale ?? 1}
            densityScale={curveConfig.templateDensity ?? 1}
            extra={curveConfig.templateExtras?.[activeTemplate.id]}
          />
        ) : (
          <MiniEasingSvg
            family={curveConfig.family}
            type={curveConfig.type}
            width={20}
            height={20}
          />
        )}
      </span>
      <span className="ccap__sum">{curveConfigSummary(curveConfig, { compact: openOnTemplate })}</span>
      <ChevronDown size={13} className="ccap__chev" />
    </>
  );

  return (
    <div className={`ccap coc${open ? ' is-open' : ''}`} ref={rootRef}>
      {open ? (
        <div className="coc__head">
          <CapsuleToggle open className="ccap__pill coc__pill-main" pillRef={pillRef} onToggle={toggle}>
            {pillInner}
          </CapsuleToggle>
          {openOnTemplate && (
            <TemplateParamModeSeg
              mode={paramMode}
              onChange={(templateParamMode) => setCurveConfig({ ...curveConfig, templateParamMode })}
            />
          )}
        </div>
      ) : (
        <CapsuleToggle open={false} pillRef={pillRef} onToggle={toggle}>
          {pillInner}
        </CapsuleToggle>
      )}
      {open && (
        <div className="ccap__body coc__body" role="group" aria-label={t('curve.title')}>
          <CurveConfigPanel config={curveConfig} onChange={setCurveConfig} />
        </div>
      )}
    </div>
  );
});
