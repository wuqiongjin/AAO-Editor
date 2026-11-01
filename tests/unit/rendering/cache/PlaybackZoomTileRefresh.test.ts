// issue 199 锁测：播放中缩放音符瓦片必须能够异步重建，杜绝因 refScale 漏检导致材质死锁发糊。
import { describe, it, expect, beforeEach } from 'vitest';
import { ChartGeometry, LANES } from '@/src/chart/geometry/ChartGeometry';
import {
  createNoteLayerCache,
  type NoteLayerCache,
} from '@/src/rendering/pipeline/noteLayerCache';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import type { RenderCtx } from '@/src/rendering/types';
import type { ChartNote } from '@/src/chart/types';
import { makeNoopCtx } from '@/tests/support/canvas';

const SURFACE = { w: 750, h: 900 };
const BEAT_DISPLAY = 4;
const CHART_END_BEAT = 200;
const CENTER_BEAT = 50;
const CTX = makeNoopCtx();

function makeNotes(): ChartNote[] {
  const notes: ChartNote[] = [{ beat: 0, type: 'BPM', bpm: 120 }];
  for (let beat = 1; beat <= CHART_END_BEAT; beat++) {
    notes.push({ type: 'Single', lane: beat % LANES, beat, subBeat: 0 } as ChartNote);
  }
  return notes;
}

const NOTES = makeNotes();

function geometry(): ChartGeometry {
  return new ChartGeometry([{ beat: 0, bpm: 120 }], { endBeat: CHART_END_BEAT }, SURFACE);
}

function makeRc(g: ChartGeometry, es: number, playing: boolean, zoomGesture = false): RenderCtx {
  return {
    geometry: g,
    viewport: {
      scrollX: 0,
      scrollY: g.beatToVirtualY(CENTER_BEAT, es) - SURFACE.h / (2 * es),
      scale: es,
      virtualWidth: 0,
      virtualHeight: 0,
    },
    surface: SURFACE,
    dpr: 1,
    beatDisplay: BEAT_DISPLAY,
    chartEndBeat: CHART_END_BEAT,
    notes: NOTES,
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
    zoomGesture,
  };
}

describe('issue 199 · 播放中缩放音符瓦片刷新与防死锁', () => {
  let cache: NoteLayerCache;
  let bitmaps = 0;

  beforeEach(() => {
    cache = createNoteLayerCache();
    bitmaps = 0;
    cache.__setCanvasFactoryForTests(() => {
      bitmaps++;
      return { width: 0, height: 0, getContext: () => makeNoopCtx() };
    });
  });

  it('播放中改变缩放：已存在瓦片识别为 stale 并排入异步队列，flush 后更新为当前 scale', () => {
    const g = geometry();
    // 1) 初始 scale = 0.2 下建好初始瓦片
    cache.draw(CTX, makeRc(g, 0.2, true));
    cache.__flushPlayingTileQueueForTests();

    // 2) 在播放状态下改变缩放为 0.7（scale 跃升超过 STALE_TOL）
    cache.draw(CTX, makeRc(g, 0.7, true));
    const st0 = cache.__getLastNoteLayerStats();
    // 播放中不同步光栅化，避免掉帧
    expect(st0.rebuilt).toBe(0);

    const targetTileId = st0.lo;
    const tileBeforeFlush = cache.__getTilesForTests().get(targetTileId);
    expect(tileBeforeFlush?.refScale).toBe(0.2);

    // 3) 排空异步队列
    cache.__flushPlayingTileQueueForTests();

    // 4) 视口内的瓦片必须已成功更新到 0.7
    const tileAfterFlush = cache.__getTilesForTests().get(targetTileId);
    expect(tileAfterFlush).toBeDefined();
    expect(tileAfterFlush?.refScale).toBe(0.7);

    // 5) 后续播放帧验证：视口内所有瓦片均已与目标 scale 对齐，消除 stale blit
    cache.draw(CTX, makeRc(g, 0.7, true));
    const st1 = cache.__getLastNoteLayerStats();
    for (let id = st1.lo; id <= st1.hi; id++) {
      const t = cache.__getTilesForTests().get(id);
      if (t && !t.empty) {
        expect(Math.abs(0.7 / t.refScale - 1)).toBeLessThanOrEqual(0.02);
      }
    }
  });

  it('极小比例（0.1）缩小后放大回弹（0.69）：播放中瓦片成功换下，不锁定在 0.1', () => {
    const g = geometry();
    // 1) 模拟快速缩小至下限 0.1 生成瓦片（覆盖超大拍位区间）
    cache.draw(CTX, makeRc(g, 0.1, true));
    cache.__flushPlayingTileQueueForTests();

    // 2) 紧接着放大到 0.69，模拟后续持续播放帧
    for (let frame = 1; frame <= 3; frame++) {
      cache.draw(CTX, makeRc(g, 0.69, true));
    }
    const st = cache.__getLastNoteLayerStats();
    const targetTileId = st.lo;
    // 刷新前，该瓦片处于 0.1 的旧 scale
    const beforeFlush = cache.__getTilesForTests().get(targetTileId);
    expect(beforeFlush?.refScale).toBe(0.1);

    // 排空异步队列
    cache.__flushPlayingTileQueueForTests();

    // 3) 修复后：瓦片成功换新为 0.69，杜绝死锁发糊
    const updatedTile = cache.__getTilesForTests().get(targetTileId);
    expect(updatedTile?.refScale).toBe(0.69);

    // 4) 随后播放帧验证：视口内瓦片已全部以 0.69 高清渲染，不再发生放大 7 倍的 stale blit
    cache.draw(CTX, makeRc(g, 0.69, true));
    const stFollowup = cache.__getLastNoteLayerStats();
    for (let id = stFollowup.lo; id <= stFollowup.hi; id++) {
      const t = cache.__getTilesForTests().get(id);
      if (t && !t.empty) {
        expect(Math.abs(0.69 / t.refScale - 1)).toBeLessThanOrEqual(0.02);
      }
    }
  });

  it('微小缩放（在 STALE_TOL = 2% 内）：不触发重建，保持原瓦片', () => {
    const g = geometry();
    cache.draw(CTX, makeRc(g, 1.0, true));
    cache.__flushPlayingTileQueueForTests();

    const st = cache.__getLastNoteLayerStats();
    const targetTileId = st.lo;
    const initialTile = cache.__getTilesForTests().get(targetTileId);
    expect(initialTile?.refScale).toBe(1.0);

    const initialBitmaps = bitmaps;

    // 缩放到 1.01（变化 1% <= STALE_TOL = 2%）
    cache.draw(CTX, makeRc(g, 1.01, true));
    cache.__flushPlayingTileQueueForTests();

    // 瓦片应当复用，不产生新位图
    const currentTile = cache.__getTilesForTests().get(targetTileId);
    expect(currentTile).toBe(initialTile);
    expect(bitmaps).toBe(initialBitmaps);
  });

  it('播放中缩放后暂停：暂停帧同步重建视口瓦片，立即恢复清晰', () => {
    const g = geometry();
    // 1) 初始 0.2 下建好
    cache.draw(CTX, makeRc(g, 0.2, true));
    cache.__flushPlayingTileQueueForTests();

    // 2) 播放中缩放到 0.8
    cache.draw(CTX, makeRc(g, 0.8, true));
    const st0 = cache.__getLastNoteLayerStats();
    // 播放帧不同步重建
    expect(st0.rebuilt).toBe(0);

    // 3) 立即暂停播放（rc.playing = false），且不手动 flush 异步队列
    cache.draw(CTX, makeRc(g, 0.8, false));
    const stPaused = cache.__getLastNoteLayerStats();
    // 暂停帧同步重建了视口瓦片
    expect(stPaused.rebuilt).toBeGreaterThan(0);

    // 查找被重建为 0.8 的瓦片
    const rebuiltTiles = [...cache.__getTilesForTests().entries()]
      .filter(([_, t]) => t.refScale === 0.8)
      .map(([id]) => id);
    expect(rebuiltTiles.length).toBeGreaterThan(0);
  });
});
