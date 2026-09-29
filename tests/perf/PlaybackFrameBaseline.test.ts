// issue 139 播放帧基线（测量，不是改造）。
// node stub 没有 GPU 光栅：数字是 JS 调用次数 + renderChart 墙钟。真 60fps 仍靠页面。
// 谱面 = tests/support/perfBackflowPlayback 合成 fixture（ADR 附录 A 时间轴 + 倒流窗 SP）。
import { describe, it, expect, beforeEach } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { renderChart, visibleBeatRanges } from '@/src/rendering/render';
import { drawStaticLayer, resetStaticLayerCache, __setStaticCanvasFactoryForTests } from '@/src/rendering/pipeline/staticLayerCache';
import { resetNoteLayerCache, __setTileCanvasFactoryForTests } from '@/src/rendering/pipeline/noteLayerCache';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import { getBpmEvents, maxNoteEndSeconds } from '@/src/audio/AudioTiming';
import { PlaybackScrollModel } from '@/src/playback/PlaybackScrollModel';
import { countNotesUpToBeat } from '@/src/chart/editing/NoteEditing';
import { makeCountingCtx, makeCanvasStub, makeTallyingCanvasStub } from '@/tests/support/canvas';
import type { RenderCtx } from '@/src/rendering/types';
import type { ChartNote } from '@/src/chart/types';
import {
  PERF_PLAYBACK_BEAT_DISPLAY, PERF_PLAYBACK_DPR, PERF_PLAYBACK_SURFACE,
  buildBackflowPlaybackNotes,
} from '@/tests/support/perfBackflowPlayback';

const SURFACE = PERF_PLAYBACK_SURFACE;
const BEAT_DISPLAY = PERF_PLAYBACK_BEAT_DISPLAY;
const EMPTY_SELECTED: never[] = [];
const EMPTY_CLIPBOARD: never[] = [];
const SHARED_NOTE_ICONS = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));

function makeRc(
  geometry: ChartGeometry,
  notes: ChartNote[],
  scrollY: number,
  dpr: number,
): RenderCtx {
  const es = geometry.effectiveScale(1);
  return {
    geometry,
    viewport: { scrollX: 0, scrollY, scale: es, virtualWidth: 0, virtualHeight: 0 },
    surface: SURFACE,
    dpr,
    beatDisplay: BEAT_DISPLAY,
    chartEndBeat: geometry.chartEndBeat,
    notes,
    selectedItems: EMPTY_SELECTED,
    selectionBox: null,
    slideBuffer: null,
    hoverPos: null,
    clipboard: EMPTY_CLIPBOARD,
    markerSeconds: null,
    armedTool: null,
    spriteIcon: { render: () => undefined, renderDecorator: () => undefined } as unknown as RenderCtx['spriteIcon'],
    noteIcons: SHARED_NOTE_ICONS,
    playing: true,
  };
}

describe('issue 139 · 播放帧基线（合成倒流 perf 谱）', () => {
  beforeEach(() => {
    resetStaticLayerCache();
    resetNoteLayerCache();
  });

  it('仅 scrollY 变：静态层不每帧重建；同 scrollY 第二次命中', () => {
    const notes = buildBackflowPlaybackNotes();
    const bpm = getBpmEvents(notes);
    const duration = maxNoteEndSeconds(notes, BEAT_DISPLAY, bpm);
    const g = new ChartGeometry(bpm, { seconds: duration }, SURFACE, 1);
    const es = g.effectiveScale(1);
    const model = new PlaybackScrollModel(g, es);
    const rangesAt5 = visibleBeatRanges(g, { scrollX: 0, scrollY: model.scrollYForSeconds(5), scale: es }, g.chartEndBeat);

    const staticDraws = { n: 0 };
    __setStaticCanvasFactoryForTests(() =>
      makeTallyingCanvasStub(() => { staticDraws.n++; }, ['stroke', 'fillText']));
    __setTileCanvasFactoryForTests(() => makeCanvasStub({ drawImage: 0, spriteRenders: 0 }));

    const ctx = makeCountingCtx({ drawImage: 0 });
    const canvas = { width: 0, height: 0 };
    const frames = 60;
    const t0 = 4.8;
    const dt = 1 / 60;
    const dpr = PERF_PLAYBACK_DPR;
    const bitmapPx = Math.round(SURFACE.w * dpr) * Math.round(SURFACE.h * dpr);

    renderChart(ctx, canvas as unknown as HTMLCanvasElement, makeRc(g, notes, model.scrollYForSeconds(t0), dpr));
    resetStaticLayerCache();
    staticDraws.n = 0;

    const staticOnlyMs: number[] = [];
    let rebuildFrames = 0;
    for (let i = 0; i < frames; i++) {
      const sy = model.scrollYForSeconds(t0 + i * dt);
      const before = staticDraws.n;
      const tStatic = performance.now();
      drawStaticLayer(ctx, makeRc(g, notes, sy, dpr));
      staticOnlyMs.push(performance.now() - tStatic);
      if (staticDraws.n > before) rebuildFrames++;
    }

    resetStaticLayerCache();
    staticDraws.n = 0;
    const frameMs: number[] = [];
    let fullRebuilds = 0;
    for (let i = 0; i < frames; i++) {
      const before = staticDraws.n;
      const tStart = performance.now();
      renderChart(ctx, canvas as unknown as HTMLCanvasElement, makeRc(g, notes, model.scrollYForSeconds(t0 + i * dt), dpr));
      frameMs.push(performance.now() - tStart);
      if (staticDraws.n > before) fullRebuilds++;
    }

    const sameSy = model.scrollYForSeconds(5);
    resetStaticLayerCache();
    staticDraws.n = 0;
    drawStaticLayer(ctx, makeRc(g, notes, sameSy, dpr));
    const firstAtSame = staticDraws.n;
    staticDraws.n = 0;
    drawStaticLayer(ctx, makeRc(g, notes, sameSy, dpr));
    const secondAtSame = staticDraws.n;

    const hudT0 = performance.now();
    for (let i = 0; i < frames; i++) {
      const sec = t0 + i * dt;
      countNotesUpToBeat(notes, g.beatOfSeconds(sec));
    }
    const hudMs = (performance.now() - hudT0) / frames;

    const stats = (xs: number[]) => {
      const sorted = [...xs].sort((a, b) => a - b);
      return {
        avg: Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)),
        p95: Number(sorted[Math.floor(sorted.length * 0.95)]!.toFixed(3)),
        max: Number(Math.max(...xs).toFixed(3)),
      };
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      tag: 'issue139-baseline',
      notes: notes.length,
      duration: Number(duration.toFixed(3)),
      chartEndBeat: g.chartEndBeat,
      effectiveScale: es,
      foldRangesAt5s: rangesAt5.length,
      staticBitmapCssPx: `${SURFACE.w}x${SURFACE.h}`,
      staticBitmapDevicePx: bitmapPx,
      playbackFrames: frames,
      staticRebuildFrames: rebuildFrames,
      fullRenderStaticRebuilds: fullRebuilds,
      sameScrollY: { firstDraws: firstAtSame, secondDraws: secondAtSame },
      drawStaticLayerJsMs: stats(staticOnlyMs),
      renderChartJsMs: stats(frameMs),
      hudCountNotesMsPerTick: Number(hudMs.toFixed(4)),
      budget60HzMs: 16.7,
      note: 'node stub 无 GPU：devicePx 是每帧 miss 时会清/重画的缓冲面积，墙钟偏低估',
    }));

    expect(firstAtSame).toBeGreaterThan(0);
    expect(secondAtSame).toBe(0);
    expect(rebuildFrames).toBeLessThan(frames);
    expect(fullRebuilds).toBeLessThan(frames);
  });
});
