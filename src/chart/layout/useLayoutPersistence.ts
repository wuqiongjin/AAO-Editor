// useLayoutPersistence（候选 2 / 架构深化评审候选 2 / ADR-0003 §6 + issue 22 §6）：
// 布局持久化 = 挂载从 settings 初始化 + 变更回写 settings.layout。
// 拆出 Editor.tsx 内 ~30 行的 layoutHydrated 双 effect。
//
// 不变量（保留）：
//   - hydrated 状态门控首帧：init 应用 settings 后才允许持久化回写，避免首帧用 UIContext 默认值覆盖已存布局
//   - setLayout 引用稳定（ConfigContext 已 useCallback），非 deps 也稳定，避免无限重渲染
//   - 仅挂载初始化一次
import { useEffect, useState } from 'react';
import type { UIContextValue } from '../../app/providers/UIProvider';
import type { AppSettings } from '../../chart/config/AppSettings';

export interface UseLayoutPersistenceOptions {
  /** 当前 settings.layout（来自 ConfigContext） */
  settings: AppSettings;
  /** UIContext 的面板 setter（保持原 4 个 setter 的引用稳定） */
  ui: Pick<UIContextValue, 'setLeftPanelWidth' | 'setRightPanelWidth' | 'setLeftCollapsed' | 'setRightCollapsed' | 'leftPanelWidth' | 'rightPanelWidth' | 'leftCollapsed' | 'rightCollapsed'>;
  /** ConfigContext.setLayout（写回 settings.layout） */
  setLayout: (layout: AppSettings['layout']) => void;
}

export function useLayoutPersistence(opts: UseLayoutPersistenceOptions): void {
  const { settings, ui, setLayout } = opts;
  const { setLeftPanelWidth, setRightPanelWidth, setLeftCollapsed, setRightCollapsed,
    leftPanelWidth, rightPanelWidth, leftCollapsed, rightCollapsed } = ui;
  const [layoutHydrated, setLayoutHydrated] = useState(false);

  // 仅挂载初始化一次
  useEffect(() => {
    const { leftPanel, rightPanel } = settings.layout;
    setLeftPanelWidth(leftPanel.width);
    setLeftCollapsed(leftPanel.collapsed);
    setRightPanelWidth(rightPanel.width);
    setRightCollapsed(rightPanel.collapsed);
    setLayoutHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // hydrate 后回写 settings.layout
  useEffect(() => {
    if (!layoutHydrated) return;
    setLayout({
      leftPanel: { width: leftPanelWidth, collapsed: leftCollapsed },
      rightPanel: { width: rightPanelWidth, collapsed: rightCollapsed },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutHydrated, leftPanelWidth, leftCollapsed, rightPanelWidth, rightCollapsed]);
}
