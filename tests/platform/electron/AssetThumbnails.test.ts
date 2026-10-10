// 票 15：封面缩略图的产出（96×96 方形 PNG）。
// nativeImage 是注入的 —— 这里用手写替身记录「裁哪块、缩到多大」，不碰真 Electron。
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THUMB_SIZE, createThumbMaker, squareCrop } from '@/electron/assetThumbnails.cjs';
import { createAssetCache } from '@/electron/assetCache.cjs';
import { tmpDir } from '@/tests/support/fs';
import { readSource } from '@/tests/support/source';

/** 记录型 nativeImage 替身：只回固定尺寸的假图，把 crop / resize 的入参记下来 */
function fakeNativeImage(size: { width: number; height: number } | null, png = Buffer.from([1, 2, 3])) {
  const calls = { crops: [] as unknown[], resizes: [] as unknown[] };
  const image = {
    isEmpty: () => size == null,
    getSize: () => size ?? { width: 0, height: 0 },
    crop: (rect: unknown) => {
      calls.crops.push(rect);
      return image;
    },
    resize: (options: unknown) => {
      calls.resizes.push(options);
      return image;
    },
    toPNG: () => png,
  };
  return {
    calls,
    nativeImage: { createFromBuffer: () => image },
  };
}

describe('票 15 · 缩略图产出：96×96 方形 PNG', () => {
  it('先居中裁方再缩到 96×96，产出固定 PNG（规格 = 行上 48 CSS px 的 2 倍）', () => {
    const { calls, nativeImage } = fakeNativeImage({ width: 400, height: 300 });
    const makeThumb = createThumbMaker(nativeImage);

    const made = makeThumb(Buffer.from([0]), 'image/png');

    expect(calls.crops).toEqual([{ x: 50, y: 0, width: 300, height: 300 }]);
    expect(calls.resizes).toEqual([{ width: 96, height: 96, quality: 'good' }]);
    expect(made).toMatchObject({ contentType: 'image/png' });
    expect(Buffer.from(made!.bytes)).toEqual(Buffer.from([1, 2, 3]));
  });

  it('不是图片 / 解不开 / 拿到的图是空的：一律回 null（= 没有缩略图，不是报错）', () => {
    const { calls, nativeImage } = fakeNativeImage({ width: 400, height: 400 });
    const makeThumb = createThumbMaker(nativeImage);

    expect(makeThumb(Buffer.from([0]), 'audio/mpeg')).toBeNull();
    expect(makeThumb(Buffer.from([0]), 'text/html')).toBeNull();
    expect(calls.crops).toEqual([]);

    // content-type 缺失也试一把（平台万一哪天不回这个头）；解不开就 null
    const broken = createThumbMaker(fakeNativeImage(null).nativeImage);
    expect(broken(Buffer.from([0]), null)).toBeNull();
    expect(makeThumb(Buffer.from([0]), null)).not.toBeNull();
  });

  it('正方形 / 竖图 / 横图的裁剪框', () => {
    expect(squareCrop(400, 400)).toEqual({ x: 0, y: 0, width: 400, height: 400 });
    expect(squareCrop(400, 700)).toEqual({ x: 0, y: 150, width: 400, height: 400 });
    expect(squareCrop(700, 400)).toEqual({ x: 150, y: 0, width: 400, height: 400 });
  });

  it('规格互锁：主进程产的是行上那 48px 的 2 倍', () => {
    expect(THUMB_SIZE).toBe(96);
    const css = readSource('src/pages/projects/ProjectsPage.css');
    const declared = /\.off-row__thumb\s*\{[^}]*--off-thumb-size:\s*(\d+)px/.exec(css);
    expect(declared, '行内缩略图的边长得写在 .off-row__thumb 上').not.toBeNull();
    expect(THUMB_SIZE).toBe(Number(declared![1]) * 2);
  });
});

describe('票 15 · 缩略图接进缓存：进缓存时顺手产出', () => {
  it('store 时产一份，挂在条目上，文件真的落盘', async () => {
    const dir = tmpDir('aao-thumb-store-');
    try {
      const cache = createAssetCache({
        dir,
        makeThumb: () => ({ bytes: Buffer.from([7, 7]), contentType: 'image/png' }),
      });
      const entry = await cache.store({
        url: 'https://bestdori.com/assets/jp/musicjacket/x.png',
        kind: 'binary',
        bytes: Buffer.alloc(40),
        contentType: 'image/png',
        suggestedName: 'blackshout.png',
      });

      expect(entry.thumb).toMatchObject({ bytes: 2, contentType: 'image/png' });
      expect(readdirSync(dir).sort()).toEqual([entry.file, entry.thumb.file, 'index.json'].sort());

      const hit = await cache.lookup({ url: entry.url, kind: 'binary' });
      expect(hit?.thumb?.file).toBe(entry.thumb.file);
      // 占用算上缩略图（设置页的口径：缩略图不单列，算进它那条目的桶）
      expect(await cache.stats()).toMatchObject({ totalBytes: 42, count: 1, byKind: { binary: { bytes: 42, count: 1 } } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('产出器抛异常 / 回空：素材照样进缓存，只是没有缩略图', async () => {
    const dir = tmpDir('aao-thumb-fail-');
    try {
      const cache = createAssetCache({
        dir,
        makeThumb: () => {
          throw new Error('解码炸了');
        },
      });
      const entry = await cache.store({ url: 'https://bestdori.com/x.png', kind: 'binary', bytes: Buffer.alloc(4) });

      expect(entry.thumb).toBeUndefined();
      expect(await cache.ensureThumb(entry)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('没接产出器时一切照旧（不产缩略图，也不报错）', async () => {
    const dir = tmpDir('aao-thumb-none-');
    try {
      const cache = createAssetCache({ dir });
      const entry = await cache.store({ url: 'https://bestdori.com/x.png', kind: 'binary', bytes: Buffer.alloc(4) });
      expect(entry.thumb).toBeUndefined();
      expect(await cache.ensureThumb(entry)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('老缓存自愈：条目上没有缩略图的记录 → 现产一份并写回索引，第二次直接用', async () => {
    const dir = tmpDir('aao-thumb-heal-');
    try {
      const url = 'https://bestdori.com/assets/jp/musicjacket/old.png';
      // 先用「没有产出器」的实例落一条（= 票 15 之前进的缓存）
      const before = createAssetCache({ dir });
      await before.store({ url, kind: 'binary', bytes: Buffer.alloc(30), contentType: 'image/png' });

      let made = 0;
      const after = createAssetCache({
        dir,
        makeThumb: () => {
          made += 1;
          return { bytes: Buffer.from([5]), contentType: 'image/png' };
        },
      });
      const entry = (await after.lookup({ url, kind: 'binary' }))!;
      expect(entry.thumb).toBeUndefined();

      const thumb = await after.ensureThumb(entry);
      expect(made).toBe(1);
      expect(thumb).not.toBeNull();
      expect(readFileSync(thumb!.path)).toEqual(Buffer.from([5]));

      // 索引已经记上：再取一次不再产，条目上也有了
      const again = (await after.lookup({ url, kind: 'binary' }))!;
      expect(again.thumb).not.toBeUndefined();
      await expect(after.ensureThumb(again)).resolves.toMatchObject({ path: thumb!.path });
      expect(made).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('缩略图文件被删：ensureThumb 重产一份（记录坏了也修）', async () => {
    const dir = tmpDir('aao-thumb-rebuild-');
    try {
      const cache = createAssetCache({
        dir,
        makeThumb: () => ({ bytes: Buffer.from([3, 3, 3]), contentType: 'image/png' }),
      });
      const entry = await cache.store({ url: 'https://bestdori.com/y.png', kind: 'binary', bytes: Buffer.alloc(8) });
      rmSync(join(dir, entry.thumb.file), { force: true });

      const rebuilt = await cache.ensureThumb(entry);
      expect(rebuilt).not.toBeNull();
      expect(readFileSync(rebuilt!.path)).toEqual(Buffer.from([3, 3, 3]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
