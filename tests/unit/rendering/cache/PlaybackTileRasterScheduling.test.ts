import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { PlaybackScrollModel } from '@/src/playback/PlaybackScrollModel';
import { createNoteLayerCache, TILE_PX, type NoteLayerCache } from '@/src/rendering/pipeline/noteLayerCache';
import * as bandGeometry from '@/src/rendering/slideBandGeometry';
import { rasterBandRuns, type BandRaster, type BandRasterInput } from '@/src/rendering/slideBandGeometry';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import type { RenderCtx } from '@/src/rendering/types';
import type { ChartNote } from '@/src/chart/types';

function canvas(fill = () => {}, clip = () => {}, rect = () => {}) {
  const cv = { width: 0, height: 0, getContext: () => ctx };
  const ctx = new Proxy({ canvas: cv }, {
    get(target, key) {
      if (key === 'canvas') return target.canvas;
      if (key === 'getTransform') return () => ({ a: 1, d: 1, e: 0, f: 0 });
      if (key === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (key === 'fill') return fill;
      if (key === 'clip') return clip;
      if (key === 'rect') return rect;
      return () => undefined;
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return cv;
}

function frame(): RenderCtx {
  const surface = { w: 750, h: 900 };
  const geometry = new ChartGeometry([{ beat: 0, bpm: 120 }], { endBeat: 100 }, surface);
  const notes: ChartNote[] = [{ type: 'BPM', beat: 0, bpm: 120 }, {
    type: 'Slide', connections: [{ beat: 0, lane: 1 }, { beat: 25, lane: 2, hidden: true }, { beat: 80, lane: 3 }],
  }];
  return {
    geometry, surface, dpr: 1, beatDisplay: 4, chartEndBeat: 100,
    viewport: { scrollX: 0, scrollY: new PlaybackScrollModel(geometry, 3).scrollYForSeconds(0), scale: 3, virtualWidth: 0, virtualHeight: 0 },
    notes, selectedItems: [], selectionBox: null, slideBuffer: null, hoverPos: null,
    clipboard: [], markerSeconds: null, armedTool: null,
    spriteIcon: { render: () => {}, renderDecorator: () => {} } as unknown as RenderCtx['spriteIcon'],
    noteIcons: buildActiveNoteIcons(normalizeNoteSkinSelection(undefined)), playing: true,
  };
}

describe('issue 234 · 真实瓦片排水的分片与过期结果隔离', () => {
  let cache: NoteLayerCache;
  let inputs: readonly BandRasterInput[];
  let resolve: (result: (BandRaster | null)[]) => void;
  let cancelled: () => boolean;
  const rasterize = vi.fn((jobs: readonly BandRasterInput[], options: { isCancelled?: () => boolean } = {}) => {
    inputs = jobs;
    cancelled = options.isCancelled!;
    return new Promise<(BandRaster | null)[]>(done => { resolve = done; });
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { createElement: canvas });
    rasterize.mockClear();
    cache = createNoteLayerCache({ rasterizeBands: rasterize });
    cache.__setCanvasFactoryForTests(canvas);
  });
  afterEach(() => { cache.reset(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  async function finish() {
    resolve(inputs.map(rasterBandRuns));
    await vi.advanceTimersByTimeAsync(0);
  }

  it('预取排水收集真实带体并等待分片完成，之后才提交完整瓦片', async () => {
    cache.draw(canvas().getContext(), frame());
    vi.advanceTimersByTime(16);
    expect(rasterize).toHaveBeenCalledTimes(1);
    expect(inputs.length).toBeGreaterThan(0);
    expect(cache.__getTilesForTests().size).toBe(0);
    expect(cancelled()).toBe(false);
    await finish();
    expect(cache.__getTilesForTests().get(0)?.empty).toBe(false);
  });

  it.each(['large', 'small'] as const)('暂停态手动滚动/拖拽（%s）先显示可见音符，瓦片光栅完成后再重绘', async distance => {
    const redraw = vi.fn();
    cache = createNoteLayerCache({ rasterizeBands: rasterize, onScrollTileReady: redraw });
    cache.__setCanvasFactoryForTests(canvas);
    const initial = { ...frame(), playing: false };
    const rc = { ...initial, viewport: { ...initial.viewport } };
    const model = new PlaybackScrollModel(rc.geometry, 3);
    const fill = vi.fn();
    const clip = vi.fn();
    const rect = vi.fn();
    const ctx = canvas(fill, clip, rect).getContext();
    const small = distance === 'small';
    const tileId = small ? 1 : 0;
    const edge = rc.geometry.chartEndVirtualY + rc.surface.h / 3 - TILE_PX;
    if (small) rc.viewport.scrollY = edge - 10;
    cache.draw(ctx, {
      ...rc, viewport: { ...rc.viewport, scrollY: small ? edge + 120 : model.scrollYForSeconds(45) },
    });
    clip.mockClear();
    rect.mockClear();
    const raster = vi.spyOn(bandGeometry, 'rasterBandRuns');
    try {
      cache.draw(ctx, { ...rc, manualScroll: true });
      expect(fill).toHaveBeenCalled();
      expect(raster).not.toHaveBeenCalled();
      expect(cache.__getTilesForTests().has(tileId)).toBe(false);
      if (small) {
        expect(clip).toHaveBeenCalledOnce();
        expect(rect).toHaveBeenCalledExactlyOnceWith(0, 0, rc.surface.w, 30);
      } else {
        expect(clip).not.toHaveBeenCalled();
      }

      vi.runOnlyPendingTimers();
      expect(rasterize).toHaveBeenCalledOnce();
      expect(inputs.length).toBeGreaterThan(0);
      cache.draw(ctx, rc);
      expect(raster).not.toHaveBeenCalled();
      expect(redraw).not.toHaveBeenCalled();
      await finish();
      expect(redraw).toHaveBeenCalledOnce();
      expect(cache.__getTilesForTests().get(tileId)?.empty).toBe(false);
      fill.mockClear();
      cache.draw(ctx, rc);
      expect(fill).not.toHaveBeenCalled();
    } finally {
      raster.mockRestore();
    }
  });

  it.each([1, 3])('%sx 下相邻冷瓦片覆盖整个视口时直接绘制，无需路径裁切', scale => {
    cache = createNoteLayerCache({ rasterizeBands: rasterize, onScrollTileReady: vi.fn() });
    cache.__setCanvasFactoryForTests(canvas);
    const rc = { ...frame(), playing: false };
    const model = new PlaybackScrollModel(rc.geometry, scale);
    const fill = vi.fn();
    const clip = vi.fn();
    const ctx = canvas(fill, clip).getContext();
    cache.draw(ctx, { ...rc, viewport: { ...rc.viewport, scale, scrollY: model.scrollYForSeconds(45) } });

    // 让瓦片 0 和 1 的公共边界落在视口正中。
    const scrollY = rc.geometry.chartEndVirtualY + rc.surface.h / (2 * scale) - TILE_PX;
    cache.draw(ctx, { ...rc, manualScroll: true, viewport: { ...rc.viewport, scale, scrollY } });

    expect(cache.__getTilesForTests().has(0)).toBe(false);
    expect(cache.__getTilesForTests().has(1)).toBe(false);
    expect(fill).toHaveBeenCalled();
    expect(clip).not.toHaveBeenCalled();
  });

  it('继续拖到另一片区域时取消离开视口的光栅，只提交当前区域', async () => {
    const redraw = vi.fn();
    cache = createNoteLayerCache({ rasterizeBands: rasterize, onScrollTileReady: redraw });
    cache.__setCanvasFactoryForTests(canvas);
    const rc = { ...frame(), playing: false };
    const model = new PlaybackScrollModel(rc.geometry, 3);
    const ctx = canvas().getContext();
    cache.draw(ctx, { ...rc, viewport: { ...rc.viewport, scrollY: model.scrollYForSeconds(45) } });
    cache.draw(ctx, { ...rc, manualScroll: true });
    vi.runOnlyPendingTimers();
    const old = { cancelled, inputs, resolve };

    cache.draw(ctx, { ...rc, manualScroll: true, viewport: { ...rc.viewport, scrollY: model.scrollYForSeconds(15) } });
    expect(old.cancelled()).toBe(true);
    old.resolve(old.inputs.map(rasterBandRuns));
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.__getTilesForTests().has(0)).toBe(false);
    expect(redraw).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();
    expect(rasterize).toHaveBeenCalledTimes(2);
    await finish();
    expect(redraw).toHaveBeenCalledOnce();
  });

  it('滚动事件因合成阻塞暂停时，不在帧间空档启动精细瓦片', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => callbacks.delete(handle));
    const advanceFrame = () => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(performance.now());
    };
    cache = createNoteLayerCache({ rasterizeBands: rasterize, onScrollTileReady: vi.fn() });
    cache.__setCanvasFactoryForTests(canvas);
    const rc = { ...frame(), playing: false };
    const model = new PlaybackScrollModel(rc.geometry, 3);
    const ctx = canvas().getContext();
    cache.draw(ctx, { ...rc, viewport: { ...rc.viewport, scrollY: model.scrollYForSeconds(45) } });
    cache.draw(ctx, { ...rc, manualScroll: true });

    vi.runOnlyPendingTimers();
    expect(rasterize).not.toHaveBeenCalled();
    advanceFrame();
    cache.draw(ctx, { ...rc, manualScroll: true, viewport: { ...rc.viewport, scrollY: model.scrollYForSeconds(15) } });
    expect(callbacks.size).toBe(0);
    vi.runOnlyPendingTimers();
    advanceFrame();
    expect(rasterize).not.toHaveBeenCalled();
    advanceFrame();
    vi.runOnlyPendingTimers();
    expect(rasterize).toHaveBeenCalledOnce();
  });

  it('手动滚到冷区后立刻播放，正式瓦片就绪前仍显示音符', async () => {
    cache = createNoteLayerCache({ rasterizeBands: rasterize, onScrollTileReady: vi.fn() });
    cache.__setCanvasFactoryForTests(canvas);
    const rc = { ...frame(), playing: false };
    const model = new PlaybackScrollModel(rc.geometry, 3);
    const fill = vi.fn();
    const ctx = canvas(fill).getContext();
    cache.draw(ctx, { ...rc, viewport: { ...rc.viewport, scrollY: model.scrollYForSeconds(45) } });
    cache.draw(ctx, { ...rc, manualScroll: true });
    expect(fill).toHaveBeenCalled();
    fill.mockClear();

    const playing = { ...rc, playing: true };
    cache.draw(ctx, playing);
    expect(fill).toHaveBeenCalled();
    expect(cache.__getTilesForTests().has(0)).toBe(false);
    vi.advanceTimersByTime(16);
    expect(rasterize).toHaveBeenCalledOnce();
    await finish();
    fill.mockClear();
    cache.draw(ctx, playing);
    expect(fill).not.toHaveBeenCalled();
    expect(cache.__getTilesForTests().get(0)?.empty).toBe(false);
  });

  it('程序化定位到冷区当帧绘制精细瓦片', () => {
    cache = createNoteLayerCache({ rasterizeBands: rasterize, onScrollTileReady: vi.fn() });
    cache.__setCanvasFactoryForTests(canvas);
    const rc = { ...frame(), playing: false };
    const model = new PlaybackScrollModel(rc.geometry, 3);
    const fill = vi.fn();
    const ctx = canvas(fill).getContext();
    cache.draw(ctx, { ...rc, viewport: { ...rc.viewport, scrollY: model.scrollYForSeconds(45) } });
    cache.draw(ctx, rc);
    expect(fill).not.toHaveBeenCalled();
    expect(cache.__getTilesForTests().get(0)?.empty).toBe(false);
  });

  it('播放编辑重建期间保留旧位图，像素全部就绪后一次换下', async () => {
    const rc = frame();
    cache.draw(canvas().getContext(), rc);
    cache.__flushPlayingTileQueueForTests();
    const original = cache.__getTilesForTests().get(0);
    const edited = { ...rc, notes: rc.notes.map(n => ({ ...n })) as ChartNote[] };
    cache.draw(canvas().getContext(), edited);
    vi.advanceTimersByTime(16);
    expect(rasterize).toHaveBeenCalledOnce();
    expect(cache.__getTilesForTests().get(0)).toBe(original);
    expect(original?.dirty).toBe(true);
    await finish();
    expect(cache.__getTilesForTests().get(0)).not.toBe(original);
    expect(cache.__getTilesForTests().get(0)?.dirty).toBeFalsy();
  });

  it.each(['edit', 'zoom', 'surface', 'skin', 'pause', 'reset', 'timeline', 'dpr', 'mirror', 'noteSize', 'opacity'] as const)('%s 期间旧计算结果不会覆盖新状态', async change => {
    const rc = frame();
    cache.draw(canvas().getContext(), rc);
    vi.advanceTimersByTime(16);
    expect(rasterize).toHaveBeenCalledOnce();
    if (change === 'reset') cache.reset();
    else {
      const next = { ...rc };
      if (change === 'edit') next.notes = rc.notes.slice();
      if (change === 'zoom') next.viewport = { ...rc.viewport, scale: 2 };
      if (change === 'surface') next.surface = { w: 800, h: 900 };
      if (change === 'skin') next.skinVersion = 1;
      if (change === 'pause') next.playing = false;
      if (change === 'timeline') next.geometry = new ChartGeometry([{ beat: 0, bpm: 150 }], { endBeat: 100 }, rc.surface);
      if (change === 'dpr') next.dpr = 2;
      if (change === 'mirror' || change === 'noteSize' || change === 'opacity') next.display = {
        noteSize: change === 'noteSize' ? 2 : 1,
        slideOpacity: change === 'opacity' ? 0.5 : 1,
        simultaneousClickLines: false, mirror: change === 'mirror',
      };
      cache.draw(canvas().getContext(), next);
    }
    const before = [...cache.__getTilesForTests().entries()];
    expect(cancelled()).toBe(true);
    await finish();
    expect([...cache.__getTilesForTests().entries()]).toEqual(before);
  });
});
