// 票 15 + 16：本机素材协议 —— 媒体标签读缓存里的字节，两支：
//   `aao-asset://thumb/?url=…` 缩略图（15）；`aao-asset://raw/?url=…` 原始字节（16，音频含 Range）。
// 协议处理器是纯函数 + 注入的缓存实例：这里用真文件系统（tmpDir）跑，不碰 Electron。
import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_HOSTS,
  ASSET_SCHEME,
  RAW_HOST,
  THUMB_HOST,
  createAssetProtocolHandler,
  parseRawRequest,
  parseThumbRequest,
  registerAssetProtocol,
  registerAssetSchemePrivileges,
} from '@/electron/assetProtocol.cjs';
import { createAssetCache } from '@/electron/assetCache.cjs';
import {
  ASSET_SCHEME as RENDERER_SCHEME,
  ASSET_RAW_HOST,
  ASSET_THUMB_HOST,
  assetRawUrl,
  assetThumbUrl,
} from '@/src/community/assetUrls';
import { tmpDir } from '@/tests/support/fs';

const JACKET_URL = 'https://bestdori.com/assets/jp/musicjacket/musicjacket30_rip/x-blackshout-jacket.png';
const AUDIO_URL = 'https://bestdori.com/assets/jp/sound/bgm001_rip/bgm001.mp3';
const THUMB_BYTES = Buffer.from([9, 8, 7]);
const ORIGINAL_BYTES = Buffer.alloc(40, 1);

/** 假 protocol：收下 registerSchemesAsPrivileged / handle 的入参 */
function fakeProtocol() {
  const privileged: unknown[] = [];
  const handlers = new Map<string, (request: unknown) => Promise<Response>>();
  return {
    privileged,
    handlers,
    protocol: {
      registerSchemesAsPrivileged: (list: unknown[]) => {
        privileged.push(...list);
      },
      handle: (scheme: string, handler: (request: unknown) => Promise<Response>) => {
        handlers.set(scheme, handler);
      },
    },
  };
}

/** 真缓存（tmpDir）+ 假产出器：图片一律产 3 字节 */
function makeCache(dir: string) {
  return createAssetCache({
    dir,
    makeThumb: () => ({ bytes: THUMB_BYTES, contentType: 'image/png' }),
  });
}

function thumbRequest(upstream: string): { url: string } {
  return { url: assetThumbUrl(upstream) };
}

/** raw 请求（票 16）：`range` 可选（协议按 RFC 7233 回 206 / 416）。
 *  替身只带 Electron 标准 Request 会有的 `headers.get` —— 协议侧不认别的形态。 */
function rawRequest(upstream: string, range?: string): { url: string; headers: { get: (name: string) => string | null } } {
  return {
    url: assetRawUrl(upstream),
    headers: { get: (name) => (name.toLowerCase() === 'range' && range != null ? range : null) },
  };
}

describe('票 15 · 缩略图请求的解析（只认白名单里的 https 素材）', () => {
  it('渲染侧拼出来的 URL 能解析回原图地址（跨进程契约互锁）', () => {
    expect(parseThumbRequest(assetThumbUrl(JACKET_URL))).toBe(JACKET_URL);
    expect(RENDERER_SCHEME).toBe(ASSET_SCHEME);
    expect(ASSET_THUMB_HOST).toBe(THUMB_HOST);
  });

  it('不是本协议 / 不是缩略图那一支 / 越界主机 / 非 https：一律 null', () => {
    const cases = [
      '',
      '不是地址',
      'https://bestdori.com/assets/x.png',
      `${ASSET_SCHEME}://other/?url=${encodeURIComponent(JACKET_URL)}`,
      `${ASSET_SCHEME}://${THUMB_HOST}/`,
      `${ASSET_SCHEME}://${THUMB_HOST}/?url=${encodeURIComponent('https://evil.com/x.png')}`,
      `${ASSET_SCHEME}://${THUMB_HOST}/?url=${encodeURIComponent('file:///etc/passwd')}`,
      `${ASSET_SCHEME}://${THUMB_HOST}/?url=${encodeURIComponent('http://bestdori.com/x.png')}`,
    ];
    for (const raw of cases) expect(parseThumbRequest(raw), raw).toBeNull();
    expect(ALLOWED_HOSTS).toEqual(['bestdori.com']);
  });
});

describe('票 16 · raw 支的解析（原始字节那一支，与缩略图同规矩）', () => {
  it('渲染侧拼出来的 URL 能解析回原图地址（跨进程契约互锁）', () => {
    expect(parseRawRequest(assetRawUrl(JACKET_URL))).toBe(JACKET_URL);
    expect(ASSET_RAW_HOST).toBe(RAW_HOST);
  });

  it('缩略图请求不进 raw 支 / 越界主机 / 非 https / 缺 url：一律 null', () => {
    const cases = [
      assetThumbUrl(JACKET_URL), // thumb 支的请求别被 raw 支收走
      `${ASSET_SCHEME}://${RAW_HOST}/`, // 缺 url
      assetRawUrl('https://evil.com/x.png'),
      assetRawUrl('http://bestdori.com/x.png'),
      assetRawUrl('file:///etc/passwd'),
    ];
    for (const raw of cases) expect(parseRawRequest(raw), raw).toBeNull();
  });
});

describe('票 16 · raw 支：只读缓存原始字节，缺了回 404', () => {
  it('命中：200 + 全量字节 + 元数据（content-type / accept-ranges / content-length）', async () => {
    const dir = tmpDir('aao-raw-hit-');
    try {
      const cache = makeCache(dir);
      await cache.store({ url: JACKET_URL, kind: 'binary', bytes: ORIGINAL_BYTES, contentType: 'image/png' });

      const response = await createAssetProtocolHandler({ assetCache: cache })(rawRequest(JACKET_URL));

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('accept-ranges')).toBe('bytes');
      expect(response.headers.get('content-length')).toBe('40');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(ORIGINAL_BYTES);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('音频带 Range：回 206 + Content-Range（拖进度条就是这些请求）', async () => {
    const dir = tmpDir('aao-raw-range-');
    try {
      const cache = makeCache(dir);
      await cache.store({ url: AUDIO_URL, kind: 'binary', bytes: ORIGINAL_BYTES, contentType: 'audio/mpeg' });
      const handler = createAssetProtocolHandler({ assetCache: cache });

      // `bytes=0-9`：头 10 字节
      const head = await handler(rawRequest(AUDIO_URL, 'bytes=0-9'));
      expect(head.status).toBe(206);
      expect(head.headers.get('content-range')).toBe('bytes 0-9/40');
      expect(head.headers.get('content-length')).toBe('10');
      expect(Buffer.from(await head.arrayBuffer())).toEqual(ORIGINAL_BYTES.subarray(0, 10));

      // `bytes=30-`：开区间到末尾；`bytes=35-99`：终点越界收敛到末尾；`bytes=-5`：后缀式
      for (const [range, start] of [['bytes=30-', 30], ['bytes=35-99', 35], ['bytes=-5', 35]] as const) {
        const partial = await handler(rawRequest(AUDIO_URL, range));
        expect(partial.status, range).toBe(206);
        expect(partial.headers.get('content-range'), range).toBe(`bytes ${start}-39/40`);
        expect(Buffer.from(await partial.arrayBuffer())).toEqual(ORIGINAL_BYTES.subarray(start));
      }

      // 解不开的 Range（当没有）：200 全量
      const plain = await handler(rawRequest(AUDIO_URL, 'bytes=garbage'));
      expect(plain.status).toBe(200);
      expect(Buffer.from(await plain.arrayBuffer())).toEqual(ORIGINAL_BYTES);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('起点越界（416 + bytes */total）与缓存缺失 / 回退页负缓存 / 坏缓存：一律 404 或 416，不抛', async () => {
    const dir = tmpDir('aao-raw-miss-');
    try {
      const cache = makeCache(dir);
      await cache.store({ url: AUDIO_URL, kind: 'binary', bytes: ORIGINAL_BYTES, contentType: 'audio/mpeg' });
      // 回退页负缓存（平台对不存在素材回 200 + text/html，网关会照存）：不外借
      await cache.store({ url: `${JACKET_URL}`, kind: 'binary', bytes: Buffer.from('<html/>'), contentType: 'text/html' });
      const handler = createAssetProtocolHandler({ assetCache: cache });

      // 起点越界：416
      const unsatisfiable = await handler(rawRequest(AUDIO_URL, 'bytes=40-'));
      expect(unsatisfiable.status).toBe(416);
      expect(unsatisfiable.headers.get('content-range')).toBe('bytes */40');

      // 没缓存过 / 回退页负缓存 / 越界主机 / 坏请求
      expect((await handler(rawRequest('https://bestdori.com/assets/jp/sound/bgm999_rip/bgm999.mp3'))).status).toBe(404);
      expect((await handler(rawRequest(JACKET_URL))).status).toBe(404);
      expect((await handler(rawRequest('https://evil.com/x.png'))).status).toBe(404);
      expect((await handler({ url: '坏了' })).status).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('缓存读不了（出异常）回 404，不把异常甩到协议层（处理器只握缓存，天生没有网络出口）', async () => {
    const broken = {
      lookup: () => Promise.reject(new Error('目录没了')),
      ensureThumb: () => Promise.resolve(null),
    };
    const response = await createAssetProtocolHandler({ assetCache: broken })(rawRequest(AUDIO_URL));
    expect(response.status).toBe(404);
  });
});

describe('票 15 · 协议处理器：只读缓存，缺图回 404', () => {
  it('条目在：回 200 + 缩略图字节与 content-type', async () => {
    const dir = tmpDir('aao-protocol-hit-');
    try {
      const cache = makeCache(dir);
      await cache.store({
        url: JACKET_URL,
        kind: 'binary',
        bytes: ORIGINAL_BYTES,
        contentType: 'image/png',
        suggestedName: 'blackshout.png',
      });

      const response = await createAssetProtocolHandler({ assetCache: cache })(thumbRequest(JACKET_URL));

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(THUMB_BYTES);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('老条目没有缩略图：顺手产一张再回（自愈），不额外联网', async () => {
    const dir = tmpDir('aao-protocol-heal-');
    try {
      const url = `${JACKET_URL}?old`;
      await createAssetCache({ dir }).store({ url, kind: 'binary', bytes: ORIGINAL_BYTES, contentType: 'image/png' });

      const cache = makeCache(dir);
      const response = await createAssetProtocolHandler({ assetCache: cache })(thumbRequest(url));

      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(THUMB_BYTES);
      expect((await cache.lookup({ url, kind: 'binary' }))?.thumb).not.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('没缓存过 / 索引里那份不是图片（没有缩略图）/ 请求越界：回 404，不抛', async () => {
    const dir = tmpDir('aao-protocol-miss-');
    try {
      const plain = createAssetCache({ dir }); // 没有产出器 = 产不出缩略图
      await plain.store({ url: JACKET_URL, kind: 'binary', bytes: ORIGINAL_BYTES, contentType: 'image/png' });
      const handler = createAssetProtocolHandler({ assetCache: plain });

      expect((await handler(thumbRequest(JACKET_URL))).status).toBe(404);
      expect((await handler(thumbRequest('https://bestdori.com/没缓存过.png'))).status).toBe(404);
      expect((await handler({ url: `${ASSET_SCHEME}://thumb/?url=${encodeURIComponent('https://evil.com/x.png')}` })).status).toBe(404);
      expect((await handler({ url: '坏了' })).status).toBe(404);
      expect((await handler({})).status).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('缓存读不了（目录被删 / 出异常）也回 404，不把异常甩到协议层', async () => {
    const broken = {
      lookup: () => Promise.reject(new Error('目录没了')),
      ensureThumb: () => Promise.resolve(null),
    };
    const response = await createAssetProtocolHandler({ assetCache: broken })(thumbRequest(JACKET_URL));
    expect(response.status).toBe(404);
  });
});

describe('票 15 · 接线：scheme 特权 + 处理器注册', () => {
  it('scheme 特权在 ready 之前登记：standard + secure', () => {
    const { privileged, protocol } = fakeProtocol();
    registerAssetSchemePrivileges(protocol);

    expect(privileged).toEqual([
      { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true } },
    ]);
  });

  it('处理器挂在 aao-asset 上，媒体标签要的就是这条', () => {
    const { handlers, protocol } = fakeProtocol();
    const dir = tmpDir('aao-protocol-wire-');
    try {
      const cache = makeCache(dir);
      registerAssetProtocol(protocol, cache);
      expect([...handlers.keys()]).toEqual([ASSET_SCHEME]);
      expect(typeof handlers.get(ASSET_SCHEME)).toBe('function');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
