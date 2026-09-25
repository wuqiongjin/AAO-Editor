// issue 140：工具栏 300%（es=3）仍走 pos 瓦片；播放热身后只 blit，不每帧直渲扫描线。
import { describe, it, expect, beforeEach } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { drawNotesLayer, resetNoteLayerCache, __setTileCanvasFactoryForTests, __getTilesForTests, __flushPlayingTileQueueForTests, __getLastNoteLayerStats, clipTileDrawRect } from '@/src/visual/noteLayerCache';
import type { RenderCtx } from '@/src/visual/types';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/visual/noteSkin';
import type { ChartNote } from '@/src/chart/types';
import { makeNoopCtx } from '@/tests/support/canvas';

const bpm120 = [{ beat: 0, bpm: 120 }];
const SURFACE = { w: 750, h: 900 };
const ES = 3;
const NOTES: ChartNote[] = [
  { beat: 0, type: 'BPM', bpm: 120 },
  { type: 'Single', lane: 3, beat: 8, subBeat: 0 },
];

function makeRc(g: ChartGeometry, scrollY: number, playing: boolean): RenderCtx {
  return {
    geometry: g,
    viewport: { scrollX: 0, scrollY, scale: ES, virtualWidth: 0, virtualHeight: 0 },
    surface: SURFACE,
    dpr: 1,
    beatDisplay: 4,
    chartEndBeat: g.chartEndBeat,
    notes: NOTES,
    selectedItems: [],
    selectionBox: null,
    slideBuffer: null,
    hoverPos: null,
    clipboard: [],
    markerBeat: null,
    armedTool: null,
    spriteIcon: { render: () => undefined, renderDecorator: () => undefined } as unknown as RenderCtx['spriteIcon'],
    noteIcons: buildActiveNoteIcons(normalizeNoteSkinSelection(undefined)),
    playing,
  };
}

describe('issue 140 · 高倍仍走瓦片', () => {
  let canvases = 0;
  beforeEach(() => {
    resetNoteLayerCache();
    canvases = 0;
    __setTileCanvasFactoryForTests(() => {
      canvases++;
      return { width: 0, height: 0, getContext: () => makeNoopCtx() };
    });
  });

  it('es=3 播放：当帧不建瓦片，flush 后热身；随后滚动帧不再新建位图', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 40 }, SURFACE);
    const y0 = g.beatToVirtualY(8, ES) - SURFACE.h / (2 * ES);
    drawNotesLayer(makeNoopCtx(), makeRc(g, y0, true));
    expect(__getTilesForTests().size).toBe(0);
    expect(__getLastNoteLayerStats().rebuilt).toBe(0);
    __flushPlayingTileQueueForTests();
    expect(__getTilesForTests().size).toBeGreaterThan(0);
    const afterWarm = canvases;
    expect(afterWarm).toBeGreaterThan(0);

    for (let i = 1; i <= 8; i++) {
      drawNotesLayer(makeNoopCtx(), makeRc(g, y0 + i * 4, true));
    }
    expect(canvases).toBe(afterWarm);
  });

  it('高倍瓦片 dest 高于视口时源矩形只覆盖可见带', () => {
    const dest = { x: 0, y: -600, w: 750, h: 1536 };
    const c = clipTileDrawRect(dest, 750, 900, 1125, 2304);
    expect(c).not.toBeNull();
    expect(c!.dy).toBe(0);
    expect(c!.dh).toBe(900);
    expect(c!.dw).toBe(750);
    expect(c!.sh).toBeCloseTo(900 / 1536 * 2304, 5);
    expect(clipTileDrawRect({ x: 0, y: 900, w: 750, h: 1536 }, 750, 900, 1125, 2304)).toBeNull();
  });
});
