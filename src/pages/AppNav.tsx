import { createContext, useContext, type ReactNode } from 'react';
import { ChevronsLeft, ChevronsRight, Keyboard, LayoutDashboard, Music2, Settings2 } from 'lucide-react';

// 应用级导航（issue 28）：跨页持久、可折叠（默认折叠）。
// 工作台页：与左侧工具面板合成同一左列（顶部导航、下方工具）；非工作台页：独立左列导航栏。
// 展开/折叠只控制标签是否显示，不额外占用一列（画布宽度不受影响）。
export type PageId = 'workspace' | 'audio' | 'settings' | 'shortcuts';

const NAV_ITEMS: Array<{ id: PageId; label: string; shortcut: string; icon: typeof LayoutDashboard }> = [
  { id: 'workspace', label: '工作台', shortcut: '⇧⌘1', icon: LayoutDashboard },
  { id: 'audio', label: '音频', shortcut: '⇧⌘2', icon: Music2 },
  { id: 'settings', label: '设置', shortcut: '⇧⌘3', icon: Settings2 },
  { id: 'shortcuts', label: '快捷键', shortcut: '⇧⌘4', icon: Keyboard },
];

interface AppNavValue {
  activePage: PageId;
  setActivePage: (p: PageId) => void;
  navCollapsed: boolean;
  setNavCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void;
}

const AppNavContext = createContext<AppNavValue | null>(null);

export function useAppNav(): AppNavValue {
  const ctx = useContext(AppNavContext);
  if (!ctx) throw new Error('useAppNav must be used within AppNavProvider');
  return ctx;
}

export function AppNavProvider({ value, children }: { value: AppNavValue; children: ReactNode }) {
  return <AppNavContext.Provider value={value}>{children}</AppNavContext.Provider>;
}

export function AppNav() {
  const { activePage, setActivePage, navCollapsed, setNavCollapsed } = useAppNav();
  return (
    <>
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
    </>
  );
}
