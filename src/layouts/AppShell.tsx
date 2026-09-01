import { useEffect, useState } from 'react';
import { AppNavProvider, AppNav, type PageId } from './AppNav';
import { PageSlot, PAGE_REGISTRY } from '../pages/PageRegistry';
import { isCapturingShortcut } from '../chart/config/ShortcutConfig';
import './AppShell.css';

// 应用壳（issue 28 + issue 29）：五页注册 + 保活隐藏暂停 + 切页快捷键 + 可折叠导航（默认折叠）。
// - 五页全部保持挂载（保活），仅激活页可见（CSS display），离开工作台时自动暂停播放。
// - 工作台（Editor）黑盒接入（Q16）：仅传 active 表面契约（失活时暂停播放并抑制其全局输入）。
// - 导航与工作台左侧工具面板合成同一左列（issue 28 第 2 轮）：工作台页由 Editor 内渲染导航，
//   非工作台页由本壳渲染独立导航列；导航不再单独挤压画布。
// - 路由层归 src/pages/PageRegistry.tsx：AppShell 不直接 import 各 page 文件。

const NAV_ITEMS: Array<{ id: PageId; label: string; shortcut: string }> = [
  { id: 'workspace', label: '工作台', shortcut: '⇧⌘1' },
  { id: 'audio', label: '音频', shortcut: '⇧⌘2' },
  { id: 'assets', label: '素材', shortcut: '⇧⌘3' },
  { id: 'shortcuts', label: '快捷键', shortcut: '⇧⌘4' },
  { id: 'settings', label: '设置', shortcut: '⇧⌘5' },
];

const PAGE_IDS = Object.keys(PAGE_REGISTRY) as PageId[];

export default function AppShell() {
  const [activePage, setActivePage] = useState<PageId>('workspace');
  const [navCollapsed, setNavCollapsed] = useState(true);

  // 应用级切页快捷键：Ctrl/⌘+Shift+1..5（工作台=1）。
  // 记录快捷键弹窗打开时（isCapturingShortcut）放行，避免误切页。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      if (isCapturingShortcut()) return;
      const index = Number(e.key) - 1;
      const next = NAV_ITEMS[index];
      if (!next) return;
      e.preventDefault();
      setActivePage(next.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 工作台页：导航列宽度归 0（DOM 始终挂载，靠 CSS 平滑伸缩，不再条件渲染导致布局瞬变）；
  // 其余页：保留独立导航列（CSS 自管 nav-width，折叠 52 / 展开 156）。
  const showShellNav = activePage !== 'workspace';
  const navValue = { activePage, setActivePage, navCollapsed, setNavCollapsed };

  // 阶段 4 v2（2026-09-01）：grid-template-columns 用 CSS 自管（看 .app-shell 的 [data-nav-mode] 选择器），
  // 这里只切 mode + 折叠态；nav-width 走 CSS 变量驱动，所有过渡由 CSS 完成。
  // 数据属性驱动代替动态内联 style，避免 inline 优先于 transition 计算。
  return (
    <AppNavProvider value={navValue}>
      <div
        className={`app-shell${navCollapsed ? ' is-nav-collapsed' : ''}`}
        data-nav-mode={showShellNav ? 'open' : 'closed'}
      >
        {/* nav 始终渲染：mode=closed 时整列宽度 0 + 透明 + 不可交互，过渡由 CSS 自管。
            修 bug：原条件渲染会让 grid 列数瞬变（workspace 1 列 → audio 2 列），交叉淡入时
            出现"工作台展开态"中间闪一下。 */}
        <aside className="app-nav" aria-label="应用页面导航" aria-hidden={!showShellNav} inert={!showShellNav || undefined}>
          <AppNav />
        </aside>

        <section className="app-surface">
          {/* 保活挂载：所有 page 始终渲染，仅激活页可见；工作台失活时由 active 表面契约暂停播放/抑制输入 */}
          {PAGE_IDS.map(id => (
            <PageSlot key={id} id={id} active={activePage === id} />
          ))}
        </section>
      </div>
    </AppNavProvider>
  );
}
