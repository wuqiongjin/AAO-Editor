// 片段库抽屉（票 183 外壳 + issue 185 内容）。
//
// 外壳口径（183）：展开占布局（不压画布）、左缘可拖宽、收起完全消失。
// 内容口径（185 / 164 定案 §3）：
// - 卡片 = 缩略图 + 名字 + 徽标（`BPM 120 → 180`，负值数字危险色）+ 统计行
//   （`12 音符 · 10 拍`，派生值，见 `chart/patterns/stats`）+ 常驻 ⋯ 菜单（导出 —— 动作落 187 / 删除）；
// - 点卡片 = 进片段粘贴态（186），被选中的那张高亮；再点同一张 = 退出（回指针）；
// - 顶部常驻搜索：按名字子串过滤（不区分大小写）；「库里没有片段」「搜索无匹配」「库读不出来」是三套空态；
// - 收藏时间倒序（最新在最上，排序是库的口径，本组件不重排）；
// - 双击名字就地改名（Enter 提交 / Esc 取消，与 BPM 数字同一套词汇；空名拒绝、超长只截显示）；
// - 删除走既有 `sm` 确认弹窗，立即删、不建撤销栈；
// - 只读谱面：**卡片置灰**（贴入被拦，186），但「收藏选区」照常可用 —— 收藏读的是选区、不写谱面。
// - 导入导出（187）：抽屉头 ⋯ = 整库；卡片 ⋯ = 单条。读文件两环境同一路（`<input type="file">`），
//   写文件 Electron 走桥 / 浏览器下载；**取消保存什么都不发生**。
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkPlus, LibraryBig, Search, X } from 'lucide-react';
import { useConfig } from '../../app/ProviderTree';
import { PATTERN_DRAWER_WIDTH } from '../../chart/config/AppSettings';
import { formatKey } from '../../chart/config/ShortcutConfig';
import type { PatternImportStrategy } from '../../chart/patterns/importConflict';
import { filterPatternsByName, patternBpmRange } from '../../chart/patterns/library';
import { formatPatternBeatSpan, patternStats } from '../../chart/patterns/stats';
import {
  pickPatternFile,
  readPatternFileText,
  savePatternLibraryFile,
  saveSinglePatternFile,
} from '../../chart/patterns/shareFile';
import type { Pattern } from '../../chart/patterns/types';
import type {
  PatternImportPreparation,
  PatternImportResult,
  PatternLibraryApi,
} from '../../chart/patterns/usePatternLibrary';
import { t } from '../../i18n';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { showToast } from '../../ui/Toast';
import BpmRange from './BpmRange';
import PatternCardMenu from './PatternCardMenu';
import PatternImportDialog from './PatternImportDialog';
import PatternLibraryMenu from './PatternLibraryMenu';
import PatternThumbnail from './PatternThumbnail';
import './PatternLibraryDrawer.css';

interface PatternLibraryDrawerProps {
  /** 库状态与写入口（活在 WorkspacePage：抽屉没开也能用快捷键收藏） */
  library: PatternLibraryApi;
  /** 当前有选区 → 「收藏选区」可点（与快捷键同一判据，由页面给出） */
  canSaveSelection: boolean;
  /** 已上传谱面只读：卡片置灰；「收藏选区」不禁用 */
  readOnly?: boolean;
  /** footer「收藏选区」：与 `execSavePattern` 同一条路径（选区 → 落库 → toast） */
  onSaveSelection: () => void;
  /** 点卡片 = 进/退片段粘贴持工具态（issue 186：同一张再点即退出）；只读时卡片不进态 */
  onPastePattern: (pattern: Pattern) => void;
  /** 当前承载粘贴负载的片段 id：那张卡片高亮 + `aria-pressed`（null = 无） */
  activePatternId?: string | null;
  /** 拖宽开始 / 结束：页面据此暂停画布实时重绘（与旧面板拖拽同口径） */
  onResizingChange?: (resizing: boolean) => void;
}

export default memo(function PatternLibraryDrawer({
  library, canSaveSelection, readOnly = false, onSaveSelection, onPastePattern,
  activePatternId = null, onResizingChange,
}: PatternLibraryDrawerProps) {
  const { settings, setPatternDrawer } = useConfig();
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

  // 搜索只筛显示，不改库
  const [query, setQuery] = useState('');
  const visible = useMemo(() => filterPatternsByName(library.patterns, query), [library.patterns, query]);

  // 就地改名（一次只编辑一条；草稿与目标分开存）
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Pattern | null>(null);
  /** 已解析、待确认策略的导入计划（189）：取消 / 关闭即丢弃，不写盘 */
  const [pendingImport, setPendingImport] = useState<PatternImportPreparation | null>(null);
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

  /**
   * 点卡片 / 回车 = 进/退片段粘贴持工具态（issue 186）。
   * 只读谱面**不进态**（置灰的卡片不做无反馈的空转，也不弹只读提示——说明已在 tooltip 里）；
   * 改名中输入框的点击不触发（它和卡片同一层）。
   * `detail > 1` 是双击的第二击：改名走双击，第二击不再动工具态（否则一次双击会把刚进的态又退掉）。
   */
  const onPasteCard = (pattern: Pattern, detail = 1) => {
    if (readOnly || renaming?.id === pattern.id || detail > 1) return;
    onPastePattern(pattern);
  };

  const saveKey = formatKey(settings.shortcuts.execSavePattern);

  // 导出项置灰的真实原因：载入中 / 读失败 / 空库三套，别一律说成「空库」
  const exportDisabledHint = library.status === 'loading'
    ? t('patternLibrary.exportLoading')
    : library.status === 'error'
      ? t('patternLibrary.exportLoadFailed')
      : library.patterns.length === 0
        ? t('patternLibrary.exportUnavailable')
        : undefined;

  /* 整库导出（187）：取消对话框 = 什么都不发生；桥报错才提示，成功不打扰 */
  const exportLibrary = async () => {
    if (library.status !== 'ready' || library.patterns.length === 0) return;
    try {
      await savePatternLibraryFile(library.patterns);
    } catch {
      showToast(t('patternLibrary.exportFailed'), 'danger');
    }
  };

  /* 单条导出（187）：信封里只有这一条，名字不改库里的 */
  const exportPattern = async (pattern: Pattern) => {
    try {
      await saveSinglePatternFile(pattern);
    } catch {
      showToast(t('patternLibrary.exportFailed'), 'danger');
    }
  };

  /**
   * 导入反馈（189）：导入 / 坏条目 / 已存在分开报数。
   * 全部被跳过时也要说清「0 条导入、N 条已存在」，别只弹一句冷冰冰的 0。
   */
  const reportImport = (result: PatternImportResult) => {
    if (!result.ok) {
      // 落盘失败已由库层 toast 并回滚；这里不重复报错
      if (result.reason === 'write-failed') return;
      showToast(result.message ?? t('patternLibrary.import.badFile'), 'danger');
      return;
    }
    if (result.imported === 0 && result.skipped === 0 && result.skippedExisting === 0) {
      showToast(t('patternLibrary.import.empty'), 'info');
      return;
    }
    if (result.skippedExisting > 0) {
      showToast(t('patternLibrary.import.duplicates', {
        imported: result.imported,
        skipped: result.skipped + result.skippedExisting,
        existing: result.skippedExisting,
      }), result.imported === 0 ? 'warn' : 'info');
      return;
    }
    if (result.skipped > 0) {
      showToast(t('patternLibrary.import.partial', { imported: result.imported, skipped: result.skipped }), 'warn');
      return;
    }
    showToast(t('patternLibrary.import.success', { imported: result.imported }), 'success');
  };

  /* 导入（187 / 189）：选文件 → 读文本 → 解析 + 冲突预览 → 弹层确认策略 → 才落盘。
     取消 / 关闭弹层 = 不写盘；没有好条目时连弹层都不开（三选一也无事可做）。 */
  const importLibrary = async () => {
    const file = await pickPatternFile();
    if (!file) return;

    let text: string;
    try {
      text = await readPatternFileText(file);
    } catch {
      showToast(t('patternLibrary.import.badFile'), 'danger');
      return;
    }

    const prepared = await library.prepareImport(text);
    if (!prepared.ok) {
      showToast(prepared.message ?? t('patternLibrary.import.badFile'), 'danger');
      return;
    }
    if (prepared.preparation.preview.valid === 0) {
      // 空文件 / 整包都是坏条目：没有可写的东西，直接报数（不产生无意义的落盘）
      reportImport(await library.applyImport(prepared.preparation, 'skip'));
      return;
    }
    setPendingImport(prepared.preparation);
  };

  const confirmImport = async (strategy: PatternImportStrategy) => {
    const preparation = pendingImport;
    if (!preparation) return;
    setPendingImport(null);
    reportImport(await library.applyImport(preparation, strategy));
  };

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
        {/* 整库导入导出（187）：空库 / 未载入完成时导出项置灰 */}
        <PatternLibraryMenu
          canExport={library.status === 'ready' && library.patterns.length > 0}
          exportDisabledHint={exportDisabledHint}
          onExport={() => void exportLibrary()}
          onImport={() => void importLibrary()}
        />
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
        ) : library.status === 'error' ? (
          // 读不出来也不是空库：如实说，并提示这轮不写入（防止覆盖原库）
          <div className="pld__empty">
            <LibraryBig size={28} aria-hidden />
            <b>{t('patternLibrary.loadFailedTitle')}</b>
            <span>{t('patternLibrary.loadFailedHint')}</span>
          </div>
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
              const range = patternBpmRange(pattern);
              const stats = patternStats(pattern);
              const active = !readOnly && activePatternId === pattern.id;
              return (
                <li
                  key={pattern.id}
                  className={`pld-card${readOnly ? ' is-readonly' : ''}${active ? ' is-active' : ''}`}
                  title={readOnly ? t('patternLibrary.readonlyCard') : undefined}
                >
                  {/* 卡片主体 = 粘贴热区（issue 186：点卡片进片段粘贴持工具态）。
                      用 div + role 而不是 <button>：改名输入框与 ⋯ 菜单都在这一层里，嵌套按钮非法。
                      只读谱面：置灰 + aria-disabled，点击不进态（贴入仍由画布三道闸门兜底）。 */}
                  <div
                    className="pld-card__hit"
                    role="button"
                    tabIndex={readOnly ? -1 : 0}
                    aria-disabled={readOnly || undefined}
                    aria-pressed={active}
                    aria-label={t('patternLibrary.pasteCardAria', { name: pattern.name })}
                    onClick={(e) => onPasteCard(pattern, e.detail)}
                    onKeyDown={(e) => {
                      // 焦点在改名输入框时不抢 Enter（e.target !== currentTarget）
                      if (e.target !== e.currentTarget) return;
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      onPasteCard(pattern);
                    }}
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
                          // 名字也是卡片的一部分：单击照常切卡（issue 186 二轮用户反馈：只有名字区域点不动）。
                          // 双击 = 就地改名（185），第二击由 `onPasteCard` 的 `detail > 1` 挡掉。
                          onDoubleClick={() => startRename(pattern)}
                        >
                          {pattern.name}
                        </span>
                      )}
                      <span className="pld-card__badges">
                        {/* 徽标 = 速度跨度（issue 186 二轮）：`BPM 120 → 180`；没有变化事件时只有 `BPM 120`。
                            负值由 BpmRange 单独上危险色，不再另挂「倒流」徽标（少一个字、也更醒目）。 */}
                        <span className="pld-badge">
                          {t('patternLibrary.badge.bpm')} <BpmRange start={range.start} peak={range.peak} />
                        </span>
                      </span>
                      {/* 统计行（issue 190）：派生值、不进载荷；名字超长仍只省略名字 */}
                      <span className="pld-card__stats">
                        {t('patternLibrary.cardStats', {
                          notes: stats.noteCount,
                          beats: formatPatternBeatSpan(stats.beatSpan),
                        })}
                      </span>
                    </div>
                  </div>

                  {/* 常驻 ⋯ 菜单：入口一直可见（hover 才出现的按钮等于靠运气发现），
                      菜单里放单条导出（187）与删除；卡片主体留给 186 的点击粘贴 */}
                  <PatternCardMenu
                    onExport={() => void exportPattern(pattern)}
                    onDelete={() => setPendingDelete(pattern)}
                  />
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
          disabled={!canSaveSelection}
          onClick={onSaveSelection}
          title={canSaveSelection
            ? `${t('patternLibrary.save')} (${saveKey})`
            : t('patternLibrary.saveNeedsSelection')}
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

      {/* 导入确认（189）：取消 / 关闭 = 不写盘；确认才走库层合并 */}
      {pendingImport && (
        <PatternImportDialog
          preview={pendingImport.preview}
          onCancel={() => setPendingImport(null)}
          onConfirm={(strategy) => void confirmImport(strategy)}
        />
      )}
    </aside>
  );
});
