import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Lock, Copy, X } from 'lucide-react';
import WorkspaceTopBar from './WorkspaceTopBar';
import WorkspaceToolRail from './WorkspaceToolRail';
import PatternLibraryDrawer from './PatternLibraryDrawer';
import CurveOptionsCapsule from './CurveOptionsCapsule';
import PatternPastePill from './PatternPastePill';
import './WorkspacePage.css';
import { ChartCodeEditorProvider } from '../../chart/components/code-editor/ChartCodeEditorProvider';
import FinalVirtualCanvas, { type FinalVirtualCanvasHandle } from '../../chart/components/canvas/FinalVirtualCanvas';
import { formatKey, type FunctionId } from '../../settings/ShortcutConfig';
import PlayBar from '../../playback/PlayBar';
import PlaybackMarkerButton from '../../playback/PlaybackMarkerButton';
import { useEditing, useUI, useConfig, usePlayback, useAudioSession, useCurrentProject } from '../../app/ProviderTree';
import { useAudioBridge } from '../../audio/useAudioBridge';
import { useChartViewSession } from '../../playback/useChartViewSession';
import { useChartProjectPersistence } from '../../project/useChartProjectPersistence';
import { useShortcutDispatch } from '../../settings/useShortcutDispatch';
import { resolveEscapeTarget } from '../../chart/editing/CanvasGesture';
import { stepBeatSnap, cycleBeatSnap } from '../../chart/editing/BeatSnap';
import { isChartReadonly, isChartEditFunction } from '../../project/chartReadonlyGate';
import { isProjectAudioLocked } from '../../project/workspaceProject';
import { duplicateChartInProject } from '../../project/projectCatalog';
import { mutateProject } from '../../project/ChartProjectRecord';
import { newChartId, type ChartProject } from '../../project/ChartProject';
import { untitledProjectLabel } from '../../project/ui/projectUi';
import { useAppNav } from '../../layouts/AppNav';
import type { ProjectAudioDeps } from '../../audio/projectAudio';
import AudioAnomalyBanner from './AudioAnomalyBanner';
import { useAudioAnomaly } from './useAudioAnomaly';
import { usePatternLibrary } from '../../patterns/usePatternLibrary';
import { useSaveSelectionPattern } from './useSaveSelectionPattern';
import { t } from '../../i18n';
import { CrashBoundaryHost } from '../../diagnostics/CrashBoundary';

interface EditorProps {
  /** issue 28 页面壳表面契约（Q16）：false 时暂停播放并抑制全局输入 */
  active?: boolean;
}

/**
 * 片段库抽屉开合后的守卫时长（ms）：开合瞬间画布列宽跳变，期间渲染面测量进入实时模式（逐帧提交），
 * 免得合并器节流窗口里画布缓冲被 CSS 拉伸、轨道"瞬间偏宽再回弹"。见 SurfaceSizeMerger.live。
 */
const DRAWER_TOGGLE_GUARD_MS = 320;

/**
 * Editor（架构深化评审候选 2 收口 + 候选 4 收口 + ADR-0003 §7）：只保留【布局 + 分发】职责。
 * 谱面视口装配（渲染面 / 几何 / 滚动重锚 / 播放 RAF）收进 useChartViewSession（候选 4）：
 *   - 谱面视口会话 → useChartViewSession
 *   - 音频桥接     → useAudioBridge
 *   - 持久化       → useChartProjectPersistence
 *   - 快捷键       → useShortcutDispatch
 * 外壳件（票 183）：WorkspaceToolRail / WorkspaceTopBar / PatternLibraryDrawer 各自直读 hooks。
 * 子组件按域直读 hooks；此处只剩：消费四域、串联视口会话与聚焦 hook、布局 JSX。
 */
const Editor: React.FC<EditorProps> = ({ active = true }) => {
  // 四域消费（子组件已按域直读，此处仅取 Editor 串联所需）
  const editing = useEditing();
  const ui = useUI();
  const config = useConfig();
  const playback = usePlayback();

  // issue 73：paste 已从本处移除 —— 粘贴的唯一入口是画布（工具单击 / execPaste），
  // 避免再有一条绕过矩阵、没有末端校验的粘贴通路。
  const { notes, selectedItems, setSelectedItems, clipboard, copy, cut, deleteSelected, mirror, undo, redo, resetNotes, chartCodeFidelity } = editing;
  const { armedTool, setArmedTool, scale, beatDisplay, setBeatDisplay } = ui;
  const { settings, setPatternDrawer } = config;
  const drawerOpen = settings.layout.patternDrawer.open;
  const shortcutConfig = settings.shortcuts;
  const {
    setIsPlaying, setCanPlay,
    setCurrentSeconds,
    duration: ctxDuration, setDuration: setCtxDuration,
    setVolume: setCtxVolume,
    currentSeconds: playheadSeconds,
    // 播放条（issue 22）props 化的数据入口：isPlaying / volume / canPlay 由页面从
    // PlaybackContext 取出后显式传入（组件不再直读 context）——值与旧实现同一份真相源
    isPlaying: ctxIsPlaying,
    volume: ctxVolume,
    canPlay,
    markerSeconds,
    setMarker,
  } = playback;

  // 谱面画布容器 + 画布句柄 ref（候选 4：会话的 DOM 锚点，页面只负责挂到 JSX / 传进会话）
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const virtualCanvasRef = useRef<FinalVirtualCanvasHandle>(null);

  // 渲染面测量实时门控（候选 2 语义原样保留，由会话经 live 注入 useSurfaceSize）：
  // 开合片段库抽屉或拖宽抽屉期间，令测量逐帧提交，使画布缓冲始终贴合容器实时宽度——
  // 否则合并器节流窗口里缓冲被 CSS 拉伸，轨道出现"瞬间偏宽再回弹"。窗口 resize 不触发此门控，保留原节流。
  // 抽屉宽度只注入**用户值**：视口夹取交给 CSS 的 `max-width: 32vw`（issue 87 口径，瞬时生效）。
  const drawerResizingRef = useRef(false);
  const onDrawerResizingChange = useCallback((resizing: boolean) => { drawerResizingRef.current = resizing; }, []);
  const drawerAnimUntilRef = useRef(0);
  useEffect(() => {
    drawerAnimUntilRef.current = performance.now() + DRAWER_TOGGLE_GUARD_MS;
  }, [drawerOpen]);
  const surfaceLive = useCallback(
    () => drawerResizingRef.current || performance.now() < drawerAnimUntilRef.current,
    [],
  );

  // === 音频会话深模块（架构深化评审候选 3 收口） ===
  // session 是单一接缝：拥有 engine + 音频文件 + 时长 + keySet + seVolume + persist 钩子。
  // useAudioSession() 返回 [snapshot, session]，snapshot 驱动响应式，session 调方法。
  const [audioSnap, audioSession] = useAudioSession();
  // 引擎：session 单例，跨页面保活期间不重建
  const engine = audioSession.getEngine();

  // === 谱面视口会话（架构深化评审候选 4 收口） ===
  // 渲染面 / 几何 / 滚动重锚 / 播放 RAF 收进 src/playback/useChartViewSession.ts —— 工作台与
  // 将来的预览页 consume 同一 interface。播放头秒数与播放状态仍写回 PlaybackContext（唯一真相源），
  // 会话不持第二份（见会话头注）。
  const judgeLineOffsetRatio = settings.display.judgeLineOffsetRatio ?? 0;
  const setSessionChartDuration = useCallback((sec: number) => audioSession.setChartDuration(sec), [audioSession]);
  const viewSession = useChartViewSession({
    containerRef: chartAreaRef,
    canvasRef: virtualCanvasRef,
    notes,
    chartDuration: ctxDuration,
    verticalRatio: settings.display.verticalRatio,
    scale,
    engine,
    live: surfaceLive,
    active,
    onSecondsChange: setCurrentSeconds,
    onPlayingChange: setIsPlaying,
    onChartDurationChange: setSessionChartDuration,
    judgeLineOffsetRatio,
  });
  const { surface, geometry, virtualHeight, isPlaying, togglePlay, seek, jumpToMarker, stopPlayback, resetToStart } = viewSession;

  // === 会话流 3：音频桥接（订阅 session 变化，副作用单向写回 PlaybackContext） ===
  // 单一稳定回调：避免 useAudioBridge 内部 useEffect 因新引用反复触发
  const syncChartDuration = useCallback((sec: number) => setCtxDuration(sec), [setCtxDuration]);
  const syncCanPlay = useCallback((v: boolean) => setCanPlay(v), [setCanPlay]);
  const syncIsPlaying = useCallback((v: boolean) => setIsPlaying(v), [setIsPlaying]);
  // Editor 自身不直接消费 audioBridge 桥的回调（音频页已直接调 session）；
  // 此处只为了让桥内部 3 个 effect（chartDuration / canPlay / isPlaying 同步）挂载。
  useAudioBridge({
    session: audioSession,
    onChartDurationChange: syncChartDuration,
    onCanPlayChange: syncCanPlay,
    onIsPlayingChange: syncIsPlaying,
  });
  // 关键：把音频元数据稳定暴露给持久化层（替换旧的 audioMetaRef ref 环）
  // 引用稳定：audioName 和 audioBlob 在 importAudio/clearAudio 时一起变，session 是单例
  const audioForPersist = useMemo(
    () => ({ audioName: audioSnap.audioName, audioBlob: audioSession.getAudioBlob() }),
    [audioSnap.audioName, audioSession],
  );

  const { projectId, chartId, store, catalogEpoch, registerPersistFlush, registerRestoreWaiter, open, notifyCatalogChanged, flushPersist } = useCurrentProject();
  const { setActivePage } = useAppNav();

  // === 33 票：音频资源异常的检测与对齐（工作台 hydrate 路径） ===
  // 丢失（半态）在恢复时判；替换等解码落地（audioLoadGeneration +1）后判。写路径收口
  // projectAudio 接缝（realignProjectAudio / clearProjectAudio force），与音频页同口径。
  const audioAnomalyDeps = useMemo<ProjectAudioDeps>(() => ({
    store,
    currentProjectId: projectId,
    flushPersist,
    notifyCatalogChanged,
  }), [store, projectId, flushPersist, notifyCatalogChanged]);
  const audioAnomaly = useAudioAnomaly({
    projectId,
    deps: audioAnomalyDeps,
    audioDuration: audioSnap.audioDuration,
    audioLoadGeneration: audioSnap.audioLoadGeneration,
    goToAudioPage: useCallback(() => {
      // 重新导入 = 带作用域跳音频页（票 22 既有机制）：不切当前工程，直接去管它的音频
      if (projectId != null) setActivePage('audio', { scope: { projectId } });
    }, [projectId, setActivePage]),
  });

  // === 片段库（issue 185）===
  // 库状态活在页面而不是抽屉里：抽屉可以没开，快捷键照样要能收藏（且不能各持一份整库）。
  const patternLibrary = usePatternLibrary();
  const { canSave: canSaveSelection, save: saveSelection } = useSaveSelectionPattern(patternLibrary);
  // issue 188：抽屉是 memo 组件，回调身份保持稳定，避免播放期 80ms 时间码连带整块重渲
  const handleSaveSelection = useCallback(() => { void saveSelection(); }, [saveSelection]);
  // issue 207：退出粘贴态回调保持稳定，避免播放期 80ms 时间码连带整块重渲（破坏 drawer memo 隔离）
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const handleExitPaste = useCallback(() => {
    if (uiRef.current.patternPaste) uiRef.current.setArmedTool(null);
  }, []);

  const [isReadOnly, setIsReadOnly] = useState(false);
  const [showReadonlyToast, setShowReadonlyToast] = useState(false);
  const readonlyTimerRef = useRef<number | null>(null);

  const triggerReadonlyPrompt = useCallback(() => {
    setShowReadonlyToast(true);
    if (readonlyTimerRef.current) window.clearTimeout(readonlyTimerRef.current);
    readonlyTimerRef.current = window.setTimeout(() => setShowReadonlyToast(false), 6000);
  }, []);

  const handleCopyCurrentChart = useCallback(async () => {
    if (!projectId || !chartId || !store) return;
    const copyId = newChartId();
    // 整记录读-改-写走唯一写入口。这条路径今天不 flush 在飞编辑（已上传谱面只读、本来就没有在飞编辑），
    // 本票只换入口，不改它的 flush 口径。
    const result = await mutateProject(
      { store, notify: notifyCatalogChanged },
      projectId,
      (project) => duplicateChartInProject(project, chartId, { chartId: copyId, now: Date.now() }, untitledProjectLabel()),
    );
    if (result.status !== 'saved') return;
    setShowReadonlyToast(false);
    await open(projectId, copyId);
  }, [projectId, chartId, store, notifyCatalogChanged, open]);

  const isReadOnlyRef = useRef(isReadOnly);
  isReadOnlyRef.current = isReadOnly;
  useEffect(() => {
    editing.setReadonlyGate?.({
      isReadOnly: () => isReadOnlyRef.current,
      onReject: triggerReadonlyPrompt,
    });
    return () => editing.setReadonlyGate?.(null);
  }, [editing, triggerReadonlyPrompt]);

  // 当前工程恢复（ADR-0015 §3）：切工程时整份编辑态换成新工程，剪贴板由 resetNotes 保留。
  const handleProjectRestore = useCallback(async (
    project: ChartProject,
    chart: import('../../project/ChartProject').ProjectChart,
    opts: { restoreAudio: boolean },
  ) => {
    const readonly = isChartReadonly(chart);
    setIsReadOnly(readonly);
    const audioLocked = isProjectAudioLocked(project);
    resetNotes(chart.notes, {
      // 记录的两个扁平字段 → 编辑态的保真字段（映射在边界做，记录形状不变）
      text: chart.appliedChartCodeText ?? null,
      pristine: chart.chartCodePristine === true,
    });
    if (project.durationSeconds > 0) {
      audioSession.setChartDuration(project.durationSeconds);
      setCtxDuration(project.durationSeconds);
    }
    // 无论是切工程还是切谱面，播放进度必须归零、停止播放并清除临时回跳标记
    seek(0);
    // issue 166：视口也要显式归零到 beat 0（ADR-0005 §7）。`seek(0)` 只按**旧几何**写了一帧，
    // 随后到达的新几何会走「按秒重锚」（语义 = 保留当前秒）把视图留在非开头位置；
    // `resetToStart` 在几何/高度落地后再落一次权威值（冷启动首次恢复就是这条路径）。
    resetToStart();
    setMarker(null);
    if (!opts.restoreAudio) {
      audioSession.setAudioLocked(audioLocked);
      return;
    }
    audioSession.hydrateFromProject({
      audioName: project.audioName,
      audioBlob: project.audioBlob,
      durationSeconds: project.durationSeconds,
      audioLocked,
    });
    audioSession.setAudioLocked(audioLocked);
    // 33 票：音频资源异常检测落在 hydrate 路径——丢失（半态）这里就判；
    // 替换等解码落地（会话时长落到音频实际值）后由 useAudioAnomaly 的 effect 判。
    audioAnomaly.noteRestoredProject(project, opts);
  }, [resetNotes, setCtxDuration, audioSession, seek, resetToStart, setMarker, audioAnomaly]);

  // 记录侧音频变更（票 15 定案 8 的不变量）：音频页按作用域直接写了当前工程记录的音频，
  // 而这条路上没有新谱面——所以只把音频重新对齐，不走 handleProjectRestore（它会 resetNotes，
  // 换个音频不该顺手清掉撤销历史）。hydrateFromProject 在无音频时会清空引擎，
  // 「无音频工程 → 引擎必清空」这半条也在里面。
  const handleRecordAudioChanged = useCallback((
    project: import('../../project/ChartProject').ChartProject,
  ) => {
    seek(0);
    resetToStart(); // issue 166：同上，音频换掉后时长会变，视口同样归零到 beat 0
    setMarker(null);
    if (project.durationSeconds > 0) setCtxDuration(project.durationSeconds);
    audioSession.hydrateFromProject({
      audioName: project.audioName,
      audioBlob: project.audioBlob,
      durationSeconds: project.durationSeconds,
      audioLocked: isProjectAudioLocked(project),
    });
    // 33 票：这条路径不是 restore，检测入口得自己调用一次——否则替换信号拿的是换音频之前
    // 那份记录的时长（音频页换完音频就误报「与工程记录不一致」，清除音频则旧横幅赖着不走）。
    audioAnomaly.noteRecordAudioChanged(project);
  }, [audioSession, audioAnomaly, seek, resetToStart, setMarker, setCtxDuration]);

  // === 会话流 6：持久化（当前工程恢复 + 防抖 800ms 落盘） ===
  // 收口点：不再有 audioMetaRef / persistRef ref 环——audioForPersist 是稳定对象，
  // 持久化 hook 的 saveNow 直接注入到 session.setPersistNow。
  const persistence = useChartProjectPersistence({
    projectId,
    chartId,
    catalogEpoch,
    store,
    notes,
    durationSeconds: ctxDuration,
    audioName: audioForPersist.audioName,
    audioBlob: audioForPersist.audioBlob,
    chartCodeFidelity,
    onRestore: handleProjectRestore,
    onRecordAudioChanged: handleRecordAudioChanged,
    registerRestoreWaiter,
  });
  const persistNow = useCallback(() => persistence.saveNow(), [persistence]);
  useEffect(() => {
    audioSession.setPersistNow(persistNow);
  }, [audioSession, persistNow]);
  // persist flush 的注册必须**挂载一次、句柄稳定**（issue 38 复验的注册侧契约）。
  // persistNow 每次渲染都是新闭包（persistence 对象每渲染新建）：按 [persistNow] 依赖注册
  // 会让本 effect 在每次重渲染时先 cleanup（registerPersistFlush(null)）再 setup，而 React
  // 一个 commit 内先跑完整个 cleanup 阶段再跑 setup 阶段，setup 又按树序——工程页在树序里
  // 排在工作台**之前**，于是"回工程页"那一提交里，工程页激活 effect 的 flushPersist() 打到
  // 的是刚被 cleanup 清空的注册柄，在飞防抖笔落不了盘（预览/音频页没踩到，只因它们树序排在
  // 工作台之后、setup 时注册已恢复）。用 ref 包一层最新句柄、依赖只剩稳定的
  // registerPersistFlush：churn 与竞态一并消除（与 registerRestoreWaiter 的稳定注册同范式）。
  const persistNowRef = useRef(persistNow);
  persistNowRef.current = persistNow;
  useEffect(() => {
    registerPersistFlush(() => persistNowRef.current());
    return () => registerPersistFlush(null);
  }, [registerPersistFlush]);

  // 谱面/BPM 变化时同步按键音事件（issue 36：编辑中防抖 300ms；播放中改谱即时）。
  // issue 101：不把 isPlaying 放进 deps——开播翻转本身不得同步跑全谱 getBpmEvents+buildKeyEvents。
  const keysPlayingRef = useRef(isPlaying);
  keysPlayingRef.current = isPlaying;
  useEffect(() => {
    const delay = keysPlayingRef.current ? 0 : 300;
    const t = window.setTimeout(() => engine?.setChart(notes, beatDisplay), delay);
    return () => window.clearTimeout(t);
  }, [notes, beatDisplay, engine]);

  // 画布 onScrollChange / `.virtual-content` 高度写入 / 首次置底 / 比例位回写 / 按秒重锚 /
  // 滚动条回声识别 —— 全部收进谱面视口会话（候选 4，src/playback/useChartViewSession.ts）；
  // 页面只把会话的 onCanvasScrollChange / onScrollbarScroll / virtualHeight 接进下方 JSX。

  // 播放条：音量（架构深化评审候选 3：主音量由 session.setVolume 转发，避免绕过 session；
  // PlaybackContext.volume 仍为 UI 状态，由 setCtxVolume 维护；session 是底层真相源）
  const handleVolumeChange = useCallback((v: number) => {
    setCtxVolume(v);
    audioSession.setVolume(v);
  }, [setCtxVolume, audioSession]);

  // 页面壳表面契约（issue 28 Q16）：工作台失活时自动暂停
  useEffect(() => {
    if (!active) stopPlayback();
  }, [active, stopPlayback]);

  // 删除选中的音符；播放起点通过双击旗标删除，不属于音符选区。
  const deleteSelectedNotes = useCallback(() => {
    if (isReadOnly) {
      triggerReadonlyPrompt();
      return;
    }
    deleteSelected();
  }, [isReadOnly, triggerReadonlyPrompt, deleteSelected]);

  // 在当前光标位置立即粘贴（ADR-0002 §2.1）。
  // 键型执行键（Ctrl+F/G/A/S/D）改走画布 ref 的 execPlace：与单击放置共用 clickOps，
  // 从而自动获得 §2 原则 6（清选区）与 snapPos 的 chartEndBeat 越末端判定
  //（原先走 Editor.place 绕过矩阵，既不清选区、也能在谱面末端外放置）。
  // 候选 3（issue 70）：锚点向画布**现问**，不再缓存 —— 谱面光标（beat/lane）是 px 的派生值，
  // 此前它被算好后存进 UIProvider.mousePosition，滚动/缩放后鼠标不动就拿不到新值
  // （粘贴与执行键落到旧的拍，用户已复现）。同上走 ref 也顺带解决了 useCallback 身份抖动。
  const pasteAtCursor = useCallback(() => {
    if (isReadOnly) {
      triggerReadonlyPrompt();
      return;
    }
    // issue 73：改走画布 execPaste —— 与粘贴工具单击共用 clickOps，自动获得
    // "整组越出谱面末端 = 拒绝"的判定（原先的 paste() 绕过矩阵，没有末端校验）
    virtualCanvasRef.current?.execPaste?.();
  }, [isReadOnly, triggerReadonlyPrompt]);

  const handleTogglePlay = useCallback(() => {
    if (!persistence.isSettled) return;
    togglePlay();
  }, [persistence, togglePlay]);

  // 具体功能分发（ADR-0002 + ADR-0008 §3）：切换功能 = 持工具态；执行功能 = 光标处瞬时执行（不占工具态）。
  // BPM/Slide 执行键按 §3 修订语义经画布 ref 执行（就地编辑 / slideBuffer 双入口共用）。
  const runFunction = useCallback((fn: FunctionId) => {
    if (isReadOnly && isChartEditFunction(fn)) {
      triggerReadonlyPrompt();
      return;
    }
    switch (fn) {
      case 'switchSingle': setArmedTool('single'); break;
      case 'execSingle': virtualCanvasRef.current?.execPlace?.('single'); break;
      case 'switchFlick': setArmedTool('flick'); break;
      case 'execFlick': virtualCanvasRef.current?.execPlace?.('flick'); break;
      case 'switchSkill': setArmedTool('skill'); break;
      case 'execSkill': virtualCanvasRef.current?.execPlace?.('skill'); break;
      case 'switchLDirectional': setArmedTool('ldirectional'); break;
      case 'execLDirectional': virtualCanvasRef.current?.execPlace?.('ldirectional'); break;
      case 'switchRDirectional': setArmedTool('rdirectional'); break;
      case 'execRDirectional': virtualCanvasRef.current?.execPlace?.('rdirectional'); break;
      case 'switchBpm': setArmedTool('bpm'); break;
      case 'execBpm': virtualCanvasRef.current?.execBpm?.(); break;
      case 'switchSlide': setArmedTool('slide'); break;
      case 'execSlide': virtualCanvasRef.current?.execSlide?.(); break;
      // issue 09 验收反馈 #9（Shift+W）：执行键按光标分发——选区≥2 = 组合+全部段应用；
      // hover 在段上 = 重应用当前配置；空白 = 挂锚点/续段（与曲线工具单击共用草稿）
      case 'switchCurve': setArmedTool('curve'); break;
      case 'execCurve': virtualCanvasRef.current?.execCurve?.(); break;
      case 'switchMouse': setArmedTool(null); break;
      // issue 185：收藏选区为片段。**故意不进 `CHART_EDIT_FUNCTIONS`** —— 它读的是选区、
      // 不写谱面，只读（已上传）谱面也允许；上面的闸门判断因此不会拦它。
      case 'execSavePattern': void saveSelection(); break;
      case 'execCopy': copy(); break;
      // §2.1（六轮）：空剪贴板 → 粘贴态是纯空转（无预览、单击无事发生），
      // 与工具栏按钮同步：不进态。键鼠一致（避免"界面无、键盘有"的错位）。
      case 'switchPaste': if (clipboard.length > 0) setArmedTool('paste'); break;
      case 'execPaste': pasteAtCursor(); break;
      case 'execCut': cut(); break;
      case 'switchDelete': setArmedTool('delete'); break;
      case 'execDelete': deleteSelectedNotes(); break;
      case 'switchMirror': setArmedTool('mirror'); break;
      case 'execMirror': mirror(); break;
      // issue 59 §2：B = 切「音符代码」工具态；Ctrl+B = 打开**光标处**音符的代码（不切工具）
      case 'switchNoteCode': setArmedTool('noteCode'); break;
      case 'execNoteCode': virtualCanvasRef.current?.execNoteCode?.(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'play': handleTogglePlay(); break;
      case 'jumpToMarker': jumpToMarker(); break;
      // ADR-0008 §7：从 Esc 摘除的独立功能（默认 Ctrl+Shift+B）；票 183 起只开合片段库抽屉
      //（工具轨固定不折叠，177 Q11）
      case 'toggleSidebar': setPatternDrawer({ open: !drawerOpen }); break;
      // issue 216：节拍吸附快捷键（增大细分 / 减小细分 / 常用档位循环）
      case 'beatSnapNext': setBeatDisplay(stepBeatSnap(beatDisplay, 1)); break;
      case 'beatSnapPrev': setBeatDisplay(stepBeatSnap(beatDisplay, -1)); break;
      case 'beatSnapCycle': setBeatDisplay(cycleBeatSnap(beatDisplay, settings.beatSnapCycleList)); break;
    }
  }, [isReadOnly, triggerReadonlyPrompt, setArmedTool, clipboard.length, pasteAtCursor, copy, cut, deleteSelectedNotes, mirror, saveSelection, undo, redo, handleTogglePlay, jumpToMarker,
      setPatternDrawer, drawerOpen, setBeatDisplay, beatDisplay, settings.beatSnapCycleList]);

  // === 会话流 7：键盘快捷键分发（issue 28 Q16 / ADR-0002） ===
  useShortcutDispatch({
    shortcutConfig,
    active,
    runFunction,
    // Esc 五档链（ADR-0008 §7 / issue 135）：① 弹窗 capture 自消费；②–⑤ 由
    // resolveEscapeTarget 唯一裁决，此处只消费一档并执行。② 取消后保持工具态与选区。
    // 侧栏折叠已从此链摘除 → toggleSidebar（issue 59 §2：Ctrl+Shift+B；票 183 起开合片段库）。
    onEscape: useCallback(() => {
      const canvas = virtualCanvasRef.current;
      const flags = canvas?.getEscapeFlags?.() ?? {
        pen: false, drag: false, box: false, rightHeld: false, anchor: false,
      };
      const target = resolveEscapeTarget({
        ...flags,
        selection: selectedItems.length > 0,
        tool: armedTool !== null,
      });
      if (target === 'gesture') { canvas?.cancelActiveGesture?.(); return; }
      if (target === 'anchor') { canvas?.cancelPendingSlide?.(); return; }
      if (target === 'selection') {
        setSelectedItems([]);
        return;
      }
      if (target === 'tool') setArmedTool(null);
    }, [selectedItems, armedTool, setSelectedItems, setArmedTool]),
  });

  // Editor 不消费 dismissError（音频页已直接调 session）；chartEndKey 归谱面视口会话内部消费（候选 4）

  return (
    // issue 59 §2：弹窗打开态提到 Editor ——「谱面代码」按钮（顶栏）与「音符代码」工具（画布）
    // 共用同一个弹窗组件，故 target 必须挂在两者共同的祖先上。
    // workspaceProject.test.ts 契约：切工程时谱面代码弹窗随当前工程卸载 (key={projectId})
    // issue 169：useSurfaceSize 现已具备 DOM 替换追踪与 active 校准能力，即便 key remount 亦能平稳追踪尺寸
    <ChartCodeEditorProvider key={projectId ?? 'none'} projectId={projectId} readOnly={isReadOnly} onReadonlyReject={triggerReadonlyPrompt}>
    <div className="ws-shell">
      <WorkspaceToolRail />

      <div className="ws-canvas-col">
        <WorkspaceTopBar />

        {/* 33 票：音频资源异常横幅（丢失 / 被替换）——hydrate 路径检出，动作收口 projectAudio */}
        {audioAnomaly.anomaly && (
          <AudioAnomalyBanner
            anomaly={audioAnomaly.anomaly}
            busy={audioAnomaly.busy}
            onReimport={audioAnomaly.reimport}
            onClearRecord={() => void audioAnomaly.clearRecordAudio()}
            onRealign={() => void audioAnomaly.realign()}
            onDismiss={audioAnomaly.dismiss}
          />
        )}

        {/* 谱面画布滚动容器 */}
        <div ref={chartAreaRef} className="ws-chart-area" onScroll={viewSession.onScrollbarScroll}>
          <div className="virtual-content" style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: virtualHeight > 0 ? `${virtualHeight}px` : 'auto',
            pointerEvents: 'none'
          }} />

          <div style={{
            position: 'sticky',
            top: '0px',
            width: '100%',
            height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'var(--canvas-bg)',
            padding: '0',
            boxSizing: 'border-box',
            zIndex: 1
          }}>
            <CrashBoundaryHost scope="canvas" pageId="workspace">
              <FinalVirtualCanvas
                ref={virtualCanvasRef}
                scrollHostRef={chartAreaRef}
                onScrollChange={viewSession.onCanvasScrollChange}
                geometry={geometry}
                surface={surface}
                active={active}
                readOnly={isReadOnly}
                onReadonlyReject={triggerReadonlyPrompt}
                judgeLineOffsetY={surface && judgeLineOffsetRatio > 0 ? Math.round(judgeLineOffsetRatio * surface.h) : undefined}
              />
            </CrashBoundaryHost>
            <CurveOptionsCapsule />
            <PatternPastePill />
          </div>
        </div>
        <PlayBar
          isPlaying={ctxIsPlaying}
          currentSeconds={playheadSeconds}
          duration={ctxDuration}
          volume={ctxVolume}
          audioLocked={audioSnap.audioLocked}
          canEditTime
          seekNoCursor={!canPlay && ctxIsPlaying}
          shortcutKey={formatKey(shortcutConfig.play)}
          timePrecision={settings.display.timePrecision}
          timeSlot={settings.playbar.markerButton && (
            <PlaybackMarkerButton
              seconds={markerSeconds}
              shortcut={shortcutConfig.jumpToMarker}
              timePrecision={settings.display.timePrecision}
              onJump={jumpToMarker}
            />
          )}
          onTogglePlay={handleTogglePlay}
          onVolumeChange={handleVolumeChange}
          onSeek={seek}
        />
      </div>

      {drawerOpen && (
        <PatternLibraryDrawer
          library={patternLibrary}
          canSaveSelection={canSaveSelection}
          readOnly={isReadOnly}
          onSaveSelection={handleSaveSelection}
          // 186 二轮：同一张卡再点 = 退出粘贴态（回指针）；高亮由 `activePatternId` 决定
          onPastePattern={ui.togglePatternPaste}
          onExitPaste={handleExitPaste}
          activePatternId={ui.patternPaste?.id ?? null}
          onResizingChange={onDrawerResizingChange}
        />
      )}
    </div>
    {showReadonlyToast && createPortal(
      <div className="readonly-toast" role="alert">
        <Lock size={14} className="readonly-toast__icon" />
        <span className="readonly-toast__text">{t('workspace.readonlyPrompt')}</span>
        <button
          type="button"
          className="readonly-toast__copy-btn"
          onClick={() => void handleCopyCurrentChart()}
        >
          <Copy size={12} />
          {t('workspace.readonlyCopyBtn')}
        </button>
        <button
          type="button"
          className="readonly-toast__close-btn"
          onClick={() => setShowReadonlyToast(false)}
          aria-label={t('chartCode.close')}
        >
          <X size={14} />
        </button>
      </div>,
      document.body,
    )}
    </ChartCodeEditorProvider>
  );
};

export default Editor;
