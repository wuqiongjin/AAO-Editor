// 工作台谱面切换器（chart-projects 05 / ADR-0015）：面包屑下拉「工程名称 / 当前谱面 ▾」。
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Copy, Eye, FolderOpen, Lock, Music2, Pencil, Plus } from 'lucide-react';
import { useAppNav } from '../../layouts/AppNav';
import { useCurrentProject } from '../../app/providers/CurrentProjectProvider';
import { newChartId, type ChartProject, type ProjectChart } from '../../project/ChartProject';
import { mutateProject } from '../../project/ChartProjectRecord';
import {
  addChartToProject,
  chartEffectiveTitle,
  chartSwitchLabel,
  DIFF_COLORS,
  DIFF_NAMES,
  DIFF_SHORT,
  duplicateChartInProject,
  toggleChartCompleted,
  updateChartInfo,
} from '../../project/projectCatalog';
import { chartStatus, pickCurrentChart } from '../../project/workspaceProject';
import { countChartNotes } from '../../chart/editing/NoteEditing';
import { formatValidationError, type ValidationError } from '../../chart/editing/ChartConverter';
import { t } from '../../i18n';
import { showToast } from '../../ui/Toast';
import { ChartInfoDialog } from '../../project/ui/ChartInfoDialog';
import {
  ChartStatusIcon,
  displayProjectName,
  ProjectMenuItem,
  untitledProjectLabel,
} from '../../project/ui/projectUi';
import '../projects/ProjectsPage.css';
import './ChartSwitcher.css';

export default function ChartSwitcher() {
  const { setActivePage } = useAppNav();
  const {
    projectId, chartId, store, catalogEpoch, open, notifyCatalogChanged, flushPersist, waitForRestore,
  } = useCurrentProject();
  const [project, setProject] = useState<ChartProject | null>(null);
  const [openMenu, setOpenMenu] = useState(false);
  const [chartInfo, setChartInfo] = useState<{ chart: ProjectChart | null } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      return;
    }
    let cancelled = false;
    void store.get(projectId).then((loaded) => {
      if (!cancelled && loaded) setProject(loaded);
    });
    return () => { cancelled = true; };
  }, [projectId, chartId, catalogEpoch, store]);

  // 整记录读-改-写走唯一写入口（次序：flush → get → fn → save → notify）；
  // setProject / open 是本组件自己的下一步。
  const mutate = useCallback(async (
    fn: (p: ChartProject) => ChartProject | null,
    thenChartId?: string,
  ): Promise<ChartProject | null> => {
    if (!projectId) return null;
    const result = await mutateProject(
      { store, flush: flushPersist, notify: notifyCatalogChanged },
      projectId,
      fn,
    );
    if (result.status !== 'saved') return null;
    setProject(result.project);
    if (thenChartId) {
      await open(projectId, thenChartId);
      await waitForRestore(projectId, thenChartId);
    }
    return result.project;
  }, [projectId, flushPersist, store, notifyCatalogChanged, open, waitForRestore]);

  const selectChart = useCallback(async (id: string) => {
    if (!projectId || id === chartId) return;
    await flushPersist();
    await open(projectId, id);
    await waitForRestore(projectId, id);
  }, [projectId, chartId, flushPersist, open, waitForRestore]);

  const copyChart = useCallback(async () => {
    if (!project || !chartId) return;
    const copyId = newChartId();
    await mutate((p) => duplicateChartInProject(p, chartId, { chartId: copyId, now: Date.now() }, untitledProjectLabel()), copyId);
  }, [project, chartId, mutate]);

  if (!project) return null;
  const cur = pickCurrentChart(project, chartId);
  const uploaded = chartStatus(cur) === 'uploaded';

  const toggle = () => {
    if (!openMenu && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpenMenu((v) => !v);
  };

  return (
    <div className="chart-switcher">
      <button
        type="button"
        className="chart-switcher__crumb"
        title={t('workspace.switcher.crumbTitle')}
        onClick={() => setActivePage('projects')}
      >
        {displayProjectName(project)}
      </button>
      <span className="pp-muted">/</span>
      <button ref={btnRef} type="button" className="chart-switcher__current" aria-expanded={openMenu} aria-haspopup="listbox" onClick={toggle}>
        <span className="pp-pill__diff" style={{ background: DIFF_COLORS[cur.diff] }}>{DIFF_SHORT[cur.diff]}</span>
        {chartSwitchLabel(project.name, cur)}
        <span className="pp-muted">{cur.level ?? ''}</span>
        <ChevronDown size={14} />
      </button>
      {openMenu && createPortal(
        <>
          <span className="pp-menu__scrim" onClick={() => setOpenMenu(false)} />
          <div className="pp-menu__panel is-portaled chart-switcher__panel" style={{ top: pos.top, left: pos.left }}>
            <div className="chart-switcher__label">{t('workspace.switcher.listLabel', { count: project.charts.length })}</div>
            {project.charts.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chart-switcher__row${c.id === cur.id ? ' is-active' : ''}`}
                onClick={() => { void selectChart(c.id); setOpenMenu(false); }}
              >
                <span className="pp-pill__diff" style={{ background: DIFF_COLORS[c.diff] }}>{DIFF_SHORT[c.diff]}</span>
                <span className="chart-switcher__title">
                  {chartEffectiveTitle(project.name, c.title, untitledProjectLabel())}
                  <small className="pp-muted">
                    {t('workspace.switcher.rowMeta', {
                      diff: DIFF_NAMES[c.diff],
                      level: c.level ?? '–',
                      count: countChartNotes(c.notes),
                    })}
                  </small>
                </span>
                <span className={`pp-badge pp-badge--${chartStatus(c)}`}>
                  <ChartStatusIcon chart={c} size={11} />{t(`projects.status.${chartStatus(c)}` as 'projects.status.unfinished')}
                </span>
              </button>
            ))}
            <div className="chart-switcher__sep" />
            <ProjectMenuItem icon={<Copy size={14} />} label={t('workspace.switcher.copyCurrent')} note={t('workspace.switcher.copyNote')} onClick={() => { void copyChart(); setOpenMenu(false); }} />
            <ProjectMenuItem
              icon={<Check size={14} />}
              label={cur.completed ? t('workspace.switcher.unmarkComplete') : t('workspace.switcher.markComplete')}
              disabled={uploaded}
              onClick={() => { void mutate((p) => toggleChartCompleted(p, cur.id, Date.now())); setOpenMenu(false); }}
            />
            <ProjectMenuItem icon={<Pencil size={14} />} label={t('workspace.switcher.editCurrent')} onClick={() => { setChartInfo({ chart: cur }); setOpenMenu(false); }} />
            <ProjectMenuItem icon={<Plus size={14} />} label={t('projects.addChart')} onClick={() => { setChartInfo({ chart: null }); setOpenMenu(false); }} />
            {/* 音频管理入口（票 15 定案 5）：不带作用域 = 去当前工程的音频页（与左栏「音频」同义），
                留在这里是因为"我要管这个工程的音频"这个念头发生在工作台里。 */}
            <ProjectMenuItem icon={<Music2 size={14} />} label={t('workspace.switcher.manageAudio')} onClick={() => { setOpenMenu(false); setActivePage('audio'); }} />
            {/* 预览入口（ADR-0016 §4 / chart-preview 02）：**带作用域**跳过去 —— 预览页作用到
                「这个工程 + 当前这张谱面」，当前工作台/当前工程都不被切走（票 22 定案 2）。 */}
            <ProjectMenuItem
              icon={<Eye size={14} />}
              label={t('workspace.switcher.preview')}
              onClick={() => {
                setOpenMenu(false);
                setActivePage('preview', { scope: { projectId: project.id, chartId: cur.id } });
              }}
            />
            <ProjectMenuItem icon={<FolderOpen size={14} />} label={t('workspace.switcher.back')} onClick={() => { setOpenMenu(false); setActivePage('projects'); }} />
          </div>
        </>,
        document.body,
      )}
      {uploaded && (
        <span className="chart-switcher__readonly">
          <Lock size={12} />{t('workspace.switcher.uploaded')}
          <button type="button" onClick={() => void copyChart()}>{t('workspace.switcher.copyToEdit')}</button>
        </span>
      )}
      {chartInfo && (
        <ChartInfoDialog
          project={project}
          chart={chartInfo.chart}
          onClose={() => setChartInfo(null)}
          onAdd={(input) => {
            const id = newChartId();
            void (async () => {
              let applyErrors: ValidationError[] | null = null;
              const next = await mutate((p) => {
                const result = addChartToProject(p, input, { chartId: id, now: Date.now() });
                if (!result.ok) {
                  applyErrors = result.errors;
                  return null;
                }
                return result.project;
              }, id);
              if (applyErrors) {
                const err = applyErrors[0];
                showToast(t('projects.applyFail', { message: err ? formatValidationError(err) : 'invalid' }), 'danger');
                return;
              }
              if (next) setChartInfo(null);
            })();
          }}
          onUpdate={(patch) => {
            void mutate((p) => updateChartInfo(p, chartInfo.chart!.id, patch, Date.now()));
            setChartInfo(null);
          }}
        />
      )}
    </div>
  );
}
