import { useEffect, useRef, useState } from 'react';
import { useConfig } from './ProviderTree';
import { t } from '../i18n';
import ActionBtn from '../ui/ActionBtn';
import Dialog from '../ui/Dialog';
import {
  checkAppUpdate,
  connectAppUpdate,
  getAppUpdateState,
  installAppUpdate,
  subscribeAppUpdate,
  type AppUpdateState,
} from './appUpdate';

/** 应用更新宿主：启动自动检查 + 下完后的重启确认（ADR-0021）。挂在应用壳一次。 */
export default function AppUpdateHost() {
  const { settings } = useConfig();
  const [state, setState] = useState<AppUpdateState>(getAppUpdateState);
  const [promptOpen, setPromptOpen] = useState(false);
  const didLaunchAutoCheck = useRef(false);

  useEffect(() => connectAppUpdate(), []);
  useEffect(() => subscribeAppUpdate(setState), []);

  useEffect(() => {
    if (state.status === 'ready') setPromptOpen(true);
  }, [state.status]);

  useEffect(() => {
    if (!state.packaged || didLaunchAutoCheck.current) return;
    didLaunchAutoCheck.current = true;
    if (!settings.autoCheck) return;
    void checkAppUpdate({ silent: true });
  }, [state.packaged, settings.autoCheck]);

  if (!promptOpen || state.status !== 'ready') return null;

  const notes = state.releaseNotes?.trim();

  return (
    <Dialog
      role="alertdialog"
      size="sm"
      title={t('update.prompt.title')}
      description={t('update.prompt.body', {
        current: state.currentVersion,
        next: state.availableVersion ?? '',
      })}
      onClose={() => setPromptOpen(false)}
      footer={(
        <>
          <ActionBtn onClick={() => setPromptOpen(false)}>{t('update.later')}</ActionBtn>
          <ActionBtn variant="primary" autoFocus onClick={() => void installAppUpdate()}>
            {t('update.restart')}
          </ActionBtn>
        </>
      )}
    >
      {notes || undefined}
    </Dialog>
  );
}
