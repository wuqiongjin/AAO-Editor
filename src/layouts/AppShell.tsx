import { useEffect, useState } from 'react';
import Editor from '../chart/Editor';
import AudioPage from '../audio/AudioPage';
import SettingsPage from '../settings/SettingsPage';
import ShortcutsPage from '../settings/ShortcutsPage';
import AssetsPage from '../visual/AssetsPage';
import { AppNavProvider, AppNav, type PageId } from './AppNav';
import { isCapturingShortcut } from '../chart/config/ShortcutConfig';
import './AppShell.css';

// 应用壳（issue 28 + issue 29）：五页注册 + 保活隐藏暂停 + 切页快捷键 + 可折叠导航（默认折叠）。
// - 五页全部保持挂载（保活），仅激活页可见（CSS display），离开工作台时自动暂停播放。
// - 工作台（Editor）黑盒接入（Q16）：仅传 active 表面契约（失活时暂停播放并抑制其全局输入）。
// - 导航与工作台左侧工具面板合成同一左列（issue 28 第 2 轮）：工作台页由 Editor 内渲染导航，
//   非工作台页由本壳渲染独立导航列；导航不再单独挤压画布。

const NAV_ITEMS: Array<{ id: PageId; label: string; shortcut: string }> = [
  { id: 'workspace', label: '工作台', shortcut: '⇧⌘1' },
  { id: 'audio', label: '音频', shortcut: '⇧⌘2' },
  { id: 'assets', label: '素材', shortcut: '⇧⌘3' },
  { id: 'shortcuts', label: '快捷键', shortcut: '⇧⌘4' },
  { id: 'settings', label: '设置', shortcut: '⇧⌘5' },
];

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

  // 工作台页：导航已并入 Editor 左侧工具列，不另占列；其余页保留独立导航列。
  const showShellNav = activePage !== 'workspace';
  const navValue = { activePage, setActivePage, navCollapsed, setNavCollapsed };

  return (
    <AppNavProvider value={navValue}>
      <div
        className={`app-shell${navCollapsed ? ' is-nav-collapsed' : ''}${showShellNav ? ' has-shell-nav' : ''}`}
        style={{ gridTemplateColumns: showShellNav ? 'var(--nav-width) minmax(0, 1fr)' : 'minmax(0, 1fr)' }}
      >
        {showShellNav && (
          <aside className="app-nav" aria-label="应用页面导航">
            <AppNav />
          </aside>
        )}

        <section className="app-surface">
          {/* 保活挂载：五页始终渲染，仅激活页可见；工作台失活时由 active 表面契约暂停播放/抑制输入 */}
          <div className={`app-page${activePage === 'workspace' ? ' is-active' : ''}`} aria-hidden={activePage !== 'workspace'}>
            <Editor active={activePage === 'workspace'} />
          </div>
          <div className={`app-page${activePage === 'audio' ? ' is-active' : ''}`} aria-hidden={activePage !== 'audio'}>
            <AudioPage />
          </div>
          <div className={`app-page${activePage === 'settings' ? ' is-active' : ''}`} aria-hidden={activePage !== 'settings'}>
            <SettingsPage />
          </div>
          <div className={`app-page${activePage === 'shortcuts' ? ' is-active' : ''}`} aria-hidden={activePage !== 'shortcuts'}>
            <ShortcutsPage />
          </div>
          <div className={`app-page${activePage === 'assets' ? ' is-active' : ''}`} aria-hidden={activePage !== 'assets'}>
            <AssetsPage />
          </div>
        </section>
      </div>
    </AppNavProvider>
  );
}
