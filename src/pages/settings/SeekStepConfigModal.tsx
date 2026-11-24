import { useEffect, useState } from 'react';
import Dialog from '../../ui/Dialog';
import ActionBtn from '../../ui/ActionBtn';
import { useConfig } from '../../app/ProviderTree';
import {
  DEFAULT_SEEK_STEP_SECONDS,
  normalizeSeekStepSeconds,
} from '../../settings/AppSettings';
import { t } from '../../i18n';

export interface SeekStepConfigModalProps {
  onClose: () => void;
}

function formatStep(value: number): string {
  return normalizeSeekStepSeconds(value).toFixed(1);
}

function StepField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(formatStep(value));
  useEffect(() => { setDraft(formatStep(value)); }, [value]);

  const commit = () => {
    const next = normalizeSeekStepSeconds(Number(draft));
    onCommit(next);
    setDraft(formatStep(next));
  };

  return (
    <label className="dialog-field">
      <span>{label}</span>
      <input
        type="number"
        min={0.1}
        max={10}
        step={0.1}
        value={draft}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}

export default function SeekStepConfigModal({ onClose }: SeekStepConfigModalProps) {
  const { settings, setSeekStepSeconds } = useConfig();

  const handleResetDefaults = () => {
    setSeekStepSeconds({ back: DEFAULT_SEEK_STEP_SECONDS, forward: DEFAULT_SEEK_STEP_SECONDS });
  };

  return (
    <Dialog
      title={t('shortcuts.seekStep.modal.title')}
      hint={t('shortcuts.seekStep.modal.hint')}
      onClose={onClose}
      size="sm"
      footer={(
        <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between' }}>
          <ActionBtn onClick={handleResetDefaults}>
            {t('shortcuts.seekStep.modal.resetDefault')}
          </ActionBtn>
          <ActionBtn variant="primary" onClick={onClose}>
            {t('shortcuts.seekStep.modal.done')}
          </ActionBtn>
        </div>
      )}
    >
      <div className="dialog-field-row">
        <StepField
          label={t('shortcuts.seekStep.modal.back')}
          value={settings.seekStepBackSeconds}
          onCommit={(back) => setSeekStepSeconds({ back })}
        />
        <StepField
          label={t('shortcuts.seekStep.modal.forward')}
          value={settings.seekStepForwardSeconds}
          onCommit={(forward) => setSeekStepSeconds({ forward })}
        />
      </div>
    </Dialog>
  );
}
