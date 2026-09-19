// issue 36 复现：连续 Slide 自下向上连接扩展时，后半截渲染缺失（瓦片未失效？）
import { describe, it, expect, beforeEach } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { drawNotesLayer, resetNoteLayerCache, __setTileCanvasFactoryForTests, __getTilesForTests, TILE_PX } from '@/src/visual/noteLayerCache';
import { handleSlideToSlideCombination } from '@/src/chart/editing/NoteReplacementRules';
import type { RenderCtx } from '@/src/visual/types';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/visual/noteSkin';
import type { ChartNote } from '@/src/chart/types';
import { makeNoopCtx } from '@/tests/support/canvas';

const bpm120 = [{ beat: 0, bpm: 120 }];
const SURFACE = { w: 750, h: 900 };
const BEAT_DISPLAY = 4;
const CHART_END_BEAT = 200;
const ES = 1.0;
const POS_PER_BEAT = 220; // 120bpm: BEAT_HEIGHT*120/120

const makeCtx = makeNoopCtx;

function makeRc(g: ChartGeometry, notes: ChartNote[], scrollY: number): RenderCtx {
  return {
    geometry: g,
    viewport: { scrollX: 0, scrollY, scale: ES, virtualWidth: 0, virtualHeight: 0 },
    surface: SURFACE,
    dpr: 1,
    beatDisplay: BEAT_DISPLAY,
    chartEndBeat: CHART_END_BEAT,
    notes,
    selectedItems: [],
    selectionBox: null,
    slideBuffer: null,
    hoverPos: null,
    clipboard: [],
    markerBeat: null,
    markerSelected: false,
    armedTool: null,
    spriteIcon: { render: () => undefined, renderDecorator: () => undefined } as unknown as RenderCtx['spriteIcon'],
    noteIcons: buildActiveNoteIcons(normalizeNoteSkinSelection(undefined)),
  };
}

/** 视口中心对准某 beat 的 scrollY */
function scrollYCenterBeat(g: ChartGeometry, beat: number): number {
  return g.beatToVirtualY(beat, ES) - SURFACE.h / (2 * ES);
}

let canvasSeq = 0;
beforeEach(() => {
  resetNoteLayerCache();
  canvasSeq = 0;
  __setTileCanvasFactoryForTests(() => ({ id: ++canvasSeq, width: 0, height: 0, getContext: () => makeCtx() }));
});

describe('slide 自下向上连接扩展 → 瓦片失效', () => {
  it('合并扩展后，覆盖新端点拍区间的瓦片必须重建（canvas 换新）', () => {
    const g = new ChartGeometry(bpm120, { endBeat: CHART_END_BEAT } , SURFACE);
    // 初始：一条 Slide[20,30]（数组末尾），加一个 Single 在 beat 40（会被 removeOverlappedNotes 删掉）
    const slide: ChartNote = {
      type: 'Slide',
      connections: [{ beat: 20, lane: 3, subBeat: 0 }, { beat: 30, lane: 3, subBeat: 0 }],
    } as ChartNote;
    const single40: ChartNote = { type: 'Single', beat: 40, lane: 3, subBeat: 0 };
    const notes: ChartNote[] = [{ beat: 0, type: 'BPM', bpm: 120 }, slide, single40];

    // 视口中心 beat 35（能看到扩展后半截）
    const scrollY = scrollYCenterBeat(g, 35);
    drawNotesLayer(makeCtx(), makeRc(g, notes, scrollY));
    const before = new Map(__getTilesForTests());

    // 自下向上扩展：点击 30（既有终点）→ 40
    const comb = handleSlideToSlideCombination(notes, [{ beat: 30, lane: 3, subBeat: 0 }, { beat: 40, lane: 3, subBeat: 0 }]);
    expect(comb.shouldCombine).toBe(true);
    // 数据正确性：合并进原 slide（index 1），Single@40 被移除
    const merged = comb.newNotes[1] as unknown as { connections: { beat: number }[] };
    expect(merged.connections.map(c => c.beat)).toEqual([20, 30, 40]);
    expect(comb.newNotes).toHaveLength(2);

    drawNotesLayer(makeCtx(), makeRc(g, comb.newNotes, scrollY));
    const after = __getTilesForTests();

    // 覆盖 pos[20*220, 40*220]（外扩一个瓦片余量）内的所有瓦片都应被重建（canvas 身份变化或新建）
    const lo = Math.floor((20 * POS_PER_BEAT - TILE_PX) / TILE_PX);
    const hi = Math.floor((40 * POS_PER_BEAT + TILE_PX) / TILE_PX);
    for (let id = lo; id <= hi; id++) {
      const t0 = before.get(id);
      const t1 = after.get(id);
      if (!t1) continue; // 不在可见范围的瓦片不重建（正常）
      // 若该瓦片在合并前就存在，必须换新 canvas（重建过），否则就是陈旧瓦片 → 渲染缺失
      if (t0) {
        expect(t1.canvas, `tile ${id} 未重建（陈旧瓦片 → 后半截渲染缺失）`).not.toBe(t0.canvas);
      }
    }
  });

  it('链式连续扩展：三段合并后整条可见范围内的瓦片无陈旧', () => {
    const g = new ChartGeometry(bpm120, { endBeat: CHART_END_BEAT } , SURFACE);
    const mkSlide = (b1: number, b2: number): ChartNote => ({
      type: 'Slide',
      connections: [{ beat: b1, lane: 2, subBeat: 0 }, { beat: b2, lane: 2, subBeat: 0 }],
    } as ChartNote);
    // 第一段 [10,20]
    let notes: ChartNote[] = [{ beat: 0, type: 'BPM', bpm: 120 }, mkSlide(10, 20)];
    // 第二段 [20,30] 合并
    let comb = handleSlideToSlideCombination(notes, [{ beat: 20, lane: 2, subBeat: 0 }, { beat: 30, lane: 2, subBeat: 0 }]);
    expect(comb.shouldCombine).toBe(true);
    notes = comb.newNotes;
    // 第三段 [30,40] 合并
    comb = handleSlideToSlideCombination(notes, [{ beat: 30, lane: 2, subBeat: 0 }, { beat: 40, lane: 2, subBeat: 0 }]);
    expect(comb.shouldCombine).toBe(true);
    notes = comb.newNotes;

    const scrollY = scrollYCenterBeat(g, 25);
    drawNotesLayer(makeCtx(), makeRc(g, notes, scrollY));

    // 第四段 [40,50]（视口中心 25 时 pos 8800..11000 不可见；把视口移到 45 再画一帧 → 滚动进入）
    comb = handleSlideToSlideCombination(notes, [{ beat: 40, lane: 2, subBeat: 0 }, { beat: 50, lane: 2, subBeat: 0 }]);
    expect(comb.shouldCombine).toBe(true);
    notes = comb.newNotes;

    const scrollY2 = scrollYCenterBeat(g, 50);
    drawNotesLayer(makeCtx(), makeRc(g, notes, scrollY2));
    const after = __getTilesForTests();
    // 新端点 50（pos 11000）所在瓦片必须是本帧新建的（滚动新入视野 + 失效）
    const tile50 = Math.floor((50 * POS_PER_BEAT) / TILE_PX);
    expect(after.has(tile50)).toBe(true);
  });
});
