import { Children, isValidElement, type ComponentType, type ReactNode } from 'react';
import './AppPageShell.css';

// 应用页面壳 / 内容壳（ADR-0007）：
//   - 4 个非工作台页（音频 / 素材 / 快捷键 / 设置）共用的"页面头 + 侧边索引 + 内容模式 + 宽度档"模板；
//   - compound component 形式（namespace），不使用 React 19 Children API named children；
//   - 模板硬约束 4 处：Header 下间距 / Sidebar-Body 横向 gap / Sidebar 内 padding / Body 居中与 max-width；
//   - 其它由 design tokens + 页面作者自管。
//
// 5 个 slot：Header / Sidebar / SidebarGroup / SidebarItem / Body
// 调用示例：
//   <AppPageShell>
//     <AppPageShell.Header eyebrow="…" title="…" description="…" />
//     <AppPageShell.Sidebar>…</AppPageShell.Sidebar>
//     <AppPageShell.Body mode="default" width="default">…</AppPageShell.Body>
//   </AppPageShell>

type WidthTier = 'default' | 'wide' | 'narrow';
type ContentMode = 'default' | 'fill';

const WIDTH_VALUES: Record<WidthTier, string> = {
  default: '920px',
  wide: '1040px',
  narrow: '720px', // 本轮仅留接口不实现
};

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
  width: WidthTier;
  children: ReactNode;
};

function Body({ mode = 'default', width, children }: BodyProps) {
  const classes = ['app-page-shell__body', `is-width-${width}`];
  if (mode === 'fill') classes.push('is-fill');
  const maxWidth = WIDTH_VALUES[width];

  return (
    <div className={classes.join(' ')} style={{ maxWidth: `min(${maxWidth}, calc(100% - 32px))` }}>
      {children}
    </div>
  );
}

/* ------------ Root ------------ */

type AppPageShellProps = { children: ReactNode };

/**
 * 容器根：组合 Header / Sidebar / Body 三段。
 * - Sidebar 与 Body 在同一 flex 行（独立于 Body 外）；
 * - 不写 Sidebar 时 Body 自占全宽；
 * - 用 Children 简单遍历识别以保留 namespace 心智模型（与 React 19 named children 区别仅在审查时间）。
 */
function AppPageShellRoot({ children }: AppPageShellProps) {
  let header: ReactNode = null;
  let sidebar: ReactNode = null;
  let body: ReactNode = null;

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const type = child.type;
    if (type === Header) header = child;
    else if (type === Sidebar) sidebar = child;
    else if (type === Body) body = child;
  });

  return (
    <div className="app-page-shell">
      {header}
      <div className="app-page-shell__main">
        {sidebar}
        {body}
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
