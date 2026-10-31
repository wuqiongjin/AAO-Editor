// 片段库抽屉（票 183 外壳 + issue 185 内容）。
//
// 外壳口径（183）：展开占布局（不压画布）、左缘可拖宽、收起完全消失。
// 内容口径（185 / 164 定案 §3）：
// - 卡片 = 缩略图 + 名字 + 徽标（含 BPM 变化 · n / 含倒流）+ hover 菜单（导出 —— 动作落 187 / 删除）；
// - 顶部常驻搜索：按名字子串过滤（不区分大小写）；「库里没有片段」与「搜索无匹配」是两套空态；
// - 收藏时间倒序（最新在最上）；
// - 双击名字就地改名（Enter 提交 / Esc 取消，与 BPM 数字同一套词汇；空名拒绝、超长只截显示）；
// - 删除走既有 `sm` 确认弹窗，立即删、不建撤销栈；
// - 只读谱面：**卡片置灰**（贴入被拦，186），但「收藏选区」照常可用 —— 收藏读的是选区、不写谱面。
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkPlus, FileDown, LibraryBig, Search, Trash2, X } from 'lucide-react';
import { useConfig, useEditing } from '../../app/ProviderTree';
import { PATTERN_DRAWER_WIDTH } from '../../chart/config/AppSettings';
import { formatKey } from '../../chart/config/ShortcutConfig';
import { filterPatternsByName, patternBpmSummary, sortPatternsNewestFirst } from '../../chart/patterns/library';
import type { Pattern } from '../../chart/patterns/types';
import type { PatternLibraryApi } from '../../chart/patterns/usePatternLibrary';
import { t } from '../../i18n';
import ConfirmDialog from '../../ui/ConfirmDialog';
import PatternThumbnail from './PatternThumbnail';
import './PatternLibraryDrawer.css';

interface PatternLibraryDrawerProps {
  /** 库状态与写入口（活在 WorkspacePage：抽屉没开也能用快捷键收藏） */
  library: PatternLibraryApi;
  /** 已上传谱面只读：卡片置灰；「收藏选区」不禁用 */
  readOnly?: boolean;
  /** footer「收藏选区」：与 `execSavePattern` 同一条路径（选区 → 落库 → toast） */
  onSaveSelection: () => void;
  /** 拖宽开始 / 结束：页面据此暂停画布实时重绘（与旧面板拖拽同口径） */
  onResizingChange?: (resizing: boolean) => void;
}

export default memo(function PatternLibraryDrawer({
  library, readOnly = false, onSaveSelection, onResizingChange,
}: PatternLibraryDrawerProps) {
  const { settings, setPatternDrawer } = useConfig();
  const { selectedItems } = useEditing();
  const storedWidth = settings.layout.patternDrawer.width;
  // 拖动中只改本地宽度，松手才写设置：每帧写 localStorage + 广播设置变更不划算
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const width = dragWidth ?? storedWidth;

  const resizing = dragWidth !== null;
  const onResizingChangeRef = useRef(onResizingChange);
  onResizingChangeRef.current = onResizingChange;
  useEffect(() => {
    if (!resizing) return;
    onResizingChangeRef.current?.(true);
    const widthAt = (clientX: number) => {
      const drag = dragRef.current!;
      return Math.max(PATTERN_DRAWER_WIDTH.min, Math.round(drag.startWidth + drag.startX - clientX));
    };
    let latest = dragRef.current!.startWidth;
    const onMove = (e: MouseEvent) => {
      latest = widthAt(e.clientX);
      setDragWidth(latest);
    };
    const onUp = () => {
      // CSS `max-width: 32vw` 只夹显示宽度；落盘也按当下视口夹一次，免得存下一个看不见的宽度
      setPatternDrawer({ width: Math.min(latest, Math.max(PATTERN_DRAWER_WIDTH.min, Math.round(window.innerWidth * 0.32))) });
      dragRef.current = null;
      setDragWidth(null);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      onResizingChangeRef.current?.(false);
    };
  }, [resizing, setPatternDrawer]);

  // 搜索只筛显示，不改库（排序是库口径：收藏时间倒序）
  const [query, setQuery] = useState('');
  const ordered = useMemo(() => sortPatternsNewestFirst(library.patterns), [library.patterns]);
  const visible = useMemo(() => filterPatternsByName(ordered, query), [ordered, query]);

  // 就地改名（一次只编辑一条；草稿与目标分开存）
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Pattern | null>(null);
  // Esc 取消后输入框卸载可能补发一次 blur：别让"取消"被 blur 又提交回去（同 BPM 就地编辑口径）
  const renameCancelledRef = useRef(false);

  const startRename = (pattern: Pattern) => {
    renameCancelledRef.current = false;
    setRenaming({ id: pattern.id, draft: pattern.name });
  };

  const commitRename = () => {
    if (!renaming) return;
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false;
      return;
    }
    const { id, draft } = renaming;
    setRenaming(null);
    // 空名 / 没改 → 库里拒绝，界面安静回退
    void library.rename(id, draft);
  };

  const canSave = selectedItems.length > 0;
  const saveKey = formatKey(settings.shortcuts.execSavePattern);

  return (
    <aside className="pld ws-island" aria-label={t('patternLibrary.title')} style={{ width }}>
      <div
        className={`pld__resizer${resizing ? ' is-dragging' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('patternLibrary.resize')}
        onMouseDown={(e) => {
          e.preventDefault();
          dragRef.current = { startX: e.clientX, startWidth: width };
          setDragWidth(width);
        }}
      />

      <header className="pld__head">
        <span className="pld__title">{t('patternLibrary.title')}</span>
        <button
          type="button"
          className="pld__close"
          onClick={() => setPatternDrawer({ open: false })}
          aria-label={t('patternLibrary.close')}
          title={t('patternLibrary.close')}
        >
          <X size={15} />
        </button>
      </header>

      <div className="pld__search">
        <Search size={13} className="pld__search-icon" aria-hidden />
        <input
          type="text"
          className="pld__search-input"
          value={query}
          placeholder={t('patternLibrary.search')}
          aria-label={t('patternLibrary.search')}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query !== '' && (
          <button
            type="button"
            className="pld__search-clear"
            onClick={() => setQuery('')}
            aria-label={t('patternLibrary.searchClear')}
            title={t('patternLibrary.searchClear')}
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="pld__body">
        {library.status === 'loading' ? (
          // 载入中不是空库：显示"还没有收藏"会误导（有片段的库也会先闪一下这句）
          <div className="pld__body-placeholder" aria-busy="true" />
        ) : library.patterns.length === 0 ? (
          <div className="pld__empty">
            <LibraryBig size={28} aria-hidden />
            <b>{t('patternLibrary.emptyTitle')}</b>
            <span>{t('patternLibrary.emptyHint')}</span>
          </div>
        ) : visible.length === 0 ? (
          <div className="pld__empty">
            <Search size={26} aria-hidden />
            <b>{t('patternLibrary.searchEmptyTitle')}</b>
            <span>{t('patternLibrary.searchEmptyHint')}</span>
          </div>
        ) : (
          <ul className="pld__list">
            {visible.map((pattern) => {
              const summary = patternBpmSummary(pattern);
              return (
                <li
                  key={pattern.id}
                  className={`pld-card${readOnly ? ' is-readonly' : ''}`}
                  title={readOnly ? t('patternLibrary.readonlyCard') : undefined}
                >
                  <div className="pld-card__thumb">
                    <PatternThumbnail pattern={pattern} />
                  </div>

                  <div className="pld-card__main">
                    {renaming?.id === pattern.id ? (
                      <input
                        className="pld-card__name-input"
                        aria-label={t('patternLibrary.rename')}
                        value={renaming.draft}
                        autoFocus
                        onChange={(e) => setRenaming({ id: pattern.id, draft: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); commitRename(); return; }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            renameCancelledRef.current = true;
                            setRenaming(null);
                          }
                        }}
                        onBlur={commitRename}
                      />
                    ) : (
                      <span
                        className="pld-card__name"
                        title={pattern.name}
                        onDoubleClick={() => startRename(pattern)}
                      >
                        {pattern.name}
                      </span>
                    )}
                    <span className="pld-card__badges">
                      {summary.changes > 0 && (
                        <span className="pld-badge">{t('patternLibrary.badge.bpmChanges', { n: summary.changes })}</span>
                      )}
                      {summary.backflow && (
                        <span className="pld-badge pld-badge--backflow">{t('patternLibrary.badge.backflow')}</span>
                      )}
                    </span>
                  </div>

                  {/* hover 菜单：导出动作落 187，这里先置灰占位（与 183 的占位口径一致） */}
                  <div className="pld-card__actions">
                    <button
                      type="button"
                      className="pld-card__action"
                      aria-label={t('patternLibrary.export')}
                      title={t('patternLibrary.exportSoon')}
                      disabled
                    >
                      <FileDown size={13} />
                    </button>
                    <button
                      type="button"
                      className="pld-card__action pld-card__action--danger"
                      aria-label={t('patternLibrary.delete')}
                      title={t('patternLibrary.delete')}
                      onClick={() => setPendingDelete(pattern)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="pld__foot">
        <button
          type="button"
          className="pld__save"
          disabled={!canSave}
          onClick={onSaveSelection}
          title={canSave ? `${t('patternLibrary.save')} (${saveKey})` : t('patternLibrary.saveNeedsSelection')}
        >
          <BookmarkPlus size={15} aria-hidden />
          {t('patternLibrary.save')}
        </button>
      </footer>

      {pendingDelete && (
        <ConfirmDialog
          title={t('patternLibrary.deleteTitle', { name: pendingDelete.name })}
          message={t('patternLibrary.deleteMessage')}
          confirmLabel={t('ui.delete')}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const target = pendingDelete;
            setPendingDelete(null);
            void library.remove(target.id);
          }}
        />
      )}
    </aside>
  );
});
