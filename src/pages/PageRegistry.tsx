// PageRegistry（issue 48 整改）：
// PageId → React 组件的单一映射表。
// AppShell 不再直接 import 各 page 文件，只引这一个表。
// 未来若要加 URL 路由（react-router 之类），这一层可以替换成 <Routes> 形式。

import { lazy, memo, useRef, Suspense, type ComponentType, type ReactNode } from 'react';
import { CrashBoundaryHost } from '../diagnostics/CrashBoundary';
import type { PageId } from '../layouts/AppNav';
import { ConfigContext, useConfig } from '../app/providers/ConfigProvider';

// 路由目的地全部走 lazy 装入。Suspense fallback 写在这里，AppShell 不用管。
const ProjectsPage = lazy(() => import('./projects/ProjectsPage'));
const Editor = lazy(() => import('./workspace/WorkspacePage'));
const AudioPage = lazy(() => import('./audio/AudioPage'));
const AssetsPage = lazy(() => import('./assets/AssetsPage'));
const SettingsPage = lazy(() => import('./settings/SettingsPage'));
const ShortcutsPage = lazy(() => import('./settings/ShortcutsPage'));
const PreviewPage = lazy(() => import('./preview/PreviewPage'));

/** 路由页组件 — 全部 lazy 装入，AppShell 仅持引用。 */
export const PAGE_REGISTRY: Record<PageId, ComponentType<{ active?: boolean }>> = {
  projects: ProjectsPage,
  workspace: Editor,
  audio: AudioPage,
  assets: AssetsPage,
  settings: SettingsPage,
  shortcuts: ShortcutsPage,
  preview: PreviewPage,
};

/**
 * 隐藏页面配置冻结隔离器：
 * 保活挂载的后台页面在 active: false 期间冻结 ConfigContext，
 * 阻止工作台抽屉开合、面板拖拽等高频布局配置变更穿透触发 6 个后台页面的全量被动重渲。
 * 当用户切回该页面（active 翻转为 true）时，立即对齐最新配置。
 */
function InactiveConfigBoundary({ active, children }: { active: boolean; children: ReactNode }) {
  const liveConfig = useConfig();
  const frozenConfigRef = useRef(liveConfig);
  if (active) {
    frozenConfigRef.current = liveConfig;
  }
  return (
    <ConfigContext.Provider value={active ? liveConfig : frozenConfigRef.current}>
      {children}
    </ConfigContext.Provider>
  );
}

/** Suspense 包裹的页渲染器，AppShell 用它来保活挂载。 */
export const PageSlot = memo(function PageSlot({ id, active }: { id: PageId; active: boolean }) {
  const Component = PAGE_REGISTRY[id];
  return (
    <div className={`app-page${active ? ' is-active' : ''}`} aria-hidden={!active}>
      <CrashBoundaryHost scope="page" pageId={id}>
        <Suspense fallback={null}>
          <InactiveConfigBoundary active={active}>
            <Component active={active} />
          </InactiveConfigBoundary>
        </Suspense>
      </CrashBoundaryHost>
    </div>
  );
});
