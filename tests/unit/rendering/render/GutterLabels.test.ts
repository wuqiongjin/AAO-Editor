import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/rendering/coords';
import { renderBpmLabels, BPM_TAIL_WARNING_COLOR } from '@/src/rendering/render';
import { gridBpmNegativeColor } from '@/src/rendering/gridStyle';
import type { ChartNote } from '@/src/chart/types';
import {
  layoutGutterLabel,
  layoutBpmLabelYs,
  layoutBpmGutter,
  bpmSummaryTokens,
  bpmSummaryFullText,
  bpmExpandedNumeralsOnCanvas,
  bpmCoincidentKey,
  clampGutterLabelY,
  bpmLabelAnchorY,
  drawGutterLabel,
  boundLabelGapPx,
  bpmLabelBox,
  BPM_LABEL_GAP_PX,
  GUTTER_LABEL_FONT_PX,
  GUTTER_LABEL_LINE_GAP_PX,
} from '@/src/rendering/gutterLabels';
import { makeRecordingCtx, propValues, fillTexts } from '@/tests/support/canvas';
import { readStripped } from '@/tests/support/source';

const bpm120 = [{ beat: 0, bpm: 120 }];
const TEST_SURFACE = { w: 750, h: 900 };

function makeCoordsAt(scale: number) {
  const geometry = new ChartGeometry(bpm120, { endBeat: 40 } , TEST_SURFACE);
  const viewport = { scrollX: 0, scrollY: 0, scale };
  return { c: makeCoords(geometry, viewport, 4, []), geometry, viewport };
}

describe('layoutGutterLabel 外侧装饰文字锚定（issue 51 第二轮）', () => {
  it('BPM 内带 8px；START/END 外带动态间距（随 labelScale 放大，恒让出内带文字盒）', () => {
    const { c } = makeCoordsAt(1);
    const { trackStartX } = c.trackGeometry(1);
    expect(layoutGutterLabel(c, 1, 300, 'centered', 'bpm').x).toBe(trackStartX - BPM_LABEL_GAP_PX);
    for (const labelScale of [1, 1.5, 3]) {
      const boundGap = boundLabelGapPx(labelScale);
      // 外带间距 = 内带 8px + BPM 文字盒（≤3 位数字 × 基准 × scale）+ 8px 间隔 → 恒不重叠
      expect(boundGap).toBeGreaterThanOrEqual(BPM_LABEL_GAP_PX + GUTTER_LABEL_FONT_PX * labelScale * 2 + 8);
      expect(layoutGutterLabel(c, 1, 300, 'above', 'bound', labelScale).x).toBe(trackStartX - boundGap);
    }
    expect(boundLabelGapPx(1.5)).toBeGreaterThan(boundLabelGapPx(1)); // 随字号系数放大
  });

  it('字号 = 21px 基准 × labelScale × scale（随画布缩放联动，issue 17）', () => {
    const { c } = makeCoordsAt(2.5);
    expect(layoutGutterLabel(c, 1, 300, 'centered', 'bpm').font).toContain('21px');
    expect(layoutGutterLabel(c, 2.5, 300, 'centered', 'bpm').font).toContain('53px');
    expect(layoutGutterLabel(c, 1, 300, 'centered', 'bpm', 1.5).font).toContain('32px');
    expect(layoutGutterLabel(c, 2, 300, 'centered', 'bpm', 1.5).font).toContain('63px');
  });

  it('纵向定位：centered 居中于线；above/below 文字盒贴线（间距 0，与 BPM 数值骑线观感一致）', () => {
    const { c } = makeCoordsAt(1);
    const lineY = 456;
    expect(layoutGutterLabel(c, 1, lineY, 'centered', 'bpm').y).toBe(lineY);
    expect(layoutGutterLabel(c, 1, lineY, 'above', 'bound').y).toBe(lineY - GUTTER_LABEL_LINE_GAP_PX);
    expect(layoutGutterLabel(c, 1, lineY, 'below', 'bound').y).toBe(lineY + GUTTER_LABEL_LINE_GAP_PX);
    expect(GUTTER_LABEL_LINE_GAP_PX).toBe(0);
    expect(layoutGutterLabel(c, 1, lineY, 'above', 'bound').textBaseline).toBe('alphabetic'); // 墨迹底压线
    expect(layoutGutterLabel(c, 1, lineY, 'below', 'bound').textBaseline).toBe('top');
  });

  it('间距随 scale 缩放（issue 17 联动）', () => {
    const gapAt = (scale: number, band: 'bpm' | 'bound') => {
      const { c } = makeCoordsAt(scale);
      return c.trackGeometry(scale).trackStartX - layoutGutterLabel(c, scale, 0, 'centered', band).x;
    };
    expect(gapAt(0.5, 'bpm')).toBe(Math.round(8 * 0.5));
    expect(gapAt(1, 'bpm')).toBe(8);
    expect(gapAt(2.5, 'bpm')).toBe(Math.round(8 * 2.5));
    expect(gapAt(0.5, 'bound')).toBe(boundLabelGapPx(1, 0.5));
    expect(gapAt(1, 'bound')).toBe(boundLabelGapPx(1, 1));
    expect(gapAt(2.5, 'bound')).toBe(boundLabelGapPx(1, 2.5));
  });
});

describe('clampGutterLabelY / drawGutterLabel（issue 51：文字都在谱面范围内）', () => {
  it('钳制：middle/bottom/top 基线各自保持文字盒完整可见', () => {
    const { c } = makeCoordsAt(1);
    const fontPx = GUTTER_LABEL_FONT_PX;
    expect(clampGutterLabelY(layoutGutterLabel(c, 1, 2, 'centered', 'bpm'), 900, fontPx).y).toBe(fontPx / 2);
    expect(clampGutterLabelY(layoutGutterLabel(c, 1, 898, 'centered', 'bpm'), 900, fontPx).y).toBe(900 - fontPx / 2);
    expect(clampGutterLabelY(layoutGutterLabel(c, 1, 2, 'above', 'bound'), 900, fontPx).y).toBe(fontPx);
    expect(clampGutterLabelY(layoutGutterLabel(c, 1, 898, 'below', 'bound'), 900, fontPx).y).toBe(900 - fontPx);
  });

  it('沟槽宽度不足时整体隐藏（优雅降级）', () => {
    const { c } = makeCoordsAt(1);
    const layout = layoutGutterLabel(c, 1, 400, 'centered', 'bound'); // x = trackStartX − 40
    // 模拟超宽文字：measureText 恒返回 10000 → 文字盒左缘越出画布 → 不绘制
    const { proxy: wideCtx, calls: wideCalls } =
      makeRecordingCtx({ measureText: () => ({ width: 10000 }) });
    expect(drawGutterLabel(wideCtx, layout, 'START', '#fff')).toBe(false);
    expect(wideCalls.filter(([k]) => k === 'fillText').length).toBe(0);

    // 正常宽度：绘制
    const { proxy, calls } = makeRecordingCtx();
    (proxy as unknown as { measureText: () => { width: number } }).measureText = () => ({ width: 30 });
    expect(drawGutterLabel(proxy, layout, 'START', '#fff')).toBe(true);
    expect(fillTexts(calls).length).toBe(1);
    expect(propValues(calls, 'font').length).toBeGreaterThan(0);
  });
});

describe('renderBpmLabels（issue 51 第二轮：恒定居中 + 钳制）', () => {
  function renderBpmAt(scrollY: number, beat = 0) {
    const bpmNote = { type: 'BPM', beat, bpm: 120 } as never;
    const geometry = new ChartGeometry(bpm120, { endBeat: 8 } , TEST_SURFACE);
    const viewport = { scrollX: 0, scrollY, scale: 1 };
    const c = makeCoords(geometry, viewport, 4, [bpmNote]);
    const rc = {
      geometry, viewport, surface: TEST_SURFACE, chartEndBeat: 8, beatDisplay: 4,
      notes: [bpmNote], display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true, labelScale: 1 },
    } as unknown as import('@/src/rendering/types').RenderCtx;
    const { proxy, calls } = makeRecordingCtx();
    renderBpmLabels(proxy, c, rc);
    return calls;
  }

  it('远离端点的 BPM 数值垂直居中于线、内带锚定', () => {
    // 中段 BPM（beat 4）：scrollY=1380 时线在 y=400
    const calls = renderBpmAt(1380, 4);
    const fills = fillTexts(calls);
    expect(fills.length).toBe(1);
    const [text, , y] = fills[0][1];
    expect(text).toBe('120');
    expect(y).toBe(400);
    expect(propValues(calls, 'textBaseline')).toContain('middle');
  });

  it('beat 0 相对线固定上移半个字高（贴线可读、滚动钉线不钳底边）', () => {
    const h = 900;
    const fontPx = GUTTER_LABEL_FONT_PX;
    const half = fontPx / 2;
    expect(bpmLabelAnchorY(0, h, fontPx, h)).toBe(h - half);
    expect(bpmLabelAnchorY(0, h + 1e-13, fontPx, h)).toBeCloseTo(h + 1e-13 - half, 9);
    expect(bpmLabelAnchorY(0, h + 0.4, fontPx, h)).toBeCloseTo(h + 0.4 - half, 6);
    expect(bpmLabelAnchorY(0, h + 0.6, fontPx, h)).toBeCloseTo(h + 0.6 - half, 6);
    expect(bpmLabelAnchorY(0, h + 8, fontPx, h)).toBeCloseTo(h + 8 - half, 6);
    expect(bpmLabelAnchorY(0, h - 5, fontPx, h)).toBe(h - 5 - half);
    expect(bpmLabelAnchorY(4, h, fontPx, h)).toBe(h);
  });

  it('beat 0 线已离开判定线：字 y 增量等于线 y 增量（不自己滑）', () => {
    const geometry = new ChartGeometry(bpm120, { endBeat: 8 }, TEST_SURFACE);
    const yOf = (scrollY: number) => {
      const viewport = { scrollX: 0, scrollY, scale: 1 };
      const c = makeCoords(geometry, viewport, 4, [{ type: 'BPM', beat: 0, bpm: 120 } as never]);
      return c.virtualToCanvas(0, c.getNoteVirtualY(0)).y;
    };
    const a = geometry.chartEndVirtualY - 4;
    const b = geometry.chartEndVirtualY - 8;
    expect(yOf(a)).toBeGreaterThan(TEST_SURFACE.h + 0.5);
    expect(yOf(b)).toBeGreaterThan(TEST_SURFACE.h + 0.5);
    const fillsA = fillTexts(renderBpmAt(a, 0));
    const fillsB = fillTexts(renderBpmAt(b, 0));
    expect(fillsA.length).toBe(1);
    expect(fillsB.length).toBe(1);
    expect(fillsA[0][1][2] - fillsB[0][1][2]).toBeCloseTo(yOf(a) - yOf(b), 6);
  });

  it('beat 0 在判定线：数字整盒在画布内（不骑底边裁一半）', () => {
    const geometry = new ChartGeometry(bpm120, { endBeat: 8 } , TEST_SURFACE);
    const calls = renderBpmAt(geometry.chartEndVirtualY);
    const fills = fillTexts(calls);
    expect(fills.length).toBe(1);
    const y = fills[0][1][2] as number;
    const half = GUTTER_LABEL_FONT_PX / 2;
    expect(y).toBe(TEST_SURFACE.h - half);
    expect(y - half).toBeGreaterThanOrEqual(0);
    expect(y + half).toBeLessThanOrEqual(TEST_SURFACE.h);
  });

  it('滚动时字 y 增量等于线 y 增量（不贴边漂移）', () => {
    const geometry = new ChartGeometry(bpm120, { endBeat: 8 }, TEST_SURFACE);
    const yOf = (scrollY: number) => {
      const viewport = { scrollX: 0, scrollY, scale: 1 };
      const c = makeCoords(geometry, viewport, 4, [{ type: 'BPM', beat: 4, bpm: 120 } as never]);
      return c.virtualToCanvas(0, c.getNoteVirtualY(4)).y;
    };
    const a = 1000;
    const b = 1040;
    const fillsA = fillTexts(renderBpmAt(a, 4));
    const fillsB = fillTexts(renderBpmAt(b, 4));
    expect(fillsA[0][1][2] - fillsB[0][1][2]).toBeCloseTo(yOf(a) - yOf(b), 6);
  });

  it('墨迹盒完全出画布后无 fillText', () => {
    const geometry = new ChartGeometry(bpm120, { endBeat: 8 }, TEST_SURFACE);
    const yOf = (scrollY: number) => {
      const viewport = { scrollX: 0, scrollY, scale: 1 };
      const c = makeCoords(geometry, viewport, 4, [{ type: 'BPM', beat: 4, bpm: 120 } as never]);
      return c.virtualToCanvas(0, c.getNoteVirtualY(4)).y;
    };
    const yMid = yOf(1380);
    const target = TEST_SURFACE.h + GUTTER_LABEL_FONT_PX;
    const scrollY = 1380 + (yMid - target);
    expect(yOf(scrollY)).toBeCloseTo(target, 6);
    expect(fillTexts(renderBpmAt(scrollY, 4))).toHaveLength(0);
  });

  it('visibleNotes 参数已删除：只凭 notes 绘制', () => {
    const bpmNote = { type: 'BPM', beat: 4, bpm: 120 } as never;
    const geometry = new ChartGeometry(bpm120, { endBeat: 8 }, TEST_SURFACE);
    const viewport = { scrollX: 0, scrollY: 1380, scale: 1 };
    const c = makeCoords(geometry, viewport, 4, [bpmNote]);
    const rc = {
      geometry, viewport, surface: TEST_SURFACE, chartEndBeat: 8, beatDisplay: 4,
      notes: [bpmNote], display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true, labelScale: 1 },
    } as unknown as import('@/src/rendering/types').RenderCtx;
    const { proxy, calls } = makeRecordingCtx();
    renderBpmLabels(proxy, c, rc);
    expect(fillTexts(calls).map(([, args]) => args[0])).toEqual(['120']);
  });
});
describe('renderBpmLabels · 末条 BPM 为负的就地警示（issue 142）', () => {
  // 定案：编辑器不拦（数据保真），只在**那条 BPM 自己身上**标出来 —— **只把数值变红**（用户 2026-09-22：
  // 不加后缀），与「倒流区负值」（只换倒流色）区分开。
  const SURFACE = { w: 750, h: 900 };
  const bpmNote = (beat: number, v: number) => ({ type: 'BPM', beat, bpm: v } as never);

  function renderLabels(
    notes: ChartNote[],
    bpmEditBeat: number | null = null,
  ) {
    const geometry = new ChartGeometry([{ beat: 0, bpm: 120 }], { endBeat: 40 }, SURFACE);
    // 让 beat 8 那条线落在画布中部（y≈300）：scrollY = 该拍的虚拟 Y − 300
    const viewport = { scrollX: 0, scrollY: geometry.beatToVirtualY(8, 1) - 300, scale: 1 };
    const c = makeCoords(geometry, viewport, 4, notes);
    const rc = {
      geometry, viewport, surface: SURFACE, chartEndBeat: 40, beatDisplay: 4, notes, bpmEditBeat,
      display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true, labelScale: 1 },
    } as unknown as import('@/src/rendering/types').RenderCtx;
    const { proxy, calls } = makeRecordingCtx();
    renderBpmLabels(proxy, c, rc);
    return calls;
  }

  it('末条为负 → 数值变警示色（不是倒流色）', () => {
    const notes = [bpmNote(0, 120), bpmNote(8, -120)];
    const calls = renderLabels(notes);
    const fills = fillTexts(calls);
    expect(fills.map((f) => f[1][0])).toContain('-120');
    expect(propValues(calls, 'fillStyle')).toContain(BPM_TAIL_WARNING_COLOR);
    expect(propValues(calls, 'fillStyle')).not.toContain(gridBpmNegativeColor('vivid'));
  });

  // issue 143 补修：输入框是 HTML 覆盖层、宽度只按当前输入值算，画布上那条旧数值
  // （带小数时更长）会从框边露出来 → 编辑期间该拍的数值不画。
  it('就地编辑中（bpmEditBeat = 该拍）→ 数值不画，让位给输入框', () => {
    const notes = [bpmNote(0, 120), bpmNote(8, 128.5)];
    expect(fillTexts(renderLabels(notes, 8)).filter((f) => f[1][0] === '128.5')).toHaveLength(0);
    expect(fillTexts(renderLabels(notes)).map((f) => f[1][0])).toContain('128.5');
    expect(fillTexts(renderLabels(notes, 0)).map((f) => f[1][0])).toContain('128.5');
  });

  it('撞 y 的两条 BPM 数值画在不同 y（issue 159）', () => {
    const sample = [
      { type: 'BPM', beat: 0, bpm: 120 },
      { type: 'BPM', beat: 3, bpm: -178 },
      { type: 'BPM', beat: 4, bpm: 178 },
      { type: 'BPM', beat: 5, bpm: 178 },
    ] as ChartNote[];
    const geometry = new ChartGeometry(
      [{ beat: 0, bpm: 120 }, { beat: 3, bpm: -178 }, { beat: 4, bpm: 178 }, { beat: 5, bpm: 178 }],
      { endBeat: 16 },
      SURFACE,
    );
    const viewport = { scrollX: 0, scrollY: geometry.beatToVirtualY(3, 1) - 300, scale: 1 };
    const c = makeCoords(geometry, viewport, 4, sample);
    const rc = {
      geometry, viewport, surface: SURFACE, chartEndBeat: 16, beatDisplay: 4, notes: sample,
      display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true, labelScale: 1 },
    } as unknown as import('@/src/rendering/types').RenderCtx;
    const { proxy, calls } = makeRecordingCtx();
    renderBpmLabels(proxy, c, rc);
    const fills = fillTexts(calls);
    const texts = fills.map((f) => String(f[1][0]));
    expect(texts.some((t) => String(t).includes('-178'))).toBe(true);
    expect(texts.some((t) => String(t) === '178' || String(t).includes(', 178'))).toBe(true);
    expect(texts).toContain('178');
  });

  it('倒流区内的**非末条**负值 → 仍只换倒流色（回归，不放松）', () => {
    const notes = [bpmNote(0, 120), bpmNote(8, -120), bpmNote(12, 120)];
    const calls = renderLabels(notes);
    expect(fillTexts(calls).map((f) => f[1][0])).toContain('-120');
    expect(propValues(calls, 'fillStyle')).toContain(gridBpmNegativeColor('vivid'));
    expect(propValues(calls, 'fillStyle')).not.toContain(BPM_TAIL_WARNING_COLOR);
  });
});

describe('layoutBpmLabelYs · 沟槽 BPM 数值撞 y 纵向错开（issue 159）', () => {
  // 用户样例：beat 3 与 beat 5 时间轴秒数相同 → 沟槽数字原本画在同一 y。
  const SAMPLE_BPM = [
    { beat: 0, bpm: 120 },
    { beat: 3, bpm: -178 },
    { beat: 4, bpm: 178 },
    { beat: 5, bpm: 178 },
  ];
  const FONT_PX = GUTTER_LABEL_FONT_PX;

  function sampleLineYs(scrollY: number) {
    const geometry = new ChartGeometry(SAMPLE_BPM, { endBeat: 16 }, TEST_SURFACE);
    const viewport = { scrollX: 0, scrollY, scale: 1 };
    const lineYOf = (beat: number) =>
      geometry.virtualToCanvas(0, geometry.beatToVirtualY(beat, 1), viewport).y;
    const items = SAMPLE_BPM.map((e) => ({ beat: e.beat, lineCanvasY: lineYOf(e.beat) }));
    return { geometry, lineYOf, items, ys: layoutBpmLabelYs(items, FONT_PX) };
  }

  it('beat 3/−178 与 beat 5/178：layout.y 间距 ≥ 字号、组中心仍在共用线 y、文字盒不再相交', () => {
    const geometry = new ChartGeometry(SAMPLE_BPM, { endBeat: 16 }, TEST_SURFACE);
    const scrollY = geometry.beatToVirtualY(3, 1) - 400;
    const { lineYOf, ys } = sampleLineYs(scrollY);
    expect(lineYOf(3)).toBeCloseTo(lineYOf(5), 6);
    const y3 = ys[1]!;
    const y5 = ys[3]!;
    expect(Math.abs(y5 - y3)).toBeGreaterThanOrEqual(FONT_PX);
    expect((y3 + y5) / 2).toBeCloseTo(lineYOf(3), 6);
    const boxH = FONT_PX;
    expect(Math.abs(y5 - y3)).toBeGreaterThanOrEqual(boxH); // 中心距 ≥ 盒高 → 盒不相交
    expect(Math.min(y3, y5) + boxH / 2).toBeLessThanOrEqual(Math.max(y3, y5) - boxH / 2 + 1e-9);
    expect(y3).toBeLessThan(y5); // beat 升序：较小 beat 在画布上方
  });

  it('不撞 y 的 BPM（beat 0、beat 4）仍居中于各自的线', () => {
    const geometry = new ChartGeometry(SAMPLE_BPM, { endBeat: 16 }, TEST_SURFACE);
    const scrollY = geometry.beatToVirtualY(3, 1) - 400;
    const { lineYOf, ys } = sampleLineYs(scrollY);
    expect(ys[0]).toBeCloseTo(lineYOf(0), 6);
    expect(ys[2]).toBeCloseTo(lineYOf(4), 6);
  });

  it('bpmLabelBox 与 layout 同 y', () => {
    const geometry = new ChartGeometry(SAMPLE_BPM, { endBeat: 16 }, TEST_SURFACE);
    const scrollY = geometry.beatToVirtualY(3, 1) - 400;
    const { ys } = sampleLineYs(scrollY);
    const trackStartX = 300;
    const b3 = bpmLabelBox(trackStartX, ys[1]!, '-178');
    const b5 = bpmLabelBox(trackStartX, ys[3]!, '178');
    expect((b3.y1 + b3.y2) / 2).toBeCloseTo(ys[1]!, 6);
    expect((b5.y1 + b5.y2) / 2).toBeCloseTo(ys[3]!, 6);
  });
});

describe('layoutBpmGutter · 同位组摘要（issue 159 定案 2）', () => {
  const SAMPLE_BPM = [
    { beat: 0, bpm: 120 },
    { beat: 3, bpm: -178 },
    { beat: 4, bpm: 178 },
    { beat: 5, bpm: 178 },
  ];
  const FONT_PX = GUTTER_LABEL_FONT_PX;

  it('摘要文案：带符号值按最小 beat 升序，次数为 1 也写 [n]', () => {
    expect(bpmSummaryFullText(bpmSummaryTokens([
      { beat: 3, bpm: -178 },
      { beat: 5, bpm: 178 },
    ]))).toBe('-178, 178');
    expect(bpmSummaryFullText(bpmSummaryTokens([
      { beat: 1, bpm: 184 },
      { beat: 2, bpm: -184 },
      { beat: 3, bpm: 184 },
    ]))).toBe('184 [2], -184');
  });

  it('票面样例：beat 3 与 5 折成一颗摘要；beat 0、4 仍是数字；近距不等 y 不进摘要', () => {
    const notes = SAMPLE_BPM.map((e) => ({ type: 'BPM' as const, ...e }));
    const geometry = new ChartGeometry(SAMPLE_BPM, { endBeat: 16 }, TEST_SURFACE);
    const scrollY = geometry.beatToVirtualY(3, 1) - 400;
    const viewport = { scrollX: 0, scrollY, scale: 1 };
    const lineCanvasYOf = (beat: number) =>
      geometry.virtualToCanvas(0, geometry.beatToVirtualY(beat, 1), viewport).y;
    const virtualYOf = (beat: number) => geometry.beatToVirtualY(beat, 1);
    const layout = layoutBpmGutter(notes, lineCanvasYOf, virtualYOf, FONT_PX, null);
    expect(layout.summaries).toHaveLength(1);
    expect(layout.summaries[0]!.fullText).toBe('-178, 178');
    expect(layout.numerals.map((n) => n.bpm).sort((a, b) => a - b)).toEqual([120, 178]);
    expect(lineCanvasYOf(3)).toBeCloseTo(lineCanvasYOf(5), 6);
    expect(lineCanvasYOf(4)).not.toBeCloseTo(lineCanvasYOf(3), 0);
  });

  it('展开同位组：两枚数字间距 ≥ 字号，贴底不整叠平移（钉线错开）', () => {
    const notes = SAMPLE_BPM.map((e) => ({ type: 'BPM' as const, ...e }));
    const geometry = new ChartGeometry(SAMPLE_BPM, { endBeat: 16 }, TEST_SURFACE);
    const virtualYOf = (beat: number) => geometry.beatToVirtualY(beat, 1);
    const key = bpmCoincidentKey(virtualYOf(3));
    const lineCanvasYOf = (beat: number) => geometry.virtualToCanvas(
      0, virtualYOf(beat), { scrollX: 0, scrollY: geometry.chartEndVirtualY, scale: 1 },
    ).y;
    const layout = layoutBpmGutter(notes, lineCanvasYOf, virtualYOf, FONT_PX, key);
    expect(layout.summaries).toHaveLength(0);
    const pair = layout.numerals.filter((n) => n.beat === 3 || n.beat === 5).sort((a, b) => a.y - b.y);
    expect(pair).toHaveLength(2);
    expect(pair[1]!.y - pair[0]!.y).toBeGreaterThanOrEqual(FONT_PX);
    const raw = layoutBpmLabelYs(
      [{ beat: 3, lineCanvasY: lineCanvasYOf(3) }, { beat: 5, lineCanvasY: lineCanvasYOf(5) }],
      FONT_PX,
    );
    expect(pair[0]!.y).toBeCloseTo(Math.min(...raw), 6);
    expect(pair[1]!.y).toBeCloseTo(Math.max(...raw), 6);
  });

  it('beat 0 展开叠：所有数字整盒在画布内，只往线上方错开', () => {
    const notes = [
      { type: 'BPM' as const, beat: 0, bpm: 172 },
      { type: 'BPM' as const, beat: 0, bpm: 162 },
    ];
    const geometry = new ChartGeometry(
      notes.map((n) => ({ beat: n.beat, bpm: n.bpm })),
      { endBeat: 8 },
      TEST_SURFACE,
    );
    const virtualYOf = (beat: number) => geometry.beatToVirtualY(beat, 1);
    const key = bpmCoincidentKey(virtualYOf(0));
    const lineCanvasYOf = (beat: number) => geometry.virtualToCanvas(
      0, virtualYOf(beat), { scrollX: 0, scrollY: geometry.chartEndVirtualY, scale: 1 },
    ).y;
    const layout = layoutBpmGutter(notes, lineCanvasYOf, virtualYOf, FONT_PX, key);
    expect(layout.numerals).toHaveLength(2);
    const half = FONT_PX / 2;
    const h = TEST_SURFACE.h;
    const lineY = lineCanvasYOf(0);
    const anchors = layout.numerals
      .map((n) => bpmLabelAnchorY(n.beat, n.y, FONT_PX, h))
      .sort((a, b) => a - b);
    expect(anchors[1]! - anchors[0]!).toBeGreaterThanOrEqual(FONT_PX);
    for (const y of anchors) {
      expect(y - half).toBeGreaterThanOrEqual(-1e-9);
      expect(y + half).toBeLessThanOrEqual(h + 1e-9);
    }
    expect(Math.max(...anchors)).toBeCloseTo(lineY - half, 6);
  });

  it('展开 y 与 layoutBpmLabelYs 一致；有盒相交则不折，全部离开才折', () => {
    const fontPx = FONT_PX;
    const surfaceH = 100;
    const n = 20;
    const center = 120;
    const start = center - ((n - 1) * fontPx) / 2;
    const tall = Array.from({ length: n }, (_, i) => start + i * fontPx);
    expect(bpmExpandedNumeralsOnCanvas(tall, fontPx, surfaceH)).toBe(true);
    expect(bpmExpandedNumeralsOnCanvas(tall.map((y) => y + 800), fontPx, surfaceH)).toBe(false);
    expect(bpmExpandedNumeralsOnCanvas([400], fontPx, 900)).toBe(true);
    const lineY = surfaceH + 2 * fontPx + 1;
    const fromLine = Array.from({ length: n }, (_, i) => lineY - ((n - 1) * fontPx) / 2 + i * fontPx);
    expect(bpmExpandedNumeralsOnCanvas(fromLine, fontPx, surfaceH)).toBe(true);
  });
});

describe('bpmLabelBox：BPM 数字命中盒（2026-09-08 修订：不再整条水平线都命中）', () => {
  const TRACK_START_X = 300;
  const LINE_Y = 400;

  it('横向右缘 = 内带锚点（轨道左外缘 − 8），只覆盖数字自身宽度', () => {
    const box = bpmLabelBox(TRACK_START_X, LINE_Y, '120');
    expect(box.x2).toBe(TRACK_START_X - BPM_LABEL_GAP_PX + 4);
    expect(box.x1).toBeLessThan(box.x2);
    // 3 位数字 @21px → 约 47px 宽，远小于沟槽宽度（不会吃掉整条水平线）
    expect(box.x2 - box.x1).toBeLessThan(60);
    expect(box.x2 - box.x1).toBeGreaterThan(30);
  });

  it('数字更长 → 盒更宽；纵向以线为中心、随 labelScale 放大', () => {
    const b3 = bpmLabelBox(TRACK_START_X, LINE_Y, '120');
    const b5 = bpmLabelBox(TRACK_START_X, LINE_Y, '12000');
    expect(b5.x1).toBeLessThan(b3.x1);
    const big = bpmLabelBox(TRACK_START_X, LINE_Y, '120', 2);
    expect(big.y2 - big.y1).toBeGreaterThan(b3.y2 - b3.y1);
    expect((b3.y1 + b3.y2) / 2).toBe(LINE_Y);
  });

  it('顶/底缘裁切可见盒：半交可点，完全出画不可点', () => {
    const box = bpmLabelBox(TRACK_START_X, 2, '120', 1, 900);
    expect(box.y1).toBe(0);
    expect(box.y2).toBeGreaterThan(box.y1);
    const bottom = bpmLabelBox(TRACK_START_X, 899, '120', 1, 900);
    expect(bottom.y2).toBeLessThanOrEqual(900);
    expect(bottom.y1).toBeLessThan(bottom.y2);
    const gone = bpmLabelBox(TRACK_START_X, -80, '120', 1, 900);
    expect(gone.y1).toBeGreaterThanOrEqual(gone.y2);
  });

  it('沟槽宽度不足（盒左缘越出画布）→ 调用方据此判不可命中', () => {
    // 与 drawGutterLabel 的隐藏条件同口径：x1 < 0
    expect(bpmLabelBox(10, LINE_Y, '120').x1).toBeLessThan(0);
    expect(bpmLabelBox(TRACK_START_X, LINE_Y, '120').x1).toBeGreaterThan(0);
  });
});

describe('renderBpmLabels · issue 161 画布裁切接线', () => {
  it('函数体内 clip，且不对 BPM 走 clampGutterLabelY', () => {
    const src = readStripped('src/rendering/render.ts');
    const start = src.indexOf('export function renderBpmLabels');
    const next = src.indexOf('export function', start + 'export function renderBpmLabels'.length);
    const body = src.slice(start, next);
    expect(body).toMatch(/ctx\.clip\(\)/);
    expect(body).not.toMatch(/clampGutterLabelY/);
  });
});
