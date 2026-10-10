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
  type OpeningInput,
  type PanelSceneInput,
  type PreviewMode,
  type SheetHeaderInput,
  type SimPlaybackAudio,
  type SimScene,
} from '../../preview';
import { countChartNotes } from '../../chart/editing/NoteEditing';
import { getBpmEvents } from '../../audio/AudioTiming';
import {
  chartEffectiveTitle,
  DIFF_COLORS,
  DIFF_NAMES,
  DIFF_SHORT,
  projectCoverHue,
} from '../../project/projectCatalog';
import { untitledProjectLabel } from '../../project/ui/projectUi';
import { t, type MessageKey } from '../../i18n';
import PreviewChartSwitcher from './PreviewChartSwitcher';
import PreviewStaticToolbar, { PreviewEnterFullscreenButton, PreviewExitFullscreenButton } from './PreviewStaticToolbar';
import PreviewDisplayPanel from './PreviewDisplayPanel';
import PreviewVideoStage from './PreviewVideoStage';
import VideoExportControl from './VideoExportControl';
import { usePreviewScope } from './usePreviewScope';
import { useVideoExport, exportDoneText } from './useVideoExport';
import './PreviewPage.css';

// 页头的模式切换（静态 / 动态）：两项互斥的"这一屏画什么"（ADR-0007 §6 四题之"有且单组"）
const PREVIEW_MODES: { id: PreviewMode; labelKey: MessageKey; icon: typeof Images }[] = [
  { id: 'static', labelKey: 'preview.mode.static', icon: Images },
  { id: 'video', labelKey: 'preview.mode.video', icon: Clapperboard },
];

export default function PreviewPage({ active = true }: { active?: boolean }) {
  const { setActivePage } = useAppNav();
  const { settings, setAudioVolume, setExport } = useConfig();
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
  //
  // 换档那一拍要**抑制过渡**：舞台底色与台上配色（`--stage-*`）都是"同一帧里前后两个值"，
  // 而播放条 / 图标钮自己带 hover 那套 `transition`（如 `.play-bar__play-btn` 的 `background-color`
  // 160ms）⇒ 不管的话，亮主题那块不透明的浅色方块会在黑影里淡出约 180ms（2026-10-08 用户：
  // "闪一下，先保持亮色，最终回到暗色"）。点下钮就挂上类（**先于** `requestFullscreen`，
  // 保证全屏第一帧就是台上配色），换档画完两帧再摘；Esc 那类"从别处退出"在事件里补挂一次
  // —— 把已经在跑的过渡掐掉，最坏只剩一帧。
  const suppressStageTransition = useCallback((on: boolean) => {
    stageRef.current?.classList.toggle('is-palette-swap', on);
  }, []);

  const releaseStageTransition = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => suppressStageTransition(false)));
  }, [suppressStageTransition]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === stageRef.current);
      suppressStageTransition(true);
      releaseStageTransition();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [suppressStageTransition, releaseStageTransition]);

  const toggleFullscreen = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    suppressStageTransition(true);
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => releaseStageTransition());
      return;
    }
    // 被拒 / 不可用（如 iframe 未授权）也别把类留在身上
    void stage.requestFullscreen?.().catch(() => releaseStageTransition());
  }, [suppressStageTransition, releaseStageTransition]);

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

  // 动态形态要画的那份谱面（票 05）：仿真场的画面输入 = 谱面 + 作者设置（音符速度 / 镜向两档来自
  // `settings.preview`，其余是画布共享项 `settings.display`——与静态预览同一份数据）
  const videoScene = useMemo<SimScene | null>(() => {
    if (!project || !chart || chart.notes.length === 0) return null;
    return {
      notes: chart.notes,
      beatDisplay,
      noteSpeed: settings.preview.noteSpeed,
      noteSize: settings.display.noteSize,
      slideOpacity: settings.display.slideOpacity,
      simultaneousClickLines: settings.display.simultaneousClickLines,
      colorAssist: settings.display.colorAssist,
      mirror: settings.preview.mirror,
    };
  }, [project, chart, settings.display, settings.preview, beatDisplay]);

  // 仿真场的声源 = **作用域工程**自己的音频（票 05 定案：仿真场自持引擎；作用域切到非当前工程也有声）
  const videoAudio = useMemo<SimPlaybackAudio | null>(
    () => (project?.audioBlob ? { name: project.audioName ?? 'audio', blob: project.audioBlob } : null),
    [project?.audioBlob, project?.audioName],
  );

  // 导出档的排布结论（跟预览当前缩放无关）：按钮 tooltip 说清要落多大一张图 / 为什么出不了。
  // 头带开关要进依赖：关掉它图就矮一截，预告尺寸必须跟着变（与实际出图同一份 `planSheet`）。
  const exportPlan = useMemo(
    () => (scene ? planSheet(scene, settings.export.enabled).plan : null),
    [scene, settings.export.enabled],
  );

  // 动态形态的导出（chart-preview 07）：文件名基础名与静态那一支同一条规则，扩展名按当选容器补
  const videoExportName = useMemo(() => {
    if (chart == null) return '';
    const title = chartEffectiveTitle(project?.name ?? null, chart.title, untitledProjectLabel());
    return t('preview.video.export.filename', { title, diff: DIFF_SHORT[chart.diff] });
  }, [chart, project?.name]);

  /**
   * 视频导出的状态机（规格 / 进度 / 取消 / 失败态）。
   * 音量口径与播放一致：`settings.audio.volume`（主音量）+ `settings.audio.seVolume`（SE）。
   */
  /**
   * 视频开场的**数据面**（chart-preview 30）：与静态那支的 `SheetHeaderInput` 同口径 ——
   * 页面组装、难度色 / 封面色相由页面算好传进去（preview 域不 import 工程域）。
   * 总开关关掉 ⇒ 传 `null`（第 0 帧即谱面 0 秒、总长 = 谱面时长）。
   */
  const openingInput = useMemo<OpeningInput | null>(() => {
    if (chart == null || !settings.export.opening.enabled) return null;
    return {
      title: chartEffectiveTitle(project?.name ?? null, chart.title, untitledProjectLabel()),
      difficultyName: DIFF_NAMES[chart.diff].toUpperCase(),
      difficultyColor: DIFF_COLORS[chart.diff],
      artist: project?.artist ?? '',
      cover: project?.coverBlob ?? null,
      coverHue: projectCoverHue(project?.id ?? chart.id),
      items: settings.export.opening.items,
    };
  }, [chart, project, settings.export.opening]);

  const videoExport = useVideoExport({
    scene: videoScene,
    audio: videoAudio,
    durationSeconds: project?.durationSeconds ?? 0,
    keySetId: settings.audio.keySet,
    seVolume: settings.audio.seVolume,
    volume: settings.audio.volume,
    noteSkin: settings.visual?.noteSkin ?? {},
    suggestedBaseName: videoExportName,
    opening: openingInput,
  });

  const handleVideoExport = useCallback(async () => {
    const outcome = await videoExport.start();
    if (outcome?.ok === true && !outcome.cancelled) {
      // 说清落盘的是哪一格（容器 + 实际 codec），别只说"导出了"
      showToast(exportDoneText(outcome), 'success');
    }
  }, [videoExport]);

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
        // 难度 chip 用工程里那一份难度色（EZ/NM/HD/EX/SP 各一色）——preview 域不 import 工程域，
        // 由页面按 `coverHue` 的同款口径传进去
        difficultyColor: DIFF_COLORS[chart.diff],
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
    // 票 19（用户 2026-10-07 定案）：动态形态把页面留白再收一档，把那点高度让给场地
    // （场地按设计面 contain，横向空白是它自己的事）。
    <div className={`preview-page${mode === 'video' ? ' is-video' : ''}`}>
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
            {/* 显示控件直接贴右缘：不再套胶囊外壳（2026-10-02 用户验收：外壳多余，还白占一条高度）。
                两种形态各用自己那一排：静态 = 缩放 + 设置 + 导出 + 全屏；
                动态 = 设置 + 全屏（chart-preview 20：全屏钮在舞台层是形态无关的，补一枚即可；
                **导出仍不给入口** —— 动态形态的导出是 07 的视频导出，随它落地，见 07 Comments）。 */}
            {!fullscreen && (
              mode === 'static' ? (
                <PreviewStaticToolbar
                  zoom={zoom}
                  onZoom={setZoom}
                  exporting={exporting}
                  onExport={() => void handleExport()}
                  exportPlan={exportPlan}
                  onEnterFullscreen={toggleFullscreen}
                />
              ) : (
                <div className="preview-controls">
                  <PreviewDisplayPanel mode="video" />
                  {/* 导出（07）：票 20 定案，动态形态工具栏的这一枚随视频导出落地；全屏在末位 */}
                  <VideoExportControl
                    disabled={videoScene == null}
                    spec={videoExport.spec}
                    opening={settings.export.opening}
                    onOpeningChange={(patch) => setExport({ opening: patch })}
                    onSpecChange={videoExport.setSpec}
                    onStart={() => void handleVideoExport()}
                    onCancel={videoExport.cancel}
                    progress={videoExport.progress}
                    notice={videoExport.notice}
                    support={videoExport.support}
                    probing={videoExport.probing}
                    onProbe={videoExport.probe}
                  />
                  <PreviewEnterFullscreenButton onEnter={toggleFullscreen} />
                </div>
              )
            )}
          </div>
          {/* 舞台：两种形态的画面（03 静态 / 05 仿真场）。画面未接时不静默空白。 */}
          <div
            ref={stageRef}
            className={`preview-stage${(mode === 'static' && scene) || (mode === 'video' && videoScene) ? ' is-filled' : ''}`}
            data-mode={mode}
          >
            {mode === 'static' && scene ? (
              <StaticPreviewView scene={scene} zoom={zoom} markers={settings.preview} onZoom={setZoom} />
            ) : mode === 'video' && videoScene ? (
              <PreviewVideoStage
                active={active}
                scene={videoScene}
                duration={project?.durationSeconds ?? 0}
                audio={videoAudio}
                keySetId={settings.audio.keySet}
                seVolume={settings.audio.seVolume}
                volume={settings.audio.volume}
                onVolumeChange={setAudioVolume}
                imageQuality={settings.display.imageQuality}
                noteSkin={settings.visual?.noteSkin ?? {}}
                // 空格（play）页面级接管（issue 22 Q2）：配置从设置域取，预览条那层不直读 context
                shortcuts={settings.shortcuts}
              />
            ) : (
              <p className="preview-stage__pending">
                {t(mode === 'static' ? 'preview.static.empty' : 'preview.video.empty')}
              </p>
            )}
            {/* 浮层**不看画面**（issue 12）：谱面没音符时也要有出口 —— 否则全屏下除 Esc 无路可走 */}
            {fullscreen && (
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
