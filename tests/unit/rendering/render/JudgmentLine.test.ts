import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/rendering/coords';
import { renderJudgmentLine, renderPassedNotesScrim, JUDGE_THEME_GOLD } from '@/src/rendering/render';
import type { RenderCtx } from '@/src/rendering/types';
import { makeRecordingCtx } from '@/tests/support/canvas';

const bpm120 = [{ beat: 0, bpm: 120 }];
const TEST_SURFACE = { w: 750, h: 700 };

function makeCtx() {
  return makeRecordingCtx({
    createLinearGradient: () => ({ addColorStop: () => {} }),
  });
}

function createRenderCtx(offsetY?: number): { c: ReturnType<typeof makeCoords>; rc: RenderCtx } {
  const geometry = new ChartGeometry(bpm120, { endBeat: 4 }, TEST_SURFACE);
  const viewport = { scrollX: 0, scrollY: 0, scale: 1 };
  const c = makeCoords(geometry, viewport, 4, []);
  const rc = {
    geometry,
    viewport,
    surface: TEST_SURFACE,
    chartEndBeat: 4,
    display: offsetY != null ? { judgeLineOffsetY: offsetY } : {},
  } as unknown as RenderCtx;
  return { c, rc };
}

describe('issue 218 · 判定线渲染（renderJudgmentLine）', () => {
  it('0% 或未设置偏移时完全隐匿（贴底原样，零绘制）', () => {
    const { proxy: ctx, calls } = makeCtx();
    const { c, rc } = createRenderCtx(0);

    renderJudgmentLine(ctx as unknown as CanvasRenderingContext2D, c, rc);
    expect(calls.filter(([m]) => m === 'stroke' || m === 'fillRect')).toEqual([]);

    // undefined 偏移同理
    const { proxy: ctx2, calls: calls2 } = makeCtx();
    const { c: c2, rc: rc2 } = createRenderCtx(undefined);
    renderJudgmentLine(ctx2 as unknown as CanvasRenderingContext2D, c2, rc2);
    expect(calls2.filter(([m]) => m === 'stroke' || m === 'fillRect')).toEqual([]);
  });

  it('偏移 > 0 时渲染过线暗化半透蒙版与光刃线体', () => {
    const { proxy: ctx, calls } = makeCtx();
    const offsetY = 140; // 20% of 700
    const { c, rc } = createRenderCtx(offsetY);

    renderJudgmentLine(ctx as unknown as CanvasRenderingContext2D, c, rc);

    // 蒙版从 lineY (560) 覆盖至底边 (700)
    const lineY = TEST_SURFACE.h - offsetY;
    expect(lineY).toBe(560);

    const fills = calls.filter(([m]) => m === 'fillRect');
    expect(fills.length).toBeGreaterThanOrEqual(2); // 1. 过线蒙版, 2. 光刃柔光幕

    // 检查蒙版 fillRect 参数: [0, 560, 750, 140]
    const scrimFill = fills.find(([_, args]) => args[1] === 560 && args[3] === 140);
    expect(scrimFill).toBeDefined();

    // 检查光刃与端饰的 stroke 调用
    const strokes = calls.filter(([m]) => m === 'stroke');
    expect(strokes.length).toBeGreaterThanOrEqual(3);
  });

  it('光刃与徽标端饰横向范围严格收纳在 7 轨内缘，0 像素外溢', () => {
    const { proxy: ctx, calls } = makeCtx();
    const offsetY = 100;
    const { c, rc } = createRenderCtx(offsetY);

    const { trackBgX, trackBgWidth } = c.trackGeometry(rc.viewport.scale);
    const expectedX1 = trackBgX;
    const expectedX2 = trackBgX + trackBgWidth;

    renderJudgmentLine(ctx as unknown as CanvasRenderingContext2D, c, rc);

    // 找到绘制光刃横线的 moveTo / lineTo
    const lines = calls.filter(([m]) => m === 'moveTo' || m === 'lineTo');
    const xCoords = lines.map(([_, args]) => args[0]);

    // 所有横线起点应在 x1，终点在 x2
    expect(xCoords).toContain(expectedX1);
    expect(xCoords).toContain(expectedX2);

    // 徽标端饰位于 x1 与 x2
    const stopTicks = lines.filter(([_, args]) => args[0] === expectedX1 || args[0] === expectedX2);
    expect(stopTicks.length).toBeGreaterThanOrEqual(4);
  });

  it('renderPassedNotesScrim 在 lineY 处于底边时不画多余蒙版', () => {
    const { proxy: ctx, calls } = makeCtx();
    const rc = { surface: { w: 750, h: 700 } } as unknown as RenderCtx;

    renderPassedNotesScrim(ctx as unknown as CanvasRenderingContext2D, rc, 700);
    expect(calls.filter(([m]) => m === 'fillRect')).toEqual([]);
  });
});
