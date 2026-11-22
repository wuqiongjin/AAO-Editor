// 工作台后台预热门控（chart-projects 44）：
// 冷启动停在非工作台页时为 false，阻止 ChartSwitcher 在空闲窗口前抢先拉取工程数据；
// 单独挂载 ChartSwitcher 的单测默认读到 true，不依赖 WorkspacePage 包裹。
import { createContext, useContext } from 'react';

export const WorkspacePrewarmContext = createContext(true);

export function useWorkspacePrewarmEnabled(): boolean {
  return useContext(WorkspacePrewarmContext);
}
