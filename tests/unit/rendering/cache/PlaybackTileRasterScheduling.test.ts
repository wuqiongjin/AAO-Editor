import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { PlaybackScrollModel } from '@/src/playback/PlaybackScrollModel';
import { createNoteLayerCache, type NoteLayerCache } from '@/src/rendering/pipeline/noteLayerCache';
import { rasterBandRuns, type BandRaster, type BandRasterInput } from '@/src/rendering/slideBandGeometry';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import type { RenderCtx } from '@/src/rendering/types';
import type { ChartNote } from '@/src/chart/types';

function canvas() {
  const cv = { width: 0, height: 0, getContext: () => ctx };
  const ctx = new Proxy({ canvas: cv }, {
    get(target, key) {
      if (key === 'canvas') return target.canvas;
      if (key === 'getTransform') return () => ({ a: 1, d: 1, e: 0, f: 0 });
      if (key === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
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
    await Promise.resolve(); await Promise.resolve();
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
