// UIContext（ADR-0003 §7.2）：工作台 UI 状态——工具/缩放/节拍/组合态/设置弹窗/布局（面板宽与折叠）/鼠标悬停位置。
// 布局收纳（issue 12 / ADR-0003 L1）：面板宽度与折叠态、拖拽分隔条逻辑集中于此。
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ChartPosition } from './index';

// H5 收口：mousePosition 直接复用 ChartPosition（{ beat, lane }）
export type MousePos = ChartPosition;

export interface UIContextValue {
  selectedTool: string;
  setSelectedTool: (t: string) => void;
  scale: number;
  setScale: (scale: number | ((prev: number) => number)) => void;
  beatDisplay: number;
  setBeatDisplay: (b: number) => void;
  isCombinationMode: boolean;
  setCombinationMode: (v: boolean) => void;
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
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [selectedTool, setSelectedTool] = useState('mouse');
  const [scale, setScale] = useState(1);
  const [beatDisplay, setBeatDisplay] = useState(4);
  const [isCombinationMode, setCombinationMode] = useState(false);
  // 收口：删 currentBpm 死状态（120 写死、原 Editor 即 _setCurrentBpm 形态）
  const [mousePosition, setMousePosition] = useState<ChartPosition | null>(null);

  // 区域宽度（issue 12 / ADR-0003 L1）：默认随视口收缩（px 上限 + vw 兜底），并支持折叠/展开
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => Math.min(470, Math.round(window.innerWidth * 0.30)));
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
    selectedTool, setSelectedTool,
    scale, setScale,
    beatDisplay, setBeatDisplay,
    isCombinationMode, setCombinationMode,
    mousePosition, setMousePosition,
    leftPanelWidth, rightPanelWidth,
    leftCollapsed, rightCollapsed,
    isDragging, startDrag,
    toggleLeftPanel,
    toggleRightPanel,
  };

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
}