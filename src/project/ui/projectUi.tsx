// 工程管理页与工作台共用的轻量 UI 碎片（状态图标、菜单项、展示名）。
import type { ReactNode } from 'react';
import { Check, Circle, Upload } from 'lucide-react';
import type { ChartDifficulty, ProjectChart } from '../ChartProject';
import { chartEffectiveTitle, DIFF_NAMES, projectDisplayName } from '../projectCatalog';
import { chartStatus } from '../workspaceProject';
import { t } from '../../i18n';

export function untitledProjectLabel(): string {
  return t('projects.untitled');
}

export function displayProjectName(project: { name: string | null }): string {
  return projectDisplayName(project.name, untitledProjectLabel());
}

/**
 * 音频锁定的宾语（票 15 定案 6）：把"是哪几张已上传谱面锁的"拼成人话。
 *
 * 只写"音频与时长已锁定"用户没法判断能不能救——得点名。参数用**结构类型**而不是
 * `ProjectAudioLockSource`：这样工程管理页能直接喂 `ProjectChart`（字段是超集），
 * 音频页喂接缝给的锁源，两边共用一个格式化，不必为它加一层 import 关系。
 */
export function lockedChartLabels(
  projectName: string | null,
  charts: { title: string | null; diff: ChartDifficulty; level: number | null }[],
): string {
  return charts
    .map((c) => {
      const title = chartEffectiveTitle(projectName, c.title, untitledProjectLabel());
      const meta = c.level == null ? DIFF_NAMES[c.diff] : `${DIFF_NAMES[c.diff]} ${c.level}`;
      return `${title}（${meta}）`;
    })
    .join(t('list.separator'));
}

export function ChartStatusIcon({ chart, size = 12 }: { chart: ProjectChart; size?: number }) {
  const s = chartStatus(chart);
  if (s === 'uploaded') return <Upload size={size} className="pp-st pp-st--uploaded" />;
  if (s === 'completed') return <Check size={size} className="pp-st pp-st--completed" />;
  return <Circle size={size - 2} className="pp-st pp-st--unfinished" />;
}

export function ProjectMenuItem({ icon, label, onClick, danger, disabled, note }: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <button
      type="button"
      className={`pp-menu__item${danger ? ' is-danger' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}<span>{label}</span>{note && <em>{note}</em>}
    </button>
  );
}
