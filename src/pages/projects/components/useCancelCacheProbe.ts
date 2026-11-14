import { useCallback, useEffect, useState } from 'react';

const DEFAULT_SLOW_AFTER_MS = 15_000;
const DEFAULT_CANCEL_AFTER_MS = 2_000;

export interface CancelCacheProbeOptions {
  slowAfterMs?: number;
  cancelAfterMs?: number;
}

export interface CancelCacheProbeState<T> {
  waitSlow: boolean;
  cachedReady: T | null;
  clearCached: () => void;
}

/**
 * 首屏空白加载时的慢速安抚 + 延迟显示「取消并读取本地缓存」探针（票 57）：
 * 满 cancelAfterMs 仍未结束加载时才向主进程发一次 cacheOnly 读取，避免正常快响应多打无谓 IPC。
 */
export function useCancelCacheProbe<T>(
  waitingBlank: boolean,
  probe: () => Promise<T | null>,
  options: CancelCacheProbeOptions = {},
): CancelCacheProbeState<T> {
  const slowAfterMs = options.slowAfterMs ?? DEFAULT_SLOW_AFTER_MS;
  const cancelAfterMs = options.cancelAfterMs ?? DEFAULT_CANCEL_AFTER_MS;
  const [waitSlow, setWaitSlow] = useState(false);
  const [cachedReady, setCachedReady] = useState<T | null>(null);

  useEffect(() => {
    setWaitSlow(false);
    setCachedReady(null);
    if (!waitingBlank) return;
    let cancelled = false;
    const slowTimer = setTimeout(() => setWaitSlow(true), slowAfterMs);
    const cancelTimer = setTimeout(() => {
      void probe().then((cached) => {
        if (!cancelled && cached) setCachedReady(cached);
      });
    }, cancelAfterMs);
    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
      clearTimeout(cancelTimer);
    };
  }, [waitingBlank, probe, slowAfterMs, cancelAfterMs]);

  const clearCached = useCallback(() => setCachedReady(null), []);
  return {
    waitSlow,
    cachedReady,
    clearCached,
  };
}
