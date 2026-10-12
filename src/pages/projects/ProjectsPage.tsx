// 工程管理页（chart-projects 04 / ADR-0015 §2）：一层两个视图。
// 默认工程启动台；点封面进工程详情。保活挂载，⇧⌘0 回来停在离开前那一层。
// 本文件只留：双视图调度 + state / handlers + 弹窗编排；两个视图与弹窗分别住在 components/。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Copy, FolderPlus, MoreHorizontal, Music4, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useAppNav } from '../../layouts/AppNav';
import { useConfig } from '../../app/ProviderTree';
import { createCommunityTransport, hasCommunityNet } from '../../community/electronTransport';
import { useCurrentProject } from '../../app/providers/CurrentProjectProvider';
import {
  newChartId, newProjectId, type ChartDifficulty, type ChartProject, type ProjectChart,
} from '../../project/ChartProject';
import { mutateProject } from '../../project/ChartProjectRecord';
import {
  addChartToProject,
  createBlankProject,
  deleteChartFromProject,
  duplicateProject,
  updateChartInfo,
  updateProjectInfo,
} from '../../project/projectCatalog';
import { mostRecentlyOpenedId, sortProjects } from '../../project/projectSort';
import { ChartInfoDialog } from '../../project/ui/ChartInfoDialog';
import { displayProjectName, ProjectMenuItem, untitledProjectLabel } from '../../project/ui/projectUi';
import { formatValidationError } from '../../chart/editing/ChartConverter';
import { t } from '../../i18n';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { showToast } from '../../ui/Toast';
import { deleteProjectNotice } from './projectFormat';
import { moveGridSelection } from './projectGridSelection';
import { Menu } from './components/ProjectBits';
import {
  EditInfoDialog, NewProjectDialog, type NewSource, type OfficialImportReply,
} from './components/ProjectDialogs';
import type { OfficialSongSelection } from './components/OfficialSongPanel';
import type { CommunityPostSelection } from './components/CommunityPostPanel';
import { importOfficialSong, officialApplyErrorText, officialErrorText, type OfficialImportStage } from './officialImport';
import {
  communityApplyErrorText,
  communityErrorText,
  importCommunityPost,
  type CommunityImportStage,
} from './communityImport';
import { ProjectStartView } from './components/ProjectHub';
import { ProjectDetail } from './components/ProjectDetail';
import './ProjectsPage.css';

export default function ProjectsPage() {
  const { activePage, setActivePage } = useAppNav();
  const { settings, setProjectSort, setProjectListWidth } = useConfig();
  const {
    projectId, store, catalogEpoch, open, reset, notifyCatalogChanged, flushPersist, waitForRestore,
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
  // 社区平台出口（票 07）：静态演示版没有 → 官方 / 社区两支入口整体隐藏（ADR-0011 §1 / 票 12）
  const communityTransport = useMemo(() => createCommunityTransport(), []);
  const importSources = hasCommunityNet();

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

  // 整记录读-改-写走唯一写入口（次序：flush → get → fn → save → notify）；
  // reload 是本页自己的下一步，不属记录模块。
  const mutate = useCallback(async (id: string, fn: (p: ChartProject) => ChartProject | null) => {
    const result = await mutateProject(
      { store, flush: flushPersist, notify: notifyCatalogChanged },
      id,
      fn,
    );
    if (result.status === 'saved') await reload();
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
    await waitForRestore(id, chartId);
    setActivePage('workspace');
  }, [setCurrent, waitForRestore, setActivePage]);

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

  // 「从官方谱面导入」（票 08 + 14）：素材缓存（音频 / 封面，命中即零网络）→ Apply 闸门（勾了才走）→ 落盘 → 切到新工程详情。
  // 与另两支同落点（issue 23 #1）：留在工程管理页、新工程成为当前工程、不跳工作台。
  const importOfficial = useCallback(async (
    selection: OfficialSongSelection,
    onStage: (stage: OfficialImportStage) => void,
  ): Promise<OfficialImportReply> => {
    await flushPersist();
    let result: Awaited<ReturnType<typeof importOfficialSong>>;
    try {
      result = await importOfficialSong(
        { store, transport: communityTransport, notifyCatalogChanged, onStage },
        {
          song: selection.song,
          detail: selection.detail,
          withChart: selection.withChart,
          diff: selection.diff,
        },
      );
    } catch (error) {
      return { ok: false, message: officialErrorText(error) };
    }
    if (!result.ok) {
      return {
        ok: false,
        message: result.reason === 'apply' ? officialApplyErrorText(result.errors) : officialErrorText(result.error),
      };
    }
    // 票 26：建成了但要说一声 —— 谱面降级 / 封面缺失都走 Toast（弹窗此刻已在关）
    const warnings: string[] = [];
    if (result.chartDegraded) warnings.push(t('projects.official.warn.chartFallback'));
    if (!result.coverImported) warnings.push(t('projects.official.warn.coverMissing'));
    setNewSource(null);
    goDetailKeepAnimation(result.project.id);
    await reload();
    await setCurrent(result.project.id, result.chartId);
    if (warnings.length > 0) showToast(warnings.join('\n'), 'warn');
    return { ok: true, warnings };
  }, [flushPersist, store, communityTransport, notifyCatalogChanged, goDetailKeepAnimation, reload, setCurrent]);

  // 「从社区谱面导入」（票 09）：帖子素材缓存 → 帖子详情（谱面原文，带上谱面时必达）→ Apply 闸门
  // → 落盘 → 切到新工程详情。落点与官方那支同口径（issue 23 #1）；
  // 工程名称 / 歌手留空（票 09：不转手别人的谱连名字一起转）；
  // `withChart` = 预览栏那颗「同步导入谱面」芯片（默认开；关掉 = 只建工程 + 音频 + 封面）。
  const importCommunity = useCallback(async (
    selection: CommunityPostSelection,
    onStage: (stage: CommunityImportStage) => void,
  ): Promise<OfficialImportReply> => {
    await flushPersist();
    let result: Awaited<ReturnType<typeof importCommunityPost>>;
    try {
      result = await importCommunityPost(
        { store, transport: communityTransport, notifyCatalogChanged, onStage },
        { post: selection.post, song: selection.song, detail: selection.detail, withChart: selection.withChart },
      );
    } catch (error) {
      return { ok: false, message: communityErrorText(error) };
    }
    if (!result.ok) {
      return {
        ok: false,
        message: result.reason === 'apply' ? communityApplyErrorText(result.errors) : communityErrorText(result.error),
      };
    }
    const warnings: string[] = [];
    if (!result.coverImported) warnings.push(t('projects.community.warn.coverMissing'));
    setNewSource(null);
    goDetailKeepAnimation(result.project.id);
    await reload();
    await setCurrent(result.project.id, result.chartId);
    if (warnings.length > 0) showToast(warnings.join('\n'), 'warn');
    return { ok: true, warnings };
  }, [flushPersist, store, communityTransport, notifyCatalogChanged, goDetailKeepAnimation, reload, setCurrent]);

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
          onImportOfficial={importOfficial}
          onImportCommunity={importCommunity}
          transport={communityTransport}
          importSources={importSources}
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
              const result = await mutateProject(
                { store, flush: flushPersist, notify: notifyCatalogChanged },
                chartForm.project.id,
                (loaded) => {
                  const applied = addChartToProject(loaded, input, { chartId: newChartId(), now: Date.now() });
                  if (!applied.ok) {
                    const err = applied.errors[0];
                    showToast(t('projects.applyFail', { message: err ? formatValidationError(err) : 'invalid' }), 'danger');
                    return null;
                  }
                  return applied.project;
                },
              );
              if (result.status === 'saved') {
                setChartForm(null);
                await reload();
              }
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
        {importSources && (
          <>
            <ProjectMenuItem icon={<Music4 size={14} />} label={t('projects.newOfficial')} onClick={() => setNewSource('official')} />
            <ProjectMenuItem icon={<Users size={14} />} label={t('projects.newCommunity')} onClick={() => setNewSource('community')} />
          </>
        )}
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

  const hub = (
    <ProjectStartView
      list={list}
      currentId={projectId}
      sort={sortKey}
      onSort={setProjectSort}
      onDetail={goDetail}
      onOpen={enterWorkspace}
      onNew={setNewSource}
      projectMenu={projectMenu}
      importSources={importSources}
    />
  );

  const sel = detailId ? list.find((p) => p.id === detailId) ?? list[0] : undefined;
  if (sel) {
    return (
      <div className="pm-root">
        <div key="detail" className={`pm-view pm-view--${navDir}`}>
          <ProjectDetail
            list={list}
            sel={sel}
            currentId={projectId}
            listWidth={settings.layout.projectList.width}
            onListWidthChange={setProjectListWidth}
            newButton={newButton}
            onHome={goHome}
            onSelect={goDetail}
            onOpen={enterWorkspace}
            onEdit={setEditing}
            onCopy={(id) => void copyProject(id)}
            onDelete={setAskDelete}
            onChartForm={setChartForm}
            onDeleteChart={setAskDeleteChart}
            onOpenAudio={() => setActivePage('audio', { scope: { projectId: sel.id } })}
            onPreviewChart={(chartId) => setActivePage('preview', { scope: { projectId: sel.id, chartId } })}
            mutate={mutate}
          />
        </div>
        {dialogs}
      </div>
    );
  }

  return (
    <div className="pm-root">
      <div key="hub" className={`pm-view pm-view--${navDir}`}>
        {hub}
      </div>
      {dialogs}
    </div>
  );
}
