// EditingContext（ADR-0003 §7.1）：谱面数据与编辑——notes / history / selection / clipboard，
// 以及编辑操作（复制/剪切/粘贴/删除/镜像/编辑工具态）。放置走 ToolActionMatrix.clickOps。
import { createContext, useContext, useCallback, useState, type ReactNode } from 'react';
import type { ChartNote, SelectionItem } from '../../chart/types';
import type { ChartPosition } from '../../types/chart';
import { deleteSelection, copySelection, cutSelection, mirrorSelection } from '../../chart/editing/SelectionEditing';
import {
  createHistory, pushHistoryIfChanged, undoHistory, redoHistory, currentHistory,
  NOTES_HISTORY_CAP, type HistoryState,
} from '../../chart/editing/History';
import { notesEqual } from '../../chart/editing/NotesEqual';
// H5 收口：所有位置参数统一为 ChartPosition（{ beat, lane }）
export type Position = ChartPosition;

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
  resetNotes: (notes: ChartNote[], applied?: { text: string | null; pristine: boolean }) => void;
  setSelectedItems: (items: SelectionItem[]) => void;
  setClipboard: (c: ChartNote[]) => void;
  // 带历史记录的变更入口
  handleNotesChange: (newNotes: ChartNote[]) => void;
  appliedChartCodeText: string | null;
  chartCodePristine: boolean;
  rememberAppliedChartCode: (text: string) => void;
  // 历史
  undo: () => void;
  redo: () => void;
  // 编辑操作
  copy: () => void;
  cut: () => void;
  deleteSelected: () => void;
  mirror: () => void;
}

const EditingContext = createContext<EditingContextValue | null>(null);

export function EditingProvider({ children }: { children: ReactNode }) {
  const [selectedItems, setSelectedItems] = useState<SelectionItem[]>([]);
  const [clipboard, setClipboard] = useState<ChartNote[]>([]);
  // 历史记录（ADR-0001）：谱面 notes 以历史栈为单一真相源（ADR-0003 候选 D 收口）。
  // 快照用结构共享（编辑函数均不可变，未改动音符复用原引用），不做全量 structuredClone。
  // H1 收口：history + historyIndex 合并为单一原子状态，updater 保持纯函数（无 React StrictMode 副作用）。
  // 初始谱面（ADR-0001 谱面必须有初始 BPM）：空谱默认含第0拍120bpm，而非空数组。
  // 这样初次打开即渲染 BPM 线 / 代码编辑器显示初始 BPM，无需重置才有。
  const initialNotes: ChartNote[] = [{ beat: 0, type: "BPM", bpm: 120 }];
  const [historyState, setHistoryState] = useState<HistoryState<ChartNote[]>>(() =>
    createHistory<ChartNote[]>(initialNotes),
  );
  const history = historyState.stack;
  const historyIndex = historyState.index;
  // 当前谱面 = 历史栈 index 指向的快照
  const notes = currentHistory(historyState);

  const addToHistory = useCallback((newNotes: ChartNote[]) => {
    // 历史去重（issue 57 bug4）：与当前快照语义相等的无操作编辑（如重复放置同一音符）
    // 不占栈位——否则 Ctrl+Z 需按同样多次才退得掉第一次的真实改动。
    setHistoryState(prev => pushHistoryIfChanged(prev, newNotes, notesEqual, NOTES_HISTORY_CAP));
  }, []);

  const [appliedChartCodeText, setAppliedChartCodeText] = useState<string | null>(null);
  const [chartCodePristine, setChartCodePristine] = useState(false);

  const rememberAppliedChartCode = useCallback((text: string) => {
    setAppliedChartCodeText(text);
    setChartCodePristine(true);
  }, []);

  const handleNotesChange = useCallback((newNotes: ChartNote[]) => {
    setChartCodePristine(false);
    addToHistory(newNotes);
  }, [addToHistory]);

  const setNotes = useCallback((n: ChartNote[]) => {
    setChartCodePristine(false);
    setHistoryState(prev => pushHistoryIfChanged(prev, n, notesEqual, NOTES_HISTORY_CAP));
  }, []);

  const resetNotes = useCallback((n: ChartNote[], applied?: { text: string | null; pristine: boolean }) => {
    const notesToUse = n.length > 0 ? n : [{ beat: 0, type: "BPM", bpm: 120 } as ChartNote];
    setHistoryState(createHistory(notesToUse));
    setSelectedItems([]);
    setAppliedChartCodeText(applied?.text ?? null);
    setChartCodePristine(applied?.pristine === true);
  }, []);

  const undo = useCallback(() => {
    setChartCodePristine(false);
    setHistoryState(prev => undoHistory(prev) ?? prev);
    setSelectedItems([]);
  }, []);

  const redo = useCallback(() => {
    setChartCodePristine(false);
    setHistoryState(prev => redoHistory(prev) ?? prev);
    setSelectedItems([]);
  }, []);

  const copy = useCallback(() => {
    if (selectedItems.length > 0) setClipboard(copySelection(notes, selectedItems));
  }, [notes, selectedItems]);

  const cut = useCallback(() => {
    if (selectedItems.length > 0) {
      const { clipboard: cb, newNotes } = cutSelection(notes, selectedItems);
      setClipboard(cb);
      handleNotesChange(newNotes);
      setSelectedItems([]);
    }
  }, [notes, selectedItems, handleNotesChange]);

  const deleteSelected = useCallback(() => {
    if (selectedItems.length > 0) {
      handleNotesChange(deleteSelection(notes, selectedItems));
      setSelectedItems([]);
    }
  }, [notes, selectedItems, handleNotesChange]);

  const mirror = useCallback(() => {
    if (selectedItems.length === 0) return;
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
    appliedChartCodeText, chartCodePristine, rememberAppliedChartCode,
  };

  return <EditingContext.Provider value={value}>{children}</EditingContext.Provider>;
}

export function useEditing(): EditingContextValue {
  const ctx = useContext(EditingContext);
  if (!ctx) throw new Error('useEditing must be used within EditingProvider');
  return ctx;
}