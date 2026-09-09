// 谱面代码弹窗的**打开态**（issue 59 §2/§6）：
// 两个入口（「谱面代码」按钮 / 「音符代码」工具）共用同一个弹窗组件，故把 target 提到 provider，
// 由画布（工具态点击、Ctrl+B）与工具栏（按钮）各自调用；面包屑的换档（结点 → 滑条 → 完整代码）
// 同样是换 target，弹窗据此重建草稿。
// 弹窗只在 target 非空时挂载 → 关闭即卸载 textarea（issue 37 的成本归零不变量不变）。
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { NoteCodeTarget } from '../../editing/NoteCodeOps';
import ChartCodeEditorModal from './ChartCodeEditorModal';

/** 弹窗视图目标：完整谱面代码 / 单个音符（可带滑条结点下标） */
export type CodeEditorTarget = { kind: 'chart' } | ({ kind: 'note' } & NoteCodeTarget);

export interface ChartCodeEditorContextValue {
  target: CodeEditorTarget | null;
  /** 打开完整谱面代码（永远不看选区，§2） */
  openChartCode: () => void;
  /** 打开某个音符 / 滑条结点的代码（§4 三种初值，slideRegion 由调用方回退成整条） */
  openNoteCode: (target: NoteCodeTarget) => void;
  /** 关闭弹窗 */
  close: () => void;
}

const ChartCodeEditorContext = createContext<ChartCodeEditorContextValue | null>(null);

export function ChartCodeEditorProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<CodeEditorTarget | null>(null);
  const openChartCode = useCallback(() => setTarget({ kind: 'chart' }), []);
  const openNoteCode = useCallback((t: NoteCodeTarget) => setTarget({ kind: 'note', ...t }), []);
  const close = useCallback(() => setTarget(null), []);
  const value = useMemo(
    () => ({ target, openChartCode, openNoteCode, close }),
    [target, openChartCode, openNoteCode, close],
  );

  return (
    <ChartCodeEditorContext.Provider value={value}>
      {children}
      {target && <ChartCodeEditorModal target={target} />}
    </ChartCodeEditorContext.Provider>
  );
}

export function useChartCodeEditor(): ChartCodeEditorContextValue {
  const ctx = useContext(ChartCodeEditorContext);
  if (!ctx) throw new Error('useChartCodeEditor must be used within ChartCodeEditorProvider');
  return ctx;
}
