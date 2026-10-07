// chart-preview 08 · Combo 标记（照 Bestdori `chartCombo`：每 50 combo 在**右沟槽**写数字）。
//
// 两条口径各锁一条：
//   1. 计数单位与 `countNotesUpToBeat` **同枚举**（单键/方向键各 1、滑条逐非 hidden 结点、BPM/System 不计），
//      落点用精确拍（含 subBeat）；
//   2. 刻度画在轨道右侧沟槽、越出画布右缘时左移（**窄档**预览面板沟槽只有 ~30px 就贴着边界；
//      默认档 289px 宽沟槽 66px 放得下，所以这条用窄档锁 —— 导出档加大不改本用例，见 issue 13 复核）。
import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { comboNodePreciseBeats } from '@/src/chart/editing/NoteEditing';
import { makeCoords } from '@/src/rendering/coords';
import { measureGutterLabelWidth } from '@/src/rendering/gutterLabels';
import { COMBO_MARK_INTERVAL, renderComboMarks } from '@/src/rendering/render';
import type { RenderCtx } from '@/src/rendering/types';
import type { ChartNote } from '@/src/chart/types';
import { fillTexts, makeRecordingCtx } from '@/tests/support/canvas';

const bpm120 = [{ beat: 0, bpm: 120 }];
/** 编辑器画布档（900px 高、es = 1 → 同屏约 4 拍） */
const CANVAS = { w: 750, h: 900 };
/** 预览窄档（zoom ≈ 45%：130 × 400、es = 1/3 → 沟槽各 30px；默认档 289 宽沟槽 66px） */
const PANEL = { w: 130, h: 400 };
const PANEL_ES = 1 / 3;

const single = (beat: number): ChartNote => ({ type: 'Single', lane: 0, beat });

/** 1..n 拍各一个单键（120bpm → 1 拍 = 0.5 秒） */
const singles = (n: number): ChartNote[] => Array.from({ length: n }, (_, i) => single(i + 1));

describe('chart-preview 08 · combo 计数单位（与 countNotesUpToBeat 同枚举）', () => {
  it('单键/方向键各 1；滑条逐非 hidden 结点；BPM / System 不计；按拍升序', () => {
    const notes: ChartNote[] = [
      { type: 'BPM', beat: 0, bpm: 120 },
      { type: 'Single', beat: 3, lane: 0 },
      { type: 'RDirectional', beat: 1, lane: 2, length: 2 } as ChartNote,
      {
        type: 'Slide', beat: 5, lane: 0,
        connections: [
          { beat: 5, lane: 0 },
          { beat: 6, lane: 1, hidden: true },
          { beat: 7, lane: 2 },
        ],
      } as unknown as ChartNote,
      { type: 'System', beat: 8, data: 'x' } as unknown as ChartNote,
    ];
    // hidden 结点不可击打 → 不计；其余按拍升序：1（方向键）、3（单键）、5 与 7（滑条两端点）
    expect(comboNodePreciseBeats(notes, 4)).toEqual([1, 3, 5, 7]);
  });

  it('落点用精确拍：1/4 网格的 subBeat 折算进去', () => {
    expect(comboNodePreciseBeats([{ type: 'Single', beat: 2, lane: 0, subBeat: 1 } as ChartNote], 4))
      .toEqual([2.25]);
  });
});

function renderAt(
  notes: ChartNote[],
  opts: { comboMarks?: boolean; surface?: { w: number; h: number }; scale?: number; centerBeat?: number } = {},
) {
  const surface = opts.surface ?? CANVAS;
  const scale = opts.scale ?? 1;
  const geometry = new ChartGeometry(bpm120, { endBeat: 200 }, surface);
  const probe = makeCoords(geometry, { scrollX: 0, scrollY: 0, scale }, 4, []);
  // 把 centerBeat 摆到画布中部（波幅半屏）
  const scrollY = probe.beatToVirtualY(opts.centerBeat ?? 50) - surface.h / (2 * scale);
  const viewport = { scrollX: 0, scrollY, scale };
  const c = makeCoords(geometry, viewport, 4, []);
  const rc = {
    geometry, viewport, surface, chartEndBeat: geometry.chartEndBeat, beatDisplay: 4,
    notes,
    display: {
      noteSize: 1, slideOpacity: 1, simultaneousClickLines: true,
      labelScale: 1, comboMarks: opts.comboMarks ?? true,
    },
  } as unknown as RenderCtx;
  const { proxy, calls } = makeRecordingCtx();
  renderComboMarks(proxy, c, rc);
  return { calls, c };
}

describe('chart-preview 08 · Combo 刻度绘制', () => {
  it('每 50 个结点一枚数字：120 个音符只画可见的那一枚（50）', () => {
    const { calls } = renderAt(singles(120), { centerBeat: 50 });
    expect(fillTexts(calls).map((t) => t[1][0])).toEqual(['50']);
  });

  it('不足 50 或关掉开关 → 一枚也不画（缺省也不画）', () => {
    expect(fillTexts(renderAt(singles(49)).calls)).toEqual([]);
    expect(fillTexts(renderAt(singles(120), { comboMarks: false }).calls)).toEqual([]);
  });

  it('刻度落在轨道右侧沟槽（x > 轨道右外缘）', () => {
    const { calls, c } = renderAt(singles(120), { centerBeat: 50 });
    const { trackStartX, totalTrackWidth } = c.trackGeometry(1);
    const [, [text, x]] = fillTexts(calls)[0]!;
    expect(text).toBe('50');
    expect(x).toBeCloseTo(trackStartX + totalTrackWidth + 8, 6);
  });

  it('预览窄面板：数字越出画布右缘时左移（不裁字）', () => {
    const narrowPanel = { w: 90, h: 400 };
    const { calls, c } = renderAt(singles(60), { surface: narrowPanel, scale: PANEL_ES, centerBeat: 50 });
    const fills = fillTexts(calls);
    expect(fills.map((t) => t[1][0])).toEqual(['50']);

    const fontPx = Math.round(21 * PANEL_ES);
    const textWidth = measureGutterLabelWidth('50', fontPx);
    const [, [text, x]] = fills[0]!;
    const { trackStartX, totalTrackWidth } = c.trackGeometry(PANEL_ES);
    const natural = trackStartX + totalTrackWidth + Math.round(8 * PANEL_ES);
    expect(natural + textWidth).toBeGreaterThan(narrowPanel.w - 2);   // 前提：自然锚点下确实放不下
    expect(x).toBeLessThan(natural);                                   // 被左移了
    expect(x + textWidth).toBeLessThanOrEqual(narrowPanel.w - 2 + 1e-6); // 文字盒完整落在画布内
  });

  it('间隔常量 = 50（照 Bestdori）', () => {
    expect(COMBO_MARK_INTERVAL).toBe(50);
  });
});
