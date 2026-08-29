// 编辑历史纯模块（ADR-0003 候选 D）：轻量撤销/重做，结构共享快照。
// 替代原 EditingContext 内联的 history/historyIndex 栈 + 每次全量 structuredClone。
//
// 结构共享原理：所有编辑函数（SelectionEditing/NoteReplacementRules/NoteEditing）均为不可变——
// 构造新数组/新对象，仅对被改动音符重建、未改动音符复用原引用。因此快照直接存引用即可让
// 未改动音符在历史栈中只保留一份，撤销正确性不受影响（ADR-0001 规则4）。
//
// 本模块纯函数、node 可单测，不依赖 React。
export interface HistoryState<T> {
  stack: T[];
  index: number;
}

/** 初始历史：含初始快照 */
export function createHistory<T>(initial: T): HistoryState<T> {
  return { stack: [initial], index: 0 };
}

/** 压入新快照，截断 index 之后的 redo 分支；返回新状态（纯函数，不就地变异） */
export function pushHistory<T>(state: HistoryState<T>, item: T): HistoryState<T> {
  const stack = [...state.stack.slice(0, state.index + 1), item];
  return { stack, index: stack.length - 1 };
}

export const canUndo = <T,>(state: HistoryState<T>): boolean => state.index > 0;
export const canRedo = <T,>(state: HistoryState<T>): boolean => state.index < state.stack.length - 1;

/** 撤销：返回后退后的状态；无可撤销时返回 null */
export function undoHistory<T>(state: HistoryState<T>): HistoryState<T> | null {
  if (!canUndo(state)) return null;
  return { stack: state.stack, index: state.index - 1 };
}

/** 重做：返回前进后的状态；无可重做时返回 null */
export function redoHistory<T>(state: HistoryState<T>): HistoryState<T> | null {
  if (!canRedo(state)) return null;
  return { stack: state.stack, index: state.index + 1 };
}

/** 当前快照（index 指向的那一版） */
export const currentHistory = <T,>(state: HistoryState<T>): T => state.stack[state.index];
