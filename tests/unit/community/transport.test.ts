// 票 07：社区出口的统一错误域与「假出口」接线。
// 假出口 = 一个 CommunityNetBridge 替身（就是 preload 那条桥的形状），
// 假时钟 = rateLimit 的注入式 sleep/random；两者都不碰网络、不依赖 vi.useFakeTimers。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/src/diagnostics/logger';
import {
  CommunityError,
  isCommunityError,
  isRetryableKind,
  type CommunityErrorKind,
  type CommunityWireResult,
} from '@/src/community/transport';
import {
  ElectronCommunityTransport,
  createCommunityTransport,
  getCommunityNetBridge,
  type CommunityNetBridge,
} from '@/src/community/electronTransport';
import { withRetry } from '@/src/community/rateLimit';
import { makeRetryClock as fakeClock, RETRY_POLICY as POLICY } from '@/tests/support/communityRetry';

/** 假出口：按脚本吐结果，并记下每次递进来的载荷 */
function fakeBridge(...results: CommunityWireResult[]) {
  const calls: { url: string; responseType?: string; body?: string }[] = [];
  const bridge: CommunityNetBridge = {
    request: async (payload) => {
      calls.push({ url: payload.url, responseType: payload.responseType, body: payload.body });
      const next = results.shift();
      if (!next) throw new Error('假出口没准备好结果');
      return next;
    },
  };
  return { bridge, calls };
}

function failWire(kind: CommunityErrorKind, extra: Partial<{ httpStatus: number; platformCode: string }> = {}): CommunityWireResult {
  return { ok: false, error: { kind, message: `失败（${kind}）`, ...extra } };
}

const okJson = (data: unknown): CommunityWireResult => ({ ok: true, responseType: 'json', status: 200, data });

describe('票 07 · 主进程限流后 renderer 退避重试', () => {
  it('429 → 退避重试，第三次拿到数据', async () => {
    const clock = fakeClock();
    const { bridge, calls } = fakeBridge(
      { ok: false, error: { kind: 'rate-limited', message: 'HTTP 429（请求过快）', httpStatus: 429 } },
      failWire('rate-limited', { httpStatus: 429 }),
      okJson({ result: true, posts: [] }),
    );
    const transport = new ElectronCommunityTransport(bridge);

    const data = await withRetry(
      () => transport.requestJson({ url: 'https://bestdori.com/api/post/list', method: 'POST', body: '{}' }),
      { policy: POLICY, deps: clock.deps },
    );

    expect(data).toEqual({ result: true, posts: [] });
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ responseType: 'json', body: '{}' });
    expect(clock.waits).toEqual([925, 1725]);
  });

  it('超时抛统一错误：kind / retryable / 诊断 message 都在', async () => {
    const clock = fakeClock();
    const { bridge, calls } = fakeBridge(failWire('timeout'), failWire('timeout'), failWire('timeout'));
    const transport = new ElectronCommunityTransport(bridge);

    const error = await withRetry(() => transport.requestText({ url: 'https://bestdori.com/api/x' }), {
      policy: POLICY,
      deps: clock.deps,
    }).catch((thrown: unknown) => thrown);

    expect(isCommunityError(error)).toBe(true);
    expect(error).toMatchObject({ kind: 'timeout', retryable: true, message: '失败（timeout）' });
    expect(calls).toHaveLength(3);
  });

  it('未授权不重试：重试一百次也是同一个结果', async () => {
    const { bridge, calls } = fakeBridge(failWire('unauthorized', { httpStatus: 401 }));
    const transport = new ElectronCommunityTransport(bridge);

    await expect(
      withRetry(() => transport.requestJson({ url: 'https://bestdori.com/api/user/me' }), {
        policy: POLICY,
        deps: fakeClock().deps,
      }),
    ).rejects.toMatchObject({ kind: 'unauthorized', retryable: false });
    expect(calls).toHaveLength(1);
  });
});

describe('票 07 · 二进制回路径不回字节', () => {
  it('requestBinary 只回暂存路径与元数据', async () => {
    const { bridge } = fakeBridge({
      ok: true,
      responseType: 'binary',
      status: 200,
      path: '/data/downloads/1a2b3c4d-bgm001.mp3',
      byteLength: 4_194_304,
      contentType: 'audio/mpeg',
    });
    const transport = new ElectronCommunityTransport(bridge);

    const staged = await transport.requestBinary({
      url: 'https://bestdori.com/assets/jp/sound/bgm001_rip/bgm001.mp3',
      responseType: 'binary',
      suggestedName: 'bgm001.mp3',
    });

    expect(staged).toEqual({
      path: '/data/downloads/1a2b3c4d-bgm001.mp3',
      byteLength: 4_194_304,
      contentType: 'audio/mpeg',
    });
    expect(Object.keys(staged).sort()).toEqual(['byteLength', 'contentType', 'path']);
  });

  it('响应形态与请求不符 → 响应非法（不是静默拿错东西）', async () => {
    const { bridge } = fakeBridge({ ok: true, responseType: 'text', status: 200, text: '<html>' });
    const transport = new ElectronCommunityTransport(bridge);

    await expect(transport.requestJson({ url: 'https://bestdori.com/api/x' })).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });
});

describe('票 07 · 静态演示版 / 桥异常都归到「运行环境没出口」', () => {
  it('没有桥（浏览器 / 静态演示版）→ kind none，请求抛 unsupported-runtime', async () => {
    expect(getCommunityNetBridge()).toBeNull();
    const transport = createCommunityTransport(null);
    expect(transport.kind).toBe('none');

    const error = await transport.requestJson({ url: 'https://bestdori.com/api/x' }).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({ kind: 'unsupported-runtime', retryable: false });
  });

  it('有桥 → kind ipc', () => {
    const { bridge } = fakeBridge(okJson({ result: true }));
    expect(new ElectronCommunityTransport(bridge).kind).toBe('ipc');
  });

  it('桥本身抛异常（通道没注册 / 主进程挂了）→ unsupported-runtime，不外泄裸异常', async () => {
    const bridge: CommunityNetBridge = {
      request: async () => {
        throw new Error('Error invoking remote method: ipc down');
      },
    };
    await expect(new ElectronCommunityTransport(bridge).requestJson({ url: 'https://bestdori.com/api/x' })).rejects.toMatchObject({
      kind: 'unsupported-runtime',
      message: 'Error invoking remote method: ipc down',
    });
  });

  it('桥回了没法识别的结果 → invalid-response', async () => {
    const bridge = { request: async () => null } as unknown as CommunityNetBridge;
    await expect(new ElectronCommunityTransport(bridge).requestJson({ url: 'https://bestdori.com/api/x' })).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });
});

describe('票 07 · 统一错误域的 retryable 判定表', () => {
  it('六类语义错误 + 三类网关自保的判定一览', () => {
    expect(isRetryableKind('offline')).toBe(true);
    expect(isRetryableKind('timeout')).toBe(true);
    expect(isRetryableKind('rate-limited')).toBe(true);
    expect(isRetryableKind('http', 500)).toBe(true);
    expect(isRetryableKind('http', 404)).toBe(false);
    expect(isRetryableKind('unauthorized')).toBe(false);
    expect(isRetryableKind('invalid-response')).toBe(false);
    expect(isRetryableKind('unsupported-runtime')).toBe(false);
    expect(isRetryableKind('request-rejected')).toBe(false);
    expect(isRetryableKind('staging-failed')).toBe(false);
  });

  it('CommunityError 带着平台业务码与状态码，便于排查', () => {
    const error = new CommunityError('平台要求登录（LOGIN_REQUIRED）', {
      kind: 'unauthorized',
      message: '平台要求登录（LOGIN_REQUIRED）',
      httpStatus: 200,
      platformCode: 'LOGIN_REQUIRED',
    });
    expect(error).toMatchObject({ kind: 'unauthorized', httpStatus: 200, platformCode: 'LOGIN_REQUIRED', retryable: false });
    expect(isCommunityError(error)).toBe(true);
    expect(isCommunityError(new Error('x'))).toBe(false);
  });
});

describe('票 05 · 社区失败落盘（出口抛错时）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('网关 ok:false → logger.error [community]，extra 只有 kind / httpStatus / platformCode', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const { bridge } = fakeBridge(
      failWire('unauthorized', { httpStatus: 401, platformCode: 'LOGIN_REQUIRED' }),
    );
    await expect(
      new ElectronCommunityTransport(bridge).requestJson({ url: 'https://bestdori.com/api/user/me' }),
    ).rejects.toMatchObject({ kind: 'unauthorized' });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('[community]');
    expect(spy.mock.calls[0][1]).toBe('失败（unauthorized）');
    expect(spy.mock.calls[0][2]).toEqual({
      kind: 'unauthorized',
      httpStatus: 401,
      platformCode: 'LOGIN_REQUIRED',
    });
    expect(Object.keys(spy.mock.calls[0][2] as object).sort()).toEqual([
      'httpStatus',
      'kind',
      'platformCode',
    ]);
  });

  it('unsupported-runtime（没桥）不写盘', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    await expect(
      createCommunityTransport(null).requestJson({ url: 'https://bestdori.com/api/x' }),
    ).rejects.toMatchObject({ kind: 'unsupported-runtime' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('票 55 · silentPlatformCodes 声明的业务码属于预期分支，不记入 logger.error（避免误报错误）', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const { bridge } = fakeBridge(
      failWire('invalid-response', { httpStatus: 200, platformCode: 'ALREADY_UPLOADED' }),
    );
    await expect(
      new ElectronCommunityTransport(bridge).requestJson({
        url: 'https://bestdori.com/api/upload/prepare',
        silentPlatformCodes: ['ALREADY_UPLOADED'],
      }),
    ).rejects.toMatchObject({ platformCode: 'ALREADY_UPLOADED' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('可重试失败每次 send 都落一行（中间失败也写）', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const { bridge } = fakeBridge(failWire('timeout'), failWire('timeout'), failWire('timeout'));
    await withRetry(() => new ElectronCommunityTransport(bridge).requestText({ url: 'https://bestdori.com/api/x' }), {
      policy: POLICY,
      deps: fakeClock().deps,
    }).catch(() => {});
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
