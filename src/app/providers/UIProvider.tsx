// UIContext（ADR-0003 §7.2）：工作台 UI 状态——工具/缩放/节拍/组合态/设置弹窗/布局（面板宽与折叠）/鼠标悬停位置。
// 布局收纳（issue 12 / ADR-0003 L1）：面板宽度与折叠态、拖拽分隔条逻辑集中于此。
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ChartPosition } from '../../types/chart';
// H5 收口：mousePosition 直接复用 ChartPosition（{ beat, lane }）
export type MousePos = ChartPosition;

// ADR-0008 §1 工具轴（持工具态）：所有工具共驻一根互斥轴；null = 指针态（默认底态）。
// 工具被激活称"持工具态"，与对象轴（选区，EditingContext.selectedItems）解耦。
export type KeyToolId = 'single' | 'flick' | 'skill' | 'ldirectional' | 'rdirectional';
// ADR-0008 §2.1（六轮）：复制/剪切**不占工具轴**（不 arm）——必须有选区、连续操作无意义/有误删风险，
// 只保留 Ctrl+C / Ctrl+X 执行键作用于选区。故 ActionToolId 只剩 delete / paste / mirror。
// issue 59 §2/§3：「音符代码」（tool id `noteCode`）是第七个持工具态——点谁看谁、弹窗关闭后态驻留；
// 它是唯一不改谱面的工具：不可框选（原则 2 例外）、单击不清选区（原则 6 例外）。
export type ActionToolId = 'delete' | 'paste' | 'mirror' | 'noteCode';
export type ArmedTool = KeyToolId | 'bpm' | 'slide' | ActionToolId;

export interface UIContextValue {
  armedTool: ArmedTool | null;
  setArmedTool: (t: ArmedTool | null) => void;
  scale: number;
  setScale: (scale: number | ((prev: number) => number)) => void;
  beatDisplay: number;
  setBeatDisplay: (b: number) => void;
  mousePosition: MousePos | null;
  setMousePosition: (p: MousePos | null) => void;
  // 布局（ADR-0003 L1）
  leftPanelWidth: number;
  rightPanelWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  isDragging: 'left' | 'right' | null;
  startDrag: (side: 'left' | 'right') => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  // 布局持久化（issue 22 / ADR-0003 §6）：供 Editor 从 settings 初始化与回写
  setLeftPanelWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  setLeftCollapsed: (v: boolean) => void;
  setRightCollapsed: (v: boolean) => void;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [armedTool, setArmedTool] = useState<ArmedTool | null>(null);
  const [scale, setScale] = useState(1);
  const [beatDisplay, setBeatDisplay] = useState(4);
  // 收口：删 currentBpm 死状态（120 写死、原 Editor 即 _setCurrentBpm 形态）
  const [mousePosition, setMousePosition] = useState<ChartPosition | null>(null);

  // 区域宽度（issue 12 / ADR-0003 L1）：默认随视口收缩（px 上限 + vw 兜底），并支持折叠/展开
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => Math.min(380, Math.round(window.innerWidth * 0.30)));
  const [rightPanelWidth, setRightPanelWidth] = useState(() => Math.min(300, Math.round(window.innerWidth * 0.20)));
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState<'left' | 'right' | null>(null);

  const startDrag = (side: 'left' | 'right') => setIsDragging(side);

  // 拖拽分隔条：min/max 随视口缩放（窄屏可收到更小，宽屏不超半屏）
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const containerWidth = window.innerWidth;
      const minWidth = Math.min(160, containerWidth * 0.2);
      const maxWidth = containerWidth * 0.5;
      if (isDragging === 'left') {
        setLeftPanelWidth(Math.max(minWidth, Math.min(maxWidth, e.clientX)));
      } else {
        setRightPanelWidth(Math.max(minWidth, Math.min(maxWidth, containerWidth - e.clientX)));
      }
    };
    const onUp = () => setIsDragging(null);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  // 收口：toggle 风格对齐（两侧都用具名函数，避免内联箭头每渲染产生新引用）
  const toggleLeftPanel = () => setLeftCollapsed(v => !v);
  const toggleRightPanel = () => setRightCollapsed(v => !v);

  const value: UIContextValue = {
    armedTool, setArmedTool,
    scale, setScale,
    beatDisplay, setBeatDisplay,
    mousePosition, setMousePosition,
    leftPanelWidth, rightPanelWidth,
    leftCollapsed, rightCollapsed,
    isDragging, startDrag,
    toggleLeftPanel,
    toggleRightPanel,
    setLeftPanelWidth, setRightPanelWidth,
    setLeftCollapsed, setRightCollapsed,
  };

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
}