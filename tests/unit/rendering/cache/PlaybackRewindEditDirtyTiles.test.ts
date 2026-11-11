// issue 232 上轮保留的瓦片优化：只验证失效策略，不作为自动保存卡顿的回归测试。
// 坐标必须经真实播放模型转换；scrollY=0 是谱尾，不能用它代表开头。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { PlaybackScrollModel } from '@/src/playback/PlaybackScrollModel';
import { createNoteLayerCache, diffNotes, tileIntersectsViewport, type NoteLayerCache } from '@/src/rendering/pipeline/noteLayerCache';
import type { RenderCtx } from '@/src/rendering/types';
import type { ChartNote } from '@/src/chart/types';
import { makeNoopCtx } from '@/tests/support/canvas';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';

const SURFACE = { w: 750, h: 900 };
const BEAT_DISPLAY = 4;
const ES = 1;
const CTX = makeNoopCtx();

function makeNotes(): ChartNote[] {
  const out: ChartNote[] = [{ beat: 0, type: 'BPM', bpm: 120 }];
  for (let i = 1; i <= 200; i++) out.push({ type: 'Single', lane: i % 7, beat: i, subBeat: 0 });
  return out;
}

function geometry(): ChartGeometry {
  return new ChartGeometry([{ beat: 0, bpm: 120 }], { endBeat: 240 }, SURFACE);
}

function makeRc(g: ChartGeometry, notes: ChartNote[], scrollY: number, playing: boolean): RenderCtx {
  return {
    geometry: g,
    viewport: { scrollX: 0, scrollY, scale: ES, virtualWidth: 0, virtualHeight: 0 },
    surface: SURFACE,
    dpr: 1,
    beatDisplay: BEAT_DISPLAY,
    chartEndBeat: g.chartEndBeat,
    notes,
    selectedItems: [],
    selectionBox: null,
    slideBuffer: null,
    hoverPos: null,
    clipboard: [],
    markerSeconds: null,
    armedTool: null,
    spriteIcon: { render: () => undefined, renderDecorator: () => undefined } as unknown as RenderCtx['spriteIcon'],
    noteIcons: buildActiveNoteIcons(normalizeNoteSkinSelection(undefined)),
    playing,
  };
}

describe('回到真实 0 秒编辑 · 瓦片失效策略', () => {
  let cache: NoteLayerCache;

  beforeEach(() => {
    cache = createNoteLayerCache();
    cache.__setCanvasFactoryForTests(() => ({
      width: 0, height: 0, getContext: () => makeNoopCtx(),
    }));
  });
  afterEach(() => cache.reset());

  function warmAndRewind(notes: ChartNote[], g: ChartGeometry) {
    const model = new PlaybackScrollModel(g, ES);
    const yStart = model.scrollYForSeconds(0);
    expect(yStart).toBe(52800);
    // 独立用几何反算判定线，避免测试再把谱尾当成 0 秒。
    expect(g.virtualYToSeconds(yStart + SURFACE.h / ES, ES)).toBeCloseTo(0);
    expect(model.secondsForScrollY(0)).toBe(120);
    cache.draw(CTX, makeRc(g, notes, yStart, false));
    cache.__flushPlayingTileQueueForTests();
    cache.draw(CTX, makeRc(g, notes, model.scrollYForSeconds(4), true));
    cache.__flushPlayingTileQueueForTests();
    cache.draw(CTX, makeRc(g, notes, yStart, false));
    // 真正 0 秒时 anchorY=surface.h；不靠猜测 tile 0/1/6 的身份。
    const anchorY = (g.chartEndVirtualY - yStart) * ES + SURFACE.h;
    const tiles = cache.__getTilesForTests();
    const visible = [...tiles.keys()].filter(id => tileIntersectsViewport(id, ES, anchorY, SURFACE.h));
    const remote = [...tiles.keys()].filter(id => !tileIntersectsViewport(id, ES, anchorY, SURFACE.h));
    expect(visible.length).toBeGreaterThan(0);
    expect(remote.length).toBeGreaterThan(0);
    return { yStart, visible, remote };
  }

  it('区间删除 0–15 秒：远端失效块淘汰，可见块在暂停帧立即重建', () => {
    const notes = makeNotes();
    const g = geometry();
    const { yStart, visible, remote } = warmAndRewind(notes, g);
    // 120 BPM 下 beat 30 = 15 秒；覆盖刚播放过的远端瓦片，确实命中 range 分支。
    const edited = notes.filter(n => n.type === 'BPM' || (n.type === 'Single' && n.beat > 30));
    expect(diffNotes(notes, edited, BEAT_DISPLAY)).toEqual({ kind: 'range', minBeat: 1, maxBeat: 30 });
    const tiles = cache.__getTilesForTests();
    const previous = new Map(visible.map(id => [id, tiles.get(id)]));
    cache.draw(CTX, makeRc(g, edited, yStart, false));
    for (const id of remote) expect(tiles.has(id), `远端瓦片 ${id}`).toBe(false);
    for (const id of visible) {
      expect(tiles.has(id)).toBe(true);
      expect(tiles.get(id)).not.toBe(previous.get(id));
      expect(tiles.get(id)!.dirty).toBeFalsy();
    }
  });

  it('整份换引用：full 分支淘汰远端，播放帧保留可见旧块直到队列替换', () => {
    const notes = makeNotes();
    const g = geometry();
    const { yStart, visible, remote } = warmAndRewind(notes, g);
    const replaced = notes.map(n => ({ ...n }));
    expect(diffNotes(notes, replaced, BEAT_DISPLAY)).toEqual({ kind: 'full' });
    const tiles = cache.__getTilesForTests();
    const previous = new Map(visible.map(id => [id, tiles.get(id)]));
    cache.draw(CTX, makeRc(g, replaced, yStart, true));
    for (const id of remote) expect(tiles.has(id), `远端瓦片 ${id}`).toBe(false);
    for (const id of visible) {
      expect(tiles.get(id)).toBe(previous.get(id));
      expect(tiles.get(id)!.dirty).toBe(true);
    }
    cache.__flushPlayingTileQueueForTests();
    for (const id of visible) {
      expect(tiles.get(id)).not.toBe(previous.get(id));
      expect(tiles.get(id)!.dirty).toBeFalsy();
    }
  });
});
