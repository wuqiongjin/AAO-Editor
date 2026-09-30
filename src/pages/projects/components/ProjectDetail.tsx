// 工程详情视图（原 ProjectsPage.tsx 的 detail 分支整块抽出，内部未再拆）。
import type { CSSProperties, ReactNode } from 'react';
import { Copy, Eye, Lock, Music2, Pencil, Play, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { newChartId, type ChartProject, type ProjectChart } from '../../../project/ChartProject';
import {
  DIFF_COLORS,
  DIFF_SHORT,
  duplicateChartInProject,
  toggleChartCompleted,
  updateChartInfo,
} from '../../../project/projectCatalog';
import { chartStatus } from '../../../project/workspaceProject';
import {
  displayProjectName,
  lockedChartLabels,
  untitledProjectLabel,
} from '../../../project/ui/projectUi';
import { countChartNotes } from '../../../chart/editing/NoteEditing';
import { t } from '../../../i18n';
import { effectiveTitle, formatDuration, relTime, sourceLabel } from '../projectFormat';
import ProjectListSplit from '../ProjectListSplit';
import { Cover, DiffLevelBadge, StatusBadge } from './ProjectBits';

export function ProjectDetail({
  list, sel, currentId, listWidth, onListWidthChange, newButton,
  onHome, onSelect, onOpen, onEdit, onCopy, onDelete, onChartForm, onDeleteChart, onOpenAudio, onPreviewChart, mutate,
}: {
  list: ChartProject[];
  sel: ChartProject;
  currentId: string | null;
  listWidth: number;
  onListWidthChange: (width: number) => void;
  newButton: ReactNode;
  onHome: () => void;
  onSelect: (id: string) => void;
  onOpen: (id: string, chartId?: string) => void;
  onEdit: (p: ChartProject) => void;
  onCopy: (id: string) => void;
  onDelete: (p: ChartProject) => void;
  onChartForm: (v: { project: ChartProject; chart: ProjectChart | null }) => void;
  onDeleteChart: (v: { project: ChartProject; chart: ProjectChart }) => void;
  /** 跳音频页（带作用域）——作用域对象由页面侧构造，这里只负责触发 */
  onOpenAudio: () => void;
  /** 跳预览页（带作用域二级 chartId，chart-preview 02）——同上，作用域由页面侧构造 */
  onPreviewChart: (chartId: string) => void;
  mutate: (id: string, fn: (p: ChartProject) => ChartProject | null) => Promise<void>;
}) {
  const uploads = sel.charts.filter((c) => c.upload);
  const locked = uploads.length > 0;
  return (
    <div className="pc-page" style={{ '--pc-list-w': `${listWidth}px` } as CSSProperties}>
      <aside className="pc-list">
        <div className="pc-list__head">
          <button type="button" className="pp-btn pp-btn--sm" onClick={onHome}>{t('projects.home')}</button>
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
              onClick={() => onSelect(p.id)}
              onDoubleClick={() => void onOpen(p.id)}
            >
              <Cover project={p} size={36} />
              <span className="pc-item__text">
                <b className={p.name ? '' : 'pp-muted'}>
                  {displayProjectName(p)}
                  {p.id === currentId && <em className="pp-current-tag">{t('projects.current')}</em>}
                </b>
                <small className="pp-muted">{t('projects.doneRatio', { done, n, time: relTime(p.lastOpened) })}</small>
              </span>
              <span className="pc-item__bar"><span style={{ width: `${n ? (done / n) * 100 : 0}%` }} /></span>
            </button>
          );
        })}
      </aside>
      <ProjectListSplit width={listWidth} onChange={onListWidthChange} />
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
                onClick={onOpenAudio}
              >
                <SlidersHorizontal size={12} />{t('audio.jumpManage')}
              </button>
            </p>
          </div>
          {/* 动作组**一行**：主行动「在工作台打开」在最左，其后编辑 / 复制 / 删除，整体贴右缘。
              保持原有一行的排列（用户 2026-09-28 二轮："这个东西就应该固定在一个位置"，
              指位置稳定而不是拆成两行——稳定性改由 CSS 的**固定高度锚**保证，见 `.pc-detail__actions`）。 */}
          <div className="pc-detail__actions">
            <button type="button" className="pp-btn pp-btn--primary" onClick={() => void onOpen(sel.id)}>
              <Play size={14} />{t('projects.openInWorkspace')}
            </button>
            <button type="button" className="pp-btn" onClick={() => onEdit(sel)}><Pencil size={14} />{t('projects.editInfo')}</button>
            <button type="button" className="pp-btn" onClick={() => void onCopy(sel.id)}><Copy size={14} />{t('projects.duplicate')}</button>
            <button type="button" className="pp-icon-btn is-danger" title={t('projects.delete')} onClick={() => onDelete(sel)}><Trash2 size={15} /></button>
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
                    <button type="button" className="pp-btn pp-btn--sm" onClick={() => void onOpen(sel.id, c.id)}>
                      <Play size={12} />{t('projects.open')}
                    </button>
                    {/* 预览入口（ADR-0016 §4）：带作用域跳到预览页的这一张谱面，当前工程不被切走 */}
                    <button type="button" className="pp-btn pp-btn--sm" onClick={() => onPreviewChart(c.id)}>
                      <Eye size={12} />{t('projects.previewChart')}
                    </button>
                    <button
                      type="button"
                      className="pp-btn pp-btn--sm"
                      disabled={up}
                      onClick={() => void mutate(sel.id, (p) => toggleChartCompleted(p, c.id, Date.now()))}
                    >
                      {c.completed ? t('projects.unmarkComplete') : t('projects.markComplete')}
                    </button>
                    <button type="button" className="pp-icon-btn" title={t('projects.editChart')} onClick={() => onChartForm({ project: sel, chart: c })}><Pencil size={14} /></button>
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
                      onClick={() => onDeleteChart({ project: sel, chart: c })}
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="pc-add">
            <button type="button" className="pp-btn" onClick={() => onChartForm({ project: sel, chart: null })}>
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
  );
}
