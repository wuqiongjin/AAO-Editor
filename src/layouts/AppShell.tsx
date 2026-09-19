import { useEffect, useState } from 'react';
import { AppNavProvider, AppNav, type PageId } from './AppNav';
import { PageSlot, PAGE_REGISTRY } from '../pages/PageRegistry';
import { isCapturingShortcut } from '../chart/config/ShortcutConfig';
import { useConfig } from '../app/ProviderTree';
import { t } from '../i18n';
import './AppShell.css';

// 应用壳：五页注册 + 保活隐藏暂停 + 切页快捷键 + 可折叠导航（默认折叠）。
// - 导航列常驻，工作台左面板只含工具栏。
// - 路由层归 src/pages/PageRegistry.tsx。

const NAV_ITEMS: Array<{ id: PageId; shortcut: string }> = [
  { id: 'workspace', shortcut: '⇧⌘1' },
  { id: 'audio', shortcut: '⇧⌘2' },
  { id: 'assets', shortcut: '⇧⌘3' },
  { id: 'shortcuts', shortcut: '⇧⌘4' },
  { id: 'settings', shortcut: '⇧⌘5' },
];

const PAGE_IDS = Object.keys(PAGE_REGISTRY) as PageId[];

export default function AppShell() {
  const { settings } = useConfig();
  // 订阅 uiLanguage：壳层（导航、保活页）多数只调 t()、不读 Config。
  // 不订阅时切语言不会重渲，要等用户自己换页才换文案。
  void settings.uiLanguage;
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

  const navValue = { activePage, setActivePage, navCollapsed, setNavCollapsed };

  return (
    <AppNavProvider value={navValue}>
      <div className={`app-shell${navCollapsed ? ' is-nav-collapsed' : ''}`}>
        <aside className="app-nav" aria-label={t('nav.aria')}>
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
