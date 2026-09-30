// 预览页（ADR-0016 §1 / §4；chart-preview 02 壳 + 03 静态预览）：独立应用页面，作用于「工程 + 谱面」。
//
// 本页是**装配层**：页面头 + 模式侧栏 + 工具栏行（谱面切换 + 模式控件 + 作用域条）+ 舞台。
// 静态形态的画面与控件来自 `src/preview/static`（面板折行 + 显示档 + 宽图导出）；
// 动态形态（05 仿真场）接同一行工具栏与同一块舞台。
// 本页不 ensure 当前工程：没有作用对象就空态，不因此新建 / 打开工程（与音频页同口径，§4）。
import { useCallback, useMemo, useState } from 'react';
import { Clapperboard, FolderOpen, Images } from 'lucide-react';
import AppPageShell from '../../layouts/AppPageShell';
import EmptyState from '../../ui/EmptyState';
import ScopePicker from '../../ui/ScopePicker';
import { showToast } from '../../ui/Toast';
import { useAppNav } from '../../layouts/AppNav';
import { useConfig, useUI } from '../../app/ProviderTree';
import {
  DEFAULT_PREVIEW_PROFILE,
  StaticPreviewView,
  exportSheetAs,
  planSheet,
  type PanelSceneInput,
  type PreviewDisplayProfile,
  type PreviewMode,
} from '../../preview';
import { chartEffectiveTitle, DIFF_SHORT } from '../../project/projectCatalog';
import { untitledProjectLabel } from '../../project/ui/projectUi';
import { t, type MessageKey } from '../../i18n';
import PreviewChartSwitcher from './PreviewChartSwitcher';
import PreviewStaticToolbar from './PreviewStaticToolbar';
import { usePreviewScope } from './usePreviewScope';
import './PreviewPage.css';

// 单组平铺（不多分组）：只有两项，且两者是互斥的"这一屏画什么"（ADR-0007 §6 四题之"有且单组"）
const PREVIEW_MODES: { id: PreviewMode; labelKey: MessageKey; icon: typeof Images }[] = [
  { id: 'static', labelKey: 'preview.mode.static', icon: Images },
  { id: 'video', labelKey: 'preview.mode.video', icon: Clapperboard },
];

export default function PreviewPage({ active = true }: { active?: boolean }) {
  const { setActivePage } = useAppNav();
  const { settings } = useConfig();
  const { beatDisplay } = useUI();
  const [mode, setMode] = useState<PreviewMode>('static');
  const { scopeId, currentId, project, options, loading, chartId, pickChart } = usePreviewScope(active);

  // 静态预览的看谱档（页面内 state，不落设置）：缩放 / 叠加项 / 导出进行中
  const [zoom, setZoom] = useState<number>(1);
  const [profile, setProfile] = useState<PreviewDisplayProfile>(DEFAULT_PREVIEW_PROFILE);
  const [exporting, setExporting] = useState(false);

  // 选作用域 = 带作用域重新激活本页（票 22 定案 2）。选中的就是当前工程时写 null 而不是
  // { projectId: currentId }：语义上"没有显式作用域"，解析出的作用对象相同但更干净（照音频页）。
  // 顺带丢掉谱面二级：旧的二级属于旧工程，换工程后由本页按新工程重新解析。
  const pickScope = useCallback((projectId: string) => {
    setActivePage('preview', { scope: projectId === currentId ? null : { projectId } });
  }, [setActivePage, currentId]);

  // 作用域条的名字取**选项**（与作用域无关的那份全量列表）而不是 `project`：换作用域时记录还在路上，
  // 靠记录会让作用域条断档一个 tick，而"此刻作用于谁"正是它要一直说的事（照音频页）。
  const scopeOption = scopeId == null ? null : options.find((o) => o.id === scopeId) ?? null;

  // 这一屏在看的那张谱面（渲染只读它：预览不改谱面，也不进编辑会话）
  const chart = useMemo(() => project?.charts.find((c) => c.id === chartId) ?? null, [project, chartId]);

  // 要画的那份谱面（画面与导出共用同一份字段定义）：没有谱面 / 没有音符 → null（走空态）
  const scene = useMemo<PanelSceneInput | null>(() => {
    if (!project || !chart || chart.notes.length === 0) return null;
    return {
      notes: chart.notes,
      chartDuration: project.durationSeconds,
      verticalRatio: settings.display.verticalRatio,
      beatDisplay,
      settingsDisplay: settings.display,
      noteSkin: settings.visual?.noteSkin ?? {},
    };
  }, [project, chart, settings.display, settings.visual?.noteSkin, beatDisplay]);

  // 导出档的排布结论（跟预览当前缩放无关）：按钮 tooltip 说清要落多大一张图 / 为什么出不了
  const exportPlan = useMemo(() => (scene ? planSheet(scene).plan : null), [scene]);

  const handleExport = useCallback(async () => {
    if (scene == null || chart == null || exporting) return;
    setExporting(true);
    try {
      const title = chartEffectiveTitle(project?.name ?? null, chart.title, untitledProjectLabel());
      const outcome = await exportSheetAs({
        scene,
        suggestedName: t('preview.static.exportFilename', { title, diff: DIFF_SHORT[chart.diff] }),
      });
      if (!outcome.ok) {
        // 尺寸越画布上限且降密度也救不了：说清原因，不画爆
        showToast(`${t('preview.static.exportFailed')}：${outcome.plan.detail}`, 'danger');
        return;
      }
      if (outcome.cancelled) return;
      showToast(
        outcome.plan.downscaled ? t('preview.static.exportDownscaled') : t('preview.static.exportDone'),
        outcome.plan.downscaled ? 'warn' : 'success',
      );
    } catch (err) {
      console.error('[preview] 导出宽图失败', err);
      showToast(t('preview.static.exportFailed'), 'danger');
    } finally {
      setExporting(false);
    }
  }, [scene, chart, exporting]);

  return (
    <AppPageShell>
      <AppPageShell.Header
        eyebrow={t('preview.header.eyebrow')}
        title={t('preview.header.title')}
        description={t('preview.header.description')}
      />

      <AppPageShell.Sidebar ariaLabel={t('preview.sidebar.aria')}>
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
            {/* 工具栏行：左 = 这一屏在看哪张谱面 + 模式控件（03 静态 / 05 仿真场注入同一行），
                右 = 这一页作用于哪个工程。作用域条放这里而不是侧栏（2026-09-30 用户验收）。 */}
            <div className="preview-toolbar">
              <PreviewChartSwitcher project={project} chartId={chartId} onPick={pickChart} />
              {mode === 'static' && (
                <PreviewStaticToolbar
                  zoom={zoom}
                  onZoom={setZoom}
                  profile={profile}
                  onProfile={setProfile}
                  exporting={exporting}
                  onExport={() => void handleExport()}
                  exportPlan={exportPlan}
                />
              )}
              {scopeOption && scopeId != null && (
                <ScopePicker
                  scopeId={scopeId}
                  currentId={currentId}
                  scopeName={scopeOption.name}
                  options={options}
                  onPick={pickScope}
                />
              )}
            </div>
            {/* 舞台：两种形态的画面（03 静态 / 05 仿真场）。画面未接时不静默空白。 */}
            <div
              className={`preview-stage${mode === 'static' && scene ? ' is-filled' : ''}`}
              data-mode={mode}
            >
              {mode === 'static' && scene ? (
                <StaticPreviewView scene={scene} zoom={zoom} profile={profile} />
              ) : (
                <p className="preview-stage__pending">
                  {t(mode === 'static' ? 'preview.static.empty' : 'preview.video.pending')}
                </p>
              )}
            </div>
          </>
        )}
      </AppPageShell.Body>
    </AppPageShell>
  );
}
