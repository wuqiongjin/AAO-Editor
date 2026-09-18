import { Children, createContext, isValidElement, type ComponentType, type ReactNode } from 'react';
import './AppPageShell.css';

// 应用页面壳 / 内容壳（ADR-0007）：4 个非工作台页共用模板（Header + Sidebar + Body）。
// 用法示例：
//   <AppPageShell.Header eyebrow="…" title="…" description="…" />
//   <AppPageShell.Sidebar ariaLabel="…">…</AppPageShell.Sidebar>
//   <AppPageShell.Body mode="default">…</AppPageShell.Body>

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
  // 不在滚动容器（body）上挂 app-stagger：直系子元素 translateY 会把 overflow-y:auto
  // 顶出一条瞬时滚动条。进入动画由页内卡片自己的 .app-stagger 承担。
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
 * 几何详见 AppPageShell.css 头部注释。
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

  // 无 sidebar 的页：__main 用 .__slot 占位槽预留 sidebar 位，与 __head 同几何对齐
  const hasSidebar = sidebar !== null;

  return (
    <div
      className="app-page-shell"
      data-has-sidebar={hasSidebar ? 'true' : 'false'}
    >
      <div className="app-page-shell__head">
        {/* 占位槽：恒渲染，顶替 __main 的 sidebar，让 header 与 body 同父块、
            同左缘（L + sidebar 宽 + 24）、同宽（见 CSS 注释）；无 sidebar 页亦然 */}
        <span aria-hidden="true" className="app-page-shell__slot" />
        {header}
      </div>
      <div className="app-page-shell__main">
        {/* 无 sidebar 页：用同款占位槽（flex 子元素）预留 sidebar 位，
            与 __head 的占位槽几何完全同构 —— 两者的 12.5% 都相对同一父块内宽解析，
            像素级对齐（避免 padding 百分比相对包含块宽度解析造成的偏移）。 */}
        {!hasSidebar && <span aria-hidden="true" className="app-page-shell__slot" />}
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
