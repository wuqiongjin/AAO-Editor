// 「新建工程」分裂钮（主行动 + 下拉：空白 / 复制 / 官方 / 社区）。
// 原内联在 ProjectsPage 里，architecture-refactor 01 拆解后两个视图的页头挂的是同一枚
// ReactNode——抽成组件留在页面目录，两个视图零改动，页面只传三个参数。
import type { ReactNode } from 'react';
import { ChevronDown, Copy, FolderPlus, Music4, Plus, Users } from 'lucide-react';
import { t } from '../../../i18n';
import { ProjectMenuItem } from '../../../project/ui/projectUi';
import { Menu } from './ProjectBits';
import type { NewSource } from './ProjectDialogs';

export function NewProjectButton({
  onNew, canCopy, importSources = false,
}: {
  onNew: (src: NewSource) => void;
  /** 有工程才许「以旧工程为模板」（复制要选源）——0 工程时该格禁用 */
  canCopy: boolean;
  /** 有没有社区平台出口（静态演示版没有）：决定官方 / 社区两格露不露 */
  importSources?: boolean;
}): ReactNode {
  return (
    <span className="pp-split">
      <button type="button" className="pp-btn pp-btn--primary" onClick={() => onNew('blank')}>
        <Plus size={15} />{t('projects.newProject')}
      </button>
      <Menu trigger={<button type="button" className="pp-btn pp-btn--primary pp-split__caret"><ChevronDown size={15} /></button>}>
        <ProjectMenuItem icon={<FolderPlus size={14} />} label={t('projects.newBlank')} onClick={() => onNew('blank')} />
        <ProjectMenuItem icon={<Copy size={14} />} label={t('projects.newCopy')} onClick={() => onNew('copy')} disabled={!canCopy} />
        {importSources && (
          <>
            <ProjectMenuItem icon={<Music4 size={14} />} label={t('projects.newOfficial')} onClick={() => onNew('official')} />
            <ProjectMenuItem icon={<Users size={14} />} label={t('projects.newCommunity')} onClick={() => onNew('community')} />
          </>
        )}
      </Menu>
    </span>
  );
}
