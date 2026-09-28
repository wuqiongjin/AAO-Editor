// 工程管理页（chart-projects 04 / ADR-0015 §2）：一层两个视图。
// 默认工程启动台；点封面进工程详情。保活挂载，⇧⌘0 回来停在离开前那一层。
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown, Copy, FolderPlus, Lock, MoreHorizontal, Music2, Pencil, Play, Plus, SlidersHorizontal, Trash2,
} from 'lucide-react';
import { useAppNav } from '../layouts/AppNav';
import { useConfig } from '../app/ProviderTree';
import { useCurrentProject } from '../app/providers/CurrentProjectProvider';
import {
  newChartId, newProjectId, type ChartDifficulty, type ChartProject, type ProjectChart, type SongSource,
} from '../chart/project/ChartProject';
import {
  addChartToProject,
  chartEffectiveTitle,
  createBlankProject,
  deleteChartFromProject,
  DIFF_COLORS,
  DIFF_NAMES,
  DIFF_SHORT,
  duplicateChartInProject,
  duplicateProject,
  projectCoverHue,
  toggleChartCompleted,
  updateChartInfo,
  updateProjectInfo,
} from '../chart/project/projectCatalog';
import { mostRecentlyOpenedId, PROJECT_SORT_KEYS, sortProjects, type ProjectSortKey } from '../chart/project/projectSort';
import { chartStatus } from '../chart/project/workspaceProject';
import { countChartNotes } from '../chart/editing/NoteEditing';
import { formatValidationError } from '../chart/editing/ChartConverter';
import { t } from '../i18n';
import ActionBtn from '../ui/ActionBtn';
import CoverField, { useCoverUrl, type CoverValue } from '../ui/CoverField';
import ConfirmDialog from '../ui/ConfirmDialog';
import Dialog from '../ui/Dialog';
import EmptyState from '../ui/EmptyState';
import { showToast } from '../ui/Toast';
import { ChartInfoDialog, parseLevel } from './ChartInfoDialog';
import {
  ChartStatusIcon,
  displayProjectName,
  lockedChartLabels,
  ProjectMenuItem,
  untitledProjectLabel,
} from './projectUi';
import { moveGridSelection } from './projectGridSelection';
import ProjectListSplit from './ProjectListSplit';
import './ProjectsPage.css';

const H = 3600_000;
const D = 24 * H;

function effectiveTitle(project: { name: string | null }, chart: { title: string | null }): string {
  return chartEffectiveTitle(project.name, chart.title, untitledProjectLabel());
}

function relTime(at: number, now = Date.now()): string {
  const delta = now - at;
  if (delta < H) return t('projects.time.justNow');
  if (delta < D) return t('projects.time.hoursAgo', { n: Math.floor(delta / H) });
  if (delta < 30 * D) return t('projects.time.daysAgo', { n: Math.floor(delta / D) });
  return t('projects.time.monthsAgo', { n: Math.floor(delta / (30 * D)) });
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function sourceLabel(source: SongSource): string {
  if (source.type === 'bandori') return t('projects.sourceLabel.bandori', { id: source.id });
  if (source.type === 'llsif') return t('projects.sourceLabel.llsif', { id: source.id });
  return t('projects.sourceLabel.custom');
}

function statusLabel(chart: ProjectChart): string {
  return t(`projects.status.${chartStatus(chart)}` as 'projects.status.unfinished');
}

function parseSource(type: string, idText: string): SongSource {
  const id = Number(idText);
  if (type === 'bandori' && Number.isFinite(id)) return { type: 'bandori', id };
  if (type === 'llsif' && Number.isFinite(id)) return { type: 'llsif', id };
  return { type: 'custom' };
}

function Cover({ project, size, fluid = false }: { project: ChartProject; size: number; fluid?: boolean }) {
  const url = useCoverUrl(project.coverBlob);
  const hue = projectCoverHue(project.id);
  const ch = project.name?.trim()[0];
  return (
    <div
      className={`pp-cover${fluid ? ' pp-cover--fluid' : ''}`}
      style={{
        // 流式档（issue 19 #5）：宽随列走、高由 aspect-ratio 撑；字号仍按名义 size 派生
        width: fluid ? '100%' : size,
        height: fluid ? undefined : size,
        fontSize: size * 0.42,
        // 只用 backgroundImage 长手，绝不混用 background 简写：React 按对象键序逐个赋值，
        // 简写先落地的渐变会被紧随其后的空 backgroundImage 整条抹掉，封面就成了空白（issue 11）。
        backgroundImage: url
          ? `url(${url})`
          : `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 65% 35%))`,
      }}
    >
      {url ? null : (ch ? ch.toUpperCase() : <Music2 size={size * 0.42} />)}
    </div>
  );
}

function StatusBadge({ chart }: { chart: ProjectChart }) {
  const s = chartStatus(chart);
  return <span className={`pp-badge pp-badge--${s}`}><ChartStatusIcon chart={chart} size={11} />{statusLabel(chart)}</span>;
}

/**
 * 难度+等级徽标（issue 19 #2）：点开就地小浮层直接改，不再绕道行尾铅笔。
 * - 点难度色块 = 即时提交；等级输入 Enter / 失焦提交（照 ADR-0008 §5 就地编辑口径）。
 * - 已上传谱面只读：点击只给 toast（复用 `projects.uploadedReadonly`），不弹浮层。
 * - 浮层照卡片菜单的 portal + scrim 范式定位，Esc / 点外部关闭。
 */
function DiffLevelBadge({ chart, uploaded, onCommit }: {
  chart: ProjectChart;
  uploaded: boolean;
  onCommit: (patch: { diff: ChartDifficulty; level: number | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState('');
  const wrapRef = useRef<HTMLSpanElement>(null);
  const cancelledRef = useRef(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const openPopover = () => {
    if (uploaded) {
      showToast(t('projects.uploadedReadonly'), 'warn');
      return;
    }
    setLevel(chart.level != null ? String(chart.level) : '');
    cancelledRef.current = false;
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left });
    }
    setOpen(true);
  };

  const commitLevel = () => {
    const parsed = parseLevel(level);
    if (parsed !== chart.level) onCommit({ diff: chart.diff, level: parsed });
  };

  return (
    <span className="pc-diff" ref={wrapRef}>
      <button
        type="button"
        className="pc-chart__diff"
        style={{ background: DIFF_COLORS[chart.diff] }}
        title={t('projects.diffLevelEdit')}
        aria-haspopup="dialog"
        onClick={(e) => { e.stopPropagation(); openPopover(); }}
      >
        {DIFF_NAMES[chart.diff]}<b>{chart.level ?? '–'}</b>
      </button>
      {open && createPortal(
        <>
          <span className="pp-menu__scrim" onClick={() => setOpen(false)} />
          <div className="pc-diff__panel is-portaled" style={{ top: pos.top, left: pos.left }} role="dialog" aria-label={t('projects.diffLevelEdit')}>
            <span className="pc-diff__row">
              {DIFF_NAMES.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  className={`pc-diff__chip${i === chart.diff ? ' is-active' : ''}`}
                  style={{ background: DIFF_COLORS[i] }}
                  title={name}
                  onClick={() => onCommit({ diff: i as ChartDifficulty, level: chart.level })}
                >
                  {DIFF_SHORT[i]}
                </button>
              ))}
            </span>
            <label className="pc-diff__level">
              <span>{t('projects.level')}</span>
              <input
                value={level}
                inputMode="numeric"
                autoFocus
                onChange={(e) => setLevel(e.target.value)}
                onKeyDown={(e) => {
                  // Enter = 提交并收起（blur 会再触发一次提交，靠 parsed !== chart.level 去重）
                  if (e.key === 'Enter') { e.currentTarget.blur(); setOpen(false); return; }
                  if (e.key === 'Escape') { cancelledRef.current = true; setOpen(false); }
                }}
                onBlur={() => {
                  if (cancelledRef.current) { cancelledRef.current = false; return; }
                  commitLevel();
                }}
              />
            </label>
          </div>
        </>,
        document.body,
      )}
    </span>
  );
}

function Menu({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const toggle = () => {
    if (!open && wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((v) => !v);
  };
  return (
    <span className="pp-menu" ref={wrapRef}>
      <span onClick={toggle}>{trigger}</span>
      {open && createPortal(
        <>
          <span className="pp-menu__scrim" onClick={() => setOpen(false)} />
          <div className="pp-menu__panel is-portaled" style={{ top: pos.top, right: pos.right }} onClick={() => setOpen(false)}>
            {children}
          </div>
        </>,
        document.body,
      )}
    </span>
  );
}

type NewSource = 'blank' | 'copy';

/** 删除工程的后果行（标题负责问，这里只说会连带删掉什么）。 */
function deleteProjectNotice(p: ChartProject): string {
  const uploaded = p.charts.filter((c) => c.upload).length;
  const extra = uploaded ? `\n${t('projects.confirmDeleteUploaded', { count: uploaded })}` : '';
  return `${t('projects.confirmDelete', { charts: p.charts.length })}${extra}`;
}

function NewProjectDialog({
  initialSource, projects, onClose, onCreate, onCopy,
}: {
  initialSource: NewSource;
  projects: ChartProject[];
  onClose: () => void;
  onCreate: (input: { name: string; artist: string; diff: ChartDifficulty }) => void;
  onCopy: (projectId: string) => void;
}) {
  const [source, setSource] = useState<NewSource>(initialSource);
  const [name, setName] = useState('');
  const [artist, setArtist] = useState('');
  const [diff, setDiff] = useState<ChartDifficulty>(3);
  const [copyFrom, setCopyFrom] = useState(projects[0]?.id ?? '');

  return (
    <Dialog
      title={t('projects.newDialogTitle')}
      hint={t('projects.newHint')}
      onClose={onClose}
      footer={(
        <>
          <ActionBtn onClick={onClose}>{t('projects.cancel')}</ActionBtn>
          <ActionBtn
            variant="primary"
            disabled={source === 'copy' && !copyFrom}
            onClick={() => (source === 'copy' ? onCopy(copyFrom) : onCreate({ name, artist, diff }))}
          >
            {source === 'copy' ? t('projects.copyAction') : t('projects.createOpen')}
          </ActionBtn>
        </>
      )}
    >
      <div className="dialog-tabs">
        <button type="button" className={source === 'blank' ? 'is-active' : ''} onClick={() => setSource('blank')}>
          <FolderPlus size={14} />{t('projects.newBlank')}
        </button>
        <button type="button" className={source === 'copy' ? 'is-active' : ''} onClick={() => setSource('copy')} disabled={projects.length === 0}>
          <Copy size={14} />{t('projects.newCopy')}
        </button>
      </div>
      {source === 'copy' ? (
        <label className="dialog-field">
          <span>{t('projects.copyWhich')}</span>
          <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{t('projects.copyCharts', { name: displayProjectName(p), count: p.charts.length })}</option>
            ))}
          </select>
          <small>{t('projects.copyHint')}</small>
        </label>
      ) : (
        <>
          <div className="dialog-field-row">
            <label className="dialog-field"><span>{t('projects.name')}</span><input value={name} placeholder={untitledProjectLabel()} onChange={(e) => setName(e.target.value)} /></label>
            <label className="dialog-field"><span>{t('projects.artist')}</span><input value={artist} placeholder={t('projects.artistLater')} onChange={(e) => setArtist(e.target.value)} /></label>
          </div>
          <label className="dialog-field">
            <span>{t('projects.firstDiff')}</span>
            <select value={diff} onChange={(e) => setDiff(Number(e.target.value) as ChartDifficulty)}>
              {DIFF_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
          </label>
        </>
      )}
    </Dialog>
  );
}

function EditInfoDialog({ project, onClose, onSave }: {
  project: ChartProject;
  onClose: () => void;
  onSave: (patch: Parameters<typeof updateProjectInfo>[1]) => void;
}) {
  const [name, setName] = useState(project.name ?? '');
  const [artist, setArtist] = useState(project.artist ?? '');
  const [sourceType, setSourceType] = useState(project.source.type);
  const [sourceId, setSourceId] = useState(project.source.type === 'custom' ? '' : String(project.source.id));
  // 封面三态：null 沿用既有 / File 新选 / 'clear' 清除（保存时按此推导 patch 出参）
  const [cover, setCover] = useState<CoverValue>(null);
  // 只管既有封面的 URL：新选的 File 由 CoverField 自己开，同一张图不建两次 objectURL。
  const existingPreview = useCoverUrl(project.coverBlob);

  return (
    <Dialog
      title={t('projects.editTitle')}
      hint={t('projects.coverHint')}
      onClose={onClose}
      footer={(
        <>
          <ActionBtn onClick={onClose}>{t('projects.cancel')}</ActionBtn>
          <ActionBtn
            variant="primary"
            onClick={() => onSave({
              name,
              artist,
              source: parseSource(sourceType, sourceId),
              coverName: cover instanceof File ? cover.name : undefined,
              coverBlob: cover instanceof File ? cover : undefined,
              clearCover: cover === 'clear',
            })}
          >
            {t('projects.save')}
          </ActionBtn>
        </>
      )}
    >
      {/* 封面在左：它是工程在启动台的门面，不该缩成字段流里的一小块 */}
      <div className="dialog-edit-grid">
        <CoverField
          label={t('projects.cover')}
          value={cover}
          previewUrl={existingPreview}
          onChange={setCover}
        />
        <div className="dialog-edit-fields">
          <div className="dialog-field-row">
            <label className="dialog-field"><span>{t('projects.name')}</span><input value={name} placeholder={untitledProjectLabel()} onChange={(e) => setName(e.target.value)} /></label>
            <label className="dialog-field"><span>{t('projects.artist')}</span><input value={artist} onChange={(e) => setArtist(e.target.value)} /></label>
          </div>
          <label className="dialog-field">
            <span>{t('projects.source')}</span>
            <select value={sourceType} onChange={(e) => setSourceType(e.target.value as SongSource['type'])}>
              <option value="custom">{t('projects.sourceCustom')}</option>
              <option value="bandori">{t('projects.sourceBandori')}</option>
              <option value="llsif">{t('projects.sourceLlsif')}</option>
            </select>
          </label>
          {sourceType !== 'custom' && (
            <label className="dialog-field">
              <span>{t('projects.sourceId')}</span>
              <input value={sourceId} inputMode="numeric" onChange={(e) => setSourceId(e.target.value)} />
            </label>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export default function ProjectsPage() {
  const { activePage, setActivePage } = useAppNav();
  const { settings, setProjectSort, setProjectListWidth } = useConfig();
  const {
    projectId, store, catalogEpoch, open, reset, notifyCatalogChanged, flushPersist,
  } = useCurrentProject();
  // 启动台排序（issue 19 #4）：跨会话沿用，改一次写回设置对象
  const sortKey = settings.projects.sort;
  const [projects, setProjects] = useState<ChartProject[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [newSource, setNewSource] = useState<NewSource | null>(null);
  const [editing, setEditing] = useState<ChartProject | null>(null);
  const [chartForm, setChartForm] = useState<{ project: ChartProject; chart: ProjectChart | null } | null>(null);
  // 删除要等用户点头（弹窗是异步的）：待确认的目标先存下，确认键按了才动手
  const [askDelete, setAskDelete] = useState<ChartProject | null>(null);
  const [askDeleteChart, setAskDeleteChart] = useState<{ project: ChartProject; chart: ProjectChart } | null>(null);
  // 视图切换方向（issue 19 #1）：进详情从右滑入、回主页从左滑入；详情内换工程不重放动画（见视图包裹层 key）
  const [navDir, setNavDir] = useState<'forward' | 'back'>('forward');

  const goDetail = useCallback((id: string) => {
    setNavDir('forward');
    setDetailId(id);
  }, []);

  const goHome = useCallback(() => {
    setNavDir('back');
    setDetailId(null);
  }, []);

  const reload = useCallback(async () => {
    // 落盘原序入库；展示序在下面按当前排序设置算（issue 19 #4）
    const listed = await store.list();
    setProjects(listed);
    setDetailId((id) => (id && !listed.some((p) => p.id === id) ? mostRecentlyOpenedId(listed) : id));
  }, [store]);

  useEffect(() => { void reload(); }, [reload, catalogEpoch]);

  const mutate = useCallback(async (id: string, fn: (p: ChartProject) => ChartProject | null) => {
    await flushPersist();
    const loaded = await store.get(id);
    if (!loaded) return;
    const next = fn(loaded);
    if (!next) return;
    await store.save(next);
    notifyCatalogChanged();
    await reload();
  }, [flushPersist, store, notifyCatalogChanged, reload]);

  // 「改写当前工程」与「进入工作台」是两件事（ADR-0015 §3 补充 / issue 23 #1）：
  // 前者是状态、后者是跳页。拆开是因为创建 / 复制工程都要改当前工程，却都不该把人
  // 推进工作台（空白新建的谱面连歌曲、难度、封面都没填）。
  // 静态断言（tests/static/WorkspaceEntrySingle.test.ts）：`setActivePage('workspace')`
  // 全仓只允许出现在 enterWorkspace 一处 —— 别再把它和 setCurrent 绑回一起。
  const setCurrent = useCallback(async (id: string, chartId?: string) => {
    await flushPersist();
    await open(id, chartId);
    notifyCatalogChanged();
  }, [flushPersist, open, notifyCatalogChanged]);

  const enterWorkspace = useCallback(async (id: string, chartId?: string) => {
    await setCurrent(id, chartId);
    setActivePage('workspace');
  }, [setCurrent, setActivePage]);

  // 删除工程本体：确认那一步在弹窗里，走到这里就是真的删
  const deleteProject = useCallback(async (p: ChartProject) => {
    await flushPersist();
    const wasCurrent = projectId === p.id;
    await store.delete(p.id);
    if (wasCurrent) reset();
    notifyCatalogChanged();
    await reload();
  }, [flushPersist, projectId, store, reset, notifyCatalogChanged, reload]);

  const deleteChart = useCallback(async (project: ChartProject, chart: ProjectChart) => {
    await mutate(project.id, (p) => {
      const result = deleteChartFromProject(p, chart.id);
      if (!result.ok) {
        showToast(t('projects.deleteLastChart'), 'warn');
        return null;
      }
      return result.project;
    });
  }, [mutate]);

  // 创建 / 复制工程的统一落点（issue 23 #1/#3）：留在工程详情页、把新工程设为当前工程、
  // 视图切到它，都不跳工作台。视图切换直接改 detailId 而不走 goDetail —— goDetail 会置
  // navDir='forward' 播一次滑入，而"详情内换工程"本就不该重放动画（票 19 #1 的锁测）。
  const goDetailKeepAnimation = useCallback((id: string) => {
    setDetailId(id);
  }, []);
  const createBlank = useCallback(async (input: { name: string; artist: string; diff: ChartDifficulty }) => {
    await flushPersist();
    const now = Date.now();
    const project = createBlankProject({
      id: newProjectId(),
      chartId: newChartId(),
      now,
      name: input.name,
      artist: input.artist,
      diff: input.diff,
    });
    await store.save(project);
    notifyCatalogChanged();
    setNewSource(null);
    goDetailKeepAnimation(project.id);
    await setCurrent(project.id, project.charts[0].id);
  }, [flushPersist, store, notifyCatalogChanged, goDetailKeepAnimation, setCurrent]);

  const copyProject = useCallback(async (fromId: string) => {
    await flushPersist();
    const src = await store.get(fromId);
    if (!src) return;
    const now = Date.now();
    // 副本编号要看全部现有工程名（issue 19 #6）：以存储为准，避免弹窗开着时列表已经变了
    const taken = (await store.list()).map((p) => displayProjectName(p));
    const copy = duplicateProject(src, {
      id: newProjectId(),
      chartIds: src.charts.map(() => newChartId()),
      now,
    }, untitledProjectLabel(), taken);
    await store.save(copy);
    notifyCatalogChanged();
    setNewSource(null);
    goDetailKeepAnimation(copy.id);
    // 与创建同口径：切视图 + 改当前工程都做，但不跳工作台。
    // reload() 只为让左栏出现副本 —— 少了它副本会静默出现在下次刷新后。
    await reload();
    await setCurrent(copy.id, copy.charts[0]?.id);
  }, [flushPersist, store, notifyCatalogChanged, goDetailKeepAnimation, reload, setCurrent]);

  // 展示序 = 用户选的排序；hero 的默认选中口径仍是「最近打开」（issue 19 #4，见 ProjectStartView）
  const list = useMemo(() => sortProjects(projects, sortKey, untitledProjectLabel()), [projects, sortKey]);

  // 详情页左栏 ↑↓ 翻看（issue 23 #4，2026-09-28 修订）。口径：
  //   - **只翻看**（只切 `detailId`），**永不碰当前工程** —— "把 ↑↓ 接到当前工程上"
  //     是「当前工程怎么切换」的交互模型问题，归票 24，不在这里顺手加。
  //   - Enter / 双击仍 = 进工作台（enterWorkspace），与 hub 一致。
  //   - 导航顺序必须用**展示序 `list`**（sortProjects 排过的），不是 store 原始序 `projects`：
  //     左栏渲染的是 `list`，用 `projects` 去找相邻项会算错邻居 —— 表现为"切到一个工程后
  //     就没法继续移动/来回横跳"（2026-09-28 用户报「↑↓ 行为非常诡异」的根因）。
  //   - `wrap: true` 首尾循环（用户 2026-09-28 拍板）：走到底再按同方向绕回另一端。
  //   - 只响应 ↑↓；←→ 在单列列表里无意义，直接忽略（不吞键）。
  //   - 守卫照抄 hub 那份（仅 activePage=projects / 弹窗或菜单开着不响应 / 输入框放行）。
  //   - 本 effect 只在详情视图挂载（detailId 非空才渲染这条分支），与 hub 那份天然互斥。
  //   - 必须声明在 `list` 之后（依赖它；提到前面会 TDZ 报错）。
  useEffect(() => {
    if (activePage !== 'projects' || !detailId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const key = e.key;
      if (key !== 'ArrowUp' && key !== 'ArrowDown') return;
      if (list.length === 0) return;
      if (document.querySelector('.dialog__scrim, .pp-menu__scrim')) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      const next = moveGridSelection(list, detailId, key, 1, { wrap: true });
      if (!next || next === detailId) return;
      e.preventDefault();
      setDetailId(next);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activePage, detailId, list]);

  // 详情页左栏选中项自动滚入视口（issue 23 Q12/Q13）——与 hub 那份同参数。
  // 索引必须与渲染序（`list`）对齐：左栏渲染的是 `list.map(...)`，用 `projects` 会错位。
  useEffect(() => {
    if (!detailId) return;
    document.querySelectorAll<HTMLElement>('.pc-item').forEach((item, i) => {
      if (list[i]?.id === detailId) item.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
  }, [detailId, list]);
  // issue 09：有工程（哪怕全已完成）横幅常显；issue 14：横幅内容由 ProjectStartView 的
  // selectedId 驱动（默认选中 = 最近打开，Q11），resume 兜底不再参与。

  const dialogs = (
    <>
      {newSource && (
        <NewProjectDialog
          initialSource={newSource}
          projects={list}
          onClose={() => setNewSource(null)}
          onCreate={(input) => void createBlank(input)}
          onCopy={(id) => void copyProject(id)}
        />
      )}
      {editing && (
        <EditInfoDialog
          project={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            void mutate(editing.id, (p) => updateProjectInfo(p, patch));
            setEditing(null);
          }}
        />
      )}
      {askDelete && (
        <ConfirmDialog
          title={t('projects.confirmDeleteTitle', { name: displayProjectName(askDelete) })}
          message={deleteProjectNotice(askDelete)}
          confirmLabel={t('ui.delete')}
          onConfirm={() => {
            const target = askDelete;
            setAskDelete(null);
            void deleteProject(target);
          }}
          onCancel={() => setAskDelete(null)}
        />
      )}
      {askDeleteChart && (
        <ConfirmDialog
          title={t('projects.deleteChartConfirm')}
          message={t('projects.deleteChartNotice')}
          confirmLabel={t('ui.delete')}
          onConfirm={() => {
            const { project, chart } = askDeleteChart;
            setAskDeleteChart(null);
            void deleteChart(project, chart);
          }}
          onCancel={() => setAskDeleteChart(null)}
        />
      )}
      {chartForm && (
        <ChartInfoDialog
          project={chartForm.project}
          chart={chartForm.chart}
          onClose={() => setChartForm(null)}
          onAdd={(input) => {
            void (async () => {
              await flushPersist();
              const loaded = await store.get(chartForm.project.id);
              if (!loaded) return;
              const result = addChartToProject(loaded, input, { chartId: newChartId(), now: Date.now() });
              if (!result.ok) {
                const err = result.errors[0];
                showToast(t('projects.applyFail', { message: err ? formatValidationError(err) : 'invalid' }), 'danger');
                return;
              }
              await store.save(result.project);
              notifyCatalogChanged();
              setChartForm(null);
              await reload();
            })();
          }}
          onUpdate={(patch) => {
            void mutate(chartForm.project.id, (p) => updateChartInfo(p, chartForm.chart!.id, patch, Date.now()));
            setChartForm(null);
          }}
        />
      )}
    </>
  );

  const newButton = (
    <span className="pp-split">
      <button type="button" className="pp-btn pp-btn--primary" onClick={() => setNewSource('blank')}>
        <Plus size={15} />{t('projects.newProject')}
      </button>
      <Menu trigger={<button type="button" className="pp-btn pp-btn--primary pp-split__caret"><ChevronDown size={15} /></button>}>
        <ProjectMenuItem icon={<FolderPlus size={14} />} label={t('projects.newBlank')} onClick={() => setNewSource('blank')} />
        <ProjectMenuItem icon={<Copy size={14} />} label={t('projects.newCopy')} onClick={() => setNewSource('copy')} disabled={list.length === 0} />
      </Menu>
    </span>
  );

  const projectMenu = (p: ChartProject) => (
    <Menu trigger={<button type="button" className="pp-icon-btn" title={t('projects.more')}><MoreHorizontal size={16} /></button>}>
      <ProjectMenuItem icon={<Pencil size={14} />} label={t('projects.editInfo')} onClick={() => setEditing(p)} />
      <ProjectMenuItem icon={<Copy size={14} />} label={t('projects.duplicate')} onClick={() => void copyProject(p.id)} />
      <ProjectMenuItem icon={<Trash2 size={14} />} label={t('projects.delete')} danger onClick={() => setAskDelete(p)} />
    </Menu>
  );

  if (detailId) {
    const sel = list.find((p) => p.id === detailId) ?? list[0];
    if (!sel) {
      return (
        <div className="pm-root">
          <div key="hub" className={`pm-view pm-view--${navDir}`}>
            <ProjectStartView list={list} currentId={projectId} sort={sortKey} onSort={setProjectSort} onDetail={goDetail} onOpen={enterWorkspace} onNew={setNewSource} projectMenu={projectMenu} />
          </div>
          {dialogs}
        </div>
      );
    }
    const uploads = sel.charts.filter((c) => c.upload);
    const locked = uploads.length > 0;
    return (
      <div className="pm-root">
        <div key="detail" className={`pm-view pm-view--${navDir}`}>
        <div className="pc-page" style={{ '--pc-list-w': `${settings.layout.projectList.width}px` } as CSSProperties}>
          <aside className="pc-list">
            <div className="pc-list__head">
              <button type="button" className="pp-btn pp-btn--sm" onClick={goHome}>{t('projects.home')}</button>
              {newButton}
            </div>
            {list.map((p) => {
              const n = p.charts.length;
              const done = p.charts.filter((c) => chartStatus(c) !== 'unfinished').length;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`pc-item${p.id === sel.id ? ' is-selected' : ''}`}
                  onClick={() => goDetail(p.id)}
                  onDoubleClick={() => void enterWorkspace(p.id)}
                >
                  <Cover project={p} size={36} />
                  <span className="pc-item__text">
                    <b className={p.name ? '' : 'pp-muted'}>
                      {displayProjectName(p)}
                      {p.id === projectId && <em className="pp-current-tag">{t('projects.current')}</em>}
                    </b>
                    <small className="pp-muted">{t('projects.doneRatio', { done, n, time: relTime(p.lastOpened) })}</small>
                  </span>
                  <span className="pc-item__bar"><span style={{ width: `${n ? (done / n) * 100 : 0}%` }} /></span>
                </button>
              );
            })}
          </aside>
          <ProjectListSplit width={settings.layout.projectList.width} onChange={setProjectListWidth} />
          <main className="pc-detail">
            <header className="pc-detail__head">
              <Cover project={sel} size={96} />
              <div className="pc-detail__body">
                <h2 className={sel.name ? '' : 'pp-muted'}>{displayProjectName(sel)}</h2>
                <p className="pp-muted">{sel.artist ?? t('projects.artistMissing')} · {sourceLabel(sel.source)}</p>
                <p className="pp-muted">
                  <Music2 size={12} /> {sel.audioName ?? t('projects.noAudio')} · {formatDuration(sel.durationSeconds)}
                  {locked && (
                    <span className="pp-lock-note">
                      <Lock size={11} />{t('projects.audioLockedNamed', { charts: lockedChartLabels(sel.name, uploads) })}
                    </span>
                  )}
                  {/* 音频在这里只读展示，管理入口只有音频页（票 15 定案 2）——这枚 chip 是带
                      **作用域**跳过去的：音频页作用到这个工程，当前工程不被切走（票 22 / §6）。 */}
                  <button
                    type="button"
                    className="pc-audio-jump"
                    title={t('audio.jumpManageTitle')}
                    onClick={() => setActivePage('audio', { scope: { projectId: sel.id } })}
                  >
                    <SlidersHorizontal size={12} />{t('audio.jumpManage')}
                  </button>
                </p>
              </div>
              {/* 动作组**一行**：主行动「在工作台打开」在最左，其后编辑 / 复制 / 删除，整体贴右缘。
                  保持原有一行的排列（用户 2026-09-28 二轮："这个东西就应该固定在一个位置"，
                  指位置稳定而不是拆成两行——稳定性改由 CSS 的**固定高度锚**保证，见 `.pc-detail__actions`）。 */}
              <div className="pc-detail__actions">
                <button type="button" className="pp-btn pp-btn--primary" onClick={() => void enterWorkspace(sel.id)}>
                  <Play size={14} />{t('projects.openInWorkspace')}
                </button>
                <button type="button" className="pp-btn" onClick={() => setEditing(sel)}><Pencil size={14} />{t('projects.editInfo')}</button>
                <button type="button" className="pp-btn" onClick={() => void copyProject(sel.id)}><Copy size={14} />{t('projects.duplicate')}</button>
                <button type="button" className="pp-icon-btn is-danger" title={t('projects.delete')} onClick={() => setAskDelete(sel)}><Trash2 size={15} /></button>
              </div>
            </header>
            <section>
              <h3 className="pb-h">{t('projects.charts')} <span className="pp-muted">{sel.charts.length}</span></h3>
              <div className="pc-charts">
                {sel.charts.map((c) => {
                  const up = chartStatus(c) === 'uploaded';
                  return (
                    <div key={c.id} className="pc-chart">
                      <DiffLevelBadge
                        chart={c}
                        uploaded={up}
                        onCommit={(patch) => void mutate(sel.id, (p) => updateChartInfo(p, c.id, {
                          title: c.title, diff: patch.diff, level: patch.level,
                        }, Date.now()))}
                      />
                      <span className="pc-chart__title">
                        <b>{effectiveTitle(sel, c)}</b>
                        <small className="pp-muted">{t('projects.notesMeta', { count: countChartNotes(c.notes), time: relTime(c.lastModified) })}</small>
                      </span>
                      <StatusBadge chart={c} />
                      <span className="pc-chart__actions">
                        <button type="button" className="pp-btn pp-btn--sm" onClick={() => void enterWorkspace(sel.id, c.id)}>
                          <Play size={12} />{t('projects.open')}
                        </button>
                        <button
                          type="button"
                          className="pp-btn pp-btn--sm"
                          disabled={up}
                          onClick={() => void mutate(sel.id, (p) => toggleChartCompleted(p, c.id, Date.now()))}
                        >
                          {c.completed ? t('projects.unmarkComplete') : t('projects.markComplete')}
                        </button>
                        <button type="button" className="pp-icon-btn" title={t('projects.editChart')} onClick={() => setChartForm({ project: sel, chart: c })}><Pencil size={14} /></button>
                        <button
                          type="button"
                          className="pp-icon-btn"
                          title={t('projects.duplicateChart')}
                          onClick={() => void mutate(sel.id, (p) => duplicateChartInProject(p, c.id, { chartId: newChartId(), now: Date.now() }, untitledProjectLabel()))}
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          type="button"
                          className="pp-icon-btn is-danger"
                          title={t('projects.deleteChart')}
                          onClick={() => setAskDeleteChart({ project: sel, chart: c })}
                        >
                          <Trash2 size={14} />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="pc-add">
                <button type="button" className="pp-btn" onClick={() => setChartForm({ project: sel, chart: null })}>
                  <Plus size={14} />{t('projects.addChart')}
                </button>
              </div>
            </section>
            <section>
              <h3 className="pb-h">{t('projects.uploads')}</h3>
              {uploads.length === 0 ? <p className="pp-muted">{t('projects.uploadsEmpty')}</p> : (
                <ul className="pc-uploads">
                  {uploads.map((c) => (
                    <li key={c.id}>
                      <span className="pp-pill__diff" style={{ background: DIFF_COLORS[c.diff] }}>{DIFF_SHORT[c.diff]}</span>
                      {effectiveTitle(sel, c)} →{' '}
                      <a href={`https://bestdori.com/community/charts/${c.upload!.postId}`} target="_blank" rel="noreferrer">
                        {t('projects.postLink', { id: c.upload!.postId })}
                      </a>
                      <span className="pp-muted">{relTime(c.upload!.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </main>
        </div>
        </div>
        {dialogs}
      </div>
    );
  }

  return (
    <div className="pm-root">
      <div key="hub" className={`pm-view pm-view--${navDir}`}>
        <ProjectStartView list={list} currentId={projectId} sort={sortKey} onSort={setProjectSort} onDetail={goDetail} onOpen={enterWorkspace} onNew={setNewSource} projectMenu={projectMenu} />
      </div>
      {dialogs}
    </div>
  );
}

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

function ProjectStartView({
  list, currentId, sort, onSort, onDetail, onOpen, onNew, projectMenu,
}: {
  list: ChartProject[];
  currentId: string | null;
  sort: ProjectSortKey;
  onSort: (key: ProjectSortKey) => void;
  onDetail: (id: string) => void;
  onOpen: (id: string, chartId?: string) => void;
  onNew: (src: NewSource) => void;
  projectMenu: (p: ChartProject) => ReactNode;
}) {
  const { activePage } = useAppNav();
  const gridRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [columns, setColumns] = useState(1);
  const isEmpty = list.length === 0;

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

  // 选中卡片自动滚入视口（定案 5；布局行为 jsdom 测不了 → 人工验收）
  useEffect(() => {
    if (!effectiveSelectedId) return;
    gridRef.current?.querySelectorAll<HTMLElement>('.pb-card').forEach((card) => {
      if (card.dataset.projectId === effectiveSelectedId) card.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
  }, [effectiveSelectedId]);

  // hero 是选中卡片的投影（选中失效时 = 最近打开，横幅不闪空）
  const selected = list.find((p) => p.id === effectiveSelectedId) ?? list[0];
  return (
    <div className="pb-page">
      {isEmpty && <GuideBanner />}
      {!isEmpty && selected && (
        <section className="pb-hero">
          <Cover project={selected} size={120} />
          <div className="pb-hero__body">
            <span className="pp-eyebrow">{t('projects.resume')}</span>
            <h2>
              {displayProjectName(selected)}
              <button type="button" className="pb-hero__detail" onClick={() => onDetail(selected.id)}>{t('projects.detailLink')}</button>
            </h2>
            <p className="pp-muted">{selected.artist ?? t('projects.artistMissing')} · {t('projects.lastOpened', { time: relTime(selected.lastOpened) })}</p>
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
          <button type="button" className="pb-tile" disabled={list.length === 0} onClick={() => onNew('copy')}>
            <Copy size={20} /><b>{t('projects.newCopy')}</b><small>{t('projects.newCopyDesc')}</small>
          </button>
        </div>
      </section>
      <section>
        <div className="pb-h-row">
          <h3 className="pb-h">{t('projects.allProjects')} <span className="pp-muted">{list.length}</span></h3>
          {!isEmpty && (
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
        {isEmpty ? (
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
              <small className="pp-muted">{p.artist ?? '—'} · {relTime(p.lastOpened)}</small>
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
