import { useEffect, useRef, useState } from 'react';
import { useConfig } from './ProviderTree';
import { t } from '../i18n';
import ActionBtn from '../ui/ActionBtn';
import Dialog from '../ui/Dialog';
import { showToast } from '../ui/Toast';
import {
  checkAppUpdate,
  connectAppUpdate,
  downloadAppUpdate,
  feedNeedsDownload,
  getAppUpdateState,
  installAppUpdate,
  subscribeAppUpdate,
  type AppUpdateState,
} from './appUpdate';
import ReleaseNotes from './ReleaseNotes';

function shouldPrompt(state: AppUpdateState): boolean {
  if (feedNeedsDownload(state)) return true;
  return state.local === 'ready' && state.remote === 'available' && !feedNeedsDownload(state);
}

/** 应用更新宿主：启动自动检查 + 发现新版确认下载 + 下完后的重启确认（ADR-0021）。挂在应用壳一次。 */
export default function AppUpdateHost() {
  const { settings } = useConfig();
  const [state, setState] = useState<AppUpdateState>(getAppUpdateState);
  const [promptOpen, setPromptOpen] = useState(false);
  const didLaunchAutoCheck = useRef(false);
  const dismissedCycle = useRef<number | null>(null);

  useEffect(() => connectAppUpdate(), []);
  useEffect(() => subscribeAppUpdate(setState), []);

  useEffect(() => {
    if (!shouldPrompt(state)) return;
    if (dismissedCycle.current != null && dismissedCycle.current === state.cycle) return;
    setPromptOpen(true);
  }, [state.cycle, state.remote, state.local, state.availableVersion, state.readyVersion]);

  useEffect(() => {
    if (!state.packaged || didLaunchAutoCheck.current) return;
    didLaunchAutoCheck.current = true;
    if (!settings.autoCheck) return;
    void checkAppUpdate({ silent: true });
  }, [state.packaged, settings.autoCheck]);

  if (!promptOpen) return null;
  if (state.local !== 'downloading' && !shouldPrompt(state) && state.local !== 'ready') return null;

  const notes = state.releaseNotes?.trim();
  const later = () => {
    dismissedCycle.current = state.cycle ?? null;
    setPromptOpen(false);
  };
  const needsDownload = feedNeedsDownload(state);
  const downloading = state.local === 'downloading';
  const ready = state.local === 'ready' && !needsDownload && !downloading;
  const title = ready ? t('update.prompt.title') : t('update.offer.title');
  const description = downloading
    ? t('update.status.downloading', { percent: Math.round(state.percent ?? 0) })
    : ready
      ? t('update.prompt.body', {
        current: state.currentVersion,
        next: state.readyVersion ?? state.availableVersion ?? '',
      })
      : t('update.offer.body', {
        current: state.currentVersion,
        next: state.availableVersion ?? '',
      });

  return (
    <Dialog
      role="alertdialog"
      size="md"
      title={title}
      description={description}
      onClose={later}
      closeOnScrim={false}
      footer={(
        <>
          <ActionBtn onClick={later}>{t('update.later')}</ActionBtn>
          {ready ? (
            <ActionBtn variant="primary" autoFocus onClick={() => void installAppUpdate()}>
              {t('update.restart')}
            </ActionBtn>
          ) : (
            <ActionBtn
              variant="primary"
              autoFocus={!downloading}
              disabled={downloading}
              onClick={() => {
                setPromptOpen(false);
                showToast(t('update.download.started'), 'info');
                void downloadAppUpdate();
              }}
            >
              {t('update.download')}
            </ActionBtn>
          )}
        </>
      )}
    >
      {notes ? <ReleaseNotes markdown={notes} /> : undefined}
    </Dialog>
  );
}
