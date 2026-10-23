// issue 173 锁测：手势期的瓦片重建必须**轮转**（不得饿死视口上方的瓦片），
// 且慢机/被抢占时不能退化成「只有最下面一块变清晰 + 松手 settle 一次性集中重建」。
//
// 为什么用假时钟：真机只能靠压 CPU 才复现（不稳定），而缺陷本质是「预算被吃光时从哪块开始」。
// `performance.now` 每次调用推进固定毫秒 → 每块瓦片的实测成本被钉住，预算耗尽时机完全确定，
// 断言与机器快慢无关。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChartGeometry, LANES } from '@/src/chart/geometry/ChartGeometry';
import {
  createNoteLayerCache,
  posRangeOf,
  tileIndexRange,
  type NoteLayerCache,
} from '@/src/rendering/pipeline/noteLayerCache';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import type { RenderCtx } from '@/src/rendering/types';
import type { ChartNote } from '@/src/chart/types';
import { makeNoopCtx } from '@/tests/support/canvas';

const bpm120 = [{ beat: 0, bpm: 120 }];
const SURFACE = { w: 750, h: 900 };
const BEAT_DISPLAY = 4;
const CHART_END_BEAT = 1500;
const CENTER_BEAT = 750;
const ICONS = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));

/** 每拍 1 个单键（1500 个）→ 512 pos px 的瓦片里恒有音符，瓦片非空 */
function makeNotes(endBeat: number): ChartNote[] {
  const notes: ChartNote[] = [];
  for (let beat = 0; beat < endBeat; beat++) {
    notes.push({ type: 'Single', lane: beat % LANES, beat, subBeat: 0 } as ChartNote);
  }
  return notes;
}

const NOTES = makeNotes(CHART_END_BEAT);

function makeRc(g: ChartGeometry, es: number, zoomGesture: boolean, sprites: { n: number }): RenderCtx {
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
    spriteIcon: { render: () => { sprites.n++; }, renderDecorator: () => undefined } as unknown as RenderCtx['spriteIcon'],
    noteIcons: ICONS,
    zoomGesture,
  };
}

function visibleTileIds(rc: RenderCtx): number[] {
  const { posMin, posMax } = posRangeOf(rc);
  const { lo, hi } = tileIndexRange(posMin, posMax);
  const ids: number[] = [];
  for (let id = lo; id <= hi; id++) ids.push(id);
  return ids;
}

describe('issue 173 · 手势重建的公平性（轮转 + 单块成本上限）', () => {
  let cache: NoteLayerCache;
  let sprites: { n: number };

  beforeEach(() => {
    cache = createNoteLayerCache();
    sprites = { n: 0 };
    cache.__setCanvasFactoryForTests(() => ({ width: 0, height: 0, getContext: () => makeNoopCtx() }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 跑 k 帧缩放手势，返回每帧重建过的瓦片 id（瓦片对象身份变化 = 本帧重建） */
  function gesture(cacheRef: NoteLayerCache, g: ChartGeometry, frames: number): number[][] {
    const out: number[][] = [];
    for (let k = 1; k <= frames; k++) {
      const es = 0.4 * Math.pow(1.1, k);
      const rc = makeRc(g, es, true, sprites);
      const before = new Map(cacheRef.__getTilesForTests());
      const ids = visibleTileIds(rc);
      cacheRef.draw(makeNoopCtx(), rc);
      const after = cacheRef.__getTilesForTests();
      out.push(ids.filter((id) => after.get(id) !== before.get(id)));
    }
    return out;
  }

  function firstFrame(g: ChartGeometry) {
    const rc = makeRc(g, 0.4, false, sprites);
    cache.draw(makeNoopCtx(), rc);
    return rc;
  }

  it('预算被吃光（每次 now +1.5ms）时仍轮转：手势期内每个最终可见瓦片都被重建过', () => {
    const g = new ChartGeometry(bpm120, { endBeat: CHART_END_BEAT }, SURFACE);
    const clock = { t: 0 };
    vi.spyOn(performance, 'now').mockImplementation(() => (clock.t += 1.5));
    firstFrame(g);
    const perFrame = gesture(cache, g, 9);

    // 每帧确实有进展、且被预算掐住（不是一次建完）
    expect(perFrame.every((ids) => ids.length >= 1)).toBe(true);
    expect(perFrame.every((ids) => ids.length <= 2)).toBe(true);

    // 核心不变量：最终可见的每一块都在手势期内轮到过（旧实现恒从 lo 重扫 → 高 id 永远轮不到）
    const finalIds = visibleTileIds(makeRc(g, 0.4 * Math.pow(1.1, 9), true, sprites));
    const rebuiltEver = new Set(perFrame.flat());
    for (const id of finalIds) {
      expect(rebuiltEver.has(id), `瓦片 ${id} 在整个手势期一次都没重建（饿死）`).toBe(true);
    }
  });

  it('单块成本超上限（每次 now +5ms）时，本帧只建一块，但仍然轮转', () => {
    const g = new ChartGeometry(bpm120, { endBeat: CHART_END_BEAT }, SURFACE);
    const clock = { t: 0 };
    vi.spyOn(performance, 'now').mockImplementation(() => (clock.t += 5));
    firstFrame(g);
    const perFrame = gesture(cache, g, 9);

    // 首块实测 10ms > 8ms 上限 → 本帧收手
    expect(perFrame.every((ids) => ids.length === 1)).toBe(true);
    const finalIds = visibleTileIds(makeRc(g, 0.4 * Math.pow(1.1, 9), true, sprites));
    const rebuiltEver = new Set(perFrame.flat());
    for (const id of finalIds) {
      expect(rebuiltEver.has(id), `瓦片 ${id} 被饿死`).toBe(true);
    }
  });

  it('正常机器（真时钟）不因游标变慢：首个手势帧仍把所有可见 stale 瓦片一次建完，settle 零重建', () => {
    const g = new ChartGeometry(bpm120, { endBeat: CHART_END_BEAT }, SURFACE);
    firstFrame(g);

    const rc = makeRc(g, 0.4 * 1.1, true, sprites);
    const ids = visibleTileIds(rc);
    cache.draw(makeNoopCtx(), rc);
    expect(cache.__getLastNoteLayerStats().rebuilt).toBe(ids.length); // 全部一次建完（与改造前一致）

    // 走完手势后 settle：可见瓦片都已转新 → 零重建
    gesture(cache, g, 9);
    const settleRc = makeRc(g, 0.4 * Math.pow(1.1, 9), false, sprites);
    sprites.n = 0;
    cache.draw(makeNoopCtx(), settleRc);
    expect(sprites.n).toBe(0);
    expect(cache.__getLastNoteLayerStats().rebuilt).toBe(0);
  });
});
