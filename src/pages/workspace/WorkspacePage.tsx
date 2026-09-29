import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, PanelLeftOpen, PanelRightOpen, Trash2, ZoomIn, ZoomOut, Lock, Copy, X } from 'lucide-react';
import Toolbar from './Toolbar';
import ChartSwitcher from './ChartSwitcher';
import { ChartCodeEditorProvider } from '../../chart/components/code-editor/ChartCodeEditorProvider';
import FinalVirtualCanvas, { type FinalVirtualCanvasHandle } from '../../chart/components/canvas/FinalVirtualCanvas';
import NoteInfoPanel from '../../chart/components/side-panel/NoteInfoPanel';
import IconButton from '../../ui/IconButton';
import { type FunctionId } from '../../chart/config/ShortcutConfig';
import { DEFAULT_BPM } from '../../audio/AudioTiming';
import PlayBar from '../../playback/PlayBar';
import PlaybackMarkerCard from '../../playback/PlaybackMarkerCard';
import { useEditing, useUI, useConfig, usePlayback, useAudioSession, useCurrentProject } from '../../app/ProviderTree';
import { countChartNotes } from '../../chart/editing/NoteEditing';
import { useSurfaceSize } from '../../chart/layout/useSurfaceSize';
import { useChartSpace } from '../../chart/geometry/ChartSpace';
import { isProgrammaticScrollEcho, registerScrollEcho, useScrollModel, type ProgrammaticScrollEcho } from '../../playback/useScrollModel';
import { useAudioBridge } from '../../audio/useAudioBridge';
import { usePlaybackCoordinator } from '../../playback/usePlaybackCoordinator';
import { useChartProjectPersistence } from '../../project/useChartProjectPersistence';
import { useLayoutPersistence } from '../../chart/layout/useLayoutPersistence';
import { useShortcutDispatch } from '../../chart/config/useShortcutDispatch';
import { resolveEscapeTarget } from '../../chart/editing/CanvasGesture';
import { isChartReadonly, isChartEditFunction } from '../../project/chartReadonlyGate';
import { isProjectAudioLocked } from '../../project/workspaceProject';
import { duplicateChartInProject } from '../../project/projectCatalog';
import { newChartId } from '../../project/ChartProject';
import { untitledProjectLabel } from '../../project/ui/projectUi';
import { t } from '../../i18n';

interface EditorProps {
  /** issue 28 页面壳表面契约（Q16）：false 时暂停播放并抑制全局输入 */
  active?: boolean;
}

/**
 * 面板宽度过渡的守卫时长（ms）：覆盖 .ws-panel 的 `width 200ms` 过渡并留尾随结算余量。
 * 展开/收起侧栏时置位，期间渲染面测量进入实时模式（逐帧提交），消除过渡后半段
 * 画布缓冲被 CSS 拉伸造成的"轨道瞬间偏宽再回弹"。见 SurfaceSizeMerger.live。
 */
const PANEL_TRANSITION_GUARD_MS = 320;

/**
 * Editor（架构深化评审候选 2 收口 + ADR-0003 §7）：只保留【组装】职责。
 * 把 6 种会话流全部拆到聚焦 hook（src/utils/use*.ts）：
 *   - 渲染面测量 → useSurfaceSize
 *   - 滚动模型   → useScrollModel
 *   - 音频桥接   → useAudioBridge
 *   - 播放协调   → usePlaybackCoordinator
 *   - 持久化     → useChartProjectPersistence
 *   - 布局持久化 → useLayoutPersistence
 *   - 快捷键     → useShortcutDispatch
 * 子组件按域直读 hooks；此处只剩：消费四域、串联 7 个 hook、布局 JSX。
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
  const {
    armedTool, setArmedTool,
    scale, setScale,
    beatDisplay,
    leftPanelWidth, rightPanelWidth, leftCollapsed, rightCollapsed,
    isDragging, startDrag, toggleLeftPanel, toggleRightPanel,
  } = ui;
  const { settings, setLayout } = config;
  const shortcutConfig = settings.shortcuts;
  const {
    setIsPlaying, setCanPlay,
    setCurrentSeconds,
    duration: ctxDuration, setDuration: setCtxDuration,
    setVolume: setCtxVolume,
    currentSeconds: playheadSeconds,
    markerSeconds,
    setMarker,
  } = playback;

  // 音符数统计（issue 36）
  const noteCount = useMemo(() => countChartNotes(notes), [notes]);

  // 谱面画布容器 ref（候选 2：作为多个会话流的统一锚点）
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const virtualCanvasRef = useRef<FinalVirtualCanvasHandle>(null);
  // 虚拟高度（由 FinalVirtualCanvas onScrollChange 喂入，Editor 经 effect 写到 .virtual-content）
  const [virtualHeight, setVirtualHeight] = useState(0);
  // issue 98：程序化 scrollTop 写入的期望值登记（见 isProgrammaticScrollEcho）。
  const programmaticScrollTopRef = useRef<ProgrammaticScrollEcho | null>(null);

  // === 会话流 1：渲染面测量（候选 2 拆出，issue 36 / 38 不变量保留） ===
  // 实时门控：展开/收起侧栏（.ws-panel width 200ms 过渡）或拖拽改宽面板期间，令测量逐帧提交，
  // 使画布缓冲始终贴合容器实时宽度——否则合并器在过渡后半段冻结提交，缓冲被 CSS 拉伸，
  // 轨道出现"瞬间偏宽再回弹"（同一根因也影响拖拽）。窗口 resize 不触发此门控，保留原节流。
  // 面板宽度只注入**用户值**：视口夹取（防面板吃掉整个视口）已交给 CSS 的 `max-width: vw`
  //（AppShell.css，issue 87）—— 夹取不再是 JS 计算 + 200ms width 过渡，而是瞬时生效，
  // 所以这里不再需要在 innerWidth 变化时进实时通道。
  const isDraggingRef = useRef(isDragging);
  isDraggingRef.current = isDragging;
  const panelAnimUntilRef = useRef(0);
  useEffect(() => {
    panelAnimUntilRef.current = performance.now() + PANEL_TRANSITION_GUARD_MS;
  }, [leftCollapsed, rightCollapsed]);
  const surfaceLive = useCallback(
    () => isDraggingRef.current !== null || performance.now() < panelAnimUntilRef.current,
    [],
  );
  const surface = useSurfaceSize(chartAreaRef, { live: surfaceLive });

  // === issue 134：布局轴几何唯一生命周期（画布 + 滚动模型 bind 同一引用） ===
  const { geometry, chartEndKey } = useChartSpace({
    notes, ctxDuration, surface, verticalRatio: settings.display.verticalRatio,
  });
  // 当前播放头所在区间的 BPM（顶栏实时区）
  // issue 134：与 HUD playheadBeat 同 geometry；最大 beat 解所在段（ADR-0010 结论 5）
  const currentRegionBpm = useMemo(() => {
    const events = geometry.bpmEvents;
    return events[geometry.segmentIndexOfSeconds(playheadSeconds)]?.bpm ?? DEFAULT_BPM;
  }, [geometry, playheadSeconds]);

  // === 会话流 2：滚动模型（候选 1 拆出；候选 2 再做生命周期封装） ===
  const { scrollModel, consumePendingReAnchor } = useScrollModel({
    geometry, scale, chartEndKey,
  });

  // === 音频会话深模块（架构深化评审候选 3 收口） ===
  // session 是单一接缝：拥有 engine + 音频文件 + 时长 + keySet + seVolume + persist 钩子。
  // useAudioSession() 返回 [snapshot, session]，snapshot 驱动响应式，session 调方法。
  const [audioSnap, audioSession] = useAudioSession();
  // 引擎：session 单例，跨页面保活期间不重建
  const engine = audioSession.getEngine();

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

  // === 会话流 4：播放协调（RAF + togglePlay/seek/jumpToMarker） ===
  const playbackCoord = usePlaybackCoordinator({
    engine,
    scrollModel,
    scrollContainerRef: chartAreaRef,
    canvasRef: virtualCanvasRef,
    ctxDuration,
    setChartDuration: (sec) => audioSession.setChartDuration(sec),
    setCurrentSeconds,
    setIsPlaying,
  });
  const { togglePlay, seek, jumpToMarker, stopPlayback } = playbackCoord;
  const { projectId, chartId, store, catalogEpoch, registerPersistFlush, open, notifyCatalogChanged } = useCurrentProject();

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
    const project = await store.get(projectId);
    if (!project) return;
    const copyId = newChartId();
    const next = duplicateChartInProject(project, chartId, { chartId: copyId, now: Date.now() }, untitledProjectLabel());
    if (!next) return;
    await store.save(next);
    notifyCatalogChanged();
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
    project: import('../../project/ChartProject').ChartProject,
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
    if (!opts.restoreAudio) {
      audioSession.setAudioLocked(audioLocked);
      return;
    }
    stopPlayback();
    setCurrentSeconds(0);
    setMarker(null);
    audioSession.hydrateFromProject({
      audioName: project.audioName,
      audioBlob: project.audioBlob,
      durationSeconds: project.durationSeconds,
      audioLocked,
    });
    audioSession.setAudioLocked(audioLocked);
  }, [resetNotes, setCtxDuration, audioSession, stopPlayback, setCurrentSeconds, setMarker]);

  // 记录侧音频变更（票 15 定案 8 的不变量）：音频页按作用域直接写了当前工程记录的音频，
  // 而这条路上没有新谱面——所以只把音频重新对齐，不走 handleProjectRestore（它会 resetNotes，
  // 换个音频不该顺手清掉撤销历史）。hydrateFromProject 在无音频时会清空引擎，
  // 「无音频工程 → 引擎必清空」这半条也在里面。
  const handleRecordAudioChanged = useCallback((
    project: import('../../project/ChartProject').ChartProject,
  ) => {
    stopPlayback();
    setCurrentSeconds(0);
    setMarker(null);
    if (project.durationSeconds > 0) setCtxDuration(project.durationSeconds);
    audioSession.hydrateFromProject({
      audioName: project.audioName,
      audioBlob: project.audioBlob,
      durationSeconds: project.durationSeconds,
      audioLocked: isProjectAudioLocked(project),
    });
  }, [audioSession, stopPlayback, setCurrentSeconds, setMarker, setCtxDuration]);

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
  });
  const persistNow = useCallback(() => persistence.saveNow(), [persistence]);
  useEffect(() => {
    audioSession.setPersistNow(persistNow);
  }, [audioSession, persistNow]);
  useEffect(() => {
    registerPersistFlush(persistNow);
    return () => registerPersistFlush(null);
  }, [persistNow, registerPersistFlush]);

  // === 会话流 5：布局持久化（issue 22 §6 / ADR-0003 §6） ===
  useLayoutPersistence({ settings, ui, setLayout });

  // 谱面/BPM 变化时同步按键音事件（issue 36：编辑中防抖 300ms；播放中改谱即时）。
  // issue 101：不把 isPlaying 放进 deps——开播翻转本身不得同步跑全谱 getBpmEvents+buildKeyEvents。
  const keysPlayingRef = useRef(playbackCoord.isPlaying);
  keysPlayingRef.current = playbackCoord.isPlaying;
  useEffect(() => {
    const delay = keysPlayingRef.current ? 0 : 300;
    const t = window.setTimeout(() => engine?.setChart(notes, beatDisplay), delay);
    return () => window.clearTimeout(t);
  }, [notes, beatDisplay, engine]);

  // 画布 onScrollChange：写虚拟高度 + 喂滚动模型做锚点观察（SKIP 保护由模型内处理）
  // lastCanvasScrollYRef：画布侧最新 scrollY，供 virtualHeight 落地后重写滚动条比例位（见下方 effect）
  const lastCanvasScrollYRef = useRef(0);
  const handleVirtualScrollChange = useCallback((scrollY: number, height: number) => {
    lastCanvasScrollYRef.current = scrollY;
    setVirtualHeight(height);
    scrollModel.noteScrollObserved(scrollY);
  }, [scrollModel]);

  // 设置虚拟内容高度 + 首次置底（初始滚动 = beat0/起点）
  const initialScrollDone = useRef(false);
  useEffect(() => {
    const scrollContainer = chartAreaRef.current;
    if (!scrollContainer || virtualHeight <= 0) return;
    const contentElement = scrollContainer.querySelector('.virtual-content') as HTMLElement;
    if (!contentElement) return;
    contentElement.style.height = `${virtualHeight}px`;
    if (!initialScrollDone.current) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      initialScrollDone.current = true;
      scrollModel.markInitialized();
    } else {
      // 缩放（Ctrl+滚轮/工具栏）/谱长/渲染面变化都会改变 scrollHeight：旧 scrollTop 与新滚动范围
      // 不再对应同一谱面位置——若越界，浏览器会钳制 scrollTop 并触发 scroll 事件，把画布 scrollY
      // 拉回端点（"起始线/首拍 BPM 线缩放漂移后回弹"的次生通路）。这里在高度落地后按画布 scrollY
      // 重写滚动条比例位（与播放 RAF 同款 0.5px 守卫）；滚动条来源的滚动不经过此分支（高度不变）。
      const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      const targetScrollTop = scrollModel.canvasScrollYToScrollTop(lastCanvasScrollYRef.current, maxScroll);
      if (Math.abs(targetScrollTop - scrollContainer.scrollTop) > 0.5) {
        scrollContainer.scrollTop = targetScrollTop;
      }
      // 无论是否实际写入都登记期望值：浏览器可能把写入值取整存储，回声事件据此识别并吞掉
      programmaticScrollTopRef.current = registerScrollEcho(targetScrollTop);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualHeight]);

  // virtualHeight 就绪后消费待重锚项（候选 1 不变量：谱面末端变化后按秒重锚，判定线处秒数稳定）。
  // 依赖须含 chartEndKey：仅宽度类 surface 变化（不改 virtualHeight）也会置位待重锚，若只在
  // virtualHeight 变化时消费，标记会潜伏到下一次缩放才发作，把鼠标锚定的视图强拉回锚点秒
  //（宽度-only 变化时重锚为恒等操作，此处消费是无害 no-op）。
  useEffect(() => {
    const canvas = virtualCanvasRef.current;
    const container = chartAreaRef.current;
    if (!canvas || !container) return;
    const maxScroll = container.scrollHeight - container.clientHeight;
    const target = consumePendingReAnchor(maxScroll);
    if (!target) return;
    canvas.setScrollY(target.scrollY);
    container.scrollTop = target.scrollTop;
    programmaticScrollTopRef.current = registerScrollEcho(target.scrollTop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualHeight, chartEndKey]);

  // 滚动条 onScroll：唯一滚动来源；播放中锁定避免双向反馈自锁（ADR-0004 §1 修订）
  const handleScrollbarChange = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const scrollTop = target.scrollTop;
    // issue 98：程序化 scrollTop 回声（±1px）在 TTL 内吞掉；过期后同一位置当手滚。
    if (isProgrammaticScrollEcho(scrollTop, programmaticScrollTopRef.current)) return;
    const maxScroll = target.scrollHeight - target.clientHeight;
    if (maxScroll <= 0 || !virtualCanvasRef.current) return;
    if (playbackCoord.isPlaying) return;
    const canvasScrollY = scrollModel.scrollTopToCanvasScrollY(scrollTop, maxScroll);
    virtualCanvasRef.current.setScrollY(canvasScrollY);
    const seconds = scrollModel.secondsForScrollY(canvasScrollY);
    scrollModel.noteScrollObserved(canvasScrollY);
    engine?.seek(seconds);
    setCurrentSeconds(seconds);
  };

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
      case 'play': togglePlay(); break;
      case 'jumpToMarker': jumpToMarker(); break;
      case 'toggleSidebar': {
        // ADR-0008 §7：侧栏折叠从 Esc 摘除 → 独立功能（issue 59 §2 起默认键为 Ctrl+Shift+B，
        // Ctrl+B 已让给「执行-音符代码」），两侧同折同展
        const anyCollapsed = leftCollapsed || rightCollapsed;
        if (anyCollapsed) {
          if (leftCollapsed) toggleLeftPanel();
          if (rightCollapsed) toggleRightPanel();
        } else {
          toggleLeftPanel();
          toggleRightPanel();
        }
        break;
      }
    }
  }, [isReadOnly, triggerReadonlyPrompt, setArmedTool, clipboard.length, pasteAtCursor, copy, cut, deleteSelectedNotes, mirror, undo, redo, togglePlay, jumpToMarker,
      leftCollapsed, rightCollapsed, toggleLeftPanel, toggleRightPanel]);

  // === 会话流 7：键盘快捷键分发（issue 28 Q16 / ADR-0002） ===
  useShortcutDispatch({
    shortcutConfig,
    active,
    runFunction,
    // Esc 五档链（ADR-0008 §7 / issue 135）：① 弹窗 capture 自消费；②–⑤ 由
    // resolveEscapeTarget 唯一裁决，此处只消费一档并执行。② 取消后保持工具态与选区。
    // 侧栏折叠已从此链摘除 → toggleSidebar（issue 59 §2：Ctrl+Shift+B）。
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

  // Editor 不消费 dismissError（音频页已直接调 session）；chartEndKey 已用于重锚 effect 依赖

  return (
    // issue 59 §2：弹窗打开态提到 Editor ——「谱面代码」按钮（工具栏）与「音符代码」工具（画布）
    // 共用同一个弹窗组件，故 target 必须挂在两者共同的祖先上。
    <ChartCodeEditorProvider key={projectId ?? 'none'} readOnly={isReadOnly} onReadonlyReject={triggerReadonlyPrompt}>
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: 'var(--bg)' }}>
      {/* 左侧工具栏列（折叠态由 .is-collapsed 驱动 CSS 过渡） */}
      <div
        className={`ws-panel ws-panel-left${leftCollapsed ? ' is-collapsed' : ''}`}
        style={{
          // expanded 宽度由 JS 注入（用户可拖拽 leftPanelWidth），folded 宽度与视口夹取由 CSS 管
          '--ws-left-w': `${leftPanelWidth}px`,
        } as React.CSSProperties}
      >
        <div className="ws-panel__body">
          <div className="ws-panel__body-scroll">
            <Toolbar />
          </div>
        </div>
        <div
          onMouseDown={(e) => { e.preventDefault(); startDrag('left'); }}
          className={`ws-panel__resizer${isDragging === 'left' ? ' is-dragging' : ''}`}
          data-side="left"
        />
        <div className="ws-panel__toggle">
          <IconButton width="auto" icon={<PanelRightOpen size={16} />} title={t('toolbar.expandLeft')} onClick={toggleLeftPanel} />
        </div>
      </div>

      {/* 中间谱面画布区域 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--canvas-bg)', minWidth: 0 }}>
        {/* 顶部控制栏 */}
        <div style={{
          height: 'var(--topbar-h)',
          backgroundColor: 'var(--bg)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 var(--space-3)',
          gap: 'var(--space-3)',
          flexShrink: 0
        }}>
          <ChartSwitcher />

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span style={{
              color: 'var(--text-muted)', fontSize: 'var(--text-xs)',
              fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: 4,
            }}>
              BPM <b style={{ color: 'var(--text)', fontWeight: 600 }}>{currentRegionBpm}</b>
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <IconButton width="auto" size="sm" icon={<ZoomOut size={14} />} title={t('editor.zoomOut')} onClick={() => setScale(prev => Math.max(prev - 0.1, 0.1))} />
              <span
                onDoubleClick={() => setScale(1)}
                title={t('editor.zoomReset')}
                style={{
                  fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                  fontVariantNumeric: 'tabular-nums', minWidth: 40, textAlign: 'center',
                  cursor: 'pointer', userSelect: 'none',
                }}
              >{Math.round(scale * 100)}%</span>
              <IconButton width="auto" size="sm" icon={<ZoomIn size={14} />} title={t('editor.zoomIn')} onClick={() => setScale(prev => Math.min(prev + 0.1, 3))} />
            </div>
          </div>
        </div>

        {/* 谱面画布滚动容器 */}
        <div ref={chartAreaRef} style={{
          flex: 1,
          overflow: 'auto',
          overflowX: 'hidden',
          backgroundColor: 'var(--canvas-bg)',
          position: 'relative'
        }} onScroll={handleScrollbarChange}>
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
            <FinalVirtualCanvas
              ref={virtualCanvasRef}
              scrollHostRef={chartAreaRef}
              onScrollChange={handleVirtualScrollChange}
              geometry={geometry}
              surface={surface}
              active={active}
              readOnly={isReadOnly}
              onReadonlyReject={triggerReadonlyPrompt}
            />
          </div>
        </div>
        <PlayBar
          onTogglePlay={togglePlay}
          onVolumeChange={handleVolumeChange}
          onSeek={seek}
        />
      </div>

      {/* 右侧信息面板列（折叠态由 .is-collapsed 驱动 CSS 过渡） */}
      <div
        className={`ws-panel ws-panel-right${rightCollapsed ? ' is-collapsed' : ''}`}
        style={{
          '--ws-right-w': `${rightPanelWidth}px`,
        } as React.CSSProperties}
      >
        <div className="ws-panel__toggle">
          <IconButton width="auto" icon={<PanelLeftOpen size={16} />} title={t('editor.expandRight')} onClick={toggleRightPanel} />
        </div>
        <div className="ws-panel__body">
          <div className="ws-panel__body-header">
            <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{t('editor.notes')}</span>
            <span title={t('editor.noteCount')} style={{
              backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: '0 var(--space-2)',
              fontSize: 'var(--text-xs)', fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
            }}>{noteCount}</span>
            {selectedItems.length > 0 && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--accent-text)' }}>{t('editor.selectedCount', { count: selectedItems.length })}</span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
              <IconButton width="auto" size="sm" danger icon={<Trash2 size={14} />} title={t('editor.deleteSelected')} onClick={deleteSelectedNotes} />
              <IconButton width="auto" size="sm" icon={<ChevronRight size={14} />} title={t('editor.collapseRight')} onClick={toggleRightPanel} />
            </div>
          </div>
          <div className="ws-panel__body-scroll">
            <NoteInfoPanel />
          </div>
          <PlaybackMarkerCard
            seconds={markerSeconds}
            shortcut={shortcutConfig.jumpToMarker}
            onJump={jumpToMarker}
          />
        </div>
        <div
          onMouseDown={(e) => { e.preventDefault(); startDrag('right'); }}
          className={`ws-panel__resizer${isDragging === 'right' ? ' is-dragging' : ''}`}
          data-side="right"
        />
      </div>
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
