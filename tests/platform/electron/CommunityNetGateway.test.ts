// 票 07：主进程网关的行为 —— 主机白名单、单飞 + 最小间隔、单次超时、响应校验、
// 二进制落下载暂存、Cookie 附着。全部走注入的假出口 / 假时钟 / 真临时目录，不碰网络。
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCookieJar } from '@/electron/communityCookies.cjs';
import {
  ALLOWED_HOSTS,
  MIN_REQUEST_INTERVAL_MS,
  createCommunityGateway,
} from '@/electron/communityNet.cjs';
import { tmpDir } from '@/tests/support/fs';

type FetchCall = { url: string; init: any };

/** 假出口：记录每次调用（url + init），按脚本回响应 */
function fakeFetch(handler: (call: FetchCall) => unknown) {
  const calls: FetchCall[] = [];
  const impl = async (url: string, init: any) => {
    calls.push({ url, init });
    return handler({ url, init });
  };
  return { impl, calls };
}

/** 假响应：只实现网关用到的那几个面（status / headers / text / arrayBuffer） */
function response(options: {
  status?: number;
  body?: unknown;
  raw?: string;
  bytes?: number[];
  contentType?: string;
  setCookie?: string[];
} = {}) {
  const body = options.body;
  return {
    status: options.status ?? 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? options.contentType ?? null : null,
      getSetCookie: () => options.setCookie ?? [],
    },
    text: async () => options.raw ?? JSON.stringify(body),
    arrayBuffer: async () => new Uint8Array(options.bytes ?? [1, 2, 3]).buffer,
  };
}

/** 假时钟：now 只在 sleep / 显式推进时前进 */
function fakeClock(start = 0) {
  let time = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
    },
    advance: (ms: number) => {
      time += ms;
    },
  };
}

/** 假定时器：只收集回调，由用例决定何时超时 */
function fakeTimers() {
  const scheduled: { fn: () => void; ms: number }[] = [];
  return {
    scheduled,
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        scheduled.push({ fn, ms });
        return scheduled.length;
      },
      clearTimeout: () => undefined,
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function gatewayWith(
  handler: (call: FetchCall) => unknown,
  extra: { stagingDir?: string; cookieJar?: unknown } = {},
) {
  const fetch = fakeFetch(handler);
  const clock = fakeClock();
  const gateway = createCommunityGateway({
    fetchImpl: fetch.impl,
    stagingDir: extra.stagingDir ?? '/tmp/unused-staging',
    cookieJar: extra.cookieJar,
    now: clock.now,
    sleep: clock.sleep,
  });
  return { gateway, fetch, clock };
}

const LIST_URL = 'https://bestdori.com/api/post/list';

describe('票 07 · 主机白名单（主进程兜底，不信 renderer）', () => {
  it('白名单只有这一个主机', () => {
    expect(ALLOWED_HOSTS).toEqual(['bestdori.com']);
  });

  it('越界主机 / 后缀伪装 / 非 https / 脏 url 一律在发请求之前拒掉', async () => {
    const { gateway, fetch } = gatewayWith(() => response({ body: { result: true } }));

    const bad = [
      'https://evil.com/api/post/list',
      'https://bestdori.com.evil.com/api/post/list',
      'http://bestdori.com/api/post/list',
      '不是地址',
      '',
    ];
    for (const url of bad) {
      const result = await gateway.request({ url });
      expect(result, url).toMatchObject({ ok: false, error: { kind: 'request-rejected' } });
    }
    expect(await gateway.request({})).toMatchObject({ ok: false, error: { kind: 'request-rejected' } });
    expect(fetch.calls).toHaveLength(0);
  });

  it('renderer 不得自带凭据头（cookie / host / content-length）', async () => {
    const { gateway, fetch } = gatewayWith(() => response({ body: { result: true } }));

    const result = await gateway.request({ url: LIST_URL, headers: { Cookie: 'token=stolen' } });
    expect(result).toMatchObject({ ok: false, error: { kind: 'request-rejected' } });
    expect(fetch.calls).toHaveLength(0);
  });

  it('方法与载荷也校验：PATCH / GET 带 body / 非字符串 body 都拒', async () => {
    const { gateway, fetch } = gatewayWith(() => response({ body: { result: true } }));
    expect(await gateway.request({ url: LIST_URL, method: 'PATCH' })).toMatchObject({
      ok: false,
      error: { kind: 'request-rejected' },
    });
    expect(await gateway.request({ url: LIST_URL, body: '{}' })).toMatchObject({
      ok: false,
      error: { kind: 'request-rejected' },
    });
    expect(await gateway.request({ url: LIST_URL, method: 'POST', body: { a: 1 } })).toMatchObject({
      ok: false,
      error: { kind: 'request-rejected' },
    });
    expect(fetch.calls).toHaveLength(0);
  });
});

describe('票 07 · 低速率（单飞 + 最小间隔）', () => {
  it('同一时刻只有一个请求在飞，且两次开始之间隔够最小间隔', async () => {
    const clock = fakeClock();
    const starts: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const gateway = createCommunityGateway({
      stagingDir: '/tmp/unused-staging',
      minIntervalMs: MIN_REQUEST_INTERVAL_MS,
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl: async () => {
        starts.push(clock.now());
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return response({ body: { result: true } });
      },
    });

    await Promise.all([
      gateway.request({ url: `${LIST_URL}?a` }),
      gateway.request({ url: `${LIST_URL}?b` }),
      gateway.request({ url: `${LIST_URL}?c` }),
    ]);

    expect(starts).toEqual([0, MIN_REQUEST_INTERVAL_MS, MIN_REQUEST_INTERVAL_MS * 2]);
    expect(maxInFlight).toBe(1);
    expect(clock.sleeps).toEqual([MIN_REQUEST_INTERVAL_MS, MIN_REQUEST_INTERVAL_MS]);
  });

  it('自报 UA 与 Accept：没带就补默认，带了就用调用方的', async () => {
    const { gateway, fetch } = gatewayWith(() => response({ body: { result: true } }));
    await gateway.request({ url: LIST_URL, method: 'POST', body: '{}' });
    expect(fetch.calls[0].init.headers['user-agent']).toContain('low-rate');
    expect(fetch.calls[0].init.headers.accept).toBe('application/json');

    await gateway.request({ url: LIST_URL, headers: { 'user-agent': 'my-agent/2.0', accept: '*/*' } });
    expect(fetch.calls[1].init.headers['user-agent']).toBe('my-agent/2.0');
    expect(fetch.calls[1].init.headers.accept).toBe('*/*');
  });
});

describe('票 07 · 单次超时（重试归 renderer）', () => {
  it('到点即 abort，回 timeout 而不是挂死', async () => {
    const timers = fakeTimers();
    const gateway = createCommunityGateway({
      stagingDir: '/tmp/unused-staging',
      timers: timers.timers,
      fetchImpl: (_url: string, init: any) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });

    const pending = gateway.request({ url: LIST_URL, timeoutMs: 5000 });
    for (let i = 0; i < 5 && timers.scheduled.length === 0; i += 1) await tick();

    expect(timers.scheduled).toHaveLength(1);
    expect(timers.scheduled[0].ms).toBe(5000);
    timers.scheduled[0].fn();

    await expect(pending).resolves.toMatchObject({ ok: false, error: { kind: 'timeout' } });
  });

  it('连不上 = offline（DNS / 拒绝连接 / 系统离线都走这条）', async () => {
    const gateway = createCommunityGateway({
      stagingDir: '/tmp/unused-staging',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(gateway.request({ url: LIST_URL })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'offline' },
    });
  });
});

describe('票 07 · 响应校验', () => {
  it('2xx + JSON 就是成功', async () => {
    const { gateway } = gatewayWith(() => response({ body: { result: true, count: 3 } }));
    await expect(gateway.request({ url: LIST_URL })).resolves.toEqual({
      ok: true,
      responseType: 'json',
      status: 200,
      data: { result: true, count: 3 },
    });
  });

  it('429 / 5xx / 4xx / 未授权各自归位（429 与 5xx 会被 renderer 重试）', async () => {
    const cases: [{ status?: number; body?: unknown }, string][] = [
      [{ status: 429 }, 'rate-limited'],
      [{ status: 500 }, 'http'],
      [{ status: 404 }, 'http'],
      [{ status: 401 }, 'unauthorized'],
      [{ status: 403 }, 'unauthorized'],
    ];
    for (const [res, kind] of cases) {
      const { gateway } = gatewayWith(() => response(res));
      const result = await gateway.request({ url: LIST_URL });
      expect(result, `HTTP ${res.status}`).toMatchObject({ ok: false, error: { kind, httpStatus: res.status } });
    }
  });

  it('平台业务错误也是 200：按码翻成未授权 / 响应非法，并带上平台码', async () => {
    const cases: [{ result: boolean; code?: string }, string][] = [
      [{ result: false, code: 'LOGIN_REQUIRED' }, 'unauthorized'],
      [{ result: false, code: 'CREDENTIALS_INVALID' }, 'unauthorized'],
      [{ result: false, code: 'USER_INVALID' }, 'unauthorized'],
      [{ result: false, code: 'REQUEST_INVALID' }, 'invalid-response'],
      [{ result: false }, 'invalid-response'],
    ];
    for (const [body, kind] of cases) {
      const { gateway } = gatewayWith(() => response({ body }));
      const result = await gateway.request({ url: LIST_URL });
      expect(result, body.code ?? 'no-code').toMatchObject({
        ok: false,
        error: { kind, httpStatus: 200, platformCode: body.code ?? 'UNKNOWN' },
      });
    }
  });

  it('回退页 / 非 JSON 文本 = 响应非法（不是静默当空数据）', async () => {
    const { gateway } = gatewayWith(() => response({ raw: '<!doctype html><html></html>' }));
    await expect(gateway.request({ url: LIST_URL })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-response' },
    });
  });

  it('text 形态按原样回文本（社区帖富文本之类的原始体）', async () => {
    const { gateway } = gatewayWith(() => response({ raw: 'hello' }));
    await expect(gateway.request({ url: LIST_URL, responseType: 'text' })).resolves.toEqual({
      ok: true,
      responseType: 'text',
      status: 200,
      text: 'hello',
    });
  });
});

describe('票 07 · 二进制落下载暂存（字节不过 IPC）', () => {
  it('写进暂存目录、回路径与元数据，不回字节', async () => {
    const staging = tmpDir('tsugu-community-staging-');
    try {
      const { gateway } = gatewayWith(
        () => response({ bytes: [1, 2, 3, 4], contentType: 'audio/mpeg' }),
        { stagingDir: staging },
      );
      const result = await gateway.request({
        url: 'https://bestdori.com/assets/jp/sound/bgm001_rip/bgm001.mp3',
        responseType: 'binary',
        suggestedName: '../../bgm001.mp3',
      });

      expect(result).toMatchObject({ ok: true, responseType: 'binary', byteLength: 4, contentType: 'audio/mpeg' });
      expect(result.path.startsWith(`${staging}/`)).toBe(true);
      expect(result.path).toContain('bgm001.mp3');
      expect(result.path).not.toContain('..');
      expect(readFileSync(result.path)).toEqual(Buffer.from([1, 2, 3, 4]));
      expect(Object.keys(result).sort()).toEqual(['byteLength', 'contentType', 'ok', 'path', 'responseType', 'status']);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });

  it('没给建议名也要落一个能认出来的名字', async () => {
    const staging = tmpDir('tsugu-community-staging-noname-');
    try {
      const { gateway } = gatewayWith(() => response({ bytes: [9] }), { stagingDir: staging });
      const result = await gateway.request({ url: 'https://bestdori.com/api/upload/file/abc', responseType: 'binary' });
      expect(result.path).toContain('download');
      expect(existsSync(result.path)).toBe(true);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });

  it('暂存写不进去 = staging-failed（平台没问题，是本机的事）', async () => {
    const dir = tmpDir('tsugu-community-staging-blocked-');
    const blocker = join(dir, 'file-not-dir');
    writeFileSync(blocker, 'x');
    try {
      const { gateway } = gatewayWith(() => response({ bytes: [1] }), { stagingDir: join(blocker, 'nested') });
      await expect(
        gateway.request({ url: 'https://bestdori.com/api/upload/file/abc', responseType: 'binary' }),
      ).resolves.toMatchObject({ ok: false, error: { kind: 'staging-failed' } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('票 07 · Cookie 由网关附着（renderer 递不了凭据）', () => {
  it('jar 里有会话 Cookie 时自动带上；响应的 Set-Cookie 收进 jar', async () => {
    const jar = createCookieJar({ now: () => 1000 });
    jar.capture('https://bestdori.com/api/user/login', ['token=abc; Path=/']);

    const { gateway, fetch } = gatewayWith(
      () => response({ body: { result: true }, setCookie: ['extra=1; Path=/'] }),
      { cookieJar: jar },
    );

    await gateway.request({ url: LIST_URL, method: 'POST', body: '{}' });
    expect(fetch.calls[0].init.headers.cookie).toBe('token=abc');

    await gateway.request({ url: `${LIST_URL}?next` });
    expect(fetch.calls[1].init.headers.cookie).toBe('token=abc; extra=1');
  });
});
