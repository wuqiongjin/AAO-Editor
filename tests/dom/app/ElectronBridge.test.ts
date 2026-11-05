// @vitest-environment jsdom
// 票 13：桥形状收拢到 adapter 后，断言打在公共取桥接缝与三条能力的行为上，
// 替代原先对消费方源码里 `electronAPI` 字面量的 4 条文本锁。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getElectronAPI } from '@/src/app/electronBridge';
import { hasDesktopRuntime } from '@/src/app/webNotice';
import { savePatternLibraryFile } from '@/src/chart/patterns/shareFile';
import {
  ElectronFilePatternLibraryBackend,
  IndexedDbPatternLibraryBackend,
  autoDetectPatternBackend,
} from '@/src/chart/patterns/PatternStore';
import {
  ElectronCommunityTransport,
  getCommunityNetBridge,
  hasCommunityNet,
} from '@/src/community/electronTransport';
import { getPreviewSaveBridge, saveBinaryAs } from '@/src/preview/static/saveBinary';

function installBridge(shape: Record<string, unknown>): void {
  (window as unknown as { electronAPI?: unknown }).electronAPI = shape;
}

function stubObjectUrl(label: string): { createObjectURL: ReturnType<typeof vi.fn>; revokeObjectURL: ReturnType<typeof vi.fn>; click: ReturnType<typeof vi.fn> } {
  const createObjectURL = vi.fn(() => label);
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  return { createObjectURL, revokeObjectURL, click };
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.restoreAllMocks();
});

describe('electronAPI adapter · 唯一取桥接缝', () => {
  it('浏览器 / 未注入桥：返回 null', () => {
    expect(getElectronAPI()).toBeNull();
  });

  it('桌面运行时：返回 preload 注入的同一个桥对象', () => {
    const api = { appUpdate: {} };
    installBridge(api);
    expect(getElectronAPI()).toBe(api);
  });
});

describe('运行时判定（Q5 守卫）', () => {
  it('任意一条桥即桌面运行时，无桥即在线版', () => {
    expect(hasDesktopRuntime()).toBe(false);
    installBridge({ appUpdate: {} });
    expect(hasDesktopRuntime()).toBe(true);
  });
});

describe('preview:saveBinary · 有桥走桥，无桥降级', () => {
  const req = { bytes: new Uint8Array([1, 2, 3]), suggestedName: 'wide.png', mime: 'image/png' };

  it('有桥：载荷原样递给桥并回传 cancelled', async () => {
    const saveBinary = vi.fn(async () => ({ cancelled: true }));
    installBridge({ preview: { saveBinary } });
    expect(getPreviewSaveBridge()).toEqual({ saveBinary });
    await expect(saveBinaryAs(req)).resolves.toEqual({ cancelled: true, via: 'bridge' });
    expect(saveBinary).toHaveBeenCalledWith(req);
  });

  it('无桥：Blob + a.download 降级，不碰桥', async () => {
    const { createObjectURL, revokeObjectURL, click } = stubObjectUrl('blob:preview');

    await expect(saveBinaryAs(req)).resolves.toEqual({ cancelled: false, via: 'download' });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    expect(click).toHaveBeenCalledOnce();
  });
});

describe('patternLibrary · 二选一后端', () => {
  it('有桥：选文件后端，load 经桥读回', async () => {
    const load = vi.fn(async () => null);
    installBridge({ patternLibrary: { load, saveAll: vi.fn() } });
    const backend = autoDetectPatternBackend();
    expect(backend).toBeInstanceOf(ElectronFilePatternLibraryBackend);
    await expect(backend.load()).resolves.toEqual([]);
    expect(load).toHaveBeenCalledOnce();
  });

  it('无桥：选 IndexedDB 后端（构造不挑环境）', () => {
    expect(autoDetectPatternBackend()).toBeInstanceOf(IndexedDbPatternLibraryBackend);
  });
});

describe('patternLibrary.saveAs · 有桥走桥，无桥降级', () => {
  const now = new Date('2026-11-05T00:00:00Z');

  it('整库导出把序列化 JSON 与建议文件名递给桥', async () => {
    const saveAs = vi.fn<(payload: { json: string; suggestedName: string }) => Promise<{ cancelled: boolean }>>(
      async () => ({ cancelled: true }),
    );
    installBridge({ patternLibrary: { saveAs } });

    await savePatternLibraryFile([], now);

    expect(saveAs).toHaveBeenCalledOnce();
    const payload = saveAs.mock.calls[0]![0];
    expect(payload.suggestedName).toMatch(/^aao-patterns-.*\.json$/);
    expect(() => JSON.parse(payload.json)).not.toThrow();
  });

  it('无桥：Blob + a.download 降级，不调用桥', async () => {
    const { createObjectURL, revokeObjectURL, click } = stubObjectUrl('blob:patterns');

    await savePatternLibraryFile([], now);

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:patterns');
    expect(click).toHaveBeenCalledOnce();
  });
});

describe('communityNet · 按能力判降级与出口唯一', () => {
  it('有桥：取到该桥、能力可用，出口把请求递给这条桥', async () => {
    const request = vi.fn(async () => ({ ok: true, responseType: 'json', status: 200, data: { result: true } }));
    installBridge({ communityNet: { request } });
    expect(getCommunityNetBridge()).toEqual({ request });
    expect(hasCommunityNet()).toBe(true);

    const data = await new ElectronCommunityTransport().requestJson({ url: 'https://bestdori.com/api/x' });
    expect(data).toEqual({ result: true });
    expect(request).toHaveBeenCalledOnce();
  });

  it('无桥：能力不可用，请求归到 unsupported-runtime', async () => {
    expect(getCommunityNetBridge()).toBeNull();
    expect(hasCommunityNet()).toBe(false);
    const error = await new ElectronCommunityTransport()
      .requestJson({ url: 'https://bestdori.com/api/x' })
      .catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({ kind: 'unsupported-runtime' });
  });
});
