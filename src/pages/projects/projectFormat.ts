import type { ChartProject, ProjectChart } from '../../project/ChartProject';
import { chartEffectiveTitle } from '../../project/projectCatalog';
import type { ProjectSortKey } from '../../project/projectSort';
import { chartStatus } from '../../project/workspaceProject';
import { untitledProjectLabel } from '../../project/ui/projectUi';
import { t, tPlural } from '../../i18n';

const M = 60_000;
const H = 3600_000;
const D = 24 * H;

export function effectiveTitle(project: { name: string | null }, chart: { title: string | null }): string {
  return chartEffectiveTitle(project.name, chart.title, untitledProjectLabel());
}

export function relTime(at: number, now = Date.now()): string {
  const delta = now - at;
  if (delta < M) return t('projects.time.justNow');
  if (delta < H) return tPlural('projects.time.minutesAgo', Math.floor(delta / M));
  if (delta < D) return tPlural('projects.time.hoursAgo', Math.floor(delta / H));
  if (delta < 30 * D) return tPlural('projects.time.daysAgo', Math.floor(delta / D));
  return tPlural('projects.time.monthsAgo', Math.floor(delta / (30 * D)));
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 工程时间戳的短标签（issue 37）：卡片副行 / 详情左栏用，跟随排序键——时间戳跟着排序键
 * 换语义（projectTimeAt），不贴标签就是静默切换：用户会看到「2 分钟前才打开过，
 * 怎么显示 5 小时前」，把一个疑惑换成另一个疑惑。hero 用完整标签
 * （projects.lastOpened / projects.lastModified），不经这里。
 */
export function projectTimeTag(key: ProjectSortKey): string {
  return t(key === 'lastModified' ? 'projects.timeTag.lastModified' : 'projects.timeTag.lastOpened');
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
