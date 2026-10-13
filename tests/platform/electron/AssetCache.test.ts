// 票 14：素材缓存（<数据根>/cache/community/）的寻址 / 记账 / 回收。
// 真文件系统往返（tmpDir），时间走注入的假时钟 —— 30 天口径不靠真等。
import { existsSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INDEX_FILE,
  POLICY_MAX_AGE_MS,
  POLICY_MAX_BYTES,
  POLICY_MIN_AGE_MS,
  POLICY_MIN_BYTES,
  createAssetCache,
  registerAssetCacheIpc,
} from '@/electron/assetCache.cjs';
import { tmpDir } from '@/tests/support/fs';

const DAY = 24 * 60 * 60 * 1000;

/** 临时缓存目录 + 可控时钟（票 15 起还能接一个缩略图产出器） */
function makeCache(options: {
  maxBytes?: number;
  maxAgeMs?: number;
  makeThumb?: (bytes: Buffer, contentType: string | null) => unknown;
} = {}) {
  const dir = tmpDir('aao-asset-cache-');
  // 起点取真实现在：`.part-*` 的年龄看文件 mtime（真时钟），两者得能比
  let time = Date.now();
  const cache = createAssetCache({
    dir,
    now: () => time,
    ...options,
  });
  return {
    dir,
    cache,
    advance: (ms: number) => {
      time += ms;
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const AUDIO_URL = 'https://bestdori.com/assets/jp/sound/bgm029_rip/bgm029.mp3';

describe('票 14 · 素材缓存：存取与寻址', () => {
  it('store → lookup 往返：字节 / 元数据 / 文件名都不带路径穿越', async () => {
    const ctx = makeCache();
    try {
      const entry = await ctx.cache.store({
        url: AUDIO_URL,
        kind: 'binary',
        bytes: Buffer.from([1, 2, 3, 4]),
        contentType: 'audio/mpeg',
        suggestedName: '../../bgm029.mp3',
      });

      expect(entry.bytes).toBe(4);
      expect(entry.contentType).toBe('audio/mpeg');
      // 跨平台：不拿 `/` 拼断言（Windows 是 `\`）
      expect(relative(ctx.dir, entry.path).startsWith('..')).toBe(false);
      expect(entry.path).toContain('bgm029.mp3');
      expect(entry.path).not.toContain('..');
      expect(existsSync(entry.path)).toBe(true);
      expect(readFileSync(entry.path)).toEqual(Buffer.from([1, 2, 3, 4]));

      const hit = await ctx.cache.lookup({ url: AUDIO_URL, kind: 'binary' });
      expect(hit).toMatchObject({ url: AUDIO_URL, kind: 'binary', bytes: 4 });
      expect(await ctx.cache.read(hit!)).toEqual(Buffer.from([1, 2, 3, 4]));

      expect(existsSync(join(ctx.dir, INDEX_FILE))).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });

  it('kind 不同 / URL 不同 = 未命中；文件被删也当未命中并摘掉坏条目', async () => {
    const ctx = makeCache();
    try {
      await ctx.cache.store({ url: AUDIO_URL, kind: 'binary', bytes: Buffer.from([9]) });

      expect(await ctx.cache.lookup({ url: AUDIO_URL, kind: 'json' })).toBeNull();
      expect(await ctx.cache.lookup({ url: `${AUDIO_URL}?x=1`, kind: 'binary' })).toBeNull();

      const payload = readdirSync(ctx.dir).find((name) => name !== INDEX_FILE)!;
      rmSync(join(ctx.dir, payload), { force: true });
      expect(await ctx.cache.lookup({ url: AUDIO_URL, kind: 'binary' })).toBeNull();
      expect((await ctx.cache.stats()).count).toBe(0);
    } finally {
      ctx.cleanup();
    }
  });

  it('索引里的 file 越界 / 形状不对：整条不认（索引是本机状态，坏了不能拖垮功能）', async () => {
    const ctx = makeCache();
    try {
      writeFileSync(join(ctx.dir, INDEX_FILE), JSON.stringify({
        version: 1,
        entries: {
          deadbeefdeadbeef: { url: 'https://bestdori.com/x', kind: 'binary', file: '../evil.bin', bytes: 1, cachedAt: 1, lastUsedAt: 1 },
          cafebabecafebabe: { url: 'https://bestdori.com/y', kind: 'binary', file: 'ok.bin', bytes: Number.NaN, cachedAt: 1, lastUsedAt: 1 },
        },
      }));
      const stats = await ctx.cache.stats();
      expect(stats.count).toBe(0);
    } finally {
      ctx.cleanup();
    }
  });

  it('索引不是合法 JSON：当空索引，不抛', async () => {
    const ctx = makeCache();
    try {
      writeFileSync(join(ctx.dir, INDEX_FILE), '{ 坏了');
      expect(await ctx.cache.lookup({ url: AUDIO_URL, kind: 'binary' })).toBeNull();
      await expect(ctx.cache.store({ url: AUDIO_URL, kind: 'binary', bytes: Buffer.from([1]) })).resolves.toMatchObject({ bytes: 1 });
    } finally {
      ctx.cleanup();
    }
  });

  it('索引里的 url 与查询对不上（哈希撞车 / 索引被改）：只当未命中，不回错文件', async () => {
    const ctx = makeCache();
    try {
      await ctx.cache.store({ url: AUDIO_URL, kind: 'binary', bytes: Buffer.from([7]) });
      const raw = JSON.parse(readFileSync(join(ctx.dir, INDEX_FILE), 'utf8'));
      const [key] = Object.keys(raw.entries);
      raw.entries[key].url = 'https://bestdori.com/别的.mp3';
      writeFileSync(join(ctx.dir, INDEX_FILE), JSON.stringify(raw));

      // 换一个实例：让内存索引从 disk 重读
      const second = createAssetCache({ dir: ctx.dir });
      expect(await second.lookup({ url: AUDIO_URL, kind: 'binary' })).toBeNull();
    } finally {
      ctx.cleanup();
    }
  });
});

describe('票 14 · 素材缓存：回收（30 天未用 / 1GB 上限 / 半截文件）', () => {
  it('30 天未用即清；29 天不动', async () => {
    const ctx = makeCache();
    try {
      await ctx.cache.store({ url: AUDIO_URL, kind: 'binary', bytes: Buffer.from([1, 2]) });
      const filePath = (await ctx.cache.lookup({ url: AUDIO_URL, kind: 'binary' }))!.path;

      ctx.advance(29 * DAY);
      await ctx.cache.sweep();
      expect(existsSync(filePath)).toBe(true);

      ctx.advance(2 * DAY);
      const result = await ctx.cache.sweep();
      expect(result.removed).toBe(1);
      expect(existsSync(filePath)).toBe(false);
      expect((await ctx.cache.stats()).count).toBe(0);
    } finally {
      ctx.cleanup();
    }
  });

  it('回收看「最后使用」而不是「写入时间」：命中一次就续命', async () => {
    const ctx = makeCache();
    try {
      await ctx.cache.store({ url: AUDIO_URL, kind: 'binary', bytes: Buffer.from([1]) });

      ctx.advance(20 * DAY);
      expect(await ctx.cache.lookup({ url: AUDIO_URL, kind: 'binary' })).not.toBeNull();

      ctx.advance(20 * DAY); // 距写入 40 天、距最后一次使用 20 天
      await ctx.cache.sweep();
      expect((await ctx.cache.stats()).count).toBe(1);
    } finally {
      ctx.cleanup();
    }
  });

  it('总量超上限：按最久未用清到线上（写入后立刻生效）', async () => {
    const ctx = makeCache({ maxBytes: 10 });
    try {
      const first = await ctx.cache.store({ url: 'https://bestdori.com/a', kind: 'binary', bytes: Buffer.alloc(4, 1) });
      ctx.advance(DAY);
      await ctx.cache.store({ url: 'https://bestdori.com/b', kind: 'binary', bytes: Buffer.alloc(4, 2) });
      ctx.advance(DAY);
      await ctx.cache.store({ url: 'https://bestdori.com/c', kind: 'binary', bytes: Buffer.alloc(4, 3) });

      const stats = await ctx.cache.stats();
      expect(stats.totalBytes).toBeLessThanOrEqual(10);
      expect(await ctx.cache.lookup({ url: first.url, kind: 'binary' })).toBeNull();
      expect(await ctx.cache.lookup({ url: 'https://bestdori.com/c', kind: 'binary' })).not.toBeNull();
    } finally {
      ctx.cleanup();
    }
  });

  it('写入后再扫一次（节流 1 小时）：长开着的会话也会清掉超龄项', async () => {
    const ctx = makeCache({ maxAgeMs: DAY });
    try {
      await ctx.cache.store({ url: 'https://bestdori.com/a', kind: 'binary', bytes: Buffer.from([1]) });
      const stale = (await ctx.cache.lookup({ url: 'https://bestdori.com/a', kind: 'binary' }))!.path;

      ctx.advance(2 * DAY);
      await ctx.cache.store({ url: 'https://bestdori.com/b', kind: 'binary', bytes: Buffer.from([2]) });

      expect(existsSync(stale)).toBe(false);
      expect(await ctx.cache.lookup({ url: 'https://bestdori.com/a', kind: 'binary' })).toBeNull();
    } finally {
      ctx.cleanup();
    }
  });

  it('崩溃残留的 .part-* 清掉；刚写的那份不动', async () => {
    const ctx = makeCache();
    try {
      const stale = join(ctx.dir, 'aaaa-bgm.m4a.part-111-111');
      const fresh = join(ctx.dir, 'bbbb-cover.png.part-222-222');
      writeFileSync(stale, 'x');
      writeFileSync(fresh, 'y');
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
      utimesSync(stale, old, old);

      await ctx.cache.sweep();
      expect(existsSync(stale)).toBe(false);
      expect(existsSync(fresh)).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });
});

describe('票 15 · 缩略图跟着条目一起记账 / 回收', () => {
  /** 落一条带缩略图的素材，回两边文件路径 */
  async function storeWithThumb(ctx: ReturnType<typeof makeCache>, url: string, size = 4) {
    const entry = await ctx.cache.store({
      url,
      kind: 'binary',
      bytes: Buffer.alloc(size, 1),
      contentType: 'image/png',
    });
    return { entry, thumbPath: join(ctx.dir, entry.thumb.file) };
  }

  it('30 天未用：原图与缩略图一起清，释放量两边都算', async () => {
    const ctx = makeCache({ makeThumb: () => ({ bytes: Buffer.alloc(3), contentType: 'image/png' }) });
    try {
      const { entry, thumbPath } = await storeWithThumb(ctx, 'https://bestdori.com/cover.png');
      expect(existsSync(thumbPath)).toBe(true);

      ctx.advance(31 * DAY);
      const result = await ctx.cache.sweep();

      expect(result.removed).toBe(1);
      expect(result.freedBytes).toBe(7); // 原图 4 + 缩略图 3
      expect(existsSync(entry.path)).toBe(false);
      expect(existsSync(thumbPath)).toBe(false);
      expect(readdirSync(ctx.dir)).toEqual([INDEX_FILE]);
    } finally {
      ctx.cleanup();
    }
  });

  it('原图已经没了：清扫顺手把孤儿缩略图也删掉', async () => {
    const ctx = makeCache({ makeThumb: () => ({ bytes: Buffer.alloc(3), contentType: 'image/png' }) });
    try {
      const { entry, thumbPath } = await storeWithThumb(ctx, 'https://bestdori.com/orphan.png');
      rmSync(entry.path, { force: true });

      await ctx.cache.sweep();

      expect(existsSync(thumbPath)).toBe(false);
      expect(readdirSync(ctx.dir)).toEqual([INDEX_FILE]);
    } finally {
      ctx.cleanup();
    }
  });

  it('摘条目（drop）连缩略图一起摘', async () => {
    const ctx = makeCache({ makeThumb: () => ({ bytes: Buffer.alloc(3), contentType: 'image/png' }) });
    try {
      const { thumbPath } = await storeWithThumb(ctx, 'https://bestdori.com/drop.png');
      const hit = (await ctx.cache.lookup({ url: 'https://bestdori.com/drop.png', kind: 'binary' }))!;

      await ctx.cache.drop(hit);

      expect(existsSync(hit.path)).toBe(false);
      expect(existsSync(thumbPath)).toBe(false);
      expect((await ctx.cache.stats()).totalBytes).toBe(0);
    } finally {
      ctx.cleanup();
    }
  });

  it('1GB 上限按「原图 + 缩略图」算总量（缩略图不白占）', async () => {
    const ctx = makeCache({
      maxBytes: 10,
      makeThumb: () => ({ bytes: Buffer.alloc(4, 2), contentType: 'image/png' }),
    });
    try {
      // 每条 4 + 4 = 8：第二条一进来就超 10，最久未用的第一条（连缩略图）被清掉
      const first = await storeWithThumb(ctx, 'https://bestdori.com/a.png');
      ctx.advance(DAY);
      const second = await storeWithThumb(ctx, 'https://bestdori.com/b.png');

      expect(existsSync(first.entry.path)).toBe(false);
      expect(existsSync(first.thumbPath)).toBe(false);
      expect(existsSync(second.thumbPath)).toBe(true);
      expect((await ctx.cache.stats()).totalBytes).toBe(8);
    } finally {
      ctx.cleanup();
    }
  });

  it('重存同一条目但这次没产出缩略图：旧的缩略图文件清掉（不留索引里没有的孤儿）', async () => {
    const ctx = makeCache({ makeThumb: () => ({ bytes: Buffer.alloc(3), contentType: 'image/png' }) });
    const url = 'https://bestdori.com/cover.png';
    try {
      const first = await storeWithThumb(ctx, url);
      expect(existsSync(first.thumbPath)).toBe(true);

      // 换一个「产不出缩略图」的实例重存同一条（文件名一致 = 覆盖那条）
      const noMaker = createAssetCache({ dir: ctx.dir });
      const second = await noMaker.store({ url, kind: 'binary', bytes: Buffer.alloc(4, 2), contentType: 'image/png' });

      expect(second.thumb).toBeUndefined();
      expect(existsSync(first.thumbPath)).toBe(false);
      expect(readdirSync(ctx.dir).sort()).toEqual([second.file, INDEX_FILE].sort());
    } finally {
      ctx.cleanup();
    }
  });

  it('ensureThumb 只认索引里那一条：条目已经被摘掉就不再产（免得留没人认领的文件）', async () => {
    const ctx = makeCache({ makeThumb: () => ({ bytes: Buffer.alloc(3), contentType: 'image/png' }) });
    try {
      await storeWithThumb(ctx, 'https://bestdori.com/gone.png');
      const hit = (await ctx.cache.lookup({ url: 'https://bestdori.com/gone.png', kind: 'binary' }))!;
      await ctx.cache.drop(hit);

      await expect(ctx.cache.ensureThumb(hit)).resolves.toBeNull();
      expect(readdirSync(ctx.dir)).toEqual([INDEX_FILE]);
    } finally {
      ctx.cleanup();
    }
  });

  it('索引里的缩略图记录坏了（越界 / 形状不对）：整条不认，不回错文件', async () => {
    const ctx = makeCache();
    try {
      writeFileSync(join(ctx.dir, INDEX_FILE), JSON.stringify({
        version: 1,
        entries: {
          deadbeefdeadbeef: {
            url: 'https://bestdori.com/x.png',
            kind: 'binary',
            file: 'ok.png',
            bytes: 1,
            cachedAt: 1,
            lastUsedAt: 1,
            thumb: { file: '../evil.png', bytes: 1, contentType: 'image/png' },
          },
        },
      }));
      const stats = await ctx.cache.stats();
      expect(stats.count).toBe(0);
    } finally {
      ctx.cleanup();
    }
  });
});

describe('票 18 · 回收策略可配（改了下一次清扫就按新值算）', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const MB = 1024 * 1024;

  it('闲置天数：设成 60 天后，31 天不再被清；61 天才清', async () => {
    const ctx = makeCache();
    try {
      const url = 'https://bestdori.com/assets/jp/musicjacket/x.png';
      const entry = await ctx.cache.store({ url, kind: 'binary', bytes: Buffer.alloc(4) });
      await ctx.cache.configure({ maxAgeMs: 60 * DAY });

      ctx.advance(31 * DAY);
      await ctx.cache.sweep();
      expect(existsSync(entry.path)).toBe(true);

      ctx.advance(30 * DAY);
      const result = await ctx.cache.sweep();
      expect(result.removed).toBe(1);
      expect(existsSync(entry.path)).toBe(false);
    } finally {
      ctx.cleanup();
    }
  });

  it('总量上限：设小之后，写入即按新上限回收', async () => {
    const ctx = makeCache();
    try {
      await ctx.cache.store({ url: 'https://bestdori.com/a', kind: 'binary', bytes: Buffer.alloc(700 * 1024) });
      await ctx.cache.configure({ maxBytes: 1 * MB });

      // 再写一条就把总占用顶到 ~1.4MB > 1MB：最久未用的那条被清
      await ctx.cache.store({ url: 'https://bestdori.com/b', kind: 'binary', bytes: Buffer.alloc(700 * 1024) });
      expect((await ctx.cache.stats()).totalBytes).toBeLessThanOrEqual(MB);
      expect(await ctx.cache.lookup({ url: 'https://bestdori.com/a', kind: 'binary' })).toBeNull();
    } finally {
      ctx.cleanup();
    }
  });

  it('renderer 递什么进来都再夹一次（界面是软约束，这里是硬约束）', async () => {
    const ctx = makeCache();
    try {
      expect(ctx.cache.configure({ maxAgeMs: 0 })).toMatchObject({ maxAgeMs: POLICY_MIN_AGE_MS });
      expect(ctx.cache.configure({ maxBytes: 1 })).toMatchObject({ maxBytes: POLICY_MIN_BYTES });
      expect(ctx.cache.configure({ maxAgeMs: 9e18, maxBytes: 9e18 })).toMatchObject({
        maxAgeMs: POLICY_MAX_AGE_MS,
        maxBytes: POLICY_MAX_BYTES,
      });
      // 非有限数 / 垃圾 / 缺字段：保持原值，不炸
      const kept = ctx.cache.configure({ maxAgeMs: 7 * DAY, maxBytes: 512 * MB });
      expect(kept).toEqual({ maxAgeMs: 7 * DAY, maxBytes: 512 * MB });
      expect(ctx.cache.configure({ maxAgeMs: Number.POSITIVE_INFINITY })).toEqual(kept);
      expect(ctx.cache.configure({})).toEqual(kept);
      expect(ctx.cache.configure(undefined as unknown as Record<string, number>)).toEqual(kept);
    } finally {
      ctx.cleanup();
    }
  });
});

describe('票 14 · 素材缓存：统计与清除（设置页用）', () => {
  it('stats 按 kind 归类；clear 清空整目录并回报释放量', async () => {
    const ctx = makeCache();
    try {
      await ctx.cache.store({ url: 'https://bestdori.com/api/songs/all.5.json', kind: 'json', bytes: Buffer.alloc(100), suggestedName: 'all.5.json' });
      await ctx.cache.store({ url: AUDIO_URL, kind: 'binary', bytes: Buffer.alloc(1024) });

      const stats = await ctx.cache.stats();
      expect(stats.count).toBe(2);
      expect(stats.totalBytes).toBe(1124);
      expect(stats.byKind.json).toEqual({ bytes: 100, count: 1 });
      expect(stats.byKind.binary).toEqual({ bytes: 1024, count: 1 });

      const cleared = await ctx.cache.clear();
      expect(cleared.freedBytes).toBe(1124);
      expect(readdirSync(ctx.dir)).toEqual([]);
      expect(await ctx.cache.stats()).toEqual({ totalBytes: 0, count: 0, byKind: {} });
    } finally {
      ctx.cleanup();
    }
  });

  it('IPC 只有三条：占用查询 / 清除 / 策略推送（形态照既有桥：一个命名空间一条 invoke）', async () => {
    const ctx = makeCache();
    try {
      const handlers = new Map<string, (payload?: unknown) => unknown>();
      registerAssetCacheIpc(
        // listener 用 any：与 .cjs 侧 JSDoc 的 Function 签名对齐，测试替身不抠这个
        { handle: (channel: string, listener: any) => { handlers.set(channel, listener as (payload?: unknown) => unknown); } },
        ctx.cache,
      );

      expect([...handlers.keys()].sort()).toEqual(['assetCache:clear', 'assetCache:configure', 'assetCache:stats']);
      await ctx.cache.store({ url: AUDIO_URL, kind: 'binary', bytes: Buffer.from([1, 2, 3]) });
      await expect(handlers.get('assetCache:stats')!()).resolves.toMatchObject({ totalBytes: 3, count: 1 });
      await expect(handlers.get('assetCache:clear')!()).resolves.toMatchObject({ freedBytes: 3 });
    } finally {
      ctx.cleanup();
    }
  });
});
