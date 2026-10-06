// 预览页（ADR-0016 §1 / §4；chart-preview 02 壳 + 03 静态预览）：独立应用页面，作用于「工程 + 谱面」。
//
// 本页是**装配层**：页头（模式切换）+ 工具栏行（作用域条 + 谱面切换 + 显示控件）+ 舞台。
// 票 10 起**脱离 AppPageShell 自渲染全幅壳**（宽高让给画面）：标题区（eyebrow + 标题）整块撤销，
// 模式切换升为页头独占一行、铺整行下缘分割线（2026-10-02 用户验收，样式变体 D 定案；
// 原型原件留档在 `proto/chart-preview-10-preview-header` 分支）。
// 静态形态的画面与控件来自 `src/preview/static`（面板折行 + 显示档 + 宽图导出）；
// 动态形态（05 仿真场）接同一行工具栏与同一块舞台。
// 本页不 ensure 当前工程：没有作用对象就空态，不因此新建 / 打开工程（与音频页同口径，§4）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, FolderOpen, Images } from 'lucide-react';
import EmptyState from '../../ui/EmptyState';
import ScopePicker from '../../ui/ScopePicker';
import { showToast } from '../../ui/Toast';
import { useAppNav } from '../../layouts/AppNav';
import { useConfig, useUI } from '../../app/ProviderTree';
import {
  DEFAULT_PREVIEW_ZOOM,
  StaticPreviewView,
  exportSheetAs,
  planSheet,
  waitForPaint,
  type PanelSceneInput,
  type PreviewMode,
  type SheetHeaderInput,
} from '../../preview';
import { countChartNotes } from '../../chart/editing/NoteEditing';
import { getBpmEvents } from '../../audio/AudioTiming';
import { chartEffectiveTitle, DIFF_SHORT, projectCoverHue } from '../../project/projectCatalog';
import { untitledProjectLabel } from '../../project/ui/projectUi';
import { t, type MessageKey } from '../../i18n';
import PreviewChartSwitcher from './PreviewChartSwitcher';
import PreviewStaticToolbar, { PreviewExitFullscreenButton } from './PreviewStaticToolbar';
import { usePreviewScope } from './usePreviewScope';
import './PreviewPage.css';

// 页头的模式切换（静态 / 动态）：两项互斥的"这一屏画什么"（ADR-0007 §6 四题之"有且单组"）
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

  // 静态预览的看谱档：缩放 / 全屏是"这一屏怎么看"（页面内 state，不落设置）；
  // 叠加项（BPM / 时间 / 节拍线）落 `settings.preview`、画布共享项落 `settings.display`
  // —— 两者都由「显示」面板直接读写，本页只把 `settings.preview` 转交给画面（chart-preview 08 定案）。
  const [zoom, setZoom] = useState<number>(DEFAULT_PREVIEW_ZOOM);
  const [exporting, setExporting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);

  // 全屏预览：整块舞台进全屏，显示控件那一排随之退场（它太长、压画面），浮层只留一枚退出钮。
  // 缩放不丢：Ctrl/⌘+滚轮仍归 StaticPreviewView；设置 / 导出先退出全屏再做（2026-10-05 定案）。
  // Esc 由浏览器负责退出，`fullscreenchange` 是唯一真相（也管住从别处退出时的状态同步）。
  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => undefined);
      return;
    }
    void stage.requestFullscreen?.().catch(() => undefined);
  }, []);

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

  // 导出档的排布结论（跟预览当前缩放无关）：按钮 tooltip 说清要落多大一张图 / 为什么出不了。
  // 头带开关要进依赖：关掉它图就矮一截，预告尺寸必须跟着变（与实际出图同一份 `planSheet`）。
  const exportPlan = useMemo(
    () => (scene ? planSheet(scene, settings.export.enabled).plan : null),
    [scene, settings.export.enabled],
  );

  const handleExport = useCallback(async () => {
    if (scene == null || chart == null || exporting) return;
    setExporting(true);
    try {
      // 先让「导出中」这一帧真正画出来再开干（issue 16）：出图是同步长任务，同一段微任务链里
      // 直接开干会把它压在按钮首帧之前——表现为按钮先冻住、再直接跳到结束。
      await waitForPaint();
      const title = chartEffectiveTitle(project?.name ?? null, chart.title, untitledProjectLabel());
      // 图文版头带（chart-preview 14）：字段开关读 `settings.export`，封面取工程封面（没有走占位块色相）；
      // 导出时间取**点按那一刻**（不 memo：同一张图重导该是新时间）
      const header: SheetHeaderInput = {
        projectName: project?.name ?? null,
        chartTitle: chart.title,
        difficulty: chart.level == null ? DIFF_SHORT[chart.diff] : `${DIFF_SHORT[chart.diff]} ${chart.level}`,
        durationSeconds: project?.durationSeconds ?? 0,
        noteCount: countChartNotes(chart.notes),
        bpms: getBpmEvents(chart.notes).map((e) => e.bpm),
        exportedAt: Date.now(),
        fields: settings.export,
        cover: project?.coverBlob ?? null,
        coverHue: projectCoverHue(project?.id ?? chart.id),
      };
      const outcome = await exportSheetAs({
        scene,
        header,
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
  }, [scene, chart, exporting, project, settings.export]);

  return (
    // 票 10：自渲染全幅壳（页头 → 工具栏 → 舞台），把宽高让给画面；
    // 原左侧模式侧栏随之撤销，模式切换升为页头（2026-10-02 用户验收）。
    <div className="preview-page">
      {/* 页头 = 模式切换独占一行（2026-10-02 用户验收：标题区整块撤销，模式名即标题）；
          整行下缘分割线是页头级的层次所在（样式变体 D 定案）。 */}
      <header className="preview-header">
        <div className="preview-modes" role="group" aria-label={t('preview.modes.aria')}>
          {PREVIEW_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`preview-modes__btn${mode === m.id ? ' is-active' : ''}`}
              aria-pressed={mode === m.id}
              onClick={() => setMode(m.id)}
            >
              <m.icon size={18} aria-hidden />
              {t(m.labelKey)}
            </button>
          ))}
        </div>
      </header>

      {/* 没有作用对象（没有当前工程，或作用域失效后当前工程也没有）→ 空态。
          不在这里 ensure：进预览页不该顺势新建 / 打开工程（ADR-0016 §4）。 */}
      {scopeId == null || (!loading && project == null) ? (
        // 外面这层只为居中：全幅壳是 flex column，EmptyState 自己不占满会贴着顶部
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
          {/* 工具栏行（票 10 起）：左 = 作用对象（作用于哪个工程 → 在看哪张谱面），
              右 = 显示控件贴右缘，中间不插东西。作用域条放这里而不是侧栏（2026-09-30 用户验收）。 */}
          <div className="preview-toolbar">
            <div className="preview-toolbar__left">
              {scopeOption && scopeId != null && (
                <>
                  <ScopePicker
                    scopeId={scopeId}
                    currentId={currentId}
                    scopeName={scopeOption.name}
                    options={options}
                    onPick={pickScope}
                  />
                  {/* 层级分隔符（2026-10-05 验收，issue 11 #5）："工程 / 谱面"读作一级到二级。
                      纯视觉：aria-hidden，不进可访问名，也不引入点按目标。 */}
                  <span className="preview-toolbar__sep" aria-hidden="true">/</span>
                </>
              )}
              <PreviewChartSwitcher project={project} chartId={chartId} onPick={pickChart} />
            </div>
            {/* 显示控件直接贴右缘：不再套胶囊外壳（2026-10-02 用户验收：外壳多余，还白占一条高度） */}
            {mode === 'static' && !fullscreen && (
              <PreviewStaticToolbar
                zoom={zoom}
                onZoom={setZoom}
                exporting={exporting}
                onExport={() => void handleExport()}
                exportPlan={exportPlan}
                onEnterFullscreen={toggleFullscreen}
              />
            )}
          </div>
          {/* 舞台：两种形态的画面（03 静态 / 05 仿真场）。画面未接时不静默空白。 */}
          <div
            ref={stageRef}
            className={`preview-stage${mode === 'static' && scene ? ' is-filled' : ''}`}
            data-mode={mode}
          >
            {mode === 'static' && scene ? (
              <StaticPreviewView scene={scene} zoom={zoom} markers={settings.preview} onZoom={setZoom} />
            ) : (
              <p className="preview-stage__pending">
                {t(mode === 'static' ? 'preview.static.empty' : 'preview.video.pending')}
              </p>
            )}
            {/* 浮层**不看画面**（issue 12）：谱面没音符时也要有出口 —— 否则全屏下除 Esc 无路可走 */}
            {mode === 'static' && fullscreen && (
              <div className="preview-fs">
                <PreviewExitFullscreenButton onExit={toggleFullscreen} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
