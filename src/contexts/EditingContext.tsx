// EditingContext（ADR-0003 §7.1）：谱面数据与编辑——notes / history / selection / clipboard，
// 以及编辑操作（复制/剪切/粘贴/删除/镜像/放置/编辑工具态）。粘贴/放置需要坐标，由调用方以参数传入（解耦鼠标位置）。
import { createContext, useContext, useCallback, useState, type ReactNode } from 'react';
import type { ChartNote, SelectionItem } from '../notes/Charts';
import type { EditingToolAction } from '../components/FinalVirtualCanvas';
import { deleteSelection, copySelection, cutSelection, mirrorSelection } from '../utils/SelectionEditing';
import { handleNoteReplacement, pasteChartNotes } from '../utils/NoteReplacementRules';
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
  const [notes, setNotes] = useState<ChartNote[]>([]);
  const [selectedItems, setSelectedItems] = useState<SelectionItem[]>([]);
  const [clipboard, setClipboard] = useState<ChartNote[]>([]);
  // 历史记录（ADR-0001）：快照必须深拷贝，防止对象就地变异泄漏到多份快照
  // H1 收口：history + historyIndex 合并为单一原子状态，避免 updater 内副作用
  // （React StrictMode 双调用 + 连续 addToHistory 时的闭包陈旧都一次性解决）
  const [historyState, setHistoryState] = useState<{ history: ChartNote[][]; historyIndex: number }>({
    history: [[]],
    historyIndex: 0,
  });
  const history = historyState.history;
  const historyIndex = historyState.historyIndex;

  const addToHistory = useCallback((newNotes: ChartNote[]) => {
    setHistoryState(prev => {
      const newHistory = [...prev.history.slice(0, prev.historyIndex + 1), structuredClone(newNotes)];
      return { history: newHistory, historyIndex: newHistory.length - 1 };
    });
  }, []);

  const handleNotesChange = useCallback((newNotes: ChartNote[]) => {
    setNotes(newNotes);
    addToHistory(newNotes);
  }, [addToHistory]);

  const undo = useCallback(() => {
    setHistoryState(prev => {
      if (prev.historyIndex <= 0) return prev;
      const newIndex = prev.historyIndex - 1;
      setNotes(prev.history[newIndex]);
      setSelectedItems([]);
      return { history: prev.history, historyIndex: newIndex };
    });
  }, []);

  const redo = useCallback(() => {
    setHistoryState(prev => {
      if (prev.historyIndex >= prev.history.length - 1) return prev;
      const newIndex = prev.historyIndex + 1;
      setNotes(prev.history[newIndex]);
      setSelectedItems([]);
      return { history: prev.history, historyIndex: newIndex };
    });
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