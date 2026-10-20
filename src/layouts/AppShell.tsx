import { useCallback, useEffect, useRef, useState } from 'react';
import { AppNavProvider, AppNav, type AppNavValue, type PageId } from './AppNav';
import { showToast } from '../ui/Toast';
import { PageSlot, PAGE_REGISTRY } from '../pages/PageRegistry';
import { isCapturingShortcut } from '../chart/config/ShortcutConfig';
import { useConfig } from '../app/ProviderTree';
import { t } from '../i18n';
import { DEFAULT_PAGE_ID, PAGE_NAV } from './pageNav';
import { useCurrentProject } from '../app/providers/CurrentProjectProvider';
import AppUpdateHost from '../app/AppUpdateHost';
import { trail } from '../diagnostics/trail';
import type { PageScope } from './pageScope';
import './AppShell.css';

// 应用壳：七页注册 + 保活隐藏暂停 + 切页快捷键 + 可折叠导航（默认折叠）。
// - 导航列常驻，工作台左面板只含工具栏。
// - 路由层归 src/pages/PageRegistry.tsx。
// - 工程管理页是启动落点（ADR-0015 §2）；进工作台时确保当前工程。

const PAGE_IDS = Object.keys(PAGE_REGISTRY) as PageId[];

// 进页面即"确保当前工程"的范围（issue 20 / ADR-0015 §3）：只剩工作台。
// 音频页出列是因为它可以被**作用域**指向别的工程（票 22），此时它不需要当前工程；
// 它无当前工程时给空态，不因进页面而新建工程（票 15 定案 4）。
const NEEDS_CURRENT_PROJECT: ReadonlySet<PageId> = new Set(['workspace']);

export default function AppShell() {
  const { settings } = useConfig();
  // 订阅 uiLanguage：壳层（导航、保活页）多数只调 t()、不读 Config。
  // 不订阅时切语言不会重渲，要等用户自己换页才换文案。
  void settings.uiLanguage;
  const [activePage, setActivePageState] = useState<PageId>(() => DEFAULT_PAGE_ID);
  const [pageScope, setPageScope] = useState<PageScope | null>(null);
  const [navCollapsed, setNavCollapsed] = useState(true);
  const { ensure, store, catalogEpoch } = useCurrentProject();
  const activePageRef = useRef(activePage);
  activePageRef.current = activePage;

  // 切页 = 同时决定这一页的作用域（票 22 定案 2）。两个 state 一起批，页面看到的是同一帧的新值。
  // 句柄必须稳定：预览/音频页有 effect 依赖 setActivePage，身份一变会把带 chartId 的作用域冲掉。
  const setActivePage = useCallback<AppNavValue['setActivePage']>((page, request) => {
    setPageScope(request?.scope ?? null);
    const from = activePageRef.current;
    if (page !== from) {
      trail.record({ module: 'nav', action: 'page', meta: { from, to: page } });
    }
    setActivePageState(page);
  }, []);

  // 作用域失效回落（票 22 定案 9 / ADR-0016 §4）。收敛点：不另立"不存在"的中间态——
  // 清掉作用域就等于回到当前工程，清掉二级就等于回到"该工程的当前谱面 ?? 首张"；
  // 当前工程也没有时由页面自己的空态兜住。"无作用域"与"作用域失效"因此是同一个态。
  useEffect(() => {
    if (!pageScope) return;
    let cancelled = false;
    void (async () => {
      try {
        const still = await store.get(pageScope.projectId);
        if (cancelled) return;
        if (!still) {
          setPageScope(null);
          showToast(t('scope.gone'), 'warn');
          return;
        }
        // 二级（谱面）失效：只清二级、保留工程——回落由页面按 pickScopedChartId 算
        if (pageScope.chartId != null && !still.charts.some((c) => c.id === pageScope.chartId)) {
          setPageScope({ projectId: pageScope.projectId });
          showToast(t('scope.chartGone'), 'warn');
        }
      } catch {
        // 读取失败不当作"被删"：一次读错不该静默改掉页面的作用对象
      }
    })();
    return () => { cancelled = true; };
  }, [pageScope, catalogEpoch, store]);

  // 应用级切页快捷键：Ctrl/⌘+Shift+0（工程）与 1..6（照 PAGE_NAV）。
  // 记录快捷键弹窗打开时（isCapturingShortcut）放行，避免误切页。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      if (isCapturingShortcut()) return;
      const next = PAGE_NAV.find((item) => item.key === e.key);
      if (!next) return;
      e.preventDefault();
      setActivePage(next.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setActivePage]);

  useEffect(() => {
    if (!NEEDS_CURRENT_PROJECT.has(activePage)) return;
    void ensure();
  }, [activePage, ensure]);

  const navValue = { activePage, setActivePage, pageScope, navCollapsed, setNavCollapsed };

  return (
    <AppNavProvider value={navValue}>
      <div className={`app-shell${navCollapsed ? ' is-nav-collapsed' : ''}`}>
        <AppUpdateHost />
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
