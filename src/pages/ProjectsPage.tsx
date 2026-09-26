// 工程管理页（chart-projects 04 / ADR-0015 §2）：一层两个视图。
// 默认工程启动台；点封面进工程详情。保活挂载，⇧⌘0 回来停在离开前那一层。
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Check, ChevronDown, Circle, Copy, FolderPlus, Lock, MoreHorizontal, Music2, Pencil, Play, Plus, Trash2, Upload,
} from 'lucide-react';
import { useAppNav } from '../layouts/AppNav';
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
  projectDisplayName,
  sortProjectsByLastOpened,
  toggleChartCompleted,
  updateChartInfo,
  updateProjectInfo,
} from '../chart/project/projectCatalog';
import { chartStatus, isProjectUnfinished } from '../chart/project/workspaceProject';
import { countChartNotes } from '../chart/editing/NoteEditing';
import { formatValidationError } from '../chart/editing/ChartConverter';
import { t } from '../i18n';
import { ChartInfoDialog } from './ChartInfoDialog';
import './ProjectsPage.css';

const H = 3600_000;
const D = 24 * H;

function untitled(): string {
  return t('projects.untitled');
}

function displayName(project: { name: string | null }): string {
  return projectDisplayName(project.name, untitled());
}

function effectiveTitle(project: { name: string | null }, chart: { title: string | null }): string {
  return chartEffectiveTitle(project.name, chart.title, untitled());
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

function useCoverUrl(blob?: Blob): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function Cover({ project, size }: { project: ChartProject; size: number }) {
  const url = useCoverUrl(project.coverBlob);
  const hue = projectCoverHue(project.id);
  const ch = project.name?.trim()[0];
  return (
    <div
      className="pp-cover"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: url
          ? undefined
          : `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 65% 35%))`,
        backgroundImage: url ? `url(${url})` : undefined,
      }}
    >
      {url ? null : (ch ? ch.toUpperCase() : <Music2 size={size * 0.42} />)}
    </div>
  );
}

function StatusIcon({ chart, size = 12 }: { chart: ProjectChart; size?: number }) {
  const s = chartStatus(chart);
  if (s === 'uploaded') return <Upload size={size} className="pp-st pp-st--uploaded" />;
  if (s === 'completed') return <Check size={size} className="pp-st pp-st--completed" />;
  return <Circle size={size - 2} className="pp-st pp-st--unfinished" />;
}

function StatusBadge({ chart }: { chart: ProjectChart }) {
  const s = chartStatus(chart);
  return <span className={`pp-badge pp-badge--${s}`}><StatusIcon chart={chart} size={11} />{statusLabel(chart)}</span>;
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

function MenuItem({ icon, label, onClick, danger, disabled }: {
  icon: ReactNode; label: string; onClick?: () => void; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button type="button" className={`pp-menu__item${danger ? ' is-danger' : ''}`} disabled={disabled} onClick={onClick}>
      {icon}<span>{label}</span>
    </button>
  );
}

type NewSource = 'blank' | 'copy';

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
    <div className="pp-dialog__scrim" onMouseDown={onClose}>
      <div className="pp-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{t('projects.newDialogTitle')}</h3>
        <div className="pp-tabs">
          <button type="button" className={source === 'blank' ? 'is-active' : ''} onClick={() => setSource('blank')}>
            <FolderPlus size={14} />{t('projects.newBlank')}
          </button>
          <button type="button" className={source === 'copy' ? 'is-active' : ''} onClick={() => setSource('copy')} disabled={projects.length === 0}>
            <Copy size={14} />{t('projects.newCopy')}
          </button>
        </div>
        {source === 'copy' ? (
          <label className="pp-field">
            <span>{t('projects.copyWhich')}</span>
            <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{t('projects.copyCharts', { name: displayName(p), count: p.charts.length })}</option>
              ))}
            </select>
            <small>{t('projects.copyHint')}</small>
          </label>
        ) : (
          <>
            <div className="pp-field-row">
              <label className="pp-field"><span>{t('projects.name')}</span><input value={name} placeholder={untitled()} onChange={(e) => setName(e.target.value)} /></label>
              <label className="pp-field"><span>{t('projects.artist')}</span><input value={artist} placeholder={t('projects.artistLater')} onChange={(e) => setArtist(e.target.value)} /></label>
            </div>
            <label className="pp-field">
              <span>{t('projects.firstDiff')}</span>
              <select value={diff} onChange={(e) => setDiff(Number(e.target.value) as ChartDifficulty)}>
                {DIFF_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
              </select>
            </label>
            <small className="pp-muted">{t('projects.newHint')}</small>
          </>
        )}
        <div className="pp-dialog__actions">
          <button type="button" className="pp-btn" onClick={onClose}>{t('projects.cancel')}</button>
          <button
            type="button"
            className="pp-btn pp-btn--primary"
            disabled={source === 'copy' && !copyFrom}
            onClick={() => (source === 'copy' ? onCopy(copyFrom) : onCreate({ name, artist, diff }))}
          >
            {source === 'copy' ? t('projects.copyAction') : t('projects.createOpen')}
          </button>
        </div>
      </div>
    </div>
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
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [clearCover, setClearCover] = useState(false);
  const preview = useCoverUrl(clearCover ? undefined : (coverFile ?? project.coverBlob));

  return (
    <div className="pp-dialog__scrim" onMouseDown={onClose}>
      <div className="pp-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{t('projects.editTitle')}</h3>
        <div className="pp-field-row">
          <label className="pp-field"><span>{t('projects.name')}</span><input value={name} placeholder={untitled()} onChange={(e) => setName(e.target.value)} /></label>
          <label className="pp-field"><span>{t('projects.artist')}</span><input value={artist} onChange={(e) => setArtist(e.target.value)} /></label>
        </div>
        <label className="pp-field">
          <span>{t('projects.source')}</span>
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value as SongSource['type'])}>
            <option value="custom">{t('projects.sourceCustom')}</option>
            <option value="bandori">{t('projects.sourceBandori')}</option>
            <option value="llsif">{t('projects.sourceLlsif')}</option>
          </select>
        </label>
        {sourceType !== 'custom' && (
          <label className="pp-field">
            <span>{t('projects.sourceId')}</span>
            <input value={sourceId} inputMode="numeric" onChange={(e) => setSourceId(e.target.value)} />
          </label>
        )}
        <label className="pp-field">
          <span>{t('projects.cover')}</span>
          {preview && <img src={preview} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8 }} />}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              setCoverFile(e.target.files?.[0] ?? null);
              setClearCover(false);
            }}
          />
          {(project.coverBlob || coverFile) && !clearCover && (
            <button type="button" className="pp-btn pp-btn--sm" onClick={() => { setCoverFile(null); setClearCover(true); }}>
              {t('projects.coverClear')}
            </button>
          )}
        </label>
        <small className="pp-muted">{t('projects.coverHint')}</small>
        <div className="pp-dialog__actions">
          <button type="button" className="pp-btn" onClick={onClose}>{t('projects.cancel')}</button>
          <button
            type="button"
            className="pp-btn pp-btn--primary"
            onClick={() => onSave({
              name,
              artist,
              source: parseSource(sourceType, sourceId),
              coverName: coverFile ? coverFile.name : undefined,
              coverBlob: coverFile ?? undefined,
              clearCover,
            })}
          >
            {t('projects.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const { setActivePage } = useAppNav();
  const {
    projectId, store, catalogEpoch, open, reset, notifyCatalogChanged, flushPersist,
  } = useCurrentProject();
  const [projects, setProjects] = useState<ChartProject[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [newSource, setNewSource] = useState<NewSource | null>(null);
  const [editing, setEditing] = useState<ChartProject | null>(null);
  const [chartForm, setChartForm] = useState<{ project: ChartProject; chart: ProjectChart | null } | null>(null);

  const reload = useCallback(async () => {
    const listed = sortProjectsByLastOpened(await store.list());
    setProjects(listed);
    setDetailId((id) => (id && !listed.some((p) => p.id === id) ? (listed[0]?.id ?? null) : id));
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

  const openWorkspace = useCallback(async (id: string, chartId?: string) => {
    await flushPersist();
    await open(id, chartId);
    notifyCatalogChanged();
    setActivePage('workspace');
  }, [flushPersist, open, notifyCatalogChanged, setActivePage]);

  const confirmDelete = useCallback(async (p: ChartProject) => {
    const uploaded = p.charts.filter((c) => c.upload).length;
    const extra = uploaded ? `\n${t('projects.confirmDeleteUploaded', { count: uploaded })}` : '';
    if (!window.confirm(`${t('projects.confirmDelete', { name: displayName(p), charts: p.charts.length })}${extra}`)) return;
    await flushPersist();
    const wasCurrent = projectId === p.id;
    await store.delete(p.id);
    if (wasCurrent) reset();
    notifyCatalogChanged();
    await reload();
  }, [flushPersist, projectId, store, reset, notifyCatalogChanged, reload]);

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
    await open(project.id, project.charts[0].id);
    setActivePage('workspace');
  }, [flushPersist, store, notifyCatalogChanged, open, setActivePage]);

  const copyProject = useCallback(async (fromId: string) => {
    await flushPersist();
    const src = await store.get(fromId);
    if (!src) return;
    const now = Date.now();
    const copy = duplicateProject(src, {
      id: newProjectId(),
      chartIds: src.charts.map(() => newChartId()),
      now,
    }, untitled());
    await store.save(copy);
    notifyCatalogChanged();
    setNewSource(null);
    await reload();
  }, [flushPersist, store, notifyCatalogChanged, reload]);

  const list = projects;
  const resume = list.find(isProjectUnfinished);

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
                window.alert(t('projects.applyFail', { message: err ? formatValidationError(err) : 'invalid' }));
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
        <MenuItem icon={<FolderPlus size={14} />} label={t('projects.newBlank')} onClick={() => setNewSource('blank')} />
        <MenuItem icon={<Copy size={14} />} label={t('projects.newCopy')} onClick={() => setNewSource('copy')} disabled={list.length === 0} />
      </Menu>
    </span>
  );

  const projectMenu = (p: ChartProject) => (
    <Menu trigger={<button type="button" className="pp-icon-btn" title={t('projects.more')}><MoreHorizontal size={16} /></button>}>
      <MenuItem icon={<Pencil size={14} />} label={t('projects.editInfo')} onClick={() => setEditing(p)} />
      <MenuItem icon={<Copy size={14} />} label={t('projects.duplicate')} onClick={() => void copyProject(p.id)} />
      <MenuItem icon={<Trash2 size={14} />} label={t('projects.delete')} danger onClick={() => void confirmDelete(p)} />
    </Menu>
  );

  if (detailId) {
    const sel = list.find((p) => p.id === detailId) ?? list[0];
    if (!sel) {
      return (
        <div className="pm-root">
          <ProjectStartView list={list} resume={resume} currentId={projectId} onDetail={setDetailId} onOpen={openWorkspace} onNew={setNewSource} projectMenu={projectMenu} />
          {dialogs}
        </div>
      );
    }
    const uploads = sel.charts.filter((c) => c.upload);
    const locked = uploads.length > 0;
    return (
      <div className="pm-root">
        <div className="pc-page">
          <aside className="pc-list">
            <div className="pc-list__head">
              <button type="button" className="pp-btn pp-btn--sm" onClick={() => setDetailId(null)}>{t('projects.home')}</button>
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
                  onClick={() => setDetailId(p.id)}
                  onDoubleClick={() => void openWorkspace(p.id)}
                >
                  <Cover project={p} size={36} />
                  <span className="pc-item__text">
                    <b className={p.name ? '' : 'pp-muted'}>
                      {displayName(p)}
                      {p.id === projectId && <em className="pp-current-tag">{t('projects.current')}</em>}
                    </b>
                    <small className="pp-muted">{t('projects.doneRatio', { done, n, time: relTime(p.lastOpened) })}</small>
                  </span>
                  <span className="pc-item__bar"><span style={{ width: `${n ? (done / n) * 100 : 0}%` }} /></span>
                </button>
              );
            })}
          </aside>
          <main className="pc-detail">
            <header className="pc-detail__head">
              <Cover project={sel} size={96} />
              <div>
                <h2 className={sel.name ? '' : 'pp-muted'}>{displayName(sel)}</h2>
                <p className="pp-muted">{sel.artist ?? t('projects.artistMissing')} · {sourceLabel(sel.source)}</p>
                <p className="pp-muted">
                  <Music2 size={12} /> {sel.audioName ?? t('projects.noAudio')} · {formatDuration(sel.durationSeconds)}
                  {locked && <span className="pp-lock-note"><Lock size={11} />{t('projects.audioLocked')}</span>}
                </p>
              </div>
              <div className="pc-detail__actions">
                <button type="button" className="pp-btn pp-btn--primary" onClick={() => void openWorkspace(sel.id)}>
                  <Play size={14} />{t('projects.openInWorkspace')}
                </button>
                <button type="button" className="pp-btn" onClick={() => setEditing(sel)}><Pencil size={14} />{t('projects.editInfo')}</button>
                <button type="button" className="pp-btn" onClick={() => void copyProject(sel.id)}><Copy size={14} />{t('projects.duplicate')}</button>
                <button type="button" className="pp-icon-btn is-danger" title={t('projects.delete')} onClick={() => void confirmDelete(sel)}><Trash2 size={15} /></button>
              </div>
            </header>
            <section>
              <h3 className="pb-h">{t('projects.charts')} <span className="pp-muted">{sel.charts.length}</span></h3>
              <div className="pc-charts">
                {sel.charts.map((c) => {
                  const up = chartStatus(c) === 'uploaded';
                  return (
                    <div key={c.id} className="pc-chart">
                      <span className="pc-chart__diff" style={{ background: DIFF_COLORS[c.diff] }}>{DIFF_NAMES[c.diff]}<b>{c.level ?? '–'}</b></span>
                      <span className="pc-chart__title">
                        <b>{effectiveTitle(sel, c)}</b>
                        <small className="pp-muted">{t('projects.notesMeta', { count: countChartNotes(c.notes), time: relTime(c.lastModified) })}</small>
                      </span>
                      <StatusBadge chart={c} />
                      <span className="pc-chart__actions">
                        <button type="button" className="pp-btn pp-btn--sm" onClick={() => void openWorkspace(sel.id, c.id)}>
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
                          onClick={() => void mutate(sel.id, (p) => duplicateChartInProject(p, c.id, { chartId: newChartId(), now: Date.now() }, untitled()))}
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          type="button"
                          className="pp-icon-btn is-danger"
                          title={t('projects.deleteChart')}
                          onClick={() => {
                            if (!window.confirm(t('projects.deleteChartConfirm'))) return;
                            void mutate(sel.id, (p) => {
                              const result = deleteChartFromProject(p, c.id);
                              if (!result.ok) {
                                window.alert(t('projects.deleteLastChart'));
                                return null;
                              }
                              return result.project;
                            });
                          }}
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
        {dialogs}
      </div>
    );
  }

  return (
    <div className="pm-root">
      <ProjectStartView list={list} resume={resume} currentId={projectId} onDetail={setDetailId} onOpen={openWorkspace} onNew={setNewSource} projectMenu={projectMenu} />
      {dialogs}
    </div>
  );
}

function ProjectStartView({
  list, resume, currentId, onDetail, onOpen, onNew, projectMenu,
}: {
  list: ChartProject[];
  resume?: ChartProject;
  currentId: string | null;
  onDetail: (id: string) => void;
  onOpen: (id: string, chartId?: string) => void;
  onNew: (src: NewSource) => void;
  projectMenu: (p: ChartProject) => ReactNode;
}) {
  return (
    <div className="pb-page">
      {resume && (
        <section className="pb-hero">
          <Cover project={resume} size={120} />
          <div className="pb-hero__body">
            <span className="pp-eyebrow">{t('projects.resume')}</span>
            <h2>
              {displayName(resume)}
              <button type="button" className="pb-hero__detail" onClick={() => onDetail(resume.id)}>{t('projects.detailLink')}</button>
            </h2>
            <p className="pp-muted">{resume.artist ?? t('projects.artistMissing')} · {t('projects.lastOpened', { time: relTime(resume.lastOpened) })}</p>
            <div className="pb-hero__charts">
              {resume.charts.map((c) => (
                <button key={c.id} type="button" className="pb-chart-btn" onClick={() => onOpen(resume.id, c.id)}>
                  <span className="pp-pill__diff" style={{ background: DIFF_COLORS[c.diff] }}>{DIFF_SHORT[c.diff]}</span>
                  {effectiveTitle(resume, c) !== displayName(resume) && <span>{c.title}</span>}
                  <StatusBadge chart={c} />
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="pp-btn pp-btn--primary pp-btn--lg pb-hero__go" onClick={() => onOpen(resume.id)}>
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
        <h3 className="pb-h">{t('projects.allProjects')} <span className="pp-muted">{list.length}</span></h3>
        <div className="pb-grid">
          {list.map((p) => (
            <div key={p.id} className={`pb-card${p.id === currentId ? ' is-current' : ''}`} onClick={() => onDetail(p.id)}>
              <div className="pb-card__cover">
                <Cover project={p} size={172} />
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
              <b className={p.name ? '' : 'pp-muted'}>{displayName(p)}</b>
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
      </section>
    </div>
  );
}
