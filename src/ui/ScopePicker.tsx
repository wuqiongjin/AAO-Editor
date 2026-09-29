// 作用域条 / 切换器（票 22 / ADR-0015 §6）：标出"这一页此刻作用于哪个工程"，并能改。
//
// 它住在**区块头右侧**（不是页级横条）：全宽横条是两端对齐 + 中间 flex:1 的形态，只有两个元素时
// 中间必然空一大片，而这里要表达的只是一格身份 + 一个入口。
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
}

export default function ScopePicker({
  scopeId, currentId, scopeName, options, onPick,
}: ScopePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const isCurrent = currentId != null && scopeId === currentId;

  const close = useCallback(() => setOpen(false), []);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      if (!prev && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        // 面板贴右侧对齐：它开在页头那一行，右缘对齐比左缘对齐更不容易顶出视口
        setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 288) });
      }
      return !prev;
    });
  }, []);

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
            style={{ top: pos.top, left: pos.left }}
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
