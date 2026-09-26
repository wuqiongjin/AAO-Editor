// 工程管理页与工作台共用的轻量 UI 碎片（状态图标、菜单项、展示名）。
import type { ReactNode } from 'react';
import { Check, Circle, Upload } from 'lucide-react';
import type { ProjectChart } from '../chart/project/ChartProject';
import { projectDisplayName } from '../chart/project/projectCatalog';
import { chartStatus } from '../chart/project/workspaceProject';
import { t } from '../i18n';

export function untitledProjectLabel(): string {
  return t('projects.untitled');
}

export function displayProjectName(project: { name: string | null }): string {
  return projectDisplayName(project.name, untitledProjectLabel());
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
