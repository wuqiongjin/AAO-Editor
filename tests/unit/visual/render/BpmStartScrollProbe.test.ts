// 回归：seek(0) 与滚动条滚到开头，beat 0 BPM 整盒在画布内。
import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/visual/coords';
import { renderBpmLabels } from '@/src/visual/render';
import {
  bpmLabelAnchorY, bpmGutterYIntersectsCanvas, GUTTER_LABEL_FONT_PX,
} from '@/src/visual/gutterLabels';
import { PlaybackScrollModel } from '@/src/playback/PlaybackScrollModel';
import { makeRecordingCtx, fillTexts } from '@/tests/support/canvas';

const bpm120 = [{ beat: 0, bpm: 120 }];
const FONT = GUTTER_LABEL_FONT_PX;

type Kind = 'full' | 'partial' | 'none';

function classify(anchorY: number, h: number, fontPx: number): Kind {
  const half = fontPx / 2;
  const top = anchorY - half;
  const bot = anchorY + half;
  const hit = bpmGutterYIntersectsCanvas(anchorY, fontPx, h);
  if (!hit) return 'none';
  if (top >= -1e-9 && bot <= h + 1e-9) return 'full';
  return 'partial';
}

function lineYAt(g: ChartGeometry, scale: number, scrollY: number): number {
  const es = g.effectiveScale(scale);
  const vp = { scrollX: 0, scrollY, scale: es };
  return g.virtualToCanvas(0, g.beatToVirtualY(0, es), vp).y;
}

describe('滚到开头时 beat 0 BPM 整盒可见', () => {
  it('精确 scrollY=chartEnd 与 seek(0) 同口径：整盒', () => {
    for (const h of [240, 401, 600, 753, 900, 1117]) {
      for (const scale of [0.5, 0.88, 1, 1.25, 2]) {
        const g = new ChartGeometry(bpm120, { endBeat: 32 }, { w: 750, h });
        const es = g.effectiveScale(scale);
        const lineY = lineYAt(g, es, g.chartEndVirtualY);
        const anchor = bpmLabelAnchorY(0, lineY, FONT, h);
        expect(classify(anchor, h, FONT), `h=${h} es=${es} lineY=${lineY}`).toBe('full');
      }
    }
  });

  it('整数 scrollTop 在 max 与 max−1：与进度条 0 秒一样整盒', () => {
    for (const h of [400, 600, 753, 900, 1080]) {
      for (const scale of [0.5, 0.7, 1, 1.25, 2]) {
        const g = new ChartGeometry(bpm120, { endBeat: 32 }, { w: 750, h });
        const es = g.effectiveScale(scale);
        const model = new PlaybackScrollModel(g, es);
        const virtualHeight = g.totalVirtualHeight(es);
        const maxScroll = Math.max(1, Math.round(virtualHeight) - h);
        for (const top of [maxScroll, Math.max(0, maxScroll - 1)]) {
          const sy = model.scrollTopToCanvasScrollY(top, maxScroll);
          const lineY = lineYAt(g, es, sy);
          const anchor = bpmLabelAnchorY(0, lineY, FONT, h);
          expect(classify(anchor, h, FONT), `h=${h} es=${es} top=${top}`).toBe('full');
        }
      }
    }
  });

  it('renderBpmLabels：scrollY=chartEnd 时 fill 整盒在画布内', () => {
    const h = 900;
    const g = new ChartGeometry(bpm120, { endBeat: 8 }, { w: 750, h });
    const note = { type: 'BPM' as const, beat: 0, bpm: 120 };
    for (const es of [0.5, 1, 1.25, 2]) {
      const scrollY = g.chartEndVirtualY;
      const vp = { scrollX: 0, scrollY, scale: es };
      const c = makeCoords(g, vp, 4, [note]);
      const rc = {
        geometry: g, viewport: vp, surface: { w: 750, h }, chartEndBeat: 8, beatDisplay: 4,
        notes: [note],
        display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true, labelScale: 1 },
      } as never;
      const { proxy, calls } = makeRecordingCtx();
      renderBpmLabels(proxy, c, rc);
      const fills = fillTexts(calls);
      expect(fills.length).toBe(1);
      const fillY = fills[0][1][2] as number;
      expect(classify(fillY, h, FONT)).toBe('full');
    }
  });
});
