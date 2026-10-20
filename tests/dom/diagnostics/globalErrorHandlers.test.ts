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

  it('换 logger 重复 install：旧监听被拆掉，错误只进新 logger', () => {
    const first: unknown[] = [];
    const second: unknown[] = [];
    dispose = installGlobalErrorHandlers({ logger: silentLogger(first) });
    dispose = installGlobalErrorHandlers({ logger: silentLogger(second) });

    window.dispatchEvent(new ErrorEvent('error', { message: 'swapped', error: new Error('swapped') }));

    expect(first).toHaveLength(0);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ level: 'error', module: '[uncaught]', message: 'swapped' });
  });

  it('换代后调用旧 dispose：只拆自己，不动在任监听', () => {
    const first: unknown[] = [];
    const second: unknown[] = [];
    const disposeA = installGlobalErrorHandlers({ logger: silentLogger(first) });
    dispose = installGlobalErrorHandlers({ logger: silentLogger(second) });
    disposeA(); // 旧世代：已随换代拆掉，重复调用是 no-op，且不得动在任一代

    window.dispatchEvent(new ErrorEvent('error', { message: 'still-live', error: new Error('still-live') }));
    expect(second).toHaveLength(1);

    dispose?.();
    // 全拆干净后没有监听记日志（不带 error 对象派发：无用户监听时 vitest 会把它当未捕获异常）
    window.dispatchEvent(new ErrorEvent('error', { message: 'gone' }));
    expect(second).toHaveLength(1);
  });
});
