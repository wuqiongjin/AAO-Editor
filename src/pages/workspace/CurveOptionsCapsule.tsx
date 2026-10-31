// 画布左上角的曲线选项胶囊（issue 180 Q15，票 182）：曲线持工具态时出现，显示当前配置摘要；
// 点开 = 四行表单，点外面 / Esc 收回，切走工具即消失，没有关闭钮。
// 展开行为与片段粘贴胶囊共用 `useCanvasCapsule`，外壳样式共用 `CanvasCapsule.css`。
import { ChevronDown } from 'lucide-react';
import { useUI } from '../../app/ProviderTree';
import { t } from '../../i18n';
import CurveConfigPanel from './CurveConfigPanel';
import { curveConfigSummary } from './curveLabels';
import { useCanvasCapsule } from './useCanvasCapsule';
import './CanvasCapsule.css';
import './CurveOptionsCapsule.css';

export default function CurveOptionsCapsule() {
  const { armedTool, curveConfig, setCurveConfig } = useUI();
  const visible = armedTool === 'curve';
  const { open, toggle, rootRef, pillRef } = useCanvasCapsule(visible);

  if (!visible) return null;

  return (
    <div className={`ccap coc${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        ref={pillRef}
        type="button"
        className="ccap__pill"
        aria-label={t('curve.title')}
        aria-expanded={open}
        title={t('curve.title')}
        onClick={toggle}
      >
        <span className="ccap__tag">{t('tool.curve')}</span>
        <span className="ccap__sum">{curveConfigSummary(curveConfig)}</span>
        <ChevronDown size={13} className="ccap__chev" />
      </button>
      {open && (
        <div className="ccap__body coc__body" role="group" aria-label={t('curve.title')}>
          <CurveConfigPanel config={curveConfig} onChange={setCurveConfig} />
        </div>
      )}
    </div>
  );
}
