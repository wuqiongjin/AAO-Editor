// 谱面代码弹窗的**打开态**（issue 59 §2/§6）：
// 两个入口（「谱面代码」按钮 / 「音符代码」工具）共用同一个弹窗组件，故把 target 提到 provider，
// 由画布（工具态点击、Ctrl+B）与工具栏（按钮）各自调用；面包屑的换档（结点 → 滑条 → 完整代码）
// 同样是换 target，弹窗据此重建草稿。
// 弹窗只在 target 非空时挂载 → 关闭即卸载 textarea（issue 37 的成本归零不变量不变）。
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { NoteCodeTarget } from '../../editing/NoteCodeOps';
import ChartCodeEditorModal from './ChartCodeEditorModal';

/** 弹窗视图目标：完整谱面代码 / 单个音符（可带滑条结点下标） */
export type CodeEditorTarget = { kind: 'chart' } | ({ kind: 'note' } & NoteCodeTarget);

export interface ChartCodeEditorContextValue {
  target: CodeEditorTarget | null;
  /**
   * issue 69：最近一次**从画布进入**的深层对象（面包屑"回得去"的依据）。
   * null = 本次会话还没进过深层 → 面包屑只显示"完整谱面代码"一档。
   *
   * 为什么需要它：面包屑只能向上（chart ← note ← node），若不记住去过的深层，
   * 用户从 node 一路点回 chart 后，画面上就没有任何能回到 note/node 的入口
   * —— 正是用户复报的"回不去了"。
   */
  trail: NoteCodeTarget | null;
  /** 打开完整谱面代码（外部入口：工具栏按钮；视为新会话 → 清空 trail） */
  openChartCode: () => void;
  /** 打开某个音符 / 滑条结点的代码（外部入口：画布点击 / 音符代码工具 / Ctrl+B）；记录 trail */
  openNoteCode: (target: NoteCodeTarget) => void;
  /**
   * **面包屑内部导航**：只切当前视图，**不动 trail**。
   * 必须用这个方法而不是 openNoteCode —— 否则从结点点"所属滑条"会把 trail 的
   * connIndex 抹掉，用户就再也点不回那个结点了（trail 的意义正是"记住最深那次"）。
   */
  navigate: (target: CodeEditorTarget) => void;
  /** 关闭弹窗（会话结束 → 一并清空 trail） */
  close: () => void;
}

const ChartCodeEditorContext = createContext<ChartCodeEditorContextValue | null>(null);

export function ChartCodeEditorProvider({
  children,
  readOnly,
  onReadonlyReject,
  projectId,
}: {
  children: ReactNode;
  readOnly?: boolean;
  onReadonlyReject?: () => void;
  projectId?: string | null;
}) {
  const [target, setTarget] = useState<CodeEditorTarget | null>(null);
  // issue 69：最近一次从画布进入的深层对象（面包屑"回得去"的依据）
  const [trail, setTrail] = useState<NoteCodeTarget | null>(null);
  // 切工程时重置弹窗状态（issue 169：替代外层 key={projectId} 破坏性整页 remount）
  useEffect(() => {
    setTarget(null);
    setTrail(null);
  }, [projectId]);
  // 外部入口 = 新会话起点：工具栏「谱面代码」按钮清空 trail，画布点音符则记录 trail
  const openChartCode = useCallback(() => { setTrail(null); setTarget({ kind: 'chart' }); }, []);
  const openNoteCode = useCallback((t: NoteCodeTarget) => { setTrail(t); setTarget({ kind: 'note', ...t }); }, []);
  // 面包屑内部导航：只切视图，trail 原样保留（保住"能点回最深层"）
  const navigate = useCallback((t: CodeEditorTarget) => setTarget(t), []);
  const close = useCallback(() => { setTarget(null); setTrail(null); }, []);
  const value = useMemo(
    () => ({ target, trail, openChartCode, openNoteCode, navigate, close }),
    [target, trail, openChartCode, openNoteCode, navigate, close],
  );

  return (
    <ChartCodeEditorContext.Provider value={value}>
      {children}
      {target && <ChartCodeEditorModal target={target} readOnly={readOnly} onReadonlyReject={onReadonlyReject} />}
    </ChartCodeEditorContext.Provider>
  );
}

export function useChartCodeEditor(): ChartCodeEditorContextValue {
  const ctx = useContext(ChartCodeEditorContext);
  if (!ctx) throw new Error('useChartCodeEditor must be used within ChartCodeEditorProvider');
  return ctx;
}
