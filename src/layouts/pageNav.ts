// 应用页导航注册表（ADR-0015 §2 / chart-projects 03）：
// 工程管理页是第一项、启动默认落点，快捷键 ⇧⌘0；其余页面 ⇧⌘1..5 不变。
import type { PageId } from './AppNav';

export interface PageNavItem {
  id: PageId;
  shortcut: string;
  key: string;
}

export const PAGE_NAV: readonly PageNavItem[] = [
  { id: 'projects', shortcut: '⇧⌘0', key: '0' },
  { id: 'workspace', shortcut: '⇧⌘1', key: '1' },
  { id: 'audio', shortcut: '⇧⌘2', key: '2' },
  { id: 'assets', shortcut: '⇧⌘3', key: '3' },
  { id: 'shortcuts', shortcut: '⇧⌘4', key: '4' },
  { id: 'settings', shortcut: '⇧⌘5', key: '5' },
] as const;

export const DEFAULT_PAGE_ID: PageId = PAGE_NAV[0].id;
