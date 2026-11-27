// issue 140：工具栏 300%（es=3）仍走 pos 瓦片；播放热身后只 blit，不每帧直渲扫描线。
import { describe, it, expect, beforeEach } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { createNoteLayerCache, clipTileDrawRect, type NoteLayerCache } from '@/src/rendering/pipeline/noteLayerCache';
import type { RenderCtx } from '@/src/rendering/types';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import type { ChartNote } from '@/src/chart/types';
import { makeNoopCtx, makeRecordingCtx } from '@/tests/support/canvas';

const bpm120 = [{ beat: 0, bpm: 120 }];
const SURFACE = { w: 750, h: 900 };
const ES = 3;
const NOTES: ChartNote[] = [
  { beat: 0, type: 'BPM', bpm: 120 },
  { type: 'Single', lane: 3, beat: 8, subBeat: 0 },
];

function makeRc(
  g: ChartGeometry,
  scrollY: number,
  playing: boolean,
  extra: Partial<RenderCtx> = {},
): RenderCtx {
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
    markerSeconds: null,
    armedTool: null,
    spriteIcon: { render: () => undefined, renderDecorator: () => undefined } as unknown as RenderCtx['spriteIcon'],
    noteIcons: buildActiveNoteIcons(normalizeNoteSkinSelection(undefined)),
    playing,
    ...extra,
  };
}

describe('issue 140 · 高倍仍走瓦片', () => {
  // 候选 3：缓存有主——每个用例一份实例（模块级单例已删除）
  let cache: NoteLayerCache;
  let canvases = 0;
  beforeEach(() => {
    cache = createNoteLayerCache();
    canvases = 0;
    cache.__setCanvasFactoryForTests(() => {
      canvases++;
      return { width: 0, height: 0, getContext: () => makeNoopCtx() };
    });
  });

  it.each([1, 1.25, 2])('issue 238：%sx DPR 的 1:1 瓦片保留亚像素平滑，避免高阶采样管线并恢复调用方状态', dpr => {
    const g = new ChartGeometry(bpm120, { endBeat: 40 }, SURFACE);
    const y = g.beatToVirtualY(8, ES) - SURFACE.h / (2 * ES) + 0.125;
    const samples: { smooth: boolean; quality: ImageSmoothingQuality }[] = [];
    const { proxy: ctx } = makeRecordingCtx({
      drawImage: () => samples.push({ smooth: ctx.imageSmoothingEnabled, quality: ctx.imageSmoothingQuality }),
    });
    ctx.imageSmoothingEnabled = false;
    ctx.imageSmoothingQuality = 'low';
    cache.draw(ctx, makeRc(g, y, false, { dpr }));
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every(s => s.smooth && s.quality === 'medium')).toBe(true);
    expect(ctx.imageSmoothingEnabled).toBe(false);
    expect(ctx.imageSmoothingQuality).toBe('low');
  });

  it('issue 238：容器改宽后旧瓦片仅居中平移，继续保留 1:1 平滑采样', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 40 }, SURFACE);
    const y = g.beatToVirtualY(8, ES) - SURFACE.h / (2 * ES) + 0.125;
    const rc = makeRc(g, y, false, { dpr: 1.25 });
    cache.draw(makeNoopCtx(), rc);
    const samples: ImageSmoothingQuality[] = [];
    const { proxy: ctx } = makeRecordingCtx({ drawImage: () => samples.push(ctx.imageSmoothingQuality) });
    cache.draw(ctx, { ...rc, surface: { w: SURFACE.w + 10, h: SURFACE.h } });
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every(quality => quality === 'medium')).toBe(true);
  });

  it.each(['zoom', 'density'] as const)('issue 238：%s 导致的实际重采样仍使用高质量滤波', change => {
    const g = new ChartGeometry(bpm120, { endBeat: 40 }, SURFACE);
    const y = g.beatToVirtualY(8, ES) - SURFACE.h / (2 * ES) + 0.125;
    const rc = makeRc(g, y, false, { dpr: change === 'density' ? 3 : 1.25 });
    cache.draw(makeNoopCtx(), rc);
    const samples: ImageSmoothingQuality[] = [];
    const { proxy: ctx } = makeRecordingCtx({ drawImage: () => samples.push(ctx.imageSmoothingQuality) });
    const next = { ...rc };
    if (change === 'zoom') next.viewport = { ...rc.viewport, scale: ES * 0.995 };
    cache.draw(ctx, next);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every(quality => quality === 'high')).toBe(true);
  });

  it('es=3 播放：当帧不建瓦片，flush 后热身；随后滚动帧不再新建位图', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 40 }, SURFACE);
    const y0 = g.beatToVirtualY(8, ES) - SURFACE.h / (2 * ES);
    cache.draw(makeNoopCtx(), makeRc(g, y0, true));
    expect(cache.__getTilesForTests().size).toBe(0);
    expect(cache.__getLastNoteLayerStats().rebuilt).toBe(0);
    cache.__flushPlayingTileQueueForTests();
    expect(cache.__getTilesForTests().size).toBeGreaterThan(0);
    const afterWarm = canvases;
    expect(afterWarm).toBeGreaterThan(0);

    for (let i = 1; i <= 8; i++) {
      cache.draw(makeNoopCtx(), makeRc(g, y0 + i * 4, true));
    }
    expect(canvases).toBe(afterWarm);
  });

  it('directNotes：预览面板/导出走直渲 —— 一块瓦片都不建，且报告 direct 模式', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 40 }, SURFACE);
    const y0 = g.beatToVirtualY(8, ES) - SURFACE.h / (2 * ES);

    // 默认（编辑器现状）：走瓦片
    cache.draw(makeNoopCtx(), makeRc(g, y0, false));
    expect(cache.__getLastNoteLayerStats().layerMode).toBe('tiles');
    expect(canvases).toBeGreaterThan(0);
    expect(cache.__getTilesForTests().size).toBeGreaterThan(0);

    // chart-preview 08：一次性出图的用法直渲（避开瓦片的最近邻 blit 与无谓重建）
    const fresh = createNoteLayerCache();
    let freshCanvases = 0;
    fresh.__setCanvasFactoryForTests(() => {
      freshCanvases++;
      return { width: 0, height: 0, getContext: () => makeNoopCtx() };
    });
    fresh.draw(makeNoopCtx(), makeRc(g, y0, false, { directNotes: true }));
    expect(fresh.__getLastNoteLayerStats().layerMode).toBe('direct');
    expect(fresh.__getTilesForTests().size).toBe(0);
    expect(freshCanvases).toBe(0);   // 不建瓦片位图
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
