// 票 07：可用性状态机与降级矩阵（ADR-0011 §1：静态演示版 / 离线不白屏、不循环报错）。
import { describe, expect, it, vi } from 'vitest';
import {
  capabilitiesFor,
  createAvailabilityMonitor,
  type CommunityAvailabilityState,
} from '@/src/community/availability';
import { CommunityError, isOfflineError, type CommunityErrorKind } from '@/src/community/transport';

function errorOf(kind: CommunityErrorKind, httpStatus?: number): CommunityError {
  return new CommunityError(`失败（${kind}）`, { kind, message: `失败（${kind}）`, httpStatus });
}

const state = (status: CommunityAvailabilityState['status']): CommunityAvailabilityState => ({
  status,
  checkedAt: status === 'online' || status === 'offline' ? 1 : null,
});

describe('票 07 · 没有出口就是 unsupported（静态演示版）', () => {
  it('初始即 unsupported，且 check() 不发任何探测', async () => {
    const probe = vi.fn(async () => undefined);
    const monitor = createAvailabilityMonitor({ supported: false, probe });

    expect(monitor.getState()).toEqual({ status: 'unsupported', checkedAt: null });
    await expect(monitor.check()).resolves.toEqual({ status: 'unsupported', checkedAt: null });
    expect(probe).not.toHaveBeenCalled();
  });

  it('真实请求的成败回报也不会把它翻成 online（这台机器根本没有出口）', () => {
    const monitor = createAvailabilityMonitor({ supported: false });
    monitor.reportSuccess();
    monitor.reportFailure(errorOf('offline'));
    expect(monitor.getState().status).toBe('unsupported');
  });

  it('降级矩阵：读也拦掉（该能力根本不提供），不是只灰写能力', () => {
    expect(capabilitiesFor(state('unsupported'), { signedIn: true })).toEqual({
      read: false,
      write: false,
      block: 'unsupported-runtime',
    });
  });
});

describe('票 07 · 探测与回报', () => {
  it('没探过 = unknown：乐观放读，写等会话', () => {
    const monitor = createAvailabilityMonitor({ supported: true });
    expect(monitor.getState().status).toBe('unknown');
    expect(capabilitiesFor(state('unknown'), { signedIn: false })).toEqual({
      read: true,
      write: false,
      block: 'signed-out',
    });
  });

  it('check() 探一次：成功 = online（记下时刻），失败 = 按错误域判离线', async () => {
    const now = vi.fn(() => 1234);
    const online = createAvailabilityMonitor({ supported: true, probe: async () => ({}), now });
    await online.check();
    expect(online.getState()).toEqual({ status: 'online', checkedAt: 1234 });

    for (const kind of ['offline', 'timeout'] as const) {
      const monitor = createAvailabilityMonitor({
        supported: true,
        probe: async () => {
          throw errorOf(kind);
        },
        now,
      });
      await monitor.check();
      expect(monitor.getState()).toEqual({ status: 'offline', checkedAt: 1234 });
    }
  });

  it('平台答了话（限流 / 未授权 / 响应非法）就算在线 —— 离线只认「连不上 / 超时」', async () => {
    expect(isOfflineError(errorOf('offline'))).toBe(true);
    expect(isOfflineError(errorOf('timeout'))).toBe(true);
    expect(isOfflineError(errorOf('rate-limited', 429))).toBe(false);
    expect(isOfflineError(errorOf('unauthorized', 401))).toBe(false);
    expect(isOfflineError(new Error('boom'))).toBe(false);

    const monitor = createAvailabilityMonitor({ supported: true });
    monitor.reportFailure(errorOf('rate-limited', 429));
    expect(monitor.getState().status).toBe('online');
    monitor.reportFailure(errorOf('offline'));
    expect(monitor.getState().status).toBe('offline');
    monitor.reportSuccess();
    expect(monitor.getState().status).toBe('online');
  });

  it('出口自己坏了（unsupported-runtime）→ unsupported，不是「在线」也不是「离线」', async () => {
    const monitor = createAvailabilityMonitor({
      supported: true,
      probe: async () => {
        throw errorOf('unsupported-runtime');
      },
    });
    await monitor.check();
    expect(monitor.getState()).toEqual({ status: 'unsupported', checkedAt: null });
    expect(capabilitiesFor(monitor.getState(), { signedIn: true })).toEqual({
      read: false,
      write: false,
      block: 'unsupported-runtime',
    });

    // 回到在线后再坏一次：同样落回 unsupported（不是乐观留在 online）
    const live = createAvailabilityMonitor({ supported: true });
    live.reportSuccess();
    expect(live.getState().status).toBe('online');
    live.reportFailure(errorOf('unsupported-runtime'));
    expect(live.getState().status).toBe('unsupported');
  });

  it('不轮询：check() 只探一次（「不循环报错」是构造上保证的）', async () => {
    const probe = vi.fn(async () => ({}));
    const monitor = createAvailabilityMonitor({ supported: true, probe });
    await monitor.check();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('订阅只在状态真的变了时回调，退订即静默', () => {
    // now 固定：状态相同（都是 online）时不因 checkedAt 抖动而重复回调
    const monitor = createAvailabilityMonitor({ supported: true, now: () => 7 });
    const seen: string[] = [];
    const unsubscribe = monitor.subscribe((next) => seen.push(next.status));

    monitor.reportSuccess();
    monitor.reportSuccess();
    monitor.reportFailure(errorOf('unauthorized', 401));
    expect(seen).toEqual(['online']);
    expect(monitor.getState().status).toBe('online');

    unsubscribe();
    monitor.reportFailure(errorOf('offline'));
    expect(seen).toEqual(['online']);
  });
});

describe('票 07 · 降级矩阵', () => {
  it('离线：读提示不可用、写一并灰掉', () => {
    expect(capabilitiesFor(state('offline'), { signedIn: true })).toEqual({
      read: false,
      write: false,
      block: 'offline',
    });
  });

  it('在线 + 未登录：读能用，写灰掉（失效不弹窗、不白屏）', () => {
    expect(capabilitiesFor(state('online'), { signedIn: false })).toEqual({
      read: true,
      write: false,
      block: 'signed-out',
    });
  });

  it('在线 + 已登录：两档都可用', () => {
    expect(capabilitiesFor(state('online'), { signedIn: true })).toEqual({
      read: true,
      write: true,
      block: null,
    });
  });
});
