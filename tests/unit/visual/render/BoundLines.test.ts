import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/visual/coords';
import { renderBoundLines, START_LINE_COLOR, END_LINE_COLOR } from '@/src/visual/render';
import type { RenderCtx } from '@/src/visual/types';
import { makeRecordingCtx, propValues, fillTexts } from '@/tests/support/canvas';

const bpm120 = [{ beat: 0, bpm: 120 }];
const TEST_SURFACE = { w: 750, h: 900 };
const chartEndBeat = 3; // 3 拍 = 660px < 画布高 900px：起始/结束两线可同屏（scrollY=700 时分别位于 y≈860 / y≈200）

function renderBoundLinesAt(scrollY: number) {
  const geometry = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , TEST_SURFACE);
  const viewport = { scrollX: 0, scrollY, scale: 1 };
  const c = makeCoords(geometry, viewport, 4, []);
  const rc = { geometry, viewport, surface: TEST_SURFACE, chartEndBeat } as unknown as RenderCtx;
  const { proxy, calls } = makeRecordingCtx();
  renderBoundLines(proxy, c, rc);
  return calls;
}

describe('renderBoundLines（issue 52 整改）', () => {
  // 两线同屏：起始线 y≈860（底边附近）、结束线 y≈200
  const calls = renderBoundLinesAt(700);

  it('文字为 START / END（英文，全大写）', () => {
    expect(fillTexts(calls).map(t => t[1][0])).toEqual(['START', 'END']);
  });

  it('START/END 均垂直居中骑线（与 BPM 数值同位对齐，第四轮修订）', () => {
    const baselines = propValues(calls, 'textBaseline');
    expect(baselines).toEqual(['middle', 'middle']);
  });

  it('线只画轨道两侧沟槽段（不覆盖轨道内，第三轮修订）', () => {
    const geometry = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , TEST_SURFACE);
    const { trackStartX, totalTrackWidth } = geometry.trackGeometry(1);
    const rightOuter = trackStartX + totalTrackWidth;
    const moveTos = calls.filter(([k]) => k === 'moveTo');
    const lineTos = calls.filter(([k]) => k === 'lineTo');
    // 两条线 × 每条两段（左沟槽 + 右沟槽）
    expect(moveTos.length).toBe(4);
    expect(lineTos.length).toBe(4);
    // 左段：moveTo(0) → lineTo(trackStartX)；右段：moveTo(rightOuter) → lineTo(surface.w)
    const moveToXs = moveTos.map(([, [x]]) => x as number).sort((a, b) => a - b);
    expect(moveToXs).toEqual([0, 0, rightOuter, rightOuter]);
    for (const [, [x]] of lineTos) expect([trackStartX, TEST_SURFACE.w]).toContain(x);
  });

  it('配色落位：起始青蓝 / 结束暖橙，旧色不再出现', () => {
    const strokes = propValues(calls, 'strokeStyle');
    expect(strokes).toContain(START_LINE_COLOR);
    expect(strokes).toContain(END_LINE_COLOR);
    expect(strokes).not.toContain('#7c9cff');
    expect(strokes).not.toContain('#ff9c7c');
  });
});
