// 工作台谱面切换器（chart-projects 05 / ADR-0015）：面包屑下拉「工程名称 / 当前谱面 ▾」。
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Circle, Copy, FolderOpen, Lock, Pencil, Plus, Upload } from 'lucide-react';
import { useAppNav } from '../../layouts/AppNav';
import { useCurrentProject } from '../../app/providers/CurrentProjectProvider';
import { newChartId, type ChartProject, type ProjectChart } from '../../chart/project/ChartProject';
import {
  addChartToProject,
  chartEffectiveTitle,
  chartSwitchLabel,
  DIFF_COLORS,
  DIFF_NAMES,
  DIFF_SHORT,
  duplicateChartInProject,
  projectDisplayName,
  toggleChartCompleted,
  updateChartInfo,
} from '../../chart/project/projectCatalog';
import { chartStatus, pickCurrentChart } from '../../chart/project/workspaceProject';
import { countChartNotes } from '../../chart/editing/NoteEditing';
import { formatValidationError } from '../../chart/editing/ChartConverter';
import { t } from '../../i18n';
import { ChartInfoDialog } from '../ChartInfoDialog';
import '../ProjectsPage.css';

function untitled(): string {
  return t('projects.untitled');
}

function displayName(project: { name: string | null }): string {
  return projectDisplayName(project.name, untitled());
}

function StatusIcon({ chart, size = 12 }: { chart: ProjectChart; size?: number }) {
  const s = chartStatus(chart);
  if (s === 'uploaded') return <Upload size={size} className="pp-st pp-st--uploaded" />;
  if (s === 'completed') return <Check size={size} className="pp-st pp-st--completed" />;
  return <Circle size={size - 2} className="pp-st pp-st--unfinished" />;
}

function MenuItem({ icon, label, onClick, disabled, note }: {
  icon: ReactNode; label: string; onClick?: () => void; disabled?: boolean; note?: string;
}) {
  return (
    <button type="button" className="pp-menu__item" disabled={disabled} onClick={onClick}>
      {icon}<span>{label}</span>{note && <em>{note}</em>}
    </button>
  );
}

export default function ChartSwitcher() {
  const { setActivePage } = useAppNav();
  const {
    projectId, chartId, store, catalogEpoch, open, notifyCatalogChanged, flushPersist,
  } = useCurrentProject();
  const [project, setProject] = useState<ChartProject | null>(null);
  const [openMenu, setOpenMenu] = useState(false);
  const [form, setForm] = useState<{ chart: ProjectChart | null } | null>(null);
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

  const mutate = useCallback(async (
    fn: (p: ChartProject) => ChartProject | null,
    thenChartId?: string,
  ) => {
    if (!projectId) return;
    await flushPersist();
    const loaded = await store.get(projectId);
    if (!loaded) return;
    const next = fn(loaded);
    if (!next) return;
    await store.save(next);
    notifyCatalogChanged();
    setProject(next);
    if (thenChartId) await open(projectId, thenChartId);
  }, [projectId, flushPersist, store, notifyCatalogChanged, open]);

  const selectChart = useCallback(async (id: string) => {
    if (!projectId || id === chartId) return;
    await flushPersist();
    await open(projectId, id);
  }, [projectId, chartId, flushPersist, open]);

  const copyChart = useCallback(async () => {
    if (!project || !chartId) return;
    const copyId = newChartId();
    await mutate((p) => duplicateChartInProject(p, chartId, { chartId: copyId, now: Date.now() }, untitled()), copyId);
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
    <div className="cs-b">
      <button
        type="button"
        className="cs-crumb"
        title={t('workspace.switcher.crumbTitle')}
        onClick={() => setActivePage('projects')}
      >
        {displayName(project)}
      </button>
      <span className="pp-muted">/</span>
      <button ref={btnRef} type="button" className="cs-b__current" aria-expanded={openMenu} aria-haspopup="listbox" onClick={toggle}>
        <span className="pp-pill__diff" style={{ background: DIFF_COLORS[cur.diff] }}>{DIFF_SHORT[cur.diff]}</span>
        {chartSwitchLabel(project.name, cur)}
        <span className="pp-muted">{cur.level ?? ''}</span>
        <ChevronDown size={14} />
      </button>
      {openMenu && createPortal(
        <>
          <span className="pp-menu__scrim" onClick={() => setOpenMenu(false)} />
          <div className="pp-menu__panel is-portaled cs-b__panel" style={{ top: pos.top, left: pos.left }}>
            <div className="cs-b__label">{t('workspace.switcher.listLabel', { count: project.charts.length })}</div>
            {project.charts.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`cs-b__row${c.id === cur.id ? ' is-active' : ''}`}
                onClick={() => { void selectChart(c.id); setOpenMenu(false); }}
              >
                <span className="pp-pill__diff" style={{ background: DIFF_COLORS[c.diff] }}>{DIFF_SHORT[c.diff]}</span>
                <span className="cs-b__title">
                  {chartEffectiveTitle(project.name, c.title, untitled())}
                  <small className="pp-muted">
                    {t('workspace.switcher.rowMeta', {
                      diff: DIFF_NAMES[c.diff],
                      level: c.level ?? '–',
                      count: countChartNotes(c.notes),
                    })}
                  </small>
                </span>
                <span className={`pp-badge pp-badge--${chartStatus(c)}`}>
                  <StatusIcon chart={c} size={11} />{t(`projects.status.${chartStatus(c)}` as 'projects.status.unfinished')}
                </span>
              </button>
            ))}
            <div className="cs-b__sep" />
            <MenuItem icon={<Copy size={14} />} label={t('workspace.switcher.copyCurrent')} note={t('workspace.switcher.copyNote')} onClick={() => { void copyChart(); setOpenMenu(false); }} />
            <MenuItem
              icon={<Check size={14} />}
              label={cur.completed ? t('workspace.switcher.unmarkComplete') : t('workspace.switcher.markComplete')}
              disabled={uploaded}
              onClick={() => { void mutate((p) => toggleChartCompleted(p, cur.id, Date.now())); setOpenMenu(false); }}
            />
            <MenuItem icon={<Pencil size={14} />} label={t('workspace.switcher.editCurrent')} onClick={() => { setForm({ chart: cur }); setOpenMenu(false); }} />
            <MenuItem icon={<Plus size={14} />} label={t('projects.addChart')} onClick={() => { setForm({ chart: null }); setOpenMenu(false); }} />
            <MenuItem icon={<FolderOpen size={14} />} label={t('workspace.switcher.back')} onClick={() => { setOpenMenu(false); setActivePage('projects'); }} />
          </div>
        </>,
        document.body,
      )}
      {uploaded && (
        <span className="cs-readonly">
          <Lock size={12} />{t('workspace.switcher.uploaded')}
          <button type="button" onClick={() => void copyChart()}>{t('workspace.switcher.copyToEdit')}</button>
        </span>
      )}
      {form && (
        <ChartInfoDialog
          project={project}
          chart={form.chart}
          onClose={() => setForm(null)}
          onAdd={(input) => {
            void (async () => {
              await flushPersist();
              const loaded = await store.get(project.id);
              if (!loaded) return;
              const result = addChartToProject(loaded, input, { chartId: newChartId(), now: Date.now() });
              if (!result.ok) {
                const err = result.errors[0];
                window.alert(t('projects.applyFail', { message: err ? formatValidationError(err) : 'invalid' }));
                return;
              }
              await store.save(result.project);
              notifyCatalogChanged();
              setForm(null);
              await open(project.id, result.chart.id);
            })();
          }}
          onUpdate={(patch) => {
            void mutate((p) => updateChartInfo(p, form.chart!.id, patch, Date.now()));
            setForm(null);
          }}
        />
      )}
    </div>
  );
}
