// 编辑态（谱面 notes 的历史栈 + 谱面代码保真）与它的状态转移（05 票）。
//
// 为什么两条并成**一个 state 对象**：保真（源文本 + pristine）必须与 notes **同一次写** ——
// 「改音符即作废 pristine」原先手写在四个入口里（handleNotesChange / setNotes / undo / redo），
// 漏掉任一条的后果是「画布已经改了，导出还发源文本原文」。收成一个 `commitNotes` 之后，
// 任何改 notes 的路径都绕不过作废。
//
// 撤销 / 重做照旧**作废但不还原** pristine（今天语义）：保真不进快照栈，它是当前值 ——
// 没有「撤销回退到 pristine = true」这回事。只有 Apply（`applyChartCode`）与
// 切工程 / 切谱面（`resetChartEditingState`）会重新置位。
//
// 纯函数、不依赖 React：保真语义直接单测（tests/unit/chart/editing/ChartEditingState.test.ts）。
import type { ChartNote } from '../types';
import {
  createHistory, pushHistoryIfChanged, undoHistory, redoHistory,
  NOTES_HISTORY_CAP, type HistoryState,
} from './History';
import { notesEqual } from './NotesEqual';
import { EMPTY_CHART_CODE_FIDELITY, type ChartCodeFidelity } from './ChartConverter';

/** 编辑态：notes 的历史栈 + 谱面代码保真（同一次 setState 里改，原子） */
export interface ChartEditingState {
  history: HistoryState<ChartNote[]>;
  fidelity: ChartCodeFidelity;
}

/** 初始编辑态（新谱面：历史只含当前快照、无保真） */
export function createChartEditingState(notes: ChartNote[]): ChartEditingState {
  return { history: createHistory(notes), fidelity: EMPTY_CHART_CODE_FIDELITY };
}

/**
 * **改音符的唯一提交点**（画布编辑 / `setNotes`）：notes 与保真在同一个返回值里写。
 * 与当前快照语义相等的无操作编辑照旧不占栈位（issue 57 bug4），但 pristine 照样作废 —— 作废是无条件的。
 */
export function commitNotes(state: ChartEditingState, notes: ChartNote[]): ChartEditingState {
  return invalidateFidelity(state, pushHistoryIfChanged(state.history, notes, notesEqual, NOTES_HISTORY_CAP));
}

/** 撤销：照旧作废 pristine，且**不还原**旧值（它从来不在快照栈里） */
export function undoNotes(state: ChartEditingState): ChartEditingState {
  return invalidateFidelity(state, undoHistory(state.history) ?? state.history);
}

/** 重做：同撤销口径 */
export function redoNotes(state: ChartEditingState): ChartEditingState {
  return invalidateFidelity(state, redoHistory(state.history) ?? state.history);
}

/**
 * Apply 成功（弹窗把代码写回画布）：回写画布与置保真**同一次转移** —— 一次 setState 里既进历史栈
 * 又把 pristine 置回，**唯一的置位点**。分成两步写的话，中间任何一次早退（只读闸门等）都会留下
 * 「画布没变、保真却是真」的状态。
 */
export function applyChartCode(
  state: ChartEditingState,
  notes: ChartNote[],
  text: string,
): ChartEditingState {
  return {
    history: pushHistoryIfChanged(state.history, notes, notesEqual, NOTES_HISTORY_CAP),
    fidelity: { text, pristine: true },
  };
}

/**
 * 切工程 / 切谱面：历史重开（调用方给出 `applyProjectSwitch` 的结果），保真从工程记录恢复。
 * 记录里没有保真（`null` / `undefined`）即未保真。
 */
export function resetChartEditingState(
  history: HistoryState<ChartNote[]>,
  fidelity?: ChartCodeFidelity | null,
): ChartEditingState {
  return { history, fidelity: fidelity ?? EMPTY_CHART_CODE_FIDELITY };
}

/** 作废 pristine 的唯一落点（内部）：历史栈与保真**同一次**写；状态无变化时原样返回，不给 React 制造空更新 */
function invalidateFidelity(
  state: ChartEditingState,
  history: HistoryState<ChartNote[]>,
): ChartEditingState {
  if (history === state.history && !state.fidelity.pristine) return state;
  return { history, fidelity: { ...state.fidelity, pristine: false } };
}
