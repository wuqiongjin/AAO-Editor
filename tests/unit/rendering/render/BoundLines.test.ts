import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/rendering/coords';
import { GUTTER_LABEL_FONT_PX } from '@/src/rendering/gutterLabels';
import { renderBoundLines, START_LINE_COLOR, END_LINE_COLOR } from '@/src/rendering/render';
import type { RenderCtx } from '@/src/rendering/types';
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

describe('issue 63 · START 线画在时间原点（首条 BPM），不再固定 beat 0', () => {
  const endBeat = 8;

  function startLineMoveToYs(bpm: { beat: number; bpm: number }[]) {
    const geometry = new ChartGeometry(bpm, { endBeat }, TEST_SURFACE);
    // 滚到底：时间原点落在画布底边附近
    const viewport = { scrollX: 0, scrollY: geometry.chartEndVirtualY, scale: 1 };
    const c = makeCoords(geometry, viewport, 4, []);
    const rc = { geometry, viewport, surface: TEST_SURFACE, chartEndBeat: endBeat } as unknown as RenderCtx;
    const { proxy, calls } = makeRecordingCtx();
    renderBoundLines(proxy, c, rc);
    const ys = calls.filter(([k]) => k === 'moveTo').map(([, args]) => args[1] as number);
    return { ys, c };
  }

  it('负首拍：START 画在 startBeat（不在 beat 0）', () => {
    const bpm = [{ beat: -4, bpm: 120 }];
    const { ys, c } = startLineMoveToYs(bpm);
    const expected = c.virtualToCanvas(0, c.beatToVirtualY(-4)).y;
    expect(ys).toEqual([expected, expected]);
    expect(expected).toBeCloseTo(TEST_SURFACE.h, 5);
    // beat 0 在这个滚动位置另有 y（正首拍时才是原点）→ 两者不同
    expect(c.virtualToCanvas(0, c.beatToVirtualY(0)).y).not.toBeCloseTo(expected, 3);
  });

  it('正首拍：START 画在 startBeat（[0, 首BPM) 属负秒，不画线）', () => {
    const bpm = [{ beat: 1, bpm: 120 }];
    const { ys, c } = startLineMoveToYs(bpm);
    const expected = c.virtualToCanvas(0, c.beatToVirtualY(1)).y;
    expect(ys).toEqual([expected, expected]);
    expect(expected).toBeCloseTo(TEST_SURFACE.h, 5);
    // beat 0 已落在判定线下方（负秒），不是画线位置
    expect(c.virtualToCanvas(0, c.beatToVirtualY(0)).y).toBeGreaterThan(TEST_SURFACE.h + 100);
  });
});
