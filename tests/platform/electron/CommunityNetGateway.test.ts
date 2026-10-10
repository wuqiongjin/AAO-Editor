// 票 07 + 14：主进程网关的行为 —— 主机白名单、单飞 + 最小间隔、单次超时、响应校验、
// 二进制落素材缓存、素材缓存命中（json / text / binary）、Cookie 附着。
// 全部走注入的假出口 / 假时钟 / 真临时目录，不碰网络。
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAssetCache } from '@/electron/assetCache.cjs';
import { createCookieJar } from '@/electron/communityCookies.cjs';
import {
  ALLOWED_HOSTS,
  ASSET_CONCURRENCY,
  ASSET_MIN_REQUEST_INTERVAL_MS,
  CACHE_FRESH_MS,
  FALLBACK_FRESH_MS,
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

/** 网关 + 假出口；给了 dir 才带素材缓存（不带的用例只测网络语义） */
function gatewayWith(
  handler: (call: FetchCall) => unknown,
  extra: { dir?: string; cookieJar?: unknown } = {},
) {
  const fetch = fakeFetch(handler);
  const clock = fakeClock();
  const assetCache = extra.dir == null ? null : createAssetCache({ dir: extra.dir, now: clock.now });
  const gateway = createCommunityGateway({
    fetchImpl: fetch.impl,
    assetCache,
    cookieJar: extra.cookieJar,
    now: clock.now,
    sleep: clock.sleep,
  });
  return { gateway, fetch, clock, assetCache };
}

/** 临时素材缓存目录（跑完即删） */
async function withTmpCache<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = tmpDir('tsugu-gateway-cache-');
  try {
    return await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

describe('票 17 · 队列分档：素材档放开并发，API 档不动，且互不阻塞', () => {
  /** 假出口：素材（/assets/）请求被闸门挂住由用例放行；API 请求立刻回 */
  function gatedFetch() {
    const gates: (() => void)[] = [];
    const starts: string[] = [];
    let open = false;
    let inFlight = 0;
    let maxInFlight = 0;
    let stalled: (() => void) | null = null;

    const impl = async (url: string) => {
      starts.push(url);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (url.includes('stall')) {
        await new Promise<void>((resolve) => {
          stalled = resolve;
        });
      } else if (url.includes('/assets/')) {
        await new Promise<void>((resolve) => {
          if (open) resolve();
          else gates.push(resolve);
        });
      }
      inFlight -= 1;
      return url.includes('/assets/')
        ? response({ bytes: [1, 2], contentType: 'image/png' })
        : response({ body: { result: true } });
    };

    return {
      impl,
      starts,
      maxInFlight: () => maxInFlight,
      /** 开闸：挂住的与之后来的素材请求都直接放行 */
      openGate: () => {
        open = true;
        for (const resolve of gates.splice(0)) resolve();
      },
      releaseStall: () => stalled?.(),
    };
  }

  /** 网关 + 假出口 + 真临时缓存（素材档要落盘，没缓存会直接 staging-failed） */
  async function withGatedGateway<T>(run: (ctx: ReturnType<typeof gatedFetch> & { gateway: any }) => Promise<T>): Promise<T> {
    return withTmpCache(async (dir) => {
      const clock = fakeClock();
      const fetch = gatedFetch();
      const gateway = createCommunityGateway({
        fetchImpl: fetch.impl,
        assetCache: createAssetCache({ dir, now: clock.now }),
        now: clock.now,
        sleep: clock.sleep,
      });
      return run({ ...fetch, gateway });
    });
  }

  const assetUrl = (name: string) => `https://bestdori.com/assets/jp/musicjacket/${name}-jacket.png`;
  const asset = (name: string) => ({ url: assetUrl(name), responseType: 'binary' as const });

  it('素材档：最多 4 个同时在飞（原来串在 API 后面，只有 1 个）', async () => {
    await withGatedGateway(async (ctx) => {
      const pending = ['a', 'b', 'c', 'd', 'e'].map((name) => ctx.gateway.request(asset(name)));
      for (let i = 0; i < 4; i += 1) await tick();

      // 4 条链各起一个；第 5 个排在链后面，要等它前面那个回来
      expect(ctx.starts).toHaveLength(4);
      expect(ctx.maxInFlight()).toBe(4);

      ctx.openGate();
      const results = await Promise.all(pending);
      expect(results.every((entry: any) => entry.ok)).toBe(true);
      expect(ctx.starts).toHaveLength(5);
    });
  });

  it('API 档仍是单飞（07 口径不动）', async () => {
    await withGatedGateway(async (ctx) => {
      const pending = [
        ctx.gateway.request({ url: `${LIST_URL}?a` }),
        ctx.gateway.request({ url: `${LIST_URL}?b` }),
      ];
      for (let i = 0; i < 4; i += 1) await tick();
      expect(ctx.starts).toHaveLength(1);
      expect(ctx.maxInFlight()).toBe(1);

      await Promise.all(pending);
      expect(ctx.starts).toHaveLength(2);
    });
  });

  it('一张素材卡住不阻塞 API：详情照样先回来（卡死隔离）', async () => {
    await withGatedGateway(async (ctx) => {
      const stalled = ctx.gateway.request(asset('stall'));
      for (let i = 0; i < 4; i += 1) await tick();

      const detail = ctx.gateway.request({ url: `${LIST_URL}?detail` });
      await expect(detail).resolves.toMatchObject({ ok: true, data: { result: true } });

      ctx.releaseStall();
      await expect(stalled).resolves.toMatchObject({ ok: true, responseType: 'binary', byteLength: 2 });
    });
  });

  it('档位是常数（改一处可调）', () => {
    expect(ASSET_CONCURRENCY).toBe(4);
    expect(ASSET_MIN_REQUEST_INTERVAL_MS).toBe(100);
    expect(MIN_REQUEST_INTERVAL_MS).toBe(400);
  });
});

describe('票 07 · 单次超时（重试归 renderer）', () => {
  it('到点即 abort，回 timeout 而不是挂死', async () => {
    const timers = fakeTimers();
    const gateway = createCommunityGateway({
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

describe('票 14 · 二进制落素材缓存（字节不过 IPC）', () => {
  it('写进缓存目录、回路径与元数据，不回字节', async () => {
    await withTmpCache(async (dir) => {
      const { gateway } = gatewayWith(
        () => response({ bytes: [1, 2, 3, 4], contentType: 'audio/mpeg' }),
        { dir },
      );
      const result = await gateway.request({
        url: 'https://bestdori.com/assets/jp/sound/bgm001_rip/bgm001.mp3',
        responseType: 'binary',
        suggestedName: '../../bgm001.mp3',
      });

      expect(result).toMatchObject({ ok: true, responseType: 'binary', byteLength: 4, contentType: 'audio/mpeg' });
      expect(relative(dir, result.path).startsWith('..')).toBe(false);
      expect(result.path).toContain('bgm001.mp3');
      expect(result.path).not.toContain('..');
      expect(readFileSync(result.path)).toEqual(Buffer.from([1, 2, 3, 4]));
      expect(Object.keys(result).sort()).toEqual(['byteLength', 'contentType', 'ok', 'path', 'responseType', 'status']);
    });
  });

  it('没给建议名也要落一个能认出来的名字', async () => {
    await withTmpCache(async (dir) => {
      const { gateway } = gatewayWith(() => response({ bytes: [9] }), { dir });
      const result = await gateway.request({ url: 'https://bestdori.com/api/upload/file/abc', responseType: 'binary' });
      expect(result.path).toContain('download');
      expect(existsSync(result.path)).toBe(true);
    });
  });

  it('缓存写不进去 = staging-failed（平台没问题，是本机的事）', async () => {
    const dir = tmpDir('tsugu-community-cache-blocked-');
    const blocker = join(dir, 'file-not-dir');
    writeFileSync(blocker, 'x');
    try {
      const { gateway } = gatewayWith(() => response({ bytes: [1] }), { dir: join(blocker, 'nested') });
      await expect(
        gateway.request({ url: 'https://bestdori.com/api/upload/file/abc', responseType: 'binary' }),
      ).resolves.toMatchObject({ ok: false, error: { kind: 'staging-failed' } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('没配缓存的网关：二进制直说不支持（不静默丢字节）', async () => {
    const { gateway } = gatewayWith(() => response({ bytes: [1] }));
    await expect(
      gateway.request({ url: 'https://bestdori.com/api/upload/file/abc', responseType: 'binary' }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'staging-failed' } });
  });
});

describe('票 14 · 素材缓存命中：GET 不碰网络', () => {
  const SONGS_URL = 'https://bestdori.com/api/songs/all.5.json';
  const AUDIO_URL = 'https://bestdori.com/assets/jp/sound/bgm029_rip/bgm029.mp3';
  const CHART_URL = 'https://bestdori.com/api/charts/29/expert.json';

  it('json：24h 内再来直接就回，一条请求都不发', async () => {
    await withTmpCache(async (dir) => {
      const { gateway, fetch } = gatewayWith(() => response({ body: { result: true, n: 1 } }), { dir });
      for (let i = 0; i < 3; i += 1) {
        await expect(gateway.request({ url: SONGS_URL })).resolves.toMatchObject({ ok: true, data: { n: 1 } });
      }
      expect(fetch.calls).toHaveLength(1);
    });
  });

  it('json：过期先回旧的，后台补一枪（补完就用新的）', async () => {
    await withTmpCache(async (dir) => {
      let version = 1;
      const { gateway, fetch, clock, assetCache } = gatewayWith(
        () => response({ body: { result: true, n: version } }),
        { dir },
      );

      await expect(gateway.request({ url: SONGS_URL })).resolves.toMatchObject({ data: { n: 1 } });
      const first = await assetCache!.lookup({ url: SONGS_URL, kind: 'json' });
      clock.advance(CACHE_FRESH_MS + 1);
      version = 2;

      // 先回旧的：列表不等人（票 14 定案）
      await expect(gateway.request({ url: SONGS_URL })).resolves.toMatchObject({ data: { n: 1 } });
      // 后台那一枪写进缓存才算数：直接盯条目（真 fs I/O，不靠猜 tick 数）
      await expect
        .poll(async () => (await assetCache!.lookup({ url: SONGS_URL, kind: 'json' }))?.cachedAt, { timeout: 3000 })
        .toBeGreaterThan(first!.cachedAt);

      await expect(gateway.request({ url: SONGS_URL })).resolves.toMatchObject({ data: { n: 2 } });
      expect(fetch.calls).toHaveLength(2);
    });
  });

  it('text：谱面原文按原样回缓存', async () => {
    await withTmpCache(async (dir) => {
      const { gateway, fetch } = gatewayWith(() => response({ raw: '[[{"type":"BPM"}]]' }), { dir });
      await expect(gateway.request({ url: CHART_URL, responseType: 'text' })).resolves.toMatchObject({ text: '[[{"type":"BPM"}]]' });
      await expect(gateway.request({ url: CHART_URL, responseType: 'text' })).resolves.toMatchObject({ text: '[[{"type":"BPM"}]]' });
      expect(fetch.calls).toHaveLength(1);
    });
  });

  it('binary：真素材长期复用（跨多天也不会「过期」重下）', async () => {
    await withTmpCache(async (dir) => {
      const { gateway, fetch, clock } = gatewayWith(
        () => response({ bytes: [1, 2], contentType: 'audio/mpeg' }),
        { dir },
      );
      await gateway.request({ url: AUDIO_URL, responseType: 'binary' });
      clock.advance(29 * 24 * 60 * 60 * 1000);
      await expect(gateway.request({ url: AUDIO_URL, responseType: 'binary' })).resolves.toMatchObject({ byteLength: 2 });
      expect(fetch.calls).toHaveLength(1);
    });
  });

  it('binary：回退页（text/html）只当 1 小时负缓存 —— 不把一张网页钉死 30 天', async () => {
    await withTmpCache(async (dir) => {
      const { gateway, fetch, clock } = gatewayWith(
        () => response({ bytes: [1], contentType: 'text/html' }),
        { dir },
      );
      await gateway.request({ url: AUDIO_URL, responseType: 'binary' });
      await gateway.request({ url: AUDIO_URL, responseType: 'binary' });
      expect(fetch.calls).toHaveLength(1);

      clock.advance(FALLBACK_FRESH_MS + 1);
      await gateway.request({ url: AUDIO_URL, responseType: 'binary' });
      expect(fetch.calls).toHaveLength(2);
    });
  });

  it('POST 不进缓存（发帖 / 登录都是写）', async () => {
    await withTmpCache(async (dir) => {
      const { gateway, fetch } = gatewayWith(() => response({ body: { result: true } }), { dir });
      await gateway.request({ url: LIST_URL, method: 'POST', body: '{}' });
      await gateway.request({ url: LIST_URL, method: 'POST', body: '{}' });
      expect(fetch.calls).toHaveLength(2);
    });
  });

  it('缓存内容坏了（不是合法 JSON）：当未命中重拉，不把坏数据喂给界面', async () => {
    await withTmpCache(async (dir) => {
      const { gateway, fetch } = gatewayWith(() => response({ body: { result: true } }), { dir });
      await gateway.request({ url: SONGS_URL });
      const cached = readdirSync(dir).find((name) => name !== 'index.json')!;
      writeFileSync(join(dir, cached), '{ 坏了');

      await expect(gateway.request({ url: SONGS_URL })).resolves.toMatchObject({ ok: true, data: { result: true } });
      expect(fetch.calls).toHaveLength(2);
    });
  });

  it('缓存文件被删：当未命中重拉', async () => {
    await withTmpCache(async (dir) => {
      const { gateway, fetch } = gatewayWith(() => response({ body: { result: true } }), { dir });
      await gateway.request({ url: SONGS_URL });
      const cached = readdirSync(dir).find((name) => name !== 'index.json')!;
      rmSync(join(dir, cached), { force: true });

      await expect(gateway.request({ url: SONGS_URL })).resolves.toMatchObject({ ok: true, data: { result: true } });
      expect(fetch.calls).toHaveLength(2);
    });
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
