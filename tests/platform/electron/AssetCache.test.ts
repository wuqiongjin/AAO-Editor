// 票 14：素材缓存（<数据根>/cache/community/）的寻址 / 记账 / 回收。
// 真文件系统往返（tmpDir），时间走注入的假时钟 —— 30 天口径不靠真等。
import { existsSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INDEX_FILE, createAssetCache, registerAssetCacheIpc } from '@/electron/assetCache.cjs';
import { tmpDir } from '@/tests/support/fs';

const DAY = 24 * 60 * 60 * 1000;

/** 临时缓存目录 + 可控时钟 */
function makeCache(options: { maxBytes?: number; maxAgeMs?: number } = {}) {
  const dir = tmpDir('tsugu-asset-cache-');
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

  it('IPC 只开两条：占用查询与清除（形态照既有桥：一个命名空间一条 invoke）', async () => {
    const ctx = makeCache();
    try {
      const handlers = new Map<string, () => unknown>();
      registerAssetCacheIpc(
        // listener 用 any：与 .cjs 侧 JSDoc 的 Function 签名对齐，测试替身不抠这个
        { handle: (channel: string, listener: any) => { handlers.set(channel, listener as () => unknown); } },
        ctx.cache,
      );

      expect([...handlers.keys()].sort()).toEqual(['assetCache:clear', 'assetCache:stats']);
      await ctx.cache.store({ url: AUDIO_URL, kind: 'binary', bytes: Buffer.from([1, 2, 3]) });
      await expect(handlers.get('assetCache:stats')!()).resolves.toMatchObject({ totalBytes: 3, count: 1 });
      await expect(handlers.get('assetCache:clear')!()).resolves.toMatchObject({ freedBytes: 3 });
    } finally {
      ctx.cleanup();
    }
  });
});
