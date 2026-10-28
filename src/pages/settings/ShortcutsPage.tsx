import { Fragment, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { AppWindow, Ellipsis, Inbox, List, Music2, Pencil, Play, RotateCcw, Search, SearchX, SquarePen } from 'lucide-react';
import AppPageShell from '../../layouts/AppPageShell';
import EmptyState from '../../ui/EmptyState';
import {
  FUNCTIONS, functionById, setFunctionBinding, getDefaultConfig,
  formatKey, normalizeKeyEvent, setCapturingShortcut, type FunctionId,
} from '../../chart/config/ShortcutConfig';
import {
  INDEX_FILTERS, type IndexFilterId,
  filterFunctions, shortcutTableEmptyKind, restoreDefaultsInFilter,
} from '../../settings/shortcutIndexFilter';
import { useConfig } from '../../app/ProviderTree';
import { showToast } from '../../ui/Toast';
import { t, type MessageKey } from '../../i18n';

// 快捷键页（issue 28 + issue 44 + issue 121 + issue 177）：
//   - 侧栏「索引筛选」粗桶筛表（≠ ADR-0002 tooltip 类别）；默认「全部」，不写入设置对象；
//   - 切页七功能与画布功能同表（归「系统」），同样可改键 / 可屏蔽 / 同一套冲突检测；
//   - 搜索 ∩ 当前桶；空结果走 EmptyState；
//   - Body 走 mode="fill"（表格自身滚）；导入/导出在「设置 → 配置数据」。

const INDEX_FILTER_ICONS: Record<IndexFilterId, ComponentType<{ size?: number }>> = {
  all: List,
  system: AppWindow,
  noteTools: Music2,
  editTools: SquarePen,
  playback: Play,
  other: Ellipsis,
};

/** 由按键事件构建规范绑定串（小写）；纯修饰键返回 null。 */
function comboFromKeyEvent(e: KeyboardEvent): string | null {
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return null;
  return normalizeKeyEvent(e);
}

/**
 * 独立的快捷键记录弹窗（类 VSCode）：Enter 确认、Esc 取消。
 * `onCommit` 返回 null = 已写入；返回字符串 = 冲突原因（**弹窗不关**，就地提示，草稿保留可重按）。
 */
function ShortcutRecorder({ id, onCommit, onClose }: {
  id: FunctionId; onCommit: (binding: string) => string | null; onClose: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);

  useEffect(() => {
    setCapturingShortcut(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') {
        if (!draftRef.current) return;
        const err = onCommit(draftRef.current);
        if (err) setConflict(err);
        else onClose();
        return;
      }
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      const combo = comboFromKeyEvent(e);
      if (combo) {
        draftRef.current = combo;
        setDraft(combo);
        setConflict(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      setCapturingShortcut(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="shortcut-recorder"
      onClick={onClose}
    >
      <div
        className="shortcut-recorder__panel"
        onClick={e => e.stopPropagation()}
      >
        <div className={`shortcut-recorder__keys${conflict ? ' is-conflict' : ''}`}>
          {draft ? formatKey(draft) : '…'}
        </div>
        {conflict
          ? <div className="shortcut-recorder__error" role="alert">{conflict}</div>
          : <div className="shortcut-recorder__hint">{t('shortcuts.recorder.hint')}</div>}
        <div className="shortcut-recorder__meta">{t('shortcuts.recorder.meta', { label: t(functionById(id).label as MessageKey) })}</div>
      </div>
    </div>
  );
}

export default function ShortcutsPage() {
  const { settings, setShortcutConfig } = useConfig();
  const config = settings.shortcuts;
  const [query, setQuery] = useState('');
  const [indexFilter, setIndexFilter] = useState<IndexFilterId>('all');
  const [editingId, setEditingId] = useState<FunctionId | null>(null);
  const shortcutTableRef = useRef<HTMLDivElement>(null);

  // issue 127：换桶重挂表体，但滚动容器仍是 .shortcut-table → 须显式回顶；搜索只滤行、保持 scrollTop。
  useEffect(() => {
    shortcutTableRef.current?.scrollTo({ top: 0 });
  }, [indexFilter]);

  const visible = useMemo(
    () => filterFunctions(FUNCTIONS, indexFilter, query, config),
    [indexFilter, query, config],
  );

  const emptyKind = useMemo(() => {
    const bucketHits = filterFunctions(FUNCTIONS, indexFilter, '', config).length;
    return shortcutTableEmptyKind(bucketHits, visible.length);
  }, [indexFilter, config, visible.length]);

  const searchActive = query.trim().length > 0;

  const restorableCount = useMemo(
    () => (searchActive
      ? visible.length
      : filterFunctions(FUNCTIONS, indexFilter, '', config).length),
    [searchActive, visible.length, indexFilter, config],
  );

  const resetTitle = useMemo(() => {
    if (searchActive) return t('shortcuts.resetSearch');
    return indexFilter === 'all' ? t('shortcuts.resetAll') : t('shortcuts.resetBucket');
  }, [searchActive, indexFilter]);

  /** 返回 null = 已写入；返回字符串 = 冲突原因，交给记录弹窗就地显示（弹窗不关） */
  const commit = (id: FunctionId, binding: string): string | null => {
    const next = { ...config };
    const conflict = setFunctionBinding(next, id, binding);
    if (conflict) {
      return t('shortcuts.conflict', { key: formatKey(binding), label: t(functionById(conflict).label as MessageKey) });
    }
    setShortcutConfig(next);
    return null;
  };

  /**
   * 启用 / 屏蔽。启用同样要过冲突检测：屏蔽期间出厂键可能已被别的功能占走
   * 直接写默认键会造成两行同键、按键静默归后写者。
   * 冲突时保持屏蔽并提示占用者——与改键同一套文案。
   */
  const setEnabled = (id: FunctionId, enabled: boolean) => {
    const next = { ...config };
    if (!enabled) {
      next[id] = null;
      setShortcutConfig(next);
      return;
    }
    const binding = getDefaultConfig()[id];
    const conflict = binding ? setFunctionBinding(next, id, binding) : null;
    if (conflict) {
      showToast(t('shortcuts.conflict', {
        key: formatKey(binding),
        label: t(functionById(conflict).label as MessageKey),
      }), 'warn');
      return;
    }
    setShortcutConfig(next);
  };

  return (
    <AppPageShell>
      <AppPageShell.Header
        eyebrow={t('shortcuts.header.eyebrow')}
        title={t('shortcuts.header.title')}
        description={t('shortcuts.header.description')}
      />

      <AppPageShell.Sidebar ariaLabel={t('shortcuts.sidebar.aria')}>
        {INDEX_FILTERS.map((item) => (
          <AppPageShell.SidebarItem
            key={item.id}
            icon={INDEX_FILTER_ICONS[item.id]}
            label={t(item.label)}
            active={indexFilter === item.id}
            onClick={() => setIndexFilter(item.id)}
          />
        ))}
      </AppPageShell.Sidebar>

      <AppPageShell.Body mode="fill">

        <section className="shortcut-surface surface-section app-stagger">
        {/* 删掉 settings-heading（与 page header "快捷键" 重复），改在 toolbar 上加 padding-top 让搜索框与卡片间距与其它页一致 */}
        <div className="shortcut-toolbar">
          <label className="search-field"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('shortcuts.search')} /></label>
          <button
            className="button-secondary"
            type="button"
            disabled={restorableCount === 0}
            title={resetTitle}
            onClick={() => {
              const onlyIds = searchActive ? visible.map((f) => f.id) : undefined;
              setShortcutConfig(restoreDefaultsInFilter(config, indexFilter, FUNCTIONS, getDefaultConfig(), onlyIds));
            }}
          ><RotateCcw size={15} />{t('shortcuts.reset')}</button>
        </div>

        <div ref={shortcutTableRef} className="shortcut-table" role="table" aria-label={t('shortcuts.tableAria')}>
          <div className="shortcut-row shortcut-head" role="row">
            <span>{t('shortcuts.col.category')}</span><span>{t('shortcuts.col.function')}</span><span>{t('shortcuts.col.key')}</span><span>{t('shortcuts.col.edit')}</span><span>{t('shortcuts.col.enable')}</span>
          </div>

          {/* 换桶才重挂，复用其它页 app-stagger；搜索只滤行、不重播。工具栏不在此。 */}
          <div key={indexFilter} className="shortcut-table-body app-stagger">
          {visible.map((f) => {
            const bound = config[f.id] !== null;
            return (
              <div
                className={`shortcut-row${bound ? '' : ' disabled'}`}
                role="row"
                key={f.id}
                onDoubleClick={(e) => {
                  // 双击整行打开编辑；双击「启用」开关 / 键位按钮不重复触发（它们各自有单击/双击语义）
                  if ((e.target as HTMLElement).closest('button')) return;
                  setEditingId(f.id);
                }}
              >
                <span className="shortcut-group">{t(`tool.cat.${f.category}` as MessageKey)}</span>
                <strong>{t(f.label as MessageKey)}</strong>
                {bound ? (
                  <button
                    className="key-binding"
                    type="button"
                    onClick={() => setEditingId(f.id)}
                    title={t('shortcuts.clickToEdit')}
                  >
                    {formatKey(config[f.id] as string).split('+').map((part, k) => (
                      <Fragment key={k}>
                        {k > 0 && <span className="combo-plus" aria-hidden="true">+</span>}
                        <kbd>{part}</kbd>
                      </Fragment>
                    ))}
                  </button>
                ) : (
                  <span className="key-binding is-disabled">{t('shortcuts.blocked')}</span>
                )}
                <button
                  className="edit-binding"
                  type="button"
                  onClick={() => setEditingId(f.id)}
                  title={t('shortcuts.edit')}
                  aria-label={t('shortcuts.editAria', { label: t(f.label as MessageKey) })}
                ><Pencil size={14} /></button>
                <label style={{ display: 'flex', justifyContent: 'center' }}>
                  <button
                    className={`switch compact${bound ? ' is-on' : ''}`}
                    type="button"
                    aria-label={bound ? t('shortcuts.disableAria', { label: t(f.label as MessageKey) }) : t('shortcuts.enableAria', { label: t(f.label as MessageKey) })}
                    onClick={() => setEnabled(f.id, !bound)}
                  ><span /></button>
                </label>
              </div>
            );
          })}
          {emptyKind === 'empty-bucket' && (
            <EmptyState
              icon={Inbox}
              title={t('shortcuts.emptyBucket')}
              primaryAction={{
                label: t('shortcuts.viewAll'),
                onClick: () => { setQuery(''); setIndexFilter('all'); },
              }}
            />
          )}
          {emptyKind === 'empty-search' && (
            <EmptyState
              icon={SearchX}
              title={t('shortcuts.emptySearch')}
              description={t('shortcuts.emptySearchHint')}
              primaryAction={{
                label: t('shortcuts.clearSearch'),
                onClick: () => setQuery(''),
              }}
            />
          )}
          </div>
        </div>
      </section>

      {editingId && (
        <ShortcutRecorder
          id={editingId}
          onCommit={(binding) => commit(editingId, binding)}
          onClose={() => setEditingId(null)}
        />
      )}
      </AppPageShell.Body>
    </AppPageShell>
  );
}
