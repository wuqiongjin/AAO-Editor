// 票 15：本机素材协议（`tsugu-asset://thumb/?url=…`）—— 媒体标签读缓存里那张缩略图。
// 协议处理器是纯函数 + 注入的缓存实例：这里用真文件系统（tmpDir）跑，不碰 Electron。
import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_HOSTS,
  ASSET_SCHEME,
  THUMB_HOST,
  createAssetProtocolHandler,
  parseThumbRequest,
  registerAssetProtocol,
  registerAssetSchemePrivileges,
} from '@/electron/assetProtocol.cjs';
import { createAssetCache } from '@/electron/assetCache.cjs';
import { ASSET_SCHEME as RENDERER_SCHEME, ASSET_THUMB_HOST, assetThumbUrl } from '@/src/community/assetUrls';
import { tmpDir } from '@/tests/support/fs';

const JACKET_URL = 'https://bestdori.com/assets/jp/musicjacket/musicjacket30_rip/x-blackshout-jacket.png';
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

describe('票 15 · 协议处理器：只读缓存，缺图回 404', () => {
  it('条目在：回 200 + 缩略图字节与 content-type', async () => {
    const dir = tmpDir('tsugu-protocol-hit-');
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
    const dir = tmpDir('tsugu-protocol-heal-');
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
    const dir = tmpDir('tsugu-protocol-miss-');
    try {
      const plain = createAssetCache({ dir }); // 没有产出器 = 产不出缩略图
      await plain.store({ url: JACKET_URL, kind: 'binary', bytes: ORIGINAL_BYTES, contentType: 'image/png' });
      const handler = createAssetProtocolHandler({ assetCache: plain });

      expect((await handler(thumbRequest(JACKET_URL))).status).toBe(404);
      expect((await handler(thumbRequest('https://bestdori.com/没缓存过.png'))).status).toBe(404);
      expect((await handler({ url: 'tsugu-asset://thumb/?url=https%3A%2F%2Fevil.com%2Fx.png' })).status).toBe(404);
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

  it('处理器挂在 tsugu-asset 上，媒体标签要的就是这条', () => {
    const { handlers, protocol } = fakeProtocol();
    const dir = tmpDir('tsugu-protocol-wire-');
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
