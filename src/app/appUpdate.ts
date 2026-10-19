import { APP_VERSION } from './appVersion';
import { logger } from '../diagnostics/logger';

export type AppUpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'current' | 'error';

export interface AppUpdateState {
  packaged: boolean;
  currentVersion: string;
  status: AppUpdateStatus;
  percent?: number;
  availableVersion?: string;
  releaseNotes?: string;
  errorMessage?: string;
}

export const IDLE_APP_UPDATE: AppUpdateState = {
  packaged: false,
  currentVersion: APP_VERSION,
  status: 'idle',
};

interface AppUpdateBridge {
  getState(): Promise<AppUpdateState>;
  check(): Promise<AppUpdateState>;
  install(): Promise<AppUpdateState>;
  onEvent(cb: (state: AppUpdateState) => void): () => void;
}

export function getAppUpdateBridge(): AppUpdateBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { electronAPI?: { appUpdate?: AppUpdateBridge } }).electronAPI?.appUpdate;
}

type Listener = (state: AppUpdateState) => void;

let state: AppUpdateState = IDLE_APP_UPDATE;
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
  if (next.status === 'error') {
    logger.error('[app-update]', next.errorMessage ?? 'update failed');
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

export async function checkAppUpdate(opts?: { silent?: boolean }): Promise<void> {
  const api = getAppUpdateBridge();
  if (!api) return;
  silentCheck = !!opts?.silent;
  try {
    await api.check();
  } finally {
    if (silentCheck) applyUpdateState(state);
    silentCheck = false;
  }
}

export async function installAppUpdate(): Promise<void> {
  const api = getAppUpdateBridge();
  if (!api) return;
  await api.install();
}
