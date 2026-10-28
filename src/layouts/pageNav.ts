// 应用页导航注册表（ADR-0015 §2 / chart-projects 03 / issue 177）：
// 工程管理页是第一项、启动默认落点。
//
// 位次（2026-09-30 用户验收拍板）：**预览页紧随音频页**——仿真场回放要放工程音频，
// 两者挨着最顺；末位留给工具类页面（快捷键 / 设置）。
//
// 本表只记「位次 + 快捷键功能 id」。键位归 `ShortcutConfig` 的 app 作用域功能（pageProjects…），
// 展示、分发、查重都从 settings.shortcuts 派生，这里不得再写键位字面量。
import type { FunctionId } from '../chart/config/ShortcutConfig';
import type { PageId } from './AppNav';

export interface PageNavItem {
  id: PageId;
  /** 对应的快捷键功能 id（默认 Alt+1..7，可改键/可屏蔽） */
  functionId: FunctionId;
}

export const PAGE_NAV: readonly PageNavItem[] = [
  { id: 'projects', functionId: 'pageProjects' },
  { id: 'workspace', functionId: 'pageWorkspace' },
  { id: 'audio', functionId: 'pageAudio' },
  { id: 'preview', functionId: 'pagePreview' },
  { id: 'assets', functionId: 'pageAssets' },
  { id: 'shortcuts', functionId: 'pageShortcuts' },
  { id: 'settings', functionId: 'pageSettings' },
] as const;

export const DEFAULT_PAGE_ID: PageId = PAGE_NAV[0].id;
