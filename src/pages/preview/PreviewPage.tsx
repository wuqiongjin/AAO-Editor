// 预览页（ADR-0016 §1 / §4；chart-preview 02）：独立应用页面，作用于「工程 + 谱面」。
//
// 本票只交**壳**：页面头 + 模式侧栏 + 工具栏宿主 + 作用域条 + 谱面切换 + 空态。
// 两种形态的画面分别由 03（静态面板折行）与 05（仿真场）注入工具栏与舞台；
// 本页不 ensure 当前工程：没有作用对象就空态，不因此新建 / 打开工程（与音频页同口径，§4）。
import { useCallback, useState } from 'react';
import { Clapperboard, FolderOpen, Images } from 'lucide-react';
import AppPageShell from '../../layouts/AppPageShell';
import EmptyState from '../../ui/EmptyState';
import ScopePicker from '../../ui/ScopePicker';
import { useAppNav } from '../../layouts/AppNav';
import type { PreviewMode } from '../../preview';
import { t, type MessageKey } from '../../i18n';
import PreviewChartSwitcher from './PreviewChartSwitcher';
import { usePreviewScope } from './usePreviewScope';
import './PreviewPage.css';

// 单组平铺（不多分组）：只有两项，且两者是互斥的"这一屏画什么"（ADR-0007 §6 四题之"有且单组"）
const PREVIEW_MODES: { id: PreviewMode; labelKey: MessageKey; icon: typeof Images }[] = [
  { id: 'static', labelKey: 'preview.mode.static', icon: Images },
  { id: 'video', labelKey: 'preview.mode.video', icon: Clapperboard },
];

export default function PreviewPage({ active = true }: { active?: boolean }) {
  const { setActivePage } = useAppNav();
  const [mode, setMode] = useState<PreviewMode>('static');
  const { scopeId, currentId, project, options, loading, chartId, pickChart } = usePreviewScope(active);

  // 选作用域 = 带作用域重新激活本页（票 22 定案 2）。选中的就是当前工程时写 null 而不是
  // { projectId: currentId }：语义上"没有显式作用域"，解析出的作用对象相同但更干净（照音频页）。
  // 顺带丢掉谱面二级：旧的二级属于旧工程，换工程后由本页按新工程重新解析。
  const pickScope = useCallback((projectId: string) => {
    setActivePage('preview', { scope: projectId === currentId ? null : { projectId } });
  }, [setActivePage, currentId]);

  // 作用域条的名字取**选项**（与作用域无关的那份全量列表）而不是 `project`：换作用域时记录还在路上，
  // 靠记录会让作用域条断档一个 tick，而"此刻作用于谁"正是它要一直说的事（照音频页）。
  const scopeOption = scopeId == null ? null : options.find((o) => o.id === scopeId) ?? null;
  const currentChart = project != null && chartId != null
    ? project.charts.find((c) => c.id === chartId) ?? null
    : null;

  return (
    <AppPageShell>
      <AppPageShell.Header
        eyebrow={t('preview.header.eyebrow')}
        title={t('preview.header.title')}
        description={t('preview.header.description')}
      />

      <AppPageShell.Sidebar ariaLabel={t('preview.sidebar.aria')}>
        {/* 作用域条落在模式切换区**上方**：它说的是"这一页作用于哪个工程"，比"画哪种形态"更外一层 */}
        {scopeOption && scopeId != null && (
          <div className="preview-scope">
            <ScopePicker
              scopeId={scopeId}
              currentId={currentId}
              scopeName={scopeOption.name}
              options={options}
              onPick={pickScope}
            />
          </div>
        )}
        {PREVIEW_MODES.map((m) => (
          <AppPageShell.SidebarItem
            key={m.id}
            icon={m.icon}
            label={t(m.labelKey)}
            active={mode === m.id}
            onClick={() => setMode(m.id)}
          />
        ))}
      </AppPageShell.Sidebar>

      <AppPageShell.Body mode="fill">
        {/* 没有作用对象（没有当前工程，或作用域失效后当前工程也没有）→ 空态。
            不在这里 ensure：进预览页不该顺势新建 / 打开工程（ADR-0016 §4）。 */}
        {scopeId == null || (!loading && project == null) ? (
          // 外面这层只为居中：fill 档正文是 flex column，EmptyState 自己不占满会贴着顶部
          <div className="preview-empty">
            <EmptyState
              icon={FolderOpen}
              title={t('preview.noProjectTitle')}
              description={t('preview.noProjectDescription')}
              primaryAction={{
                label: t('preview.goProjects'),
                onClick: () => setActivePage('projects'),
                icon: FolderOpen,
              }}
            />
          </div>
        ) : (
          <>
            {/* 工具栏宿主：模式无关的控件在这里（谱面切换 = 这一屏看哪张谱面），
                模式相关的控件由 03（静态）/ 05（仿真场）注入同一行。 */}
            <div className="preview-toolbar">
              {project != null && currentChart != null && (
                <PreviewChartSwitcher project={project} chartId={currentChart.id} onPick={pickChart} />
              )}
            </div>
            {/* 舞台：两种形态的画面（03 / 05 接入）。本票只立接缝，画面未接时不静默空白。 */}
            <div className="preview-stage" data-mode={mode}>
              <p className="preview-stage__pending">
                {t(mode === 'static' ? 'preview.static.pending' : 'preview.video.pending')}
              </p>
            </div>
          </>
        )}
      </AppPageShell.Body>
    </AppPageShell>
  );
}
