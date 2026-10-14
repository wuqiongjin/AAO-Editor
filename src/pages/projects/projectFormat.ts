import type { ChartProject, ProjectChart } from '../../project/ChartProject';
import { chartEffectiveTitle } from '../../project/projectCatalog';
import { chartStatus } from '../../project/workspaceProject';
import { untitledProjectLabel } from '../../project/ui/projectUi';
import { t } from '../../i18n';

const M = 60_000;
const H = 3600_000;
const D = 24 * H;

export function effectiveTitle(project: { name: string | null }, chart: { title: string | null }): string {
  return chartEffectiveTitle(project.name, chart.title, untitledProjectLabel());
}

export function relTime(at: number, now = Date.now()): string {
  const delta = now - at;
  if (delta < M) return t('projects.time.justNow');
  if (delta < H) return t('projects.time.minutesAgo', { n: Math.floor(delta / M) });
  if (delta < D) return t('projects.time.hoursAgo', { n: Math.floor(delta / H) });
  if (delta < 30 * D) return t('projects.time.daysAgo', { n: Math.floor(delta / D) });
  return t('projects.time.monthsAgo', { n: Math.floor(delta / (30 * D)) });
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function statusLabel(chart: ProjectChart): string {
  return t(`projects.status.${chartStatus(chart)}` as 'projects.status.unfinished');
}


/** 删除工程的后果行（标题负责问，这里只说会连带删掉什么）。 */
export function deleteProjectNotice(p: ChartProject): string {
  const uploaded = p.charts.filter((c) => c.upload).length;
  const extra = uploaded ? `\n${t('projects.confirmDeleteUploaded', { count: uploaded })}` : '';
  return `${t('projects.confirmDelete', { charts: p.charts.length })}${extra}`;
}
