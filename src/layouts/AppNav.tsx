import { createContext, useContext, type ReactNode } from 'react';
import { t, type MessageKey } from '../i18n';
import { ChevronsLeft, ChevronsRight, FolderOpen, Keyboard, LayoutDashboard, Layers, Music2, Settings2 } from 'lucide-react';
import { PAGE_NAV } from './pageNav';

// 应用级导航（issue 28）：跨页持久、可折叠（默认折叠）。
// 工作台页：与左侧工具面板合成同一左列（顶部导航、下方工具）；非工作台页：独立左列导航栏。
// 展开/折叠只控制标签是否显示，不额外占用一列（画布宽度不受影响）。
export type PageId = 'projects' | 'workspace' | 'audio' | 'settings' | 'shortcuts' | 'assets';

const NAV_META: Record<PageId, { labelKey: MessageKey; icon: typeof LayoutDashboard }> = {
  projects: { labelKey: 'nav.projects', icon: FolderOpen },
  workspace: { labelKey: 'nav.workspace', icon: LayoutDashboard },
  audio: { labelKey: 'nav.audio', icon: Music2 },
  assets: { labelKey: 'nav.assets', icon: Layers },
  shortcuts: { labelKey: 'nav.shortcuts', icon: Keyboard },
  settings: { labelKey: 'nav.settings', icon: Settings2 },
};

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
      <div className="app-mark" aria-label={t('app.markAria')}>BD</div>
      <nav className="app-nav-items">
        {PAGE_NAV.map(({ id, shortcut }) => {
          const { labelKey, icon: Icon } = NAV_META[id];
          const label = t(labelKey);
          return (
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
          );
        })}
      </nav>
      <button
        className="app-nav-toggle"
        type="button"
        onClick={() => setNavCollapsed((v) => !v)}
        title={navCollapsed ? t('nav.expand') : t('nav.collapse')}
        aria-expanded={!navCollapsed}
      >
        {navCollapsed ? <ChevronsRight size={18} strokeWidth={1.8} /> : <ChevronsLeft size={18} strokeWidth={1.8} />}
      </button>
    </>
  );
}
