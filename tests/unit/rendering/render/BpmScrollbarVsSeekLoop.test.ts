// 回归：seek(0) 与滚动条滚到 DOM 底，beat 0 BPM 整盒可见。
import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/rendering/coords';
import { renderBpmLabels } from '@/src/rendering/render';
import {
  bpmLabelAnchorY, bpmGutterYIntersectsCanvas, GUTTER_LABEL_FONT_PX,
} from '@/src/rendering/gutterLabels';
import { PlaybackScrollModel } from '@/src/playback/PlaybackScrollModel';
import { isProgrammaticScrollEcho, registerScrollEcho, SCROLL_ECHO_TTL_MS } from '@/src/playback/useScrollModel';
import { makeRecordingCtx, fillTexts } from '@/tests/support/canvas';

const bpm120 = [{ beat: 0, bpm: 120 }];
const FONT = GUTTER_LABEL_FONT_PX;

type Kind = 'full' | 'partial' | 'none';

function classify(anchorY: number, h: number): Kind {
  const half = FONT / 2;
  if (!bpmGutterYIntersectsCanvas(anchorY, FONT, h)) return 'none';
  if (anchorY - half >= -1e-9 && anchorY + half <= h + 1e-9) return 'full';
  return 'partial';
}

function lineYAt(g: ChartGeometry, es: number, scrollY: number): number {
  return g.virtualToCanvas(0, g.beatToVirtualY(0, es), { scrollX: 0, scrollY, scale: es }).y;
}

/** 与 FinalVirtualCanvas.setScrollY 同一公式（viewport.scale 当 es 用）。 */
function productSetScrollY(g: ChartGeometry, scale: number, requested: number, h: number): number {
  const bounds = g.scaledVirtualBounds(scale);
  return Math.max(bounds.minY, Math.min(bounds.maxY - h / scale, requested));
}

function kindAfter(g: ChartGeometry, es: number, h: number, scrollY: number): Kind {
  const sy = productSetScrollY(g, es, scrollY, h);
  return classify(bpmLabelAnchorY(0, lineYAt(g, es, sy), FONT, h), h);
}

function renderKind(g: ChartGeometry, es: number, h: number, scrollY: number): Kind {
  const sy = productSetScrollY(g, es, scrollY, h);
  const note = { type: 'BPM' as const, beat: 0, bpm: 120 };
  const vp = { scrollX: 0, scrollY: sy, scale: es };
  const c = makeCoords(g, vp, 4, [note]);
  const rc = {
    geometry: g, viewport: vp, surface: { w: 750, h }, chartEndBeat: 8, beatDisplay: 4,
    notes: [note],
    display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true, labelScale: 1 },
  } as never;
  const { proxy, calls } = makeRecordingCtx();
  renderBpmLabels(proxy, c, rc);
  const fills = fillTexts(calls);
  if (fills.length === 0) return 'none';
  return classify(fills[0][1][2] as number, h);
}

describe('滚动条到底 vs seek(0)，beat 0 BPM 整盒', () => {
  it('seek(0) 经 setScrollY 钳制后整盒', () => {
    const bad: unknown[] = [];
    for (const h of [400, 753, 900, 1117]) {
      for (const es of [0.5, 0.88, 1, 1.25, 2]) {
        const g = new ChartGeometry(bpm120, { endBeat: 32 }, { w: 750, h });
        const model = new PlaybackScrollModel(g, es);
        const sy = model.scrollYForSeconds(0);
        const k = kindAfter(g, es, h, sy);
        if (k !== 'full') bad.push({ path: 'seek0', h, es, sy, k, chartEnd: g.chartEndVirtualY });
      }
    }
    expect(bad).toEqual([]);
  });

  it('滚动条 DOM max / max-1 / max-2 经映射+钳制后整盒（无 echo）', () => {
    const bad: unknown[] = [];
    for (const h of [400, 753, 900, 1117]) {
      for (const es of [0.5, 0.88, 1, 1.25, 2]) {
        const g = new ChartGeometry(bpm120, { endBeat: 32 }, { w: 750, h });
        const model = new PlaybackScrollModel(g, es);
        const maxScroll = Math.max(1, Math.round(g.totalVirtualHeight(es)) - h);
        for (const top of [maxScroll, maxScroll - 1]) {
          if (top < 0) continue;
          const requested = model.scrollTopToCanvasScrollY(top, maxScroll);
          const k = kindAfter(g, es, h, requested);
          if (k !== 'full') bad.push({ path: 'bar', h, es, top, maxScroll, requested, k, vis: renderKind(g, es, h, requested) });
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('登记过 expected=max 且 TTL 已过：用户滚回底边整盒（与 seek(0) 同口径）', () => {
    const bad: unknown[] = [];
    for (const h of [400, 753, 900, 1117]) {
      for (const es of [0.5, 0.88, 1, 1.25, 2]) {
        const g = new ChartGeometry(bpm120, { endBeat: 32 }, { w: 750, h });
        const model = new PlaybackScrollModel(g, es);
        const maxScroll = Math.max(1, Math.round(g.totalVirtualHeight(es)) - h);
        const gate = registerScrollEcho(maxScroll, 0);
        let sy = 0;
        const now = SCROLL_ECHO_TTL_MS + 1;
        for (const top of [0, Math.floor(maxScroll / 2), maxScroll - 80, maxScroll - 2, maxScroll - 1, maxScroll]) {
          if (top < 0) continue;
          if (isProgrammaticScrollEcho(top, gate, now)) continue;
          sy = productSetScrollY(g, es, model.scrollTopToCanvasScrollY(top, maxScroll), h);
        }
        const k = kindAfter(g, es, h, sy);
        if (k !== 'full') {
          bad.push({ h, es, maxScroll, sy, k, vis: renderKind(g, es, h, sy) });
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
