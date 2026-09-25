// 回归：beat 0 滚动时字相对线的偏移恒定（不按画布底边钳 y）。
import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/visual/coords';
import { renderBpmLabels } from '@/src/visual/render';
import { bpmLabelAnchorY, GUTTER_LABEL_FONT_PX } from '@/src/visual/gutterLabels';
import { makeRecordingCtx, fillTexts } from '@/tests/support/canvas';

const bpm120 = [{ beat: 0, bpm: 120 }];
const FONT = GUTTER_LABEL_FONT_PX;

describe('beat 0 滚动时线 y 与字 y', () => {
  it('从 chartEnd 往外扫：字相对线的偏移恒定', () => {
    const h = 900;
    const g = new ChartGeometry(bpm120, { endBeat: 8 }, { w: 750, h });
    const es = 1;
    const note = { type: 'BPM' as const, beat: 0, bpm: 120 };
    const rows: { delta: number; lineY: number; labelY: number | null; off: number | null }[] = [];
    for (const delta of [0, 0.2, 0.5, 1, 2, 4, 8, 12, 20]) {
      const scrollY = g.chartEndVirtualY - delta;
      const vp = { scrollX: 0, scrollY, scale: es };
      const lineY = g.virtualToCanvas(0, g.beatToVirtualY(0, es), vp).y;
      const c = makeCoords(g, vp, 4, [note]);
      const rc = {
        geometry: g, viewport: vp, surface: { w: 750, h }, chartEndBeat: 8, beatDisplay: 4,
        notes: [note],
        display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true, labelScale: 1 },
      } as never;
      const { proxy, calls } = makeRecordingCtx();
      renderBpmLabels(proxy, c, rc);
      const fills = fillTexts(calls);
      const labelY = fills.length ? (fills[0][1][2] as number) : null;
      rows.push({ delta, lineY, labelY, off: labelY == null ? null : labelY - lineY });
    }
    const visible = rows.filter((r) => r.labelY != null);
    const offs = visible.map((r) => r.off as number);
    const unique = new Set(offs.map((o) => o.toFixed(3)));
    expect(unique.size, `偏移不恒定 ${JSON.stringify(visible)}`).toBe(1);
  });

  it('bpmLabelAnchorY(0, y) − y 在离开判定线后恒等于 −fontPx/2', () => {
    const h = 900;
    const offs = [1, 2, 5, 10, 20].map((d) => bpmLabelAnchorY(0, h + d, FONT, h) - (h + d));
    expect(new Set(offs.map((o) => o.toFixed(4))).size).toBe(1);
    expect(offs[0]).toBeCloseTo(-FONT / 2, 6);
  });
});
