// EditingContext（ADR-0003 §7.1）：谱面数据与编辑——notes / history / selection / clipboard，
// 以及编辑操作（复制/剪切/粘贴/删除/镜像/放置/编辑工具态）。粘贴/放置需要坐标，由调用方以参数传入（解耦鼠标位置）。
import { createContext, useContext, useCallback, useState, type ReactNode } from 'react';
import type { ChartNote, SelectionItem } from '../notes/Charts';
import type { EditingToolAction } from '../components/FinalVirtualCanvas';
import { deleteSelection, copySelection, cutSelection, mirrorSelection } from '../utils/SelectionEditing';
import { handleNoteReplacement, pasteChartNotes } from '../utils/NoteReplacementRules';
import {
  createHistory, pushHistory, undoHistory, redoHistory, currentHistory,
  type HistoryState,
} from '../utils/History';
import type { ChartPosition } from './index';

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
  setSelectedItems: (items: SelectionItem[]) => void;
  setClipboard: (c: ChartNote[]) => void;
  // 带历史记录的变更入口
  handleNotesChange: (newNotes: ChartNote[]) => void;
  // 历史
  undo: () => void;
  redo: () => void;
  // 编辑操作
  copy: () => void;
  cut: () => void;
  paste: (pos: Position) => void;
  deleteSelected: () => void;
  mirror: () => void;
  place: (tool: string, pos: Position) => void;
  editToolAction: (action: EditingToolAction, item: SelectionItem) => void;
  editToolPaste: (pos: Position) => void;
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
    setHistoryState(prev => pushHistory(prev, newNotes));
  }, []);

  const handleNotesChange = useCallback((newNotes: ChartNote[]) => {
    addToHistory(newNotes);
  }, [addToHistory]);

  const setNotes = useCallback((n: ChartNote[]) => {
    setHistoryState(prev => pushHistory(prev, n));
  }, []);

  const undo = useCallback(() => {
    setHistoryState(prev => undoHistory(prev) ?? prev);
    setSelectedItems([]);
  }, []);

  const redo = useCallback(() => {
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

  const pasteAt = useCallback((pos: Position) => {
    if (clipboard.length === 0) return;
    const { newNotes, newStartIndex } = pasteChartNotes(notes, clipboard, pos.beat, pos.lane);
    handleNotesChange(newNotes);
    setSelectedItems(
      clipboard
        .map((_, i) => newStartIndex + i)
        .filter(i => i < newNotes.length)
        .map(i => ({ kind: 'note' as const, noteIndex: i })),
    );
  }, [notes, clipboard, handleNotesChange]);

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

  const place = useCallback((tool: string, pos: Position) => {
    const result = handleNoteReplacement(notes, pos.beat, pos.lane, 0, tool);
    if (result.shouldReplace) handleNotesChange(result.newNotes);
  }, [notes, handleNotesChange]);

  const editToolAction = useCallback((action: EditingToolAction, item: SelectionItem) => {
    setSelectedItems([item]);
    if (action === 'copy') {
      setClipboard(copySelection(notes, [item]));
    } else if (action === 'cut') {
      const { clipboard: cb, newNotes } = cutSelection(notes, [item]);
      setClipboard(cb);
      handleNotesChange(newNotes);
      setSelectedItems([]);
    } else if (action === 'delete') {
      handleNotesChange(deleteSelection(notes, [item]));
      setSelectedItems([]);
    } else if (action === 'mirror') {
      handleNotesChange(mirrorSelection(notes, [item]));
    }
  }, [notes, handleNotesChange]);

  const value: EditingContextValue = {
    notes, history, historyIndex,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
    selectedItems, clipboard,
    setNotes, setSelectedItems, setClipboard,
    handleNotesChange, undo, redo,
    copy, cut, paste: pasteAt, deleteSelected, mirror, place, editToolAction, editToolPaste: pasteAt,
  };

  return <EditingContext.Provider value={value}>{children}</EditingContext.Provider>;
}

export function useEditing(): EditingContextValue {
  const ctx = useContext(EditingContext);
  if (!ctx) throw new Error('useEditing must be used within EditingProvider');
  return ctx;
}