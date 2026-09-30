// 应用页导航注册表（ADR-0015 §2 / chart-projects 03）：
// 工程管理页是第一项、启动默认落点，快捷键 ⇧⌘0；其余页面 ⇧⌘1..6。
//
// 位次（2026-09-30 用户验收拍板）：**预览页紧随音频页（⇧⌘3）**——仿真场回放要放工程音频，
// 两者挨着最顺；末位留给工具类页面（快捷键 / 设置）。预览插进来使素材（3→4）、快捷键（4→5）、
// 设置（5→6）各顺延一位。
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
  { id: 'preview', shortcut: '⇧⌘3', key: '3' },
  { id: 'assets', shortcut: '⇧⌘4', key: '4' },
  { id: 'shortcuts', shortcut: '⇧⌘5', key: '5' },
  { id: 'settings', shortcut: '⇧⌘6', key: '6' },
] as const;

export const DEFAULT_PAGE_ID: PageId = PAGE_NAV[0].id;
