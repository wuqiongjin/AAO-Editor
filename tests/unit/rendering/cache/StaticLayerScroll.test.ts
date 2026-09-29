// issue 139 锁测 1：仅 scrollY 变不得再跑网格重建；倒流折返带横线仍在（104/105）。
import { describe, it, expect, beforeEach } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { createStaticLayerCache, type StaticLayerCache } from '@/src/rendering/pipeline/staticLayerCache';
import { renderGrid } from '@/src/rendering/render';
import { makeCoords } from '@/src/rendering/coords';
import { makeCountingCtx, makeTallyingCanvasStub, makeRecordingCtx } from '@/tests/support/canvas';
import type { RenderCtx } from '@/src/rendering/types';
import type { BpmTimelineEvent } from '@/src/chart/geometry/BpmTimeline';

const SURFACE = { w: 750, h: 900 };
const bpm120: BpmTimelineEvent[] = [{ beat: 0, bpm: 120 }];
const FOLD: BpmTimelineEvent[] = [{ beat: 0, bpm: 120 }, { beat: 5, bpm: -240 }, { beat: 6.5, bpm: 120 }];

function makeRc(g: ChartGeometry, scrollY: number): RenderCtx {
  const es = g.effectiveScale(1);
  return {
    geometry: g,
    viewport: { scrollX: 0, scrollY, scale: es, virtualWidth: 0, virtualHeight: 0 },
    surface: SURFACE,
    dpr: 1,
    beatDisplay: 4,
    chartEndBeat: g.chartEndBeat,
    notes: [],
    selectedItems: [],
    selectionBox: null,
    slideBuffer: null,
    hoverPos: null,
    clipboard: [],
    markerSeconds: null,
    armedTool: null,
  } as unknown as RenderCtx;
}

describe('issue 139 · 静态层随 scrollY blit', () => {
  // 候选 3：缓存有主——每个用例一份实例（模块级单例已删除）
  let cache: StaticLayerCache;
  beforeEach(() => {
    cache = createStaticLayerCache();
  });

  it('仅 scrollY 变时第二次 draw 不再 stroke/fillText（修前会跑 renderGrid）', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 64 }, SURFACE);
    const staticDraws = { n: 0 };
    cache.__setCanvasFactoryForTests(() =>
      makeTallyingCanvasStub(() => { staticDraws.n++; }, ['stroke', 'fillText']));
    const ctx = makeCountingCtx({ drawImage: 0 });
    const sy = g.beatToVirtualY(8, 1) - SURFACE.h / 2;
    cache.draw(ctx, makeRc(g, sy));
    expect(staticDraws.n).toBeGreaterThan(0);
    staticDraws.n = 0;
    cache.draw(ctx, makeRc(g, sy + 12));
    expect(staticDraws.n).toBe(0);
  });

  it('倒流折返带：renderGrid 仍画出 beat 5/6/7 三层整拍线（issue 104/105 不回退）', () => {
    const g = new ChartGeometry(FOLD, { seconds: 2.5 }, SURFACE);
    const viewport = { scrollX: 0, scrollY: 700, scale: 1 };
    const rc = makeRc(g, 700);
    const c = makeCoords(g, viewport, 4, []);
    const { proxy, calls } = makeRecordingCtx();
    renderGrid(proxy, c, rc);
    const trackBgX = c.trackGeometry(1).trackBgX;
    const beatYs: number[] = [];
    let width = 0;
    let pendingX: number | null = null;
    let pendingY: number | null = null;
    for (const [k, args] of calls) {
      if (k === 'lineWidth') width = args[0] as number;
      else if (k === 'moveTo') { pendingX = args[0] as number; pendingY = args[1] as number; }
      else if (k === 'stroke' && pendingY !== null && pendingX === trackBgX && width === 2) {
        beatYs.push(pendingY);
        pendingX = null;
        pendingY = null;
      }
    }
    const yOf = (beat: number) => c.virtualToCanvas(0, c.beatToVirtualY(beat)).y;
    for (const beat of [5, 6, 7]) {
      expect(beatYs.some((y) => Math.abs(y - yOf(beat)) < 1e-6)).toBe(true);
    }
  });
});
