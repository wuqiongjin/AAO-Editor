// issue 232：回滚到播放过的区间开头处进行批量删除或撤回后，离开当前视口的远端失效瓦片必须直接淘汰，
// 不得作为 dirty 滞留在缓存中，避免开播时引发后台排水风暴与旧位图闪烁。
import { describe, it, expect, beforeEach } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { createNoteLayerCache, type NoteLayerCache } from '@/src/rendering/pipeline/noteLayerCache';
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

describe('issue 232 · 回滚编辑远端瓦片即时淘汰与开播防卡顿', () => {
  let cache: NoteLayerCache;

  beforeEach(() => {
    cache = createNoteLayerCache();
    cache.__setCanvasFactoryForTests(() => ({
      width: 0,
      height: 0,
      getContext: () => makeNoopCtx(),
    }));
  });

  it('播放后回滚到开头进行区间删除：视口内瓦片重建，视口外远端瓦片彻底淘汰不残留为 dirty', () => {
    const notes = makeNotes();
    const g = geometry();
    // 0s 开头处的 scrollY（置底）
    const yStart = 0;

    // 1. 模拟在开头 0s 渲染首帧
    cache.draw(CTX, makeRc(g, notes, yStart, false));
    cache.__flushPlayingTileQueueForTests();

    // 2. 模拟播放一段，滚动向前推进，生成多个瓦片
    const yPlayed = g.beatToVirtualY(40, ES);
    cache.draw(CTX, makeRc(g, notes, yPlayed, true));
    cache.__flushPlayingTileQueueForTests();

    const tilesMap = cache.__getTilesForTests();
    const cachedIds = [...tilesMap.keys()];
    expect(cachedIds.length).toBeGreaterThan(2);

    // 3. 回滚到开头 0s
    cache.draw(CTX, makeRc(g, notes, yStart, false));

    // 4. 批量删除 0s~40s 区间的音符（区间修改）
    const editedNotes = notes.filter((n) => n.beat === 0 || n.beat > 30);
    cache.draw(CTX, makeRc(g, editedNotes, yStart, false));

    // 检查缓存状态：
    // - 当前视口内的瓦片（比如 0、1）应该存在且 dirty 为 false（已同步重建）
    // - 视口外的远端瓦片（比如此前播放时缓存的高 tileId）不应滞留为 dirty，应被彻底 delete 淘汰
    for (const [id, t] of tilesMap.entries()) {
      expect(t.dirty).toBeFalsy();
    }

    // 此前播放生成的远端瓦片（不在当前视口内）应该已被淘汰，数量显著减少
    const remainingIds = [...tilesMap.keys()];
    expect(remainingIds.length).toBeLessThan(cachedIds.length);
  });

  it('整份换引用（undo / redo 形态）回滚：视口外旧瓦片同样淘汰，不留滞留脏瓦片', () => {
    const notes = makeNotes();
    const g = geometry();
    const yStart = 0;

    // 模拟播放一段生成多块瓦片
    const yPlayed = g.beatToVirtualY(40, ES);
    cache.draw(CTX, makeRc(g, notes, yPlayed, true));
    cache.__flushPlayingTileQueueForTests();
    expect(cache.__getTilesForTests().size).toBeGreaterThan(2);

    // 回滚到开头 0s 并整份替换（触发 diff.kind === 'full'）
    const replaced = notes.map((n) => ({ ...n }));
    cache.draw(CTX, makeRc(g, replaced, yStart, false));

    const tilesMap = cache.__getTilesForTests();
    for (const [id, t] of tilesMap.entries()) {
      expect(t.dirty).toBeFalsy();
    }
  });
});
