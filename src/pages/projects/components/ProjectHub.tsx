// 工程管理页的启动台视图（原 ProjectsPage.tsx 的 ProjectStartView + 0 工程引导横幅）。
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Copy, FolderPlus, Music2, Music4, Play, Users } from 'lucide-react';
import type { ChartProject } from '../../../project/ChartProject';
import { DIFF_COLORS, DIFF_NAMES, DIFF_SHORT } from '../../../project/projectCatalog';
import { mostRecentlyOpenedId, PROJECT_SORT_KEYS, projectTimeAt, type ProjectSortKey } from '../../../project/projectSort';
import { chartStatus } from '../../../project/workspaceProject';
import { displayProjectName } from '../../../project/ui/projectUi';
import { useAppNav } from '../../../layouts/AppNav';
import { useNow } from '../../../app/ProviderTree';
import EmptyState from '../../../ui/EmptyState';
import LoadingShimmer, { useSlowLoading } from '../../../ui/LoadingShimmer';
import { t } from '../../../i18n';
import { effectiveTitle, projectTimeTag, relTime, statusLabel } from '../projectFormat';
import { moveGridSelection } from '../projectGridSelection';
import { Cover, StatusBadge } from './ProjectBits';
import type { NewSource } from './ProjectDialogs';

// 引导横幅（issue 09）：0 工程时占住 hero 节点——与有工程时的 hero 同位置、同尺寸
// （24px 内边距 + 120px 图块），页面视觉不塌陷。主行动在下方网格区的 EmptyState。
function GuideBanner() {
  return (
    <section className="pb-hero pb-hero--guide">
      <div className="pb-guide-art" aria-hidden="true"><Music2 size={44} /></div>
      <div className="pb-hero__body">
        <span className="pp-eyebrow">{t('projects.guide.eyebrow')}</span>
        <h2>{t('projects.guide.title')}</h2>
        <p className="pp-muted">{t('projects.guide.description')}</p>
      </div>
    </section>
  );
}

/**
 * 目录未就绪时的占位（issue 29）：槽位与最终内容等高（hero 168px / 卡片封面 1:1），
 * 到位后原地替换、零跳位。微光只在"真的慢"时出现（`useSlowLoading` + `SLOW_LOADING_MS`，票 24 口径）——
 * 快启动不闪任何加载动效，只是这块占位很快被真实内容顶掉。
 */
function PendingHero({ shimmer }: { shimmer: boolean }) {
  return (
    <section className="pb-hero pb-hero--pending" aria-hidden="true">
      <span className="pb-pending-cover">{shimmer && <LoadingShimmer />}</span>
      <div className="pb-hero__body">
        <span className="pb-pending-line pb-pending-line--title">{shimmer && <LoadingShimmer />}</span>
        <span className="pb-pending-line">{shimmer && <LoadingShimmer />}</span>
      </div>
    </section>
  );
}

function PendingGrid({ shimmer }: { shimmer: boolean }) {
  return (
    <div className="pb-grid" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="pb-card">
          <span className="pb-pending-cover pb-pending-cover--card">{shimmer && <LoadingShimmer />}</span>
          <span className="pb-pending-line pb-pending-line--title">{shimmer && <LoadingShimmer />}</span>
        </div>
      ))}
    </div>
  );
}

export function ProjectStartView({
  list, ready, currentId, sort, onSort, onDetail, onOpen, onNew, projectMenu, importSources = false,
}: {
  list: ChartProject[];
  /** 目录是否已读回来（issue 29）：未就绪 ≠ 0 工程 —— 未就绪不渲染空态，也不显示 0 计数 */
  ready: boolean;
  currentId: string | null;
  sort: ProjectSortKey;
  onSort: (key: ProjectSortKey) => void;
  onDetail: (id: string) => void;
  onOpen: (id: string, chartId?: string) => void;
  onNew: (src: NewSource) => void;
  projectMenu: (p: ChartProject) => ReactNode;
  /** 有没有社区平台出口（静态演示版没有）：决定官方 / 社区两格露不露 */
  importSources?: boolean;
}) {
  const { activePage } = useAppNav();
  // relTime 的 now 走共享 ticker（issue 36）：30s 一跳，「N 分钟前」随时间自己走，
  // 不再"切走再切回来才变"。
  const now = useNow();
  const gridRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [columns, setColumns] = useState(1);
  // 未就绪 ≠ 空（issue 29）：只有目录读回来、且确实一个工程都没有，才是空态。
  const isEmpty = ready && list.length === 0;
  const showProjects = ready && !isEmpty;
  // 占位微光只在"真的慢"时出现（票 24 口径：本机秒开不闪动效）
  const pendingShimmer = useSlowLoading(ready, 'project-catalog');

  // 浏览焦点（issue 14）：不等于「当前工程」，is-current 角标继续单独标识。
  // 默认选中 = 最近打开（Q11），与显示排序无关（issue 19 #4：排序可选后「第一个卡片」不再等于它）；
  // 选中失效（工程被删等）时先按默认口径**投影**（hero 与高亮首帧就不闪），再由 effect 固化回 state。
  const defaultSelectedId = mostRecentlyOpenedId(list);
  const effectiveSelectedId = selectedId !== null && list.some((p) => p.id === selectedId)
    ? selectedId
    : defaultSelectedId;
  useEffect(() => {
    if (effectiveSelectedId !== selectedId) setSelectedId(effectiveSelectedId);
  }, [effectiveSelectedId, selectedId]);

  // 列数按容器实际折行实测：首行卡片数即列数。ResizeObserver 覆盖窗口 resize 与导航展开折叠；
  // 失活页只是 opacity:0，布局仍可测，无需等激活。
  useEffect(() => {
    const measure = () => {
      const cards = gridRef.current?.querySelectorAll<HTMLElement>('.pb-card');
      if (!cards || cards.length === 0) return;
      const top = cards[0].offsetTop;
      let count = 1;
      while (count < cards.length && cards[count].offsetTop === top) count += 1;
      setColumns(count);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    if (gridRef.current) observer.observe(gridRef.current);
    return () => observer.disconnect();
  }, [list.length]);

  // 方向键导航：仅工程管理页为当前页、焦点不在输入框、弹窗/卡片菜单未开时响应（issue 14 定案 1）。
  useEffect(() => {
    if (activePage !== 'projects') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const key = e.key;
      const isArrow = key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';
      if (!isArrow && key !== 'Enter') return;
      if (list.length === 0) return;
      // 弹窗（新建 / 编辑工程 / 谱面信息 / 删除确认 —— 都走通用壳 .dialog__scrim）与卡片菜单
      // 都挂 scrim，开着就不响应
      if (document.querySelector('.dialog__scrim, .pp-menu__scrim')) return;
      // 焦点在输入框时放行原生行为（与 useShortcutDispatch 同口径）
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      if (isArrow) {
        const next = moveGridSelection(list, effectiveSelectedId, key, columns);
        if (next === effectiveSelectedId) return; // 边界停在原地：不吞键，放行 .pb-page 原生滚页
        e.preventDefault();
        setSelectedId(next);
        // 选中卡片自动滚入视口（issue 14 定案 5 / issue 27：仅在键盘导航移动选中项时触发，首次挂载不滚）
        gridRef.current?.querySelectorAll<HTMLElement>('.pb-card').forEach((card) => {
          if (card.dataset.projectId === next) card.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
        });
        return;
      }
      // Enter 打开选中工程详情；焦点在按钮 / 链接等可激活元素上时交给浏览器原生行为
      if (tag === 'BUTTON' || tag === 'A' || (target instanceof HTMLElement && target.hasAttribute('tabindex'))) return;
      if (effectiveSelectedId) {
        e.preventDefault();
        onDetail(effectiveSelectedId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activePage, list, columns, effectiveSelectedId, onDetail]);

  // hero 是选中卡片的投影（选中失效时 = 最近打开，横幅不闪空）
  const selected = list.find((p) => p.id === effectiveSelectedId) ?? list[0];
  // 列表时间戳跟随排序键（issue 37）：hero 的完整标签也随排序切——顺序按
  // max(charts.lastModified) 排时，标签不能还写死「上次打开」。选中锚不动（仍 = 最近打开）。
  const heroTimeKey = sort === 'lastModified' ? 'projects.lastModified' : 'projects.lastOpened';
  return (
    <div className="pb-page">
      {!ready && <PendingHero shimmer={pendingShimmer} />}
      {isEmpty && <GuideBanner />}
      {showProjects && selected && (
        <section className="pb-hero">
          <Cover project={selected} size={120} />
          <div className="pb-hero__body">
            <span className="pp-eyebrow">{t('projects.resume')}</span>
            <h2>
              {displayProjectName(selected)}
              <button type="button" className="pb-hero__detail" onClick={() => onDetail(selected.id)}>{t('projects.detailLink')}</button>
            </h2>
            <p className="pp-muted">{selected.artist ?? t('projects.artistMissing')} · {t(heroTimeKey, { time: relTime(projectTimeAt(selected, sort), now) })}</p>
            <div className="pb-hero__charts">
              {selected.charts.map((c) => (
                <button key={c.id} type="button" className="pb-chart-btn" onClick={() => onOpen(selected.id, c.id)}>
                  <span className="pp-pill__diff" style={{ background: DIFF_COLORS[c.diff] }}>{DIFF_SHORT[c.diff]}</span>
                  {effectiveTitle(selected, c) !== displayProjectName(selected) && <span>{c.title}</span>}
                  <StatusBadge chart={c} />
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="pp-btn pp-btn--primary pp-btn--lg pb-hero__go" onClick={() => onOpen(selected.id)}>
            <Play size={16} />{t('projects.enterWorkspace')}
          </button>
        </section>
      )}
      <section>
        <h3 className="pb-h">{t('projects.new')}</h3>
        <div className="pb-tiles">
          <button type="button" className="pb-tile" onClick={() => onNew('blank')}>
            <FolderPlus size={20} /><b>{t('projects.newBlank')}</b><small>{t('projects.newBlankDesc')}</small>
          </button>
          <button
            type="button"
            className="pb-tile"
            disabled={!showProjects}
            title={showProjects ? undefined : t('projects.copyDisabledHint')}
            onClick={() => onNew('copy')}
          >
            <Copy size={20} /><b>{t('projects.newCopy')}</b><small>{t('projects.newCopyDesc')}</small>
          </button>
          {/* 官方 / 社区两支要连社区平台，静态演示版（无出口）只隐藏这两格（票 12；ADR-0011 §1） */}
          {importSources && (
            <>
              <button type="button" className="pb-tile" onClick={() => onNew('official')}>
                <Music4 size={20} /><b>{t('projects.newOfficial')}</b><small>{t('projects.newOfficialDesc')}</small>
              </button>
              <button type="button" className="pb-tile" onClick={() => onNew('community')}>
                <Users size={20} /><b>{t('projects.newCommunity')}</b><small>{t('projects.newCommunityDesc')}</small>
              </button>
            </>
          )}
        </div>
      </section>
      <section>
        <div className="pb-h-row">
          <h3 className="pb-h">{t('projects.allProjects')}{ready && <span className="pp-muted"> {list.length}</span>}</h3>
          {showProjects && (
            <label className="pb-sort">
              <span className="pp-muted">{t('projects.sortBy')}</span>
              <select value={sort} onChange={(e) => onSort(e.target.value as ProjectSortKey)}>
                {PROJECT_SORT_KEYS.map((key) => (
                  <option key={key} value={key}>{t(`projects.sort.${key}` as 'projects.sort.lastOpened')}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {!ready ? (
          <PendingGrid shimmer={pendingShimmer} />
        ) : isEmpty ? (
          <EmptyState
            icon={Music2}
            title={t('projects.empty.title')}
            description={t('projects.empty.description')}
            primaryAction={{
              label: t('projects.empty.createFirst'),
              onClick: () => onNew('blank'),
              icon: FolderPlus,
            }}
          />
        ) : (
        <div className="pb-grid" ref={gridRef}>
          {list.map((p) => (
            <div
              key={p.id}
              data-project-id={p.id}
              className={`pb-card${p.id === currentId ? ' is-current' : ''}${p.id === effectiveSelectedId ? ' is-selected' : ''}`}
              onClick={() => onDetail(p.id)}
              onDoubleClick={() => onDetail(p.id)}
            >
              <div className="pb-card__cover">
                <Cover project={p} size={172} fluid />
                {p.id === currentId && <em className="pb-card__current">{t('projects.current')}</em>}
                <span className="pb-card__menu" onClick={(e) => e.stopPropagation()}>{projectMenu(p)}</span>
                <button
                  type="button"
                  className="pb-card__play"
                  title={t('projects.play')}
                  onClick={(e) => { e.stopPropagation(); onOpen(p.id); }}
                >
                  <Play size={16} />
                </button>
              </div>
              <b className={p.name ? '' : 'pp-muted'}>{displayProjectName(p)}</b>
              <small className="pp-muted">{p.artist ?? '—'} · {projectTimeTag(sort)} {relTime(projectTimeAt(p, sort), now)}</small>
              <span className="pb-card__dots">
                {p.charts.map((c) => (
                  <span
                    key={c.id}
                    className={`pb-dot pb-dot--${chartStatus(c)}`}
                    style={{ '--c': DIFF_COLORS[c.diff] } as CSSProperties}
                    title={`${DIFF_NAMES[c.diff]} · ${statusLabel(c)}`}
                  >
                    {DIFF_SHORT[c.diff]}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
        )}
      </section>
    </div>
  );
}
