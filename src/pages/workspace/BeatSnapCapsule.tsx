// 顶栏节拍吸附胶囊（issue 177 Q4 / Q5 / Q16，票 178）：胶囊显示「1/N」，滚轮步进，
// 点击弹出 4×3 预设网格 + 底部自定义输入。不设快捷键（177 Q7：细分是低频操作）。
import { useEffect, useRef, useState } from 'react';
import { Magnet } from 'lucide-react';
import { useUI } from '../../app/ProviderTree';
import { BEAT_SNAP_PRESETS, BEAT_SNAP_RANGE, parseCustomBeatSnap, stepBeatSnap } from '../../chart/editing/BeatSnap';
import { t } from '../../i18n';
import './BeatSnapCapsule.css';

export default function BeatSnapCapsule() {
  const { beatDisplay, setBeatDisplay } = useUI();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    setDraft('');
    setInvalid(false);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      pillRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const pick = (n: number) => {
    setBeatDisplay(n);
    close();
  };

  const submitCustom = () => {
    const n = parseCustomBeatSnap(draft);
    if (n === null) {
      setInvalid(true);
      return;
    }
    pick(n);
  };

  return (
    <div className="bsc" ref={rootRef}>
      <button
        ref={pillRef}
        type="button"
        className={`bsc__pill${open ? ' is-open' : ''}`}
        aria-label={t('workspace.beatSnap')}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('workspace.beatSnap.tooltip')}
        onClick={() => (open ? close() : setOpen(true))}
        onWheel={(e) => setBeatDisplay(stepBeatSnap(beatDisplay, e.deltaY < 0 ? 1 : -1))}
      >
        <Magnet size={12} className="bsc__icon" />
        <span className="bsc__val">1/{beatDisplay}</span>
      </button>

      {open && (
        <div className="bsc__pop" role="dialog" aria-label={t('workspace.beatSnap')}>
          <div className="bsc__title">{t('workspace.beatSnap')}</div>
          <div className="bsc__presets">
            {BEAT_SNAP_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                className={`bsc__chip${n === beatDisplay ? ' is-active' : ''}`}
                aria-pressed={n === beatDisplay}
                onClick={() => pick(n)}
              >
                1/{n}
              </button>
            ))}
          </div>
          <div className="bsc__custom">
            <span className="bsc__custom-label">{t('workspace.beatSnap.custom')}</span>
            <span className={`bsc__input${invalid ? ' is-invalid' : ''}`}>
              <span>1/</span>
              <input
                value={draft}
                inputMode="numeric"
                aria-label={t('workspace.beatSnap.customAria')}
                aria-invalid={invalid}
                placeholder={String(beatDisplay)}
                onChange={(e) => {
                  setDraft(e.target.value.replace(/[^\d]/g, ''));
                  setInvalid(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCustom();
                }}
              />
            </span>
            <span className="bsc__hint">
              {invalid
                ? t('workspace.beatSnap.customInvalid', { min: BEAT_SNAP_RANGE.min, max: BEAT_SNAP_RANGE.max })
                : t('workspace.beatSnap.customHint')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
