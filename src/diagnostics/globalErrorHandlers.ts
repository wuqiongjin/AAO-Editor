/**
 * 渲染进程未捕获错误接入 logger（ADR-0019 §5 / 票 03）。
 * 只记日志，不 preventDefault。
 */
import { logger, type Logger } from './logger';

let dispose: (() => void) | null = null;

function reasonMessage(reason: unknown, fallback: string): string {
  if (reason instanceof Error) return reason.message || fallback;
  if (typeof reason === 'string' && reason) return reason;
  return fallback;
}

export function installGlobalErrorHandlers(deps?: {
  logger?: Pick<Logger, 'error'>;
}): () => void {
  if (dispose) return dispose;

  const log = deps?.logger ?? logger;

  const onError = (event: ErrorEvent) => {
    const extra = event.error ?? event.message;
    log.error('[uncaught]', reasonMessage(event.error, event.message || 'window error'), extra);
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    log.error('[uncaught]', reasonMessage(event.reason, 'unhandledrejection'), event.reason);
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  dispose = () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    dispose = null;
  };
  return dispose;
}
