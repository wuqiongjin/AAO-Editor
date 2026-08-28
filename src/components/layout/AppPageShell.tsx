import { Children, createContext, isValidElement, type ComponentType, type ReactNode } from 'react';
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
//
// 几何（按 issue 44 红框图 + H 原型定案，正常文档流实现）：
//   - 整块（sidebar + body）与 Header 包装层同宽 blockWidth，均 margin: 0 auto 居中于 main 视口；
//   - Header 跟 body 同宽同左缘（不横跨整块）：intro 在 __head 包装层内 margin-left = sidebar(200) + gap(24)；
//   - 无 sidebar 时（快捷键页）indent = 0，Header 左缘 = 整块左缘；
//   - Body flex: 1 1 auto + max-width 档值：main 满宽时 body = 档值，视口收缩时随 main 收缩；
//   - 整块宽 = sidebar(200) + gap(24) + body(<width 档>)

type WidthTier = 'default' | 'wide' | 'narrow';
type ContentMode = 'default' | 'fill';

const SIDEBAR_W = 200;          // 模板硬约束：4 页统一 200px
const SIDEBAR_BODY_GAP = 24;    // 模板硬约束：sidebar-body 横向 gap

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

/**
 * 共享 width 给 main 整块：BodyContext.Provider 让 main 知道整块宽。
 * main 整块宽 = SIDEBAR_W + SIDEBAR_BODY_GAP + body width。
 */
const BodyContext = createContext<{ width: WidthTier; maxWidth: string }>({
  width: 'default',
  maxWidth: WIDTH_VALUES.default,
});

function Body({ mode = 'default', width, children }: BodyProps) {
  const maxWidth = WIDTH_VALUES[width];
  const classes = ['app-page-shell__body', `is-width-${width}`];
  if (mode === 'fill') classes.push('is-fill');

  return (
    <BodyContext.Provider value={{ width, maxWidth }}>
      <div className={classes.join(' ')} style={{ maxWidth }}>
        {children}
      </div>
    </BodyContext.Provider>
  );
}

/* ------------ Root ------------ */

type AppPageShellProps = { children: ReactNode };

/**
 * 容器根：组合 Header / Sidebar / Body 三段（正常文档流，无绝对定位）。
 * - __head 包装层与 main 整块同宽（blockWidth），同用 margin: 0 auto 居中；
 * - Header（.page-intro）在 __head 内 margin-left = sidebar(200) + gap(24)，
 *   使 Header 左缘/宽度跟 Body 严格一致；
 * - main 整块（sidebar+body）宽 = sidebar(200) + gap(24) + body(<width 档>)；
 * - 不写 Sidebar 时（快捷键页）blockWidth = body 档值，Header indent = 0。
 */
function AppPageShellRoot({ children }: AppPageShellProps) {
  let header: ReactNode = null;
  let sidebar: ReactNode = null;
  let bodyNode: ReactNode = null;
  let bodyWidth: WidthTier = 'default';

  // 单次遍历：先收齐 header/sidebar/body 与 body width，再做几何计算（顺序敏感）。
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const type = child.type;
    if (type === Header) header = child;
    else if (type === Sidebar) sidebar = child;
    else if (type === Body) {
      bodyNode = child;
      const w = (child.props as { width?: WidthTier }).width;
      if (w) bodyWidth = w;
    }
  });

  const bodyMaxWidth = parseInt(WIDTH_VALUES[bodyWidth], 10);
  const hasSidebar = sidebar !== null;
  const headerIndent = hasSidebar ? SIDEBAR_W + SIDEBAR_BODY_GAP : 0;
  const blockWidth = headerIndent + bodyMaxWidth;

  return (
    <div
      className="app-page-shell"
      style={{
        '--aps-block-width': `${blockWidth}px`,
        '--aps-body-width': `${bodyMaxWidth}px`,
        '--aps-header-indent': `${headerIndent}px`,
      } as React.CSSProperties}
    >
      <div className="app-page-shell__head">{header}</div>
      <div className="app-page-shell__main">{sidebar}{bodyNode}</div>
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
// BodyContext 仅供未来扩展（如 SidebarItem 想知道所在 Body 的 width），不强制使用
export { BodyContext };
