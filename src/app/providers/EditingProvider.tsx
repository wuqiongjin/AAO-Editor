// EditingContext（ADR-0003 §7.1）：谱面数据与编辑——notes / history / selection / clipboard，
// 以及编辑操作（复制/剪切/粘贴/删除/镜像/编辑工具态）。放置走 ToolActionMatrix.clickOps。
import { createContext, useContext, useCallback, useRef, useState, type ReactNode } from 'react';
import type { ChartNote, SelectionItem } from '../../chart/types';
import type { ChartPosition } from '../../types/chart';
import { deleteSelection, copySelection, cutSelection, mirrorSelection } from '../../chart/editing/SelectionEditing';
import { currentHistory } from '../../chart/editing/History';
import {
  createChartEditingState, commitNotes, undoNotes, redoNotes,
  applyChartCode, resetChartEditingState, type ChartEditingState,
} from '../../chart/editing/ChartEditingState';
import type { ChartCodeFidelity } from '../../chart/editing/ChartConverter';
import { applyProjectSwitch } from '../../project/workspaceProject';
// H5 收口：所有位置参数统一为 ChartPosition（{ beat, lane }）
export type Position = ChartPosition;

export interface ReadonlyGateHandler {
  isReadOnly: () => boolean;
  onReject: () => void;
}

export interface EditingContextValue {
  // 数据
  notes: ChartNote[];
  history: ChartNote[][];
  historyIndex: number;
  canUndo: boolean;
  canRedo: boolean;
  selectedItems: SelectionItem[];
  clipboard: ChartNote[];
  // 基础 setter
  setNotes: (notes: ChartNote[]) => void;
  /** 重置整个谱面（ADR-0005 §6：加载持久化工程时干净恢复，不产生撤销记录） */
  resetNotes: (notes: ChartNote[], fidelity?: ChartCodeFidelity) => void;
  setSelectedItems: (items: SelectionItem[]) => void;
  setClipboard: (c: ChartNote[]) => void;
  // 带历史记录的变更入口
  handleNotesChange: (newNotes: ChartNote[]) => void;
  /** 谱面代码保真（源文本 + pristine）：与 notes 同一个 state 字段，只能整份读（05 收口） */
  chartCodeFidelity: ChartCodeFidelity;
  /** Apply 成功：回写画布 + 置保真（两者同一次 setState，不会只成一半） */
  applyChartCodeToCanvas: (notes: ChartNote[], text: string) => void;
  // 历史
  undo: () => void;
  redo: () => void;
  // 编辑操作
  copy: () => void;
  cut: () => void;
  deleteSelected: () => void;
  mirror: () => void;
  // 只读闸门注册
  setReadonlyGate?: (gate: ReadonlyGateHandler | null) => void;
}

const EditingContext = createContext<EditingContextValue | null>(null);

export function EditingProvider({ children }: { children: ReactNode }) {
  const [selectedItems, setSelectedItems] = useState<SelectionItem[]>([]);
  const [clipboard, setClipboard] = useState<ChartNote[]>([]);
  const clipboardRef = useRef(clipboard);
  clipboardRef.current = clipboard;
  // 编辑态（ADR-0001 / ADR-0003 候选 D 收口）：**一个 state 对象**装两样东西 ——
  //   · history：谱面 notes 以历史栈为单一真相源（快照结构共享，编辑函数均不可变，不做全量 structuredClone）；
  //   · fidelity：谱面代码保真（源文本 + pristine）。
  // 合成一个对象是为了让「改音符即作废 pristine」成为**同一次写**：任何改 notes 的路径都绕不过
  // chart/editing/ChartEditingState 的转移函数（05 票）。
  // H1 收口：history + historyIndex 合并为单一原子状态，updater 保持纯函数（无 React StrictMode 副作用）。
  // 初始谱面（ADR-0001 谱面必须有初始 BPM）：空谱默认含第0拍120bpm，而非空数组。
  // 这样初次打开即渲染 BPM 线 / 代码编辑器显示初始 BPM，无需重置才有。
  const initialNotes: ChartNote[] = [{ beat: 0, type: "BPM", bpm: 120 }];
  const [editingState, setEditingState] = useState<ChartEditingState>(() =>
    createChartEditingState(initialNotes),
  );
  const history = editingState.history.stack;
  const historyIndex = editingState.history.index;
  // 当前谱面 = 历史栈 index 指向的快照
  const notes = currentHistory(editingState.history);
  const chartCodeFidelity = editingState.fidelity;
  const readonlyGateRef = useRef<ReadonlyGateHandler | null>(null);
  const setReadonlyGate = useCallback((gate: ReadonlyGateHandler | null) => {
    readonlyGateRef.current = gate;
  }, []);

  // Apply 成功：回写画布 + 置保真**一次完成**（唯一的置位点；撤销 / 重做都不还原它）
  const applyChartCodeToCanvas = useCallback((newNotes: ChartNote[], text: string) => {
    if (readonlyGateRef.current?.isReadOnly()) {
      readonlyGateRef.current.onReject();
      return;
    }
    setEditingState(prev => applyChartCode(prev, newNotes, text));
  }, []);

  const handleNotesChange = useCallback((newNotes: ChartNote[]) => {
    if (readonlyGateRef.current?.isReadOnly()) {
      readonlyGateRef.current.onReject();
      return;
    }
    setEditingState(prev => commitNotes(prev, newNotes));
  }, []);

  const setNotes = useCallback((n: ChartNote[]) => {
    if (readonlyGateRef.current?.isReadOnly()) {
      readonlyGateRef.current.onReject();
      return;
    }
    setEditingState(prev => commitNotes(prev, n));
  }, []);

  const resetNotes = useCallback((n: ChartNote[], fidelity?: ChartCodeFidelity) => {
    const next = applyProjectSwitch({ notes: n, clipboard: clipboardRef.current });
    setEditingState(resetChartEditingState(next.history, fidelity));
    setSelectedItems(next.selectedItems);
  }, []);

  const undo = useCallback(() => {
    if (readonlyGateRef.current?.isReadOnly()) {
      readonlyGateRef.current.onReject();
      return;
    }
    setEditingState(undoNotes);
    setSelectedItems([]);
  }, []);

  const redo = useCallback(() => {
    if (readonlyGateRef.current?.isReadOnly()) {
      readonlyGateRef.current.onReject();
      return;
    }
    setEditingState(redoNotes);
    setSelectedItems([]);
  }, []);

  const copy = useCallback(() => {
    if (selectedItems.length > 0) setClipboard(copySelection(notes, selectedItems));
  }, [notes, selectedItems]);

  const cut = useCallback(() => {
    if (selectedItems.length > 0) {
      if (readonlyGateRef.current?.isReadOnly()) {
        readonlyGateRef.current.onReject();
        return;
      }
      const { clipboard: cb, newNotes } = cutSelection(notes, selectedItems);
      setClipboard(cb);
      handleNotesChange(newNotes);
      setSelectedItems([]);
    }
  }, [notes, selectedItems, handleNotesChange]);

  const deleteSelected = useCallback(() => {
    if (selectedItems.length > 0) {
      if (readonlyGateRef.current?.isReadOnly()) {
        readonlyGateRef.current.onReject();
        return;
      }
      handleNotesChange(deleteSelection(notes, selectedItems));
      setSelectedItems([]);
    }
  }, [notes, selectedItems, handleNotesChange]);

  const mirror = useCallback(() => {
    if (selectedItems.length === 0) return;
    if (readonlyGateRef.current?.isReadOnly()) {
      readonlyGateRef.current.onReject();
      return;
    }
    handleNotesChange(mirrorSelection(notes, selectedItems));
  }, [notes, selectedItems, handleNotesChange]);

  const value: EditingContextValue = {
    notes, history, historyIndex,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
    selectedItems, clipboard,
    setNotes, resetNotes, setSelectedItems, setClipboard,
    handleNotesChange, undo, redo,
    copy, cut, deleteSelected, mirror,
    chartCodeFidelity, applyChartCodeToCanvas,
    setReadonlyGate,
  };

  return <EditingContext.Provider value={value}>{children}</EditingContext.Provider>;
}

export function useEditing(): EditingContextValue {
  const ctx = useContext(EditingContext);
  if (!ctx) throw new Error('useEditing must be used within EditingProvider');
  return ctx;
}