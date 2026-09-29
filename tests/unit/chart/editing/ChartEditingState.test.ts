// 05 票 · 谱面代码保真的**语义**（不只是函数）：Apply 置位、改音符即作废、撤销跨过 Apply 不回退、
// 切工程从记录恢复。
//
// 这些语义活在编辑态（notes 历史栈 + 保真，**同一个 state 对象**）里，所以由纯模块单测钉死；
// 「EditingProvider 的改 notes 入口只经本模块」这条接线由 tests/static/ChartCodeFidelityWiring.test.ts 看守。
import { describe, it, expect } from 'vitest';
import {
  createChartEditingState, commitNotes, undoNotes, redoNotes,
  applyChartCode, resetChartEditingState, type ChartEditingState,
} from '@/src/chart/editing/ChartEditingState';
import { EMPTY_CHART_CODE_FIDELITY } from '@/src/chart/editing/ChartConverter';
import { createHistory, currentHistory } from '@/src/chart/editing/History';
import type { ChartNote } from '@/src/chart/types';

/** Apply 留下的源文本：带未知字段与原始排版（保真的意义就在这两样上） */
const SOURCE = '[\n  {"beat": 0, "type": "BPM", "bpm": 120, "unknown": "留着我"}\n]';
const BPM0: ChartNote[] = [{ beat: 0, type: 'BPM', bpm: 120 }];
const WITH_SINGLE: ChartNote[] = [...BPM0, { beat: 1, lane: 2, type: 'Single' }];

/** 已 Apply 的编辑态（画布仍是 BPM0，保真 = 源文本 + pristine） */
const appliedState = (): ChartEditingState => applyChartCode(createChartEditingState(BPM0), BPM0, SOURCE);

describe('05 · 保真 = 编辑态的一个字段（与 notes 同一次写）', () => {
  it('新谱面：无源文本、pristine 为假', () => {
    expect(createChartEditingState(BPM0).fidelity).toEqual(EMPTY_CHART_CODE_FIDELITY);
  });

  it('Apply → 回写画布与置位**同一次转移**：pristine = true 且文本 = 源文本', () => {
    const state = applyChartCode(createChartEditingState(BPM0), WITH_SINGLE, SOURCE);
    expect(state.fidelity).toEqual({ text: SOURCE, pristine: true });
    expect(currentHistory(state.history)).toEqual(WITH_SINGLE);
  });

  it('改音符（画布编辑 / setNotes 同一条提交路径）→ pristine = false，源文本留着但不再作数', () => {
    const edited = commitNotes(appliedState(), WITH_SINGLE);
    expect(edited.fidelity).toEqual({ text: SOURCE, pristine: false });
    expect(currentHistory(edited.history)).toEqual(WITH_SINGLE);
  });

  it('撤销 / 重做 → pristine = false，且**不还原**旧值（撤销跨过 Apply 也不回退成 true）', () => {
    const edited = commitNotes(appliedState(), WITH_SINGLE);

    const undone = undoNotes(edited);
    expect(currentHistory(undone.history)).toEqual(BPM0);
    expect(undone.fidelity).toEqual({ text: SOURCE, pristine: false });
    // 再往后撤同样不还原（保真不进快照栈，没有"撤销回退到 pristine"这回事）
    expect(undoNotes(undone).fidelity.pristine).toBe(false);

    const redone = redoNotes(undone);
    expect(currentHistory(redone.history)).toEqual(WITH_SINGLE);
    expect(redone.fidelity.pristine).toBe(false);
  });

  it('没有可撤销 / 可重做的步也照样作废（照旧语义：作废是无条件的）', () => {
    expect(undoNotes(appliedState()).fidelity.pristine).toBe(false);
    expect(redoNotes(appliedState()).fidelity.pristine).toBe(false);
  });

  it('无操作编辑不占栈位（issue 57 bug4），但 pristine 照样作废', () => {
    const applied = appliedState();
    const noop = commitNotes(applied, BPM0);
    expect(noop.history).toBe(applied.history);
    expect(noop.fidelity).toEqual({ text: SOURCE, pristine: false });
  });

  it('状态无变化时原样返回（不给 React 制造空更新）', () => {
    const fresh = createChartEditingState(BPM0);
    expect(commitNotes(fresh, BPM0)).toBe(fresh);
    expect(undoNotes(fresh)).toBe(fresh);
    expect(redoNotes(fresh)).toBe(fresh);
  });

  it('切工程 / 切谱面 → 从记录恢复 (text, pristine)；记录没有保真即未保真', () => {
    const restored = resetChartEditingState(createHistory(WITH_SINGLE), { text: SOURCE, pristine: true });
    expect(restored.fidelity).toEqual({ text: SOURCE, pristine: true });
    expect(currentHistory(restored.history)).toEqual(WITH_SINGLE);

    // 新谱面 / 缺字段的旧记录：不会因为 undefined 被当成"保真"
    expect(resetChartEditingState(createHistory(BPM0)).fidelity).toEqual(EMPTY_CHART_CODE_FIDELITY);
    expect(resetChartEditingState(createHistory(BPM0), null).fidelity).toEqual(EMPTY_CHART_CODE_FIDELITY);
    expect(resetChartEditingState(createHistory(BPM0), { text: null, pristine: false }).fidelity.pristine).toBe(false);
  });
});
