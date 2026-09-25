import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/visual/coords';
import { GUTTER_LABEL_FONT_PX } from '@/src/visual/gutterLabels';
import { renderBoundLines, START_LINE_COLOR, END_LINE_COLOR } from '@/src/visual/render';
import type { RenderCtx } from '@/src/visual/types';
import { makeRecordingCtx, propValues, fillTexts } from '@/tests/support/canvas';

const bpm120 = [{ beat: 0, bpm: 120 }];
const TEST_SURFACE = { w: 750, h: 900 };
const chartEndBeat = 3; // 3 拍 = 660px < 画布高 900px：起始/结束两线可同屏（scrollY=700 时分别位于 y≈860 / y≈200）

function renderBoundLinesAt(scrollY: number) {
  const geometry = new ChartGeometry(bpm120, { endBeat: chartEndBeat }, TEST_SURFACE);
  const viewport = { scrollX: 0, scrollY, scale: 1 };
  const c = makeCoords(geometry, viewport, 4, []);
  const rc = { geometry, viewport, surface: TEST_SURFACE, chartEndBeat } as unknown as RenderCtx;
  const { proxy, calls } = makeRecordingCtx();
  renderBoundLines(proxy, c, rc);
  return { calls, c };
}

function endLineCanvasY(c: ReturnType<typeof makeCoords>) {
  return c.virtualToCanvas(0, c.beatToVirtualY(chartEndBeat)).y;
}

describe('renderBoundLines（issue 151：无 START 字、END 在线下方）', () => {
  // 两线同屏：起始线 y≈860（底边附近）、结束线 y≈200
  const { calls, c } = renderBoundLinesAt(700);

  it('START 文本不再输出；END 文本仍输出', () => {
    expect(fillTexts(calls).map(t => t[1][0])).toEqual(['END']);
  });

  it('END 文字基线位于结束线下方', () => {
    const endY = endLineCanvasY(c);
    const [endFill] = fillTexts(calls);
    expect(endFill).toBeDefined();
    expect(propValues(calls, 'textBaseline')).toEqual(['top']);
    expect(endFill![1][2]).toBeGreaterThanOrEqual(endY);
  });

  it('起始线和结束线仍各自绘制（只画两侧沟槽）', () => {
    const geometry = new ChartGeometry(bpm120, { endBeat: chartEndBeat }, TEST_SURFACE);
    const { trackStartX, totalTrackWidth } = geometry.trackGeometry(1);
    const rightOuter = trackStartX + totalTrackWidth;
    const moveTos = calls.filter(([k]) => k === 'moveTo');
    const lineTos = calls.filter(([k]) => k === 'lineTo');
    expect(moveTos.length).toBe(4);
    expect(lineTos.length).toBe(4);
    const moveToXs = moveTos.map(([, [x]]) => x as number).sort((a, b) => a - b);
    expect(moveToXs).toEqual([0, 0, rightOuter, rightOuter]);
    for (const [, [x]] of lineTos) expect([trackStartX, TEST_SURFACE.w]).toContain(x);
    const strokes = propValues(calls, 'strokeStyle');
    expect(strokes).toContain(START_LINE_COLOR);
    expect(strokes).toContain(END_LINE_COLOR);
  });

  it('结束线贴近画布底边时 END 文字盒仍完整落在画布内', () => {
    const geometry = new ChartGeometry(bpm120, { endBeat: chartEndBeat }, TEST_SURFACE);
    const viewportProbe = { scrollX: 0, scrollY: 0, scale: 1 };
    const cProbe = makeCoords(geometry, viewportProbe, 4, []);
    const endVirtualY = cProbe.beatToVirtualY(chartEndBeat);
    const fontPx = GUTTER_LABEL_FONT_PX;
    // 结束线距底边 4px：未钳制时 top 基线会让文字盒越出底边
    const scrollY = endVirtualY - (TEST_SURFACE.h - 4);
    const { calls: edgeCalls, c: edgeC } = renderBoundLinesAt(scrollY);
    const lineY = endLineCanvasY(edgeC);
    expect(lineY).toBeCloseTo(TEST_SURFACE.h - 4, 5);
    const [endFill] = fillTexts(edgeCalls);
    expect(endFill).toBeDefined();
    const textY = endFill![1][2];
    expect(propValues(edgeCalls, 'textBaseline')).toEqual(['top']);
    expect(textY).toBeGreaterThanOrEqual(0);
    expect(textY + fontPx).toBeLessThanOrEqual(TEST_SURFACE.h);
  });
});
