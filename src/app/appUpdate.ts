import { APP_VERSION } from './appVersion';
import { logger } from '../diagnostics/logger';
import { trail } from '../diagnostics/trail';
import { toastAppUpdateResult } from './appUpdateFeedback';

export type AppUpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'current' | 'error';
export type UpdateSource = 'github' | 'cnb';

export interface AppUpdateState {
  packaged: boolean;
  currentVersion: string;
  status: AppUpdateStatus;
  percent?: number;
  availableVersion?: string;
  releaseNotes?: string;
  errorMessage?: string;
  updateSource?: UpdateSource;
}

export const IDLE_APP_UPDATE: AppUpdateState = {
  packaged: false,
  currentVersion: APP_VERSION,
  status: 'idle',
  updateSource: 'github',
};

interface AppUpdateBridge {
  getState(): Promise<AppUpdateState>;
  check(): Promise<AppUpdateState>;
  install(): Promise<AppUpdateState>;
  setUpdateSource?(source: UpdateSource): Promise<AppUpdateState & { ok?: boolean }>;
  onEvent(cb: (state: AppUpdateState) => void): () => void;
}

export function getAppUpdateBridge(): AppUpdateBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { electronAPI?: { appUpdate?: AppUpdateBridge } }).electronAPI?.appUpdate;
}

type Listener = (state: AppUpdateState) => void;

let state: AppUpdateState = IDLE_APP_UPDATE;
let lastRaw: AppUpdateState = IDLE_APP_UPDATE;
const listeners = new Set<Listener>();
let silentCheck = false;

function publish(next: AppUpdateState) {
  state = next;
  listeners.forEach((fn) => fn(state));
}

function isQuietTerminal(status: AppUpdateStatus) {
  return status === 'error' || status === 'current';
}

/** 启动自动检查期间把「已是最新 / 失败」收成 idle（updater 常 error 事件 + check() 再抛一次）。 */
function applyUpdateState(next: AppUpdateState) {
  lastRaw = next;
  if (next.status === 'error') {
    logger.error('[app-update]', next.errorMessage ?? 'update failed');
    toastAppUpdateResult(next);
  }
  if (silentCheck && isQuietTerminal(next.status)) {
    publish({ ...next, status: 'idle', errorMessage: undefined });
    return;
  }
  publish(next);
}

export function getAppUpdateState(): AppUpdateState {
  return state;
}

export function subscribeAppUpdate(fn: Listener): () => void {
  listeners.add(fn);
  fn(state);
  return () => { listeners.delete(fn); };
}

/** 挂一次：拉快照 + 听主进程事件。无桥则保持浏览器默认（未打包 + APP_VERSION）。 */
export function connectAppUpdate(): () => void {
  const api = getAppUpdateBridge();
  if (!api) return () => {};
  const off = api.onEvent(applyUpdateState);
  void api.getState().then(applyUpdateState).catch(() => {});
  return off;
}

export async function checkAppUpdate(opts?: { silent?: boolean }): Promise<AppUpdateState> {
  const api = getAppUpdateBridge();
  if (!api) return state;
  silentCheck = !!opts?.silent;
  const t0 = Date.now();
  trail.record({ module: 'app-update', action: 'check-start' });
  try {
    const checked = await api.check();
    const raw = checked ?? lastRaw;
    const result = raw.status === 'error' ? 'fail' : raw.status === 'current' ? 'current' : 'ok';
    trail.record({
      module: 'app-update',
      action: 'check-end',
      result,
      durationMs: Date.now() - t0,
      ...(raw.availableVersion ? { meta: { availableVersion: raw.availableVersion } } : {}),
    });
    return raw;
  } catch (err) {
    trail.record({
      module: 'app-update',
      action: 'check-end',
      result: 'fail',
      durationMs: Date.now() - t0,
    });
    throw err;
  } finally {
    if (silentCheck) applyUpdateState(state);
    silentCheck = false;
  }
}

export async function setAppUpdateSource(source: UpdateSource): Promise<void> {
  const api = getAppUpdateBridge();
  if (!api?.setUpdateSource) return;
  const next = await api.setUpdateSource(source);
  applyUpdateState(next);
}

export async function installAppUpdate(): Promise<void> {
  const api = getAppUpdateBridge();
  if (!api) return;
  await api.install();
}
