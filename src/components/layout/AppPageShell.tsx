import { Children, createContext, isValidElement, type ComponentType, type ReactNode } from 'react';
import './AppPageShell.css';

// 应用页面壳 / 内容壳（ADR-0007，issue 44 收口 · 第三轮 sidebar 自适应 + body fluid）：
//   - 4 个非工作台页（音频 / 素材 / 快捷键 / 设置）共用的"页面头 + 侧边索引 + 内容模式"模板；
//   - compound component 形式（namespace），不使用 React 19 Children API named children；
//   - 模板硬约束 3 处：Header 下间距 / sidebar-body 横向 gap / sidebar 内 padding；
//   - 几何自适应：sidebar 宽 = clamp(160px, 15.625%, 240px)；body 宽 = 填满剩余；
//     4 页 body 距 main 视口左缘严格相同（= sidebar 宽 + 24px），不论有无 sidebar 渲染。
//   - 其它由 design tokens + 页面作者自管。
//
// 4 个 slot：Header / Sidebar / SidebarGroup / SidebarItem / Body
// 调用示例：
//   <AppPageShell>
//     <AppPageShell.Header eyebrow="…" title="…" description="…" />
//     <AppPageShell.Sidebar ariaLabel="…">…</AppPageShell.Sidebar>
//     <AppPageShell.Body mode="default">…</AppPageShell.Body>
//   </AppPageShell>
//
// 几何（issue 44 收口 · sidebar clamp + body fluid）：
//   - sidebar 紧贴 body 左边（gap 24px），不是贴 main 视口 0；
//   - sidebar 宽 = clamp(160px, 15.625%, 240px)（1024=160 / 1280≈192 / 1440≈217 / 1920≈240）；
//   - main 永远 padding-left: calc(sidebar + 24) 预留（无 sidebar 页该位空着，body left 仍跟其它 3 页一致）；
//   - body 宽 = 100% 填满 main 剩余空间（fluid，不硬编码）；
//   - header 左缘 = sidebar 宽 + 24，header 宽 = 填满 body 同款空间；
//   - 删 width 档（default/wide/narrow）—— body 自适应后档位无意义。

type ContentMode = 'default' | 'fill';

/* ------------ Header ------------ */

type HeaderProps = { eyebrow: string; title: string; description: string };

function Header({ eyebrow, title, description }: HeaderProps) {
  return (
    <header className="page-intro">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

/* ------------ Sidebar ------------ */

type SidebarProps = { children: ReactNode; ariaLabel?: string };

function Sidebar({ children, ariaLabel }: SidebarProps) {
  return (
    <aside className="app-page-shell__sidebar" aria-label={ariaLabel ?? '次级索引'}>
      {children}
    </aside>
  );
}

/* ------------ SidebarGroup / SidebarItem ------------ */

type SidebarGroupProps = { title: string; children: ReactNode };

function SidebarGroup({ title, children }: SidebarGroupProps) {
  return (
    <div className="app-page-shell__sidebar-group" role="group" aria-label={title}>
      <div className="app-page-shell__sidebar-group-title">{title}</div>
      <div className="app-page-shell__sidebar-group-items">{children}</div>
    </div>
  );
}

type SidebarItemProps = {
  icon: ComponentType<{ size?: number }>;
  label: string;
  active?: boolean;
  onClick: () => void;
};

function SidebarItem({ icon: Icon, label, active, onClick }: SidebarItemProps) {
  return (
    <button
      type="button"
      className={`app-page-shell__sidebar-item${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <Icon size={17} />
      <span>{label}</span>
    </button>
  );
}

/* ------------ Body ------------ */

type BodyProps = {
  mode?: ContentMode;
  /** @deprecated 删 width 档后此 prop 不再被使用；保留仅为兼容旧调用，调用方可在下一轮清理。 */
  width?: never;
  children: ReactNode;
};

const BodyContext = createContext<{ mode: ContentMode }>({ mode: 'default' });

function Body({ mode = 'default', children }: BodyProps) {
  const classes = ['app-page-shell__body'];
  if (mode === 'fill') classes.push('is-fill');

  return (
    <BodyContext.Provider value={{ mode }}>
      <div className={classes.join(' ')}>{children}</div>
    </BodyContext.Provider>
  );
}

/* ------------ Root ------------ */

type AppPageShellProps = { children: ReactNode };

/**
 * 容器根：组合 Header / Sidebar / Body 三段。
 * 几何（issue 44 收口 · sidebar 紧贴 body + body 限宽）：
 *   - 内容块 = sidebar(200) + gap(24) + body(920) = 1144px；
 *   - 整块（__head + __main）margin: 0 auto 居中于 main 视口；
 *   - 4 页内容块距 main 视口左缘严格相同 = 居中偏移；
 *   - sidebar 是 body 的附属（紧贴 body 左边），不贴 main 视口 0；
 *   - body 限宽 920（合适阅读宽度，4 页统一）；
 *   - header 跟 body 同宽同左缘（在 __head 包装层内 padding-left: 224 偏移）。
 *   - 无 sidebar 的快捷键页：整块宽 = 920，main padding-left: 224 让 body left 跟有 sidebar 3 页一致。
 */
function AppPageShellRoot({ children }: AppPageShellProps) {
  let header: ReactNode = null;
  let sidebar: ReactNode = null;
  let bodyNode: ReactNode = null;

  // 单次遍历：收齐 header / sidebar / body（顺序敏感，但几何不依赖顺序）。
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const type = child.type;
    if (type === Header) header = child;
    else if (type === Sidebar) sidebar = child;
    else if (type === Body) bodyNode = child;
  });

  // 无 sidebar 的页（快捷键）：__head 不应 padding-left 224（让 header 跟 body 在 main 0 位置对齐）
  const hasSidebar = sidebar !== null;

  return (
    <div
      className="app-page-shell"
      data-has-sidebar={hasSidebar ? 'true' : 'false'}
    >
      <div className="app-page-shell__head">{header}</div>
      <div className="app-page-shell__main">
        {sidebar}
        {bodyNode}
      </div>
    </div>
  );
}

// 复合导出
type AppPageShellType = typeof AppPageShellRoot & {
  Header: typeof Header;
  Sidebar: typeof Sidebar;
  SidebarGroup: typeof SidebarGroup;
  SidebarItem: typeof SidebarItem;
  Body: typeof Body;
};

const AppPageShell = AppPageShellRoot as AppPageShellType;
AppPageShell.Header = Header;
AppPageShell.Sidebar = Sidebar;
AppPageShell.SidebarGroup = SidebarGroup;
AppPageShell.SidebarItem = SidebarItem;
AppPageShell.Body = Body;

export default AppPageShell;
export { BodyContext };
