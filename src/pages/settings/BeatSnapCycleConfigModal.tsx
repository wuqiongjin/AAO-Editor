import { useState, Fragment, type KeyboardEvent } from 'react';
import { ArrowRight, Info, RotateCw, X } from 'lucide-react';
import Dialog from '../../ui/Dialog';
import ActionBtn from '../../ui/ActionBtn';
import {
  BEAT_SNAP_PRESETS,
  DEFAULT_BEAT_SNAP_CYCLE_LIST,
  normalizeBeatSnapCycleList,
  parseCustomBeatSnap,
} from '../../chart/editing/BeatSnap';
import { useConfig } from '../../app/ProviderTree';
import { t } from '../../i18n';
import './BeatSnapCycleConfigModal.css';

export interface BeatSnapCycleConfigModalProps {
  onClose: () => void;
}

export default function BeatSnapCycleConfigModal({ onClose }: BeatSnapCycleConfigModalProps) {
  const { settings, setBeatSnapCycleList } = useConfig();
  const cycleList = settings.beatSnapCycleList;
  const [draft, setDraft] = useState('');

  const togglePreset = (preset: number) => {
    if (cycleList.includes(preset)) {
      setBeatSnapCycleList(cycleList.filter((v) => v !== preset));
    } else {
      setBeatSnapCycleList(normalizeBeatSnapCycleList([...cycleList, preset]));
    }
  };

  const handleAddCustom = () => {
    const val = parseCustomBeatSnap(draft);
    if (val !== null) {
      setBeatSnapCycleList(normalizeBeatSnapCycleList([...cycleList, val]));
      setDraft('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddCustom();
    }
  };

  const handleRemove = (val: number) => {
    setBeatSnapCycleList(cycleList.filter((v) => v !== val));
  };

  const handleResetDefaults = () => {
    setBeatSnapCycleList([...DEFAULT_BEAT_SNAP_CYCLE_LIST]);
  };

  return (
    <Dialog
      title={t('shortcuts.cycleModal.title')}
      hint={t('shortcuts.cycleModal.hint')}
      onClose={onClose}
      size="md"
      footer={(
        <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between' }}>
          <ActionBtn onClick={handleResetDefaults}>
            {t('shortcuts.cycleModal.resetDefault')}
          </ActionBtn>
          <ActionBtn variant="primary" onClick={onClose}>
            {t('shortcuts.cycleModal.done')}
          </ActionBtn>
        </div>
      )}
    >
      {/* 顶部：当前生效循环序列可视化流 */}
      <div className="cycle-modal-section">
        <div className="cycle-section-head">
          <h4>{t('shortcuts.cycleModal.sequenceTitle')}</h4>
          <span className="cycle-badge" aria-hidden="true">
            <RotateCw size={11} />
            <span>{t('shortcuts.cycleModal.loopBadge')}</span>
          </span>
        </div>
        {cycleList.length > 0 ? (
          <div className="cycle-sequence-flow" role="list" aria-label={t('shortcuts.cycleModal.sequenceTitle')}>
            {cycleList.map((val, idx) => (
              <Fragment key={val}>
                {idx > 0 && <ArrowRight size={13} className="cycle-flow-arrow" aria-hidden="true" />}
                <span className="cycle-flow-item" role="listitem">
                  <span className="cycle-flow-item__label">{`1/${val}`}</span>
                  <button
                    type="button"
                    className="cycle-flow-item__remove"
                    onClick={() => handleRemove(val)}
                    title={t('shortcuts.cycleModal.removeCustom', { val: String(val) })}
                    aria-label={t('shortcuts.cycleModal.removeCustom', { val: String(val) })}
                  >
                    <X size={11} />
                  </button>
                </span>
              </Fragment>
            ))}
          </div>
        ) : (
          <div className="cycle-sequence-empty" role="status">
            <Info size={14} />
            <span>{t('shortcuts.cycleModal.sequenceEmpty')}</span>
          </div>
        )}
      </div>

      {/* 中部：快捷预设档位 */}
      <div className="cycle-modal-section">
        <h4>{t('shortcuts.cycleModal.presetsTitle')}</h4>
        <div className="cycle-chips-grid" role="group" aria-label={t('shortcuts.cycleModal.presetsTitle')}>
          {BEAT_SNAP_PRESETS.map((preset) => {
            const active = cycleList.includes(preset);
            return (
              <button
                key={preset}
                type="button"
                className={`cycle-chip${active ? ' is-active' : ''}`}
                aria-pressed={active}
                onClick={() => togglePreset(preset)}
              >
                {`1/${preset}`}
              </button>
            );
          })}
        </div>
      </div>

      {/* 底部：添加自定义细分（添加后直接升序进入上方循环序列） */}
      <div className="cycle-modal-section">
        <h4>{t('shortcuts.cycleModal.customTitle')}</h4>
        <div className="cycle-custom-input-row">
          <input
            type="number"
            min={1}
            max={192}
            value={draft}
            placeholder={t('shortcuts.cycleModal.customPlaceholder')}
            aria-label={t('shortcuts.cycleModal.customTitle')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <ActionBtn onClick={handleAddCustom}>
            {t('shortcuts.cycleModal.customAdd')}
          </ActionBtn>
        </div>
      </div>
    </Dialog>
  );
}
