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
  // 重复 install（如热更新 / 测试里换 logger）：先拆旧的再挂新的，
  // 既不叠监听，也不把新 logger 静默丢掉。
  dispose?.();

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

  let removed = false;
  const self = () => {
    // 幂等：同一代重复 dispose 直接返回 —— 不二次摘监听；换代之后旧世代早已
    // 摘掉自己的监听，重复调用也不会把模块级 dispose 置空（那会让在任一代
    // 失去被卸载的入口，监听泄漏）。
    if (removed) return;
    removed = true;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    dispose = null;
  };
  dispose = self;
  return self;
}
