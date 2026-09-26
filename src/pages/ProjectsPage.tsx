import { lazy, Suspense } from 'react';
import { FolderOpen } from 'lucide-react';
import AppPageShell from '../layouts/AppPageShell';
import EmptyState from '../ui/EmptyState';
import { t } from '../i18n';
import { isProjectsPrototype } from '../prototypes/projects/projectsPrototypeStore';

// 工程管理页（chart-projects 03）：导航与启动落点先挂上；页面本体由 04 做。
// ?prototype=projects 仍挂 04 的活规格原型，不升格为默认入口。
const ProjectsPrototype = lazy(() => import('../prototypes/projects/ProjectsPrototype'));

export default function ProjectsPage() {
  if (isProjectsPrototype()) {
    return (
      <Suspense fallback={null}>
        <ProjectsPrototype />
      </Suspense>
    );
  }
  return (
    <AppPageShell>
      <AppPageShell.Header
        eyebrow={t('projects.header.eyebrow')}
        title={t('projects.header.title')}
        description={t('projects.header.description')}
      />
      <AppPageShell.Body mode="default">
        <EmptyState
          icon={FolderOpen}
          title={t('projects.placeholder.title')}
          description={t('projects.placeholder.description')}
        />
      </AppPageShell.Body>
    </AppPageShell>
  );
}
