// UIContext（ADR-0003 §7.2）：工作台 UI 状态——工具/缩放/节拍/组合态/设置弹窗/布局（面板宽与折叠）。
// 注：鼠标悬停位置**不在此 Provider**（候选 3，2026-09-10 移出）—— 谱面光标是「画布 px × viewport」
// 的派生值，缓存进 context state 会在滚动/缩放后落到旧拍；现由画布按 hoverPos 用时现算，
// 并通过 ref 出口 getCursorChartPos() 提供给需要的一方。
// 布局收纳（issue 12 / ADR-0003 L1）：面板宽度与折叠态、拖拽分隔条逻辑集中于此。
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { defaultPanelWidth } from '../../chart/config/AppSettings';
import type { CurveConfig } from '../../chart/editing/ToolActionMatrix';


// ADR-0008 §1 工具轴（持工具态）：所有工具共驻一根互斥轴；null = 指针态（默认底态）。
// 工具被激活称"持工具态"，与对象轴（选区，EditingContext.selectedItems）解耦。
export type KeyToolId = 'single' | 'flick' | 'skill' | 'ldirectional' | 'rdirectional';
// ADR-0008 §2.1（六轮）：复制/剪切**不占工具轴**（不 arm）——必须有选区、连续操作无意义/有误删风险，
// 只保留 Ctrl+C / Ctrl+X 执行键作用于选区。故 ActionToolId 只剩 delete / paste / mirror。
// issue 59 §2/§3：「音符代码」（tool id `noteCode`）是第七个持工具态——点谁看谁、弹窗关闭后态驻留；
// 它是唯一不改谱面的工具：不可框选（原则 2 例外）、单击不清选区（原则 6 例外）。
export type ActionToolId = 'delete' | 'paste' | 'mirror' | 'noteCode';
// issue 09 S2（ADR-0009 §3）：`curve` = 曲线工具（单击链式缓动段 / 拖动画笔自由段 / 点段重应用）
export type ArmedTool = KeyToolId | 'bpm' | 'slide' | 'curve' | ActionToolId;

/** 曲线工具出厂默认（沿用上次值 = 本 Provider state 天然具备；会话内不持久化到 settings）。
 *  templateId null = 用缓动函数；非空 = 形状模板优先（ADR-0009 §2） */
export const DEFAULT_CURVE_CONFIG: CurveConfig = { family: 'sine', type: 'inOut', precision: 16, templateId: null };

export interface UIContextValue {
  armedTool: ArmedTool | null;
  setArmedTool: (t: ArmedTool | null) => void;
  /** issue 09 S2：曲线工具配置（族/型/精度），放置与段重应用共用；沿用上次值 */
  curveConfig: CurveConfig;
  setCurveConfig: (c: CurveConfig) => void;
  scale: number;
  setScale: (scale: number | ((prev: number) => number)) => void;
  beatDisplay: number;
  setBeatDisplay: (b: number) => void;

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
  const [curveConfig, setCurveConfig] = useState<CurveConfig>(DEFAULT_CURVE_CONFIG);
  const [scale, setScale] = useState(1);
  const [beatDisplay, setBeatDisplay] = useState(4);


  // 区域宽度（issue 12 / ADR-0003 L1；issue 97 起左右同口径 = defaultPanelWidth：20vw 兜底、300px 封顶，
  //   与 AppSettings 出厂默认一致——挂载 hydrate 会以 settings.layout 覆盖本初值，两者不得再分叉），
  // 并支持折叠/展开
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => defaultPanelWidth(window.innerWidth));
  const [rightPanelWidth, setRightPanelWidth] = useState(() => defaultPanelWidth(window.innerWidth));
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
    curveConfig, setCurveConfig,
    scale, setScale,
    beatDisplay, setBeatDisplay,
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