// 作用域条 / 切换器（票 22 / ADR-0015 §6）：标出"这一页此刻作用于哪个工程"，并能改。
//
// 它不住页级横条（横条是两端对齐 + 中间 flex:1，只有两个元素时中间必然空一大片；这里要表达的
// 只是一格身份 + 一个入口）。落点两处：预览页工具栏左簇 / 音频页区块头右侧——面板贴哪条边跟随
// 落点，由调用方给的 `align` 决定（2026-10-05 用户定案：左簇左对齐 / 右侧右对齐）。
//
// 「当前 / 非当前」由两处一起说（定案 6）：
//   - 徽标：当前 = accent 系（与工程管理页 `.pp-current-tag` 同一枚语言）、非当前 = 中性 pill；
//   - 容器：当前 = 无框；非当前 = bg-inset 底 + border-strong 描边。
// 用中性而非警示色：这不是错误态，只是"你正待在一个临时作用域里"。
//
// 受控组件：不读 store，工程列表由调用方加载（各页数据来源不同，组件不该替它们做决定）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, FolderOpen, Lock, Search } from 'lucide-react';
import { t } from '../i18n';
import { displayProjectName } from '../project/ui/projectUi';
// 浮层复用菜单壳（`.pp-menu__scrim` / `.pp-menu__panel.is-portaled`）。它目前定义在
// ProjectsPage.css 里，所以显式 import 进来——照 ChartSwitcher 的做法，别指望"反正工程管理页
// 一定先挂载"。把菜单壳摘进 ui.css 才是正解，属另一次清理。
import '../pages/projects/ProjectsPage.css';
import './ui.css';

/** 切换器列表里的一项：只需身份 + 音频摘要 + 锁（不放封面——这条是"选作用域"，不是"挑作品"） */
export interface ScopeOption {
  id: string;
  name: string | null;
  artist: string | null;
  audioName: string | null;
  locked: boolean;
}

export interface ScopePickerProps {
  /** 本页此刻在动的工程 id（调用方已经把"作用域 ?? 当前工程"解析好） */
  scopeId: string;
  /** 当前工程 id；null = 没有当前工程（此时列表不置顶、也不标"当前"） */
  currentId: string | null;
  /** 作用域工程的展示名（调用方从记录取，组件不自己去读） */
  scopeName: string | null;
  /** 可选工程（调用方已按 lastOpened 排好；当前项会由本组件提到最前） */
  options: ScopeOption[];
  onPick: (projectId: string) => void;
  /** 下拉面板贴哪条边：`left`（默认，预览页工具栏左簇）/ `right`（音频页区块头右侧） */
  align?: 'left' | 'right';
}

/** 面板目标宽度（CSS px）：空间够时用这个 */
const PANEL_TARGET_W = 288;
/** 面板宽度下限：收窄也别比这更窄（再窄搜索框没法用） */
const PANEL_FLOOR_W = 160;
/** 面板离视口边缘的留白 */
const VIEWPORT_MARGIN = 8;

/**
 * 面板定位：贴触发钮哪条边由 `align` 定（2026-10-05 用户定案——预览页工具栏左簇 → 左对齐，
 * 音频页区块头右侧 → 右对齐）。**贴边一侧钉死不动**，另一侧放不下时收窄面板宽度（下限
 * `PANEL_FLOOR_W`）——v1「钳平」与 v2「翻转」都让位置背离触发钮，已被验收否掉。
 * 内联 width + minWidth:0 覆盖 CSS（`.pp-menu__panel{min-width:200}` 因注入顺序压过
 * `.scope-panel{min-width:288}`，曾让面板实测只有 237px）。
 */
function panelLayoutFor(
  rect: { left: number; right: number; bottom: number },
  align: 'left' | 'right',
) {
  const top = rect.bottom + 4;
  if (align === 'right') {
    const right = Math.min(window.innerWidth - VIEWPORT_MARGIN, rect.right);
    const width = Math.min(PANEL_TARGET_W, Math.max(PANEL_FLOOR_W, right - VIEWPORT_MARGIN));
    return { top, left: Math.max(VIEWPORT_MARGIN, right - width), width };
  }
  const left = Math.max(VIEWPORT_MARGIN, rect.left);
  const width = Math.min(PANEL_TARGET_W, Math.max(PANEL_FLOOR_W, window.innerWidth - left - VIEWPORT_MARGIN));
  // 连下限都放不下时（触发钮贴视口右缘）才把面板往左推——牺牲左对齐换不溢出
  const finalLeft = left + width <= window.innerWidth - VIEWPORT_MARGIN
    ? left
    : window.innerWidth - VIEWPORT_MARGIN - width;
  return { top, left: finalLeft, width };
}

export default function ScopePicker({
  scopeId, currentId, scopeName, options, onPick, align = 'left',
}: ScopePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: PANEL_TARGET_W });

  const isCurrent = currentId != null && scopeId === currentId;

  const close = useCallback(() => setOpen(false), []);

  /** 量触发钮定面板位；打开前与开着时窗口伸缩都走它（算法见 panelLayoutFor） */
  const computePos = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const next = panelLayoutFor(btn.getBoundingClientRect(), align);
    // 等值守卫：补测路径会反复调用，几何没变时别平白制造一次重渲
    setPos((prev) =>
      prev.top === next.top && prev.left === next.left && prev.width === next.width ? prev : next,
    );
  }, [align]);

  const toggle = useCallback(() => {
    if (!open) computePos(); // 先量再开：首帧就到位，不出现"先落在旧处再跳一下"
    setOpen(!open);
  }, [open, computePos]);

  // 开着时跟随触发钮：伸缩窗口会让触发钮随布局移动，不重新量的话面板停在旧位置、与触发钮脱节
  // （2026-10-05 音频页验收报，图 2 的形态）。
  //
  // 为什么要跨帧补测（2026-10-05 音频页验收，最大化窗口不跟随）：触发钮的位置不是 resize 事件
  // 当帧就落定的——AppPageShell 的内容壳几何由 ResizeObserver 在布局后**异步**写 --aps-* 变量，
  // window.resize 先于它派发。当帧量到的是旧几何；拖拽伸缩时 resize 连发、下一发就纠偏（慢一拍
  // 肉眼无感），而最大化是**单发** resize，量旧了之后没人再量，面板就永久停在旧位（复现：
  // 916→1900 一次性放大，面板停在旧坐标不动）。跨两帧补测覆盖 RO 落定（第一帧）与极端情况下的
  // 再落定（第二帧）；等值守卫让补测不制造冗余重渲。
  useEffect(() => {
    if (!open) return;
    let raf1 = 0;
    let raf2 = 0;
    const onResize = () => {
      computePos();
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      raf1 = requestAnimationFrame(() => {
        computePos();
        raf2 = requestAnimationFrame(computePos);
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open, computePos]);

  // 打开即聚焦搜索框（显式 focus，不用挂载期隐式抢焦点）
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    setQuery('');
  }, [open]);

  // Esc 关面板并把焦点还给触发钮（点面板外由遮罩负责）
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      btnRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  // 过滤：匹配显示名 + 歌手。**必须用显示名**——`name === null` 的工程显示为「未命名工程」，
  // 只匹配原始字段的话自动新建的工程全都搜不到。不做拼音（本仓没有拼音索引基建）。
  const { pinnedCurrent, rest } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const hit = (o: ScopeOption) => {
      if (!needle) return true;
      const name = displayProjectName(o).toLowerCase();
      const artist = (o.artist ?? '').toLowerCase();
      return name.includes(needle) || artist.includes(needle);
    };
    const matched = options.filter(hit);
    return {
      pinnedCurrent: matched.find((o) => o.id === currentId) ?? null,
      rest: matched.filter((o) => o.id !== currentId),
    };
  }, [options, query, currentId]);

  const empty = pinnedCurrent == null && rest.length === 0;

  const row = (o: ScopeOption, isPinnedCurrent: boolean) => (
    <button
      key={o.id}
      type="button"
      role="option"
      aria-selected={o.id === scopeId}
      className={`scope-panel__row${o.id === scopeId ? ' is-active' : ''}`}
      onClick={() => { onPick(o.id); close(); }}
    >
      <span className="scope-panel__row-text">
        <b className={o.name ? '' : 'pp-muted'}>
          {displayProjectName(o)}
          {isPinnedCurrent && <em className="pp-current-tag">{t('projects.current')}</em>}
        </b>
        <small className="pp-muted">
          {o.audioName ?? t('projects.noAudio')}
          {o.artist ? ` · ${o.artist}` : ''}
        </small>
      </span>
      {o.locked && (
        <span className="scope-panel__lock" title={t('scope.lockedOption')}>
          <Lock size={11} />
        </span>
      )}
    </button>
  );

  return (
    <div className={`scope-picker${isCurrent ? '' : ' is-other'}`}>
      <button
        ref={btnRef}
        type="button"
        className="scope-picker__trigger"
        title={t('scope.triggerTitle')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('scope.triggerAria', { name: displayProjectName({ name: scopeName }) })}
        onClick={toggle}
      >
        <FolderOpen size={13} />
        <span className="scope-picker__name">{displayProjectName({ name: scopeName })}</span>
        <span className={`scope-picker__tag${isCurrent ? ' is-current' : ' is-other'}`}>
          {isCurrent ? t('projects.current') : t('scope.other')}
        </span>
        <ChevronDown size={14} className={`scope-picker__caret${open ? ' is-open' : ''}`} />
      </button>

      {open && createPortal(
        <>
          <span className="pp-menu__scrim" onClick={close} />
          {/* portal 是硬要求：AppPageShell.Body 的直系子元素带 .app-stagger 进场动画
              （终止态 transform: translateY(0) + fill: both），会给它们各建一个常驻 stacking
              context，把浮层的 z-index 困在里面；卡片还有 overflow: clip 会裁掉长列表。 */}
          <div
            className="pp-menu__panel is-portaled scope-panel"
            style={{ top: pos.top, left: pos.left, width: pos.width, minWidth: 0, boxSizing: 'border-box' }}
            role="listbox"
            aria-label={t('scope.panelAria')}
          >
            <div className="scope-panel__search">
              <Search size={13} />
              <input
                ref={inputRef}
                type="text"
                className="scope-panel__input"
                value={query}
                placeholder={t('scope.searchPlaceholder')}
                aria-label={t('scope.searchAria')}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="scope-panel__list">
              {pinnedCurrent && row(pinnedCurrent, true)}
              {pinnedCurrent && rest.length > 0 && <div className="scope-panel__sep" />}
              {rest.map((o) => row(o, false))}
              {empty && <div className="scope-panel__empty">{t('scope.noMatch')}</div>}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
