// UIContext（ADR-0003 §7.2）：工作台 UI 状态——工具/缩放/节拍吸附。
// 注：鼠标悬停位置**不在此 Provider**（候选 3，2026-09-10 移出）—— 谱面光标是「画布 px × viewport」
// 的派生值，缓存进 context state 会在滚动/缩放后落到旧拍；现由画布按 hoverPos 用时现算，
// 并通过 ref 出口 getCursorChartPos() 提供给需要的一方。
// 票 183：旧版左右面板（宽度 / 折叠 / 拖拽分隔条）随换壳删除；片段库抽屉的开合与宽度存 settings.layout.patternDrawer。
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CurveConfig } from '../../chart/editing/CurveTool';
import type { Pattern } from '../../chart/patterns/types';
import {
  POINTER_TOOL_STATE, withArmedTool, withPatternPasteToggled, type ArmedToolState,
} from '../armedToolState';
import { useConfig } from './ConfigProvider';

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

export interface UIContextValue {
  armedTool: ArmedTool | null;
  setArmedTool: (t: ArmedTool | null) => void;
  /**
   * 片段粘贴持工具态（issue 186 / ADR-0023 §4）：非 null = 粘贴的负载来自该片段而非剪贴板。
   * 只经下面两个入口变化，故 `patternPaste !== null ⇒ armedTool === 'paste'` 恒成立。
   */
  patternPaste: Pattern | null;
  /** 点卡片（抽屉用）：进粘贴持工具态、负载来源 = 该片段；同一张再点 = 退出（回指针） */
  togglePatternPaste: (pattern: Pattern) => void;
  /** 片段粘贴的「带 BPM」偏好（`settings.patternPaste.withBpm`，单一真相在 ConfigContext） */
  patternPasteWithBpm: boolean;
  setPatternPasteWithBpm: (withBpm: boolean) => void;
  /** issue 09 S2：曲线工具配置（族/型/精度），放置与段重应用共用；沿用上次值 */
  curveConfig: CurveConfig;
  setCurveConfig: (c: CurveConfig) => void;
  scale: number;
  setScale: (scale: number | ((prev: number) => number)) => void;
  beatDisplay: number;
  setBeatDisplay: (b: number) => void;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  // issue 114：曲线配置持久化于 settings.curve（全局一份、跨会话沿用），**单一真相在 ConfigContext**。
  // 本 Provider 不另存副本：否则「设置导入」走 ConfigContext 的 `setAllSettings` 整体替换 settings 后，
  // 这里的副本不会跟着变——曲线配置面板与画笔采样步长（`step = 1 / curveConfig.precision`）会继续用旧值。
  // 票 181：节拍吸附档位同理，单一真相在 settings.beatSnap。
  // 票 186：片段粘贴的「带 BPM」偏好同理，单一真相在 settings.patternPaste.withBpm。
  const {
    settings,
    setCurveConfig: persistCurveConfig,
    setBeatSnap,
    setPatternPasteWithBpm,
  } = useConfig();
  const curveConfig = settings.curve;
  const beatDisplay = settings.beatSnap;
  // 缺字段 / 非布尔一律当「含 BPM」（ADR-0023 §2 的默认档），别让脏存档静默退化成仅音符
  const patternPasteWithBpm = settings.patternPaste?.withBpm !== false;
  // 工具轴与粘贴负载来源是同一份状态：切工具即丢片段来源（ADR-0023 §4），拆成两个 useState 会漏同步
  const [toolState, setToolState] = useState<ArmedToolState>(POINTER_TOOL_STATE);
  const [scale, setScale] = useState(1);

  const setArmedTool = useCallback((t: ArmedTool | null) => setToolState(withArmedTool(t)), []);
  const togglePatternPaste = useCallback(
    (pattern: Pattern) => setToolState((state) => withPatternPasteToggled(state, pattern)),
    [],
  );

  const value = useMemo<UIContextValue>(() => ({
    armedTool: toolState.armedTool,
    setArmedTool,
    patternPaste: toolState.pattern,
    togglePatternPaste,
    patternPasteWithBpm,
    setPatternPasteWithBpm,
    curveConfig,
    setCurveConfig: persistCurveConfig,
    scale,
    setScale,
    beatDisplay,
    setBeatDisplay: setBeatSnap,
  }), [
    toolState.armedTool,
    setArmedTool,
    toolState.pattern,
    togglePatternPaste,
    patternPasteWithBpm,
    setPatternPasteWithBpm,
    curveConfig,
    persistCurveConfig,
    scale,
    setScale,
    beatDisplay,
    setBeatSnap,
  ]);

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
}
