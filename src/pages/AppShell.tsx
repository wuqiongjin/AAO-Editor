import { useEffect, useState } from 'react';
import { ChevronsLeft, ChevronsRight, Keyboard, LayoutDashboard, Music2, Settings2 } from 'lucide-react';
import { isCapturingShortcut } from '../utils/ShortcutConfig';
import Editor from './Editor';
import AudioPage from './AudioPage';
import SettingsPage from './SettingsPage';
import ShortcutsPage from './ShortcutsPage';
import './AppShell.css';

// 应用壳（issue 28）：四页注册 + 保活隐藏暂停 + 切页快捷键 + 可折叠导航（默认折叠）。
// - 四页全部保持挂载（保活），仅激活页可见（CSS display），离开工作台时自动暂停播放。
// - 工作台（Editor）黑盒接入（Q16）：仅传 active 表面契约（失活时暂停播放并抑制其全局输入）。
type PageId = 'workspace' | 'audio' | 'settings' | 'shortcuts';

const NAV_ITEMS: Array<{ id: PageId; label: string; shortcut: string; icon: typeof LayoutDashboard }> = [
  { id: 'workspace', label: '工作台', shortcut: '⇧⌘1', icon: LayoutDashboard },
  { id: 'audio', label: '音频', shortcut: '⇧⌘2', icon: Music2 },
  { id: 'settings', label: '设置', shortcut: '⇧⌘3', icon: Settings2 },
  { id: 'shortcuts', label: '快捷键', shortcut: '⇧⌘4', icon: Keyboard },
];

export default function AppShell() {
  const [activePage, setActivePage] = useState<PageId>('workspace');
  const [navCollapsed, setNavCollapsed] = useState(true);

  // 应用级切页快捷键：Ctrl/⌘+Shift+1..4（工作台=1）。
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

  return (
    <div className={`app-shell${navCollapsed ? ' is-nav-collapsed' : ''}`}>
      <aside className="app-nav" aria-label="应用页面导航">
        <div className="app-mark" aria-label="BanG Dream 谱面编辑器">BD</div>
        <nav className="app-nav-items">
          {NAV_ITEMS.map(({ id, label, shortcut, icon: Icon }) => (
            <button
              key={id}
              className={`app-nav-item${activePage === id ? ' is-active' : ''}`}
              type="button"
              onClick={() => setActivePage(id)}
              aria-current={activePage === id ? 'page' : undefined}
              title={`${label} · ${shortcut}`}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{label}</span>
              <kbd>{shortcut}</kbd>
            </button>
          ))}
        </nav>
        <button
          className="app-nav-toggle"
          type="button"
          onClick={() => setNavCollapsed((v) => !v)}
          title={navCollapsed ? '展开应用导航' : '折叠应用导航'}
          aria-expanded={!navCollapsed}
        >
          {navCollapsed ? <ChevronsRight size={18} strokeWidth={1.8} /> : <ChevronsLeft size={18} strokeWidth={1.8} />}
        </button>
      </aside>

      <section className="app-surface">
        {/* 保活挂载：四页始终渲染，仅激活页可见；工作台失活时由 active 表面契约暂停播放/抑制输入 */}
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
      </section>
    </div>
  );
}
