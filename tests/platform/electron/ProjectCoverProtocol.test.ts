// chart-projects 44：aao-asset://project-cover/ 协议处理器锁测 ——
// 路径穿越拦截、384×384 缩略图落盘与缓存复用、nativeImage 不可解码时回退原图。
import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASSET_SCHEME,
  PROJECT_COVER_HOST,
  createAssetProtocolHandler,
  parseProjectCoverRequest,
} from '@/electron/assets/assetProtocol.cjs';
import { PROJECT_THUMB_SIZE } from '@/electron/assets/assetThumbnails.cjs';
import { ensureDataRootLayoutSync, projectThumbPath } from '@/electron/storage/dataRoot.cjs';
import {
  ASSET_PROJECT_COVER_HOST,
  ASSET_SCHEME as RENDERER_ASSET_SCHEME,
  projectCoverUrl,
} from '@/src/community/assetUrls';
import { tmpDir } from '@/tests/support/fs';

function fakeNativeImage(options: { empty?: boolean; outPng?: Uint8Array } = {}) {
  const resizeCalls: Array<{ width: number; height: number; quality: string }> = [];
  const cropCalls: Array<{ x: number; y: number; width: number; height: number }> = [];
  const createFromBuffer = vi.fn(() => ({
    isEmpty: () => Boolean(options.empty),
    getSize: () => ({ width: 800, height: 600 }),
    crop(rect: { x: number; y: number; width: number; height: number }) {
      cropCalls.push(rect);
      return this;
    },
    resize(opts: { width: number; height: number; quality: string }) {
      resizeCalls.push(opts);
      return this;
    },
    toPNG: () => Buffer.from(options.outPng ?? [0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  }));
  return { nativeImage: { createFromBuffer }, createFromBuffer, resizeCalls, cropCalls };
}

describe('chart-projects 44 · aao-asset://project-cover/ 协议', () => {
  it('渲染侧与主进程 host 常量互锁，且拦截非法/穿越 projectId', () => {
    expect(ASSET_PROJECT_COVER_HOST).toBe(PROJECT_COVER_HOST);
    expect(RENDERER_ASSET_SCHEME).toBe(ASSET_SCHEME);
    expect(projectCoverUrl('p1', '100-5')).toBe('aao-asset://project-cover/?id=p1&v=100-5');

    expect(parseProjectCoverRequest('aao-asset://project-cover/?id=p1&v=1-2')).toEqual({ id: 'p1', version: '1-2' });
    expect(parseProjectCoverRequest('aao-asset://project-cover/?id=../evil')).toBeNull();
    expect(parseProjectCoverRequest('aao-asset://project-cover/?id=.hidden')).toBeNull();
    expect(parseProjectCoverRequest('aao-asset://project-cover/?id=')).toBeNull();
    expect(parseProjectCoverRequest('aao-asset://project-cover/?id=中文')).toBeNull();
  });

  it('生成 384×384 居中裁方缩略图并缓存到 cache/projects/thumbs/<id>.png，二次命中不再解码', async () => {
    const root = tmpDir('aao-cover-proto-');
    try {
      ensureDataRootLayoutSync(root);
      const projDir = join(root, 'projects', 'pCover1');
      mkdirSync(projDir, { recursive: true });
      const coverPath = join(projDir, 'cover.bin');
      writeFileSync(coverPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]));
      const past = new Date(Date.now() - 5000);
      utimesSync(coverPath, past, past);

      const mock = fakeNativeImage();
      const handler = createAssetProtocolHandler({
        getDataRoot: () => root,
        nativeImage: mock.nativeImage,
      });

      const res1 = await handler({ url: projectCoverUrl('pCover1', '100-6') });
      expect(res1.status).toBe(200);
      expect(res1.headers.get('content-type')).toBe('image/png');
      expect(mock.createFromBuffer).toHaveBeenCalledTimes(1);
      expect(mock.cropCalls[0]).toEqual({ x: 100, y: 0, width: 600, height: 600 });
      expect(mock.resizeCalls[0]).toEqual({ width: PROJECT_THUMB_SIZE, height: PROJECT_THUMB_SIZE, quality: 'good' });
      expect(PROJECT_THUMB_SIZE).toBe(384);

      const thumbFile = projectThumbPath(root, 'pCover1');
      expect(existsSync(thumbFile)).toBe(true);
      expect(new Uint8Array(await res1.arrayBuffer())).toEqual(new Uint8Array(readFileSync(thumbFile)));

      // 二次请求直接走磁盘缩略图，不再触发 nativeImage 解码
      const res2 = await handler({ url: projectCoverUrl('pCover1', '100-6') });
      expect(res2.status).toBe(200);
      expect(mock.createFromBuffer).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('nativeImage 无法解码时回退返回原始 cover.bin 字节，不静默 404', async () => {
    const root = tmpDir('aao-cover-fallback-');
    try {
      ensureDataRootLayoutSync(root);
      const projDir = join(root, 'projects', 'pWebp1');
      mkdirSync(projDir, { recursive: true });
      const webpBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
      writeFileSync(join(projDir, 'cover.bin'), webpBytes);

      const mock = fakeNativeImage({ empty: true });
      const handler = createAssetProtocolHandler({
        getDataRoot: () => root,
        nativeImage: mock.nativeImage,
      });

      const res = await handler({ url: projectCoverUrl('pWebp1', '1-12') });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/webp');
      expect(Buffer.from(await res.arrayBuffer())).toEqual(webpBytes);
      expect(existsSync(projectThumbPath(root, 'pWebp1'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('无 cover.bin 或越界路径返回 404', async () => {
    const root = tmpDir('aao-cover-404-');
    try {
      ensureDataRootLayoutSync(root);
      const handler = createAssetProtocolHandler({ getDataRoot: () => root });
      expect((await handler({ url: 'aao-asset://project-cover/?id=pMissing' })).status).toBe(404);
      expect((await handler({ url: 'aao-asset://project-cover/?id=../etc' })).status).toBe(404);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
