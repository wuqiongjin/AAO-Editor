import { Fragment, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { AppWindow, Ellipsis, Inbox, List, Music2, Pencil, Play, RotateCcw, Search, SearchX, SquarePen } from 'lucide-react';
import AppPageShell from '../../layouts/AppPageShell';
import EmptyState from '../../ui/EmptyState';
import {
  FUNCTIONS, functionById, setFunctionBinding, getDefaultConfig,
  formatKey, setCapturingShortcut, type FunctionId,
} from '../../chart/config/ShortcutConfig';
import {
  INDEX_FILTERS, PAGE_SWITCH_ROWS, type IndexFilterId,
  filterFunctions, filterPageSwitchRows, shortcutTableEmptyKind, restoreDefaultsInFilter,
} from '../../settings/shortcutIndexFilter';
import { useConfig } from '../../app/ProviderTree';
import { t, type MessageKey } from '../../i18n';

// 快捷键页（issue 28 + issue 44 + issue 121）：
//   - 侧栏「索引筛选」粗桶筛表（≠ ADR-0002 tooltip 类别）；默认「全部」，不写入设置对象；
//   - 切页六行进表、归系统、不可改键（无页头重复只读区）；
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

/**
 * 把可能含「/」备选的组合串展开为一条条完整快捷键。
 * 例：'Ctrl/⌘+Shift+1' → [['Ctrl','Shift','1'], ['⌘','Shift','1']]
 * 即一个功能支持多个（可互相替换的）快捷键时，各自生成一个独立键块。
 */
function expandCombo(combo: string): string[][] {
  return combo
    .split('+')
    .map(seg => seg.split('/'))
    .reduce<string[][]>((acc, alts) => alts.flatMap(alt => acc.map(prefix => [...prefix, alt])), [[]]);
}

/** 把一组按键渲染为「键块 + 键块 + 键块」；加号作为键间分隔、不渲染进键块内部 */
function KeyChips({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="combo-plus" aria-hidden="true">+</span>}
          <kbd>{p}</kbd>
        </Fragment>
      ))}
    </>
  );
}

/** 由按键事件构建规范绑定串（小写）；纯修饰键返回 null。 */
function comboFromKeyEvent(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string | null {
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return null;
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  const main = e.key === ' ' ? ' ' : e.key.toLowerCase();
  return [...mods, main].join('+');
}

/** 独立的快捷键记录弹窗（类 VSCode）：Enter 确认、Esc 取消。 */
function ShortcutRecorder({ id, onCommit, onCancel }: {
  id: FunctionId; onCommit: (binding: string) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);

  useEffect(() => {
    setCapturingShortcut(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') {
        if (draftRef.current) onCommit(draftRef.current);
        onCancel();
        return;
      }
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      const combo = comboFromKeyEvent(e);
      if (combo) {
        draftRef.current = combo;
        setDraft(combo);
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
      onClick={onCancel}
    >
      <div
        className="shortcut-recorder__panel"
        onClick={e => e.stopPropagation()}
      >
        <div className="shortcut-recorder__keys">
          {draft ? formatKey(draft) : '…'}
        </div>
        <div className="shortcut-recorder__hint">{t('shortcuts.recorder.hint')}</div>
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
  const [error, setError] = useState<{ id: FunctionId; msg: string } | null>(null);
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

  // 切页：只读进表、归系统；搜索 ∩ 当前桶
  const visiblePageSwitch = useMemo(
    () => filterPageSwitchRows(PAGE_SWITCH_ROWS, indexFilter, query),
    [indexFilter, query],
  );

  const emptyKind = useMemo(() => {
    const bucketHits =
      filterFunctions(FUNCTIONS, indexFilter, '', config).length +
      filterPageSwitchRows(PAGE_SWITCH_ROWS, indexFilter, '').length;
    return shortcutTableEmptyKind(bucketHits, visible.length + visiblePageSwitch.length);
  }, [indexFilter, config, visible.length, visiblePageSwitch.length]);

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

  const commit = (id: FunctionId, binding: string) => {
    const next = { ...config };
    const conflict = setFunctionBinding(next, id, binding);
    if (conflict) {
      setError({ id, msg: t('shortcuts.conflict', { key: formatKey(binding), label: t(functionById(conflict).label as MessageKey) }) });
      return;
    }
    setError(null);
    setShortcutConfig(next);
  };

  const setEnabled = (id: FunctionId, enabled: boolean) => {
    const next = { ...config };
    next[id] = enabled ? getDefaultConfig()[id] : null;
    setError(null);
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
              setError(null);
              const onlyIds = searchActive ? visible.map((f) => f.id) : undefined;
              setShortcutConfig(restoreDefaultsInFilter(config, indexFilter, FUNCTIONS, getDefaultConfig(), onlyIds));
            }}
          ><RotateCcw size={15} />{t('shortcuts.reset')}</button>
        </div>

        {error && <div className="shortcut-error">{error.msg}</div>}

        <div ref={shortcutTableRef} className="shortcut-table" role="table" aria-label={t('shortcuts.tableAria')}>
          <div className="shortcut-row shortcut-head" role="row">
            <span>{t('shortcuts.col.category')}</span><span>{t('shortcuts.col.function')}</span><span>{t('shortcuts.col.key')}</span><span>{t('shortcuts.col.edit')}</span><span>{t('shortcuts.col.enable')}</span>
          </div>

          {/* 换桶才重挂，复用其它页 app-stagger；搜索只滤行、不重播。工具栏不在此。 */}
          <div key={indexFilter} className="shortcut-table-body app-stagger">
          {/* 应用级（切页）快捷键：只读展示，固定绑定、不支持自定义/启用/修改 */}
          {visiblePageSwitch.map((s) => (
            <div className="shortcut-row is-system" role="row" key={s.label}>
              <span className="shortcut-group">{t('shortcuts.system')}</span>
              <strong>{t(s.label)}</strong>
              {/* 每个可替换的快捷键各成一个独立键块（如 Ctrl+Shift+1 与 ⌘+Shift+1），并排在同一行 */}
              <div className="sys-keybindings">
                {expandCombo(s.combo).map((parts, i) => (
                  <span className="key-binding is-disabled" key={i} title={t('shortcuts.fixedTitle', { label: t(s.label) })}>
                    <KeyChips parts={parts} />
                  </span>
                ))}
              </div>
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </div>
          ))}

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
                    style={error?.id === f.id ? { borderColor: 'var(--danger)', color: 'var(--danger-text)' } : undefined}
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
                  disabled={!bound}
                  onClick={() => bound && setEditingId(f.id)}
                  title={bound ? t('shortcuts.edit') : t('shortcuts.editDisabled')}
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
          onCancel={() => setEditingId(null)}
        />
      )}
      </AppPageShell.Body>
    </AppPageShell>
  );
}
