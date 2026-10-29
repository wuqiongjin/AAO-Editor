// issue 140：高倍倒流 SP 扫描线仍贵；播放热身只 blit。谱面 = tests/support/perfBackflowPlayback 合成 fixture。
// 计时口径（test-infra 02）：CPU 时间最小值 + 显式 liveness 超时，不拿默认 5s 当性能预算。
import { describe, it, expect } from 'vitest';
import { ChartGeometry, LANE_WIDTH } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/rendering/coords';
import { rasterBandRuns, splitBandAtFolds } from '@/src/rendering/slideBandGeometry';
import { isSpRegion, projectedSlideSpans } from '@/src/chart/editing/SlideSegments';
import { PlaybackScrollModel } from '@/src/playback/PlaybackScrollModel';
import {
  TILE_PX, clipTileDrawRect, posRangeOf, tileIndexRange, tileBlitRect,
} from '@/src/rendering/pipeline/noteLayerCache';
import { makeCountingCtx, makeCanvasStub } from '@/tests/support/canvas';
import { renderChart } from '@/src/rendering/render';
import { createRenderTarget } from '@/src/rendering/RenderTarget';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import type { RenderCtx } from '@/src/rendering/types';
import type { ChartNote, SlideNote } from '@/src/chart/types';
import {
  BACKFLOW_RASTER_PROFILE, BACKFLOW_RASTER_RGB, PERF_PLAYBACK_BEAT_DISPLAY, PERF_PLAYBACK_DPR,
  PERF_PLAYBACK_SURFACE, buildBackflowPlaybackNotes, geometryForBackflowPlayback,
} from '@/tests/support/perfBackflowPlayback';
import { minCpuMs } from '@/tests/support/perfTiming';

const SURFACE = PERF_PLAYBACK_SURFACE;
const BEAT_DISPLAY = PERF_PLAYBACK_BEAT_DISPLAY;
const DPR = PERF_PLAYBACK_DPR;
const PROFILE = BACKFLOW_RASTER_PROFILE;
const RGB = BACKFLOW_RASTER_RGB;

type RasterJob = { runs: { x: number; y: number }[][]; half: number; pts: number };

function collectSpJobs(
  notes: ChartNote[],
  g: ChartGeometry,
  scrollY: number,
  userScale: number,
): { vis: number; jobs: RasterJob[] } {
  const es = g.effectiveScale(userScale);
  const vp = { scrollX: 0, scrollY, scale: userScale, virtualWidth: 0, virtualHeight: 0 };
  const c = makeCoords(g, vp, BEAT_DISPLAY, notes);
  const vis = c.getVisibleNotes();
  const half = (LANE_WIDTH * es) / 2;
  const jobs: RasterJob[] = [];
  for (const { note } of vis) {
    if (note.type !== 'Slide' && note.type !== 'Long') continue;
    const slide = note as SlideNote;
    const proj = projectedSlideSpans(slide.connections);
    for (const sp of proj.regions) {
      if (sp.end - sp.start <= 1 || !isSpRegion(proj.conns, sp.start)) continue;
      const pts: { x: number; y: number }[] = [];
      for (let i = sp.start; i <= sp.end; i++) {
        const cn = proj.conns[i]!;
        pts.push(c.virtualToCanvas(c.getNoteVirtualX(cn.lane), c.getNoteVirtualY(cn.beat, cn.subBeat || 0)));
      }
      jobs.push({ runs: splitBandAtFolds(pts), half, pts: pts.length });
    }
  }
  return { vis: vis.length, jobs };
}

/** 一趟 raster 的像素量（只量工作量，时间另计） */
function rasterPx(
  jobs: RasterJob[],
  sx: number,
  sy: number,
  clip: { minX: number; minY: number; maxX: number; maxY: number },
): number {
  let px = 0;
  for (const j of jobs) {
    const r = rasterBandRuns({
      runs: j.runs, half: j.half, profile: PROFILE, rgb: RGB, sx, sy, baseAlpha: 1, clipCss: clip,
    });
    if (r) px += r.bw * r.bh;
  }
  return px;
}

describe('issue 140 · 高倍倒流 SP 成本', () => {
  const notes = buildBackflowPlaybackNotes();

  // 成本按**进程 CPU 时间的最小值**计（`tests/support/perfTiming.ts`）：墙钟在多 worker 抢占下
  // 会被放大数倍，曾把这条用例顶过默认 5s 超时（test-infra 02）。像素量只与几何有关，不需重测。
  it('es=3 折返扫描线比非折返贵、比 es=1 像素多', () => {
    const g1 = geometryForBackflowPlayback(notes, 1);
    const g3 = geometryForBackflowPlayback(notes, 3);
    const viewClip = { minX: 0, minY: 0, maxX: SURFACE.w, maxY: SURFACE.h };

    const jobsAt = (g: ChartGeometry, scale: number, seconds: number) => collectSpJobs(
      notes, g, new PlaybackScrollModel(g, g.effectiveScale(scale)).scrollYForSeconds(seconds), scale,
    ).jobs;
    const costMs = (jobs: RasterJob[]) => minCpuMs(() => rasterPx(jobs, DPR, DPR, viewClip), 3);

    const es1Jobs = jobsAt(g1, 1, 5);
    const es3Jobs = jobsAt(g3, 3, 5);
    const t30Jobs = jobsAt(g3, 3, 30);

    expect(g3.effectiveScale(3)).toBeGreaterThan(2.5);
    expect(costMs(es3Jobs)).toBeGreaterThan(costMs(t30Jobs));
    expect(rasterPx(es3Jobs, DPR, DPR, viewClip)).toBeGreaterThan(rasterPx(es1Jobs, DPR, DPR, viewClip));
  }, 30_000);

  it('es=3 折返播放热身后 rebuilt=0，裁切 blit 面积 ≤ 视口 × 瓦片张数', () => {
    const g = geometryForBackflowPlayback(notes, 3);
    const es = g.effectiveScale(3);
    const model = new PlaybackScrollModel(g, es);
    const icons = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));
    const makeRc = (scrollY: number): RenderCtx => ({
      geometry: g,
      viewport: { scrollX: 0, scrollY, scale: es, virtualWidth: 0, virtualHeight: 0 },
      surface: SURFACE,
      dpr: DPR,
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
      noteIcons: icons,
      playing: true,
    });
    const ctx = makeCountingCtx({ drawImage: 0 });
    const target = createRenderTarget({
      canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement,
      surface: SURFACE,
      dpr: DPR,
    });
    target.noteLayer.__setCanvasFactoryForTests(() => makeCanvasStub({ drawImage: 0, spriteRenders: 0 }));
    target.staticLayer.__setCanvasFactoryForTests(() => makeCanvasStub({ drawImage: 0, spriteRenders: 0 }));
    const t0 = 4.8;
    renderChart(target, makeRc(model.scrollYForSeconds(t0)));
    target.noteLayer.__flushPlayingTileQueueForTests();
    let rebuildSum = 0;
    let maxBlit = 0;
    for (let i = 1; i <= 30; i++) {
      renderChart(target, makeRc(model.scrollYForSeconds(t0 + i / 60)));
      const st = target.noteLayer.__getLastNoteLayerStats();
      rebuildSum += st.rebuilt;
      maxBlit = Math.max(maxBlit, st.blitCssPx);
    }
    const rc = makeRc(model.scrollYForSeconds(5));
    const { posMin, posMax } = posRangeOf(rc);
    const { lo, hi } = tileIndexRange(posMin, posMax);
    const tileCount = hi - lo + 1;
    const fullTileCss = SURFACE.w * TILE_PX * es;
    const viewCss = SURFACE.w * SURFACE.h;
    const dest = tileBlitRect(lo, es, es, (g.chartEndVirtualY - rc.viewport.scrollY) * es + SURFACE.h, SURFACE.w);
    const clipped = clipTileDrawRect(dest, SURFACE.w, SURFACE.h, 1000, 1000);

    expect(rebuildSum).toBeLessThanOrEqual(2);
    expect(maxBlit).toBeLessThanOrEqual(viewCss * tileCount + 1);
    expect(maxBlit).toBeLessThan(fullTileCss * tileCount);
    expect(maxBlit).toBeLessThanOrEqual(viewCss + 1);
    expect(clipped?.dh).toBeLessThanOrEqual(SURFACE.h);
  });
});
