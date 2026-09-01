import { Children, createContext, isValidElement, type ComponentType, type ReactNode } from 'react';
import './AppPageShell.css';

// 应用页面壳 / 内容壳（ADR-0007，第四轮流体几何）：
//   - 4 个非工作台页（音频 / 素材 / 快捷键 / 设置）共用的"页面头 + 侧边索引 + 内容模式"模板；
//   - compound component 形式（namespace），不使用 React 19 Children API named children；
//   - 模板硬约束 3 处：Header 下间距 / sidebar-body 横向 gap / sidebar 内 padding；
//   - 几何全部相对 main 视口（.app-surface，不含应用导航）：
//     * sidebar 宽 = clamp(140px, 12.5%, 200px)；
//     * 左边距 L = 51px（sidebar 起始位置，含 +3px 右移微调）；sidebar-body gap = 24px；
//     * body 宽 = max(920px, 920px + 12px + (主内容区 - 1440px) * 0.3)（主内容区 = 100vw - 导航宽），
//       主内容区 ≤1440 恒 920（1280 窗不变窄），1920 窗 ≈ 1060（+128+12）；右边距 R = 32px；
//     * 4 页 body 距 main 视口左缘严格相同 = L + sidebar 宽 + 24，不论有无 sidebar 渲染
//       （快捷键页该位置为空槽，header 从 L 对齐）；
//     * header 跟 body 同左缘同宽：__head 与 __main 完全同构 flex，共用同一 .__slot 占位槽
//       （槽里 12.5% 相对同一父块内宽解析 → 槽宽一致 → 像素级对齐）；
//     * 删 width 档（default/wide/narrow）—— body fluid 后档位无意义。
//
// 4 个 slot：Header / Sidebar / SidebarGroup / SidebarItem / Body
// 调用示例：
//   <AppPageShell>
//     <AppPageShell.Header eyebrow="…" title="…" description="…" />
//     <AppPageShell.Sidebar ariaLabel="…">…</AppPageShell.Sidebar>
//     <AppPageShell.Body mode="default">…</AppPageShell.Body>
//   </AppPageShell>
//
// 几何（第四轮流体，详见 AppPageShell.css 头部注释）：
//   - sidebar 紧贴 body 左边（gap 24px），不是贴 main 视口 0；
//   - sidebar 宽 = clamp(140px, 12.5%, 200px)（1280≈150 / 1440≈166 / 1600=200 封顶）；
//   - 左边距 L = 51px 固定（sidebar 起始位置，含 +3px 右移微调）；
//   - main 永远按 sidebar 宽 + 24 预留（无 sidebar 页用 .__slot 占位槽，body 左缘跟其它 3 页一致）；
//   - body 宽 = max(920px, 920px + 12px + (主内容区 - 1440px) * 0.3)（1280 窗 = 920 不变窄，1920 窗 ≈ 1060）；
//   - header 左缘 = L + sidebar 宽 + 24，header 宽 = 跟 body 同宽空间（与 body 共用 .__slot 占位槽对齐）；
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
  // 阶段 4（2026-09-01）：默认加 app-stagger，让 body 直系子元素进入时按 40ms 间隔
  // 阶梯式进入（Y 轴 8px + opacity）。多数页面 body 内只有一个 surface-section card，
  // 此时表现为「该卡片整体浮入」；多 card 页（assets noteskin 等）会自然阶梯化。
  // 切换 section/page 时 React 会卸载/重挂载 body 子元素，动画自然重跑。
  const classes = ['app-page-shell__body', 'app-stagger'];
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
 * 几何（第四轮流体，详见 AppPageShell.css 头部注释）：
 *   - 相对 main 视口（.app-surface）：左边距 L = 51px、
 *     sidebar 宽 = clamp(140px, 12.5%, 200px)、gap = 24px、
 *     body 宽 = max(920px, 920px + 12px + (主内容区 - 1440px) * 0.3)、右边距 R = 32px；
 *   - 1280 窗 body = 920（与历史固定 920 锚点一致，不变窄），1920 窗 body ≈ 1060（+128+12）；
 *   - 4 页 body 左缘严格相同 = L + sidebar 宽 + 24，不论有无 sidebar 渲染；
 *   - sidebar 是 body 的附属（紧贴 body 左边），不贴 main 视口 0；
 *   - header 跟 body 同宽同左缘：__head 与 __main 完全同构 flex，共用同一 .__slot 占位槽
 *     （槽里 12.5% 相对同一父块内宽解析 → 槽宽一致 → 像素级对齐）；
 *     .page-intro 宽 = 100% 跟随可用空间，覆盖 AppShell.css 旧 min(920px) 限宽。
 *   - 无 sidebar 的快捷键页：__main 渲染同款 .__slot 占位槽预留 sidebar 位，
 *     body 左缘仍跟有 sidebar 的 3 页一致。
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

  // 无 sidebar 的页（快捷键）：__main 用 .__slot 占位槽预留 sidebar 位，与 __head 同几何对齐
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
