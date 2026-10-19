// @vitest-environment jsdom
// 票 03：window error / unhandledrejection 接入 logger。
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '@/src/diagnostics/logger';
import { installGlobalErrorHandlers } from '@/src/diagnostics/globalErrorHandlers';

const AT = new Date('2026-10-19T09:00:00.000Z');

function silentLogger(writes: unknown[]) {
  return createLogger({
    now: () => AT,
    write: (payload) => writes.push(payload),
    console: { error() {}, warn() {}, info() {} },
  });
}

describe('票 03 · 全局未捕获 handler', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  it('派发 error 与 unhandledrejection 各记一条 [uncaught] error', () => {
    const writes: unknown[] = [];
    dispose = installGlobalErrorHandlers({ logger: silentLogger(writes) });

    window.dispatchEvent(new ErrorEvent('error', { message: 'script boom', error: new Error('script boom') }));
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.resolve(),
      reason: new Error('async boom'),
    }));

    expect(writes).toEqual([
      {
        level: 'error',
        module: '[uncaught]',
        message: 'script boom',
        extra: { message: 'script boom', stack: expect.any(String) },
        ts: '2026-10-19T09:00:00.000Z',
      },
      {
        level: 'error',
        module: '[uncaught]',
        message: 'async boom',
        extra: { message: 'async boom', stack: expect.any(String) },
        ts: '2026-10-19T09:00:00.000Z',
      },
    ]);
  });

  it('重复 install 不叠监听', () => {
    const writes: unknown[] = [];
    const log = silentLogger(writes);
    dispose = installGlobalErrorHandlers({ logger: log });
    installGlobalErrorHandlers({ logger: log });

    window.dispatchEvent(new ErrorEvent('error', { message: 'once', error: new Error('once') }));

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ level: 'error', module: '[uncaught]', message: 'once' });
  });
});
