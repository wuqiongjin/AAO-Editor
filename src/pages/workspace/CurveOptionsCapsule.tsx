// 画布左上角的曲线选项胶囊（issue 177 Q15，票 179）：曲线持工具态时出现，显示当前配置摘要；
// 点开 = 四行表单，点外面 / Esc 收回，切走工具即消失，没有关闭钮。
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useUI } from '../../app/ProviderTree';
import { t } from '../../i18n';
import CurveConfigPanel from './CurveConfigPanel';
import { curveConfigSummary } from './curveLabels';
import './CurveOptionsCapsule.css';

export default function CurveOptionsCapsule() {
  const { armedTool, curveConfig, setCurveConfig } = useUI();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const visible = armedTool === 'curve';

  useEffect(() => {
    if (!open || !visible) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, visible]);

  if (!visible) return null;

  return (
    <div className={`coc${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="coc__pill"
        aria-label={t('curve.title')}
        aria-expanded={open}
        title={t('curve.title')}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="coc__tag">{t('tool.curve')}</span>
        <span className="coc__sum">{curveConfigSummary(curveConfig)}</span>
        <ChevronDown size={13} className="coc__chev" />
      </button>
      {open && (
        <div className="coc__body" role="group" aria-label={t('curve.title')}>
          <CurveConfigPanel config={curveConfig} onChange={setCurveConfig} />
        </div>
      )}
    </div>
  );
}
