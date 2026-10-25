import { t } from '../i18n';
import { showToast } from '../ui/Toast';
import { classifyUpdateFailure } from './updateFailure';
import type { AppUpdateState, UpdateSource } from './appUpdate';

export function otherUpdateSourceName(source: UpdateSource | undefined): string {
  return source === 'cnb' ? t('update.source.github') : t('update.source.cnb');
}

export function updateErrorToastMessage(state: AppUpdateState): string {
  const kind = classifyUpdateFailure(state.errorMessage);
  if (kind === 'checksum') return t('update.status.error.checksum');
  if (kind === 'disk') return t('update.status.error.disk');
  if (kind === 'permission') return t('update.status.error.permission');
  return t('update.status.error.network', { other: otherUpdateSourceName(state.updateSource) });
}

export function toastAppUpdateResult(state: AppUpdateState, opts?: { silent?: boolean }): void {
  if (state.status === 'error') {
    showToast(updateErrorToastMessage(state), 'danger');
    return;
  }
  if (!opts?.silent && state.status === 'current') {
    showToast(t('update.status.current'), 'success');
  }
}
