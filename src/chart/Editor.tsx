import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ChevronRight, PanelLeftOpen, PanelRightOpen, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import Toolbar from '../pages/WorkspacePage/Toolbar';
import FinalVirtualCanvas, { type FinalVirtualCanvasHandle } from '../chart/components/canvas/FinalVirtualCanvas';
import NoteInfoPanel from '../chart/components/side-panel/NoteInfoPanel';
import IconButton from '../ui/IconButton';
import { type FunctionId } from '../chart/config/ShortcutConfig';
import { getBpmEvents, secondsToBeat } from '../utils/AudioTiming';
import PlayBar from '../components/PlayBar';
import { useEditing, useUI, useConfig, usePlayback, useAudioSession } from '../app/ProviderTree';
import { countChartNotes } from '../chart/editing/NoteEditing';
import { AppNav, useAppNav } from '../layouts/AppNav';
import { useSurfaceSize } from '../chart/layout/useSurfaceSize';
import { useScrollModel } from '../utils/useScrollModel';
import { useAudioBridge } from '../utils/useAudioBridge';
import { usePlaybackCoordinator } from '../utils/usePlaybackCoordinator';
import { useChartProjectPersistence } from '../chart/project/useChartProjectPersistence';
import { useLayoutPersistence } from '../chart/layout/useLayoutPersistence';
import { useShortcutDispatch } from '../chart/config/useShortcutDispatch';

interface EditorProps {
  /** issue 28 页面壳表面契约（Q16）：false 时暂停播放并抑制全局输入 */
  active?: boolean;
}

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

  const { notes, selectedItems, copy, cut, paste, deleteSelected, mirror, place, undo, redo, resetNotes } = editing;
  const {
    mousePosition,
    setSelectedTool,
    scale, setScale,
    beatDisplay,
    leftPanelWidth, rightPanelWidth, leftCollapsed, rightCollapsed,
    isDragging, startDrag, toggleLeftPanel, toggleRightPanel,
  } = ui;
  const { settings, setLayout } = config;
  const shortcutConfig = settings.shortcuts;
  const { navCollapsed } = useAppNav();
  const {
    setIsPlaying, setCanPlay,
    setCurrentSeconds,
    duration: ctxDuration, setDuration: setCtxDuration,
    setVolume: setCtxVolume,
    currentSeconds: playheadSeconds,
    markerBeat,
  } = playback;

  // 当前播放头所在区间的 BPM（顶栏实时区）
  const currentRegionBpm = useMemo(() => {
    const events = getBpmEvents(notes);
    const beat = secondsToBeat(events, playheadSeconds);
    let bpm = 120;
    for (const e of events) if (e.beat <= beat) bpm = e.bpm;
    return bpm;
  }, [notes, playheadSeconds]);

  // 音符数统计（issue 36）
  const noteCount = useMemo(() => countChartNotes(notes), [notes]);

  // 谱面画布容器 ref（候选 2：作为多个会话流的统一锚点）
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const virtualCanvasRef = useRef<FinalVirtualCanvasHandle>(null);
  // 虚拟高度（由 FinalVirtualCanvas onScrollChange 喂入，Editor 经 effect 写到 .virtual-content）
  const [virtualHeight, setVirtualHeight] = useState(0);

  // === 会话流 1：渲染面测量（候选 2 拆出，issue 36 / 38 不变量保留） ===
  const surface = useSurfaceSize(chartAreaRef);

  // === 会话流 2：滚动模型（候选 1 拆出；候选 2 再做生命周期封装） ===
  const { scrollModel, consumePendingReAnchor } = useScrollModel({
    notes, ctxDuration, surface, scale, verticalRatio: settings.display.verticalRatio,
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
    setCtxDuration,
    setCurrentSeconds,
    setIsPlaying,
    notes,
  });
  const { togglePlay, seek, jumpToMarker, deleteMarkerIfSelected, stopPlayback } = playbackCoord;

  // 挂载恢复（ADR-0005 §6）：通过 onRestore 把 project 灌入 Editor。
  // 定义在持久化 hook 之前——持久化 hook 拿它当 onRestore 回调。
  const handleProjectRestore = useCallback(async (project: import('../chart/project/ChartProject').ChartProject) => {
    if (project.notes.length > 0) resetNotes(project.notes);
    if (project.durationSeconds > 0 && engine?.duration == null) {
      setCtxDuration(project.durationSeconds);
    }
    if (project.audioBlob && project.audioName) {
      // 走 importAudio 路径（统一行为：含引擎 load + 时长同步 + persist 触发）
      const file = new File([project.audioBlob], project.audioName);
      audioSession.importAudio(file);
    }
  }, [resetNotes, setCtxDuration, engine, audioSession]);

  // === 会话流 6：持久化（挂载恢复 + 防抖 800ms 落盘） ===
  // 收口点：不再有 audioMetaRef / persistRef ref 环——audioForPersist 是稳定对象，
  // 持久化 hook 的 saveNow 直接注入到 session.setPersistNow。
  const persistence = useChartProjectPersistence({
    notes,
    durationSeconds: ctxDuration,
    audioName: audioForPersist.audioName,
    audioBlob: audioForPersist.audioBlob,
    onRestore: handleProjectRestore,
  });
  // 把 saveNow 一次性注入到 session（导入/清除后自动调）。
  // 依赖 saveNow 函数本身（hook 返回的函数引用稳定），不依赖整个 persistence 对象。
  // 用 useCallback 让闭包只依赖 saveNow 本身（与 deps 对齐）。
  const persistNow = useCallback(() => persistence.saveNow(), [persistence]);
  useEffect(() => {
    audioSession.setPersistNow(persistNow);
  }, [audioSession, persistNow]);

  // === 会话流 5：布局持久化（issue 22 §6 / ADR-0003 §6） ===
  useLayoutPersistence({ settings, ui, setLayout });

  // 谱面/BPM 变化时同步按键音事件（issue 36：编辑中防抖 300ms；播放中即时）
  useEffect(() => {
    if (playbackCoord.isPlaying) {
      engine?.setChart(notes, beatDisplay);
      return;
    }
    const t = window.setTimeout(() => engine?.setChart(notes, beatDisplay), 300);
    return () => window.clearTimeout(t);
  }, [notes, beatDisplay, engine, playbackCoord.isPlaying]);

  // 画布 onScrollChange：写虚拟高度 + 喂滚动模型做锚点观察（SKIP 保护由模型内处理）
  const handleVirtualScrollChange = useCallback((scrollY: number, height: number) => {
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualHeight]);

  // virtualHeight 就绪后消费待重锚项（候选 1 不变量：谱面末端变化后按秒重锚，判定线处秒数稳定）
  useEffect(() => {
    const canvas = virtualCanvasRef.current;
    const container = chartAreaRef.current;
    if (!canvas || !container) return;
    const maxScroll = container.scrollHeight - container.clientHeight;
    const target = consumePendingReAnchor(maxScroll);
    if (!target) return;
    canvas.setScrollY(target.scrollY);
    container.scrollTop = target.scrollTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualHeight]);

  // 滚动条 onScroll：唯一滚动来源；播放中锁定避免双向反馈自锁（ADR-0004 §1 修订）
  const handleScrollbarChange = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const scrollTop = target.scrollTop;
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

  // 删除选中（含起点标记优先）
  const deleteSelectedNotes = useCallback(() => {
    if (deleteMarkerIfSelected()) return;
    deleteSelected();
  }, [deleteMarkerIfSelected, deleteSelected]);

  // 在当前光标位置立即放置/粘贴音符（ADR-0002 §2.1）
  const placeAtCursor = useCallback((tool: string) => {
    if (mousePosition) place(tool, mousePosition);
  }, [mousePosition, place]);
  const pasteAtCursor = useCallback(() => {
    if (mousePosition) paste(mousePosition);
  }, [mousePosition, paste]);

  // 具体功能分发（ADR-0002）：切换功能切换工具态；执行功能立即执行
  const runFunction = useCallback((fn: FunctionId) => {
    switch (fn) {
      case 'switchSingle': setSelectedTool('single'); break;
      case 'execSingle': placeAtCursor('single'); break;
      case 'switchFlick': setSelectedTool('flick'); break;
      case 'execFlick': placeAtCursor('flick'); break;
      case 'switchSkill': setSelectedTool('skill'); break;
      case 'execSkill': placeAtCursor('skill'); break;
      case 'switchLDirectional': setSelectedTool('ldirectional'); break;
      case 'execLDirectional': placeAtCursor('ldirectional'); break;
      case 'switchRDirectional': setSelectedTool('rdirectional'); break;
      case 'execRDirectional': placeAtCursor('rdirectional'); break;
      case 'switchBpm': setSelectedTool('bpm'); break;
      case 'execBpm': setSelectedTool('bpm'); break;
      case 'switchSlide': setSelectedTool('slide'); break;
      case 'execSlide': setSelectedTool('slide'); break;
      case 'switchMouse': setSelectedTool('mouse'); break;
      case 'switchCopy': setSelectedTool('copy'); break;
      case 'execCopy': copy(); break;
      case 'switchPaste': setSelectedTool('paste'); break;
      case 'execPaste': pasteAtCursor(); break;
      case 'switchCut': setSelectedTool('cut'); break;
      case 'execCut': cut(); break;
      case 'switchDelete': setSelectedTool('delete'); break;
      case 'execDelete': deleteSelectedNotes(); break;
      case 'switchMirror': setSelectedTool('mirror'); break;
      case 'execMirror': mirror(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'play': togglePlay(); break;
      case 'jumpToMarker': jumpToMarker(); break;
    }
  }, [setSelectedTool, placeAtCursor, pasteAtCursor, copy, cut, deleteSelectedNotes, mirror, undo, redo, togglePlay, jumpToMarker]);

  // === 会话流 7：键盘快捷键分发（issue 28 Q16 / ADR-0002） ===
  useShortcutDispatch({
    shortcutConfig,
    active,
    runFunction,
    onEscape: useCallback(() => {
      if (!leftCollapsed) toggleLeftPanel();
      if (!rightCollapsed) toggleRightPanel();
    }, [leftCollapsed, rightCollapsed, toggleLeftPanel, toggleRightPanel]),
  });

  // Editor 不消费 dismissError / chartEndKey（前者音频页已直接调 session；后者仅供 useScrollModel 内部用）

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: 'var(--bg)' }}>
      {/* 左侧工具栏列 */}
      {leftCollapsed ? (
        <div style={{ display: 'flex', flexShrink: 0 }}>
          <div className={`app-nav-inline${navCollapsed ? ' is-collapsed' : ''}`}>
            <AppNav />
          </div>
          <div style={{
            width: 34, flexShrink: 0,
            backgroundColor: 'var(--bg-elevated)', borderRight: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ height: 'var(--panel-header-h)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <IconButton width="auto" icon={<PanelRightOpen size={16} />} title="展开左侧工具栏" onClick={toggleLeftPanel} />
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          width: `min(${leftPanelWidth}px, 30vw)`, flexShrink: 0,
          backgroundColor: 'var(--bg)', borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'row', overflow: 'hidden', position: 'relative',
        }}>
          <div className={`app-nav-inline${navCollapsed ? ' is-collapsed' : ''}`}>
            <AppNav />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              <Toolbar />
            </div>
          </div>
          <div
            onMouseDown={(e) => { e.preventDefault(); startDrag('left'); }}
            style={{ position: 'absolute', top: 0, bottom: 0, right: -3, width: 6, cursor: 'col-resize', zIndex: 40, background: isDragging === 'left' ? 'var(--accent)' : 'transparent' }}
          />
        </div>
      )}

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
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)' }}>谱面画布</span>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span style={{
              color: 'var(--text-muted)', fontSize: 'var(--text-xs)',
              fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: 4,
            }}>
              BPM <b style={{ color: 'var(--text)', fontWeight: 600 }}>{currentRegionBpm}</b>
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <IconButton width="auto" size="sm" icon={<ZoomOut size={14} />} title="缩小" onClick={() => setScale(prev => Math.max(prev - 0.1, 0.1))} />
              <span
                onDoubleClick={() => setScale(1)}
                title="双击复原 100%"
                style={{
                  fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                  fontVariantNumeric: 'tabular-nums', minWidth: 40, textAlign: 'center',
                  cursor: 'pointer', userSelect: 'none',
                }}
              >{Math.round(scale * 100)}%</span>
              <IconButton width="auto" size="sm" icon={<ZoomIn size={14} />} title="放大" onClick={() => setScale(prev => Math.min(prev + 0.1, 3))} />
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
              onScrollChange={handleVirtualScrollChange}
              chartEndSeconds={ctxDuration}
              surface={surface}
              active={active}
            />
          </div>
        </div>
        <PlayBar
          onTogglePlay={togglePlay}
          onVolumeChange={handleVolumeChange}
          onSeek={seek}
        />
      </div>

      {/* 右侧信息面板列 */}
      {rightCollapsed ? (
        <div style={{
          width: 34, flexShrink: 0,
          backgroundColor: 'var(--bg-elevated)', borderLeft: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ height: 'var(--panel-header-h)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconButton width="auto" icon={<PanelLeftOpen size={16} />} title="展开右侧面板" onClick={toggleRightPanel} />
          </div>
        </div>
      ) : (
        <div style={{
          width: `min(${rightPanelWidth}px, 24vw)`, flexShrink: 0,
          backgroundColor: 'var(--bg)', borderLeft: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
        }}>
          <div style={{
            height: 'var(--panel-header-h)',
            backgroundColor: 'var(--bg)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 var(--space-3)',
            gap: 'var(--space-2)',
            flexShrink: 0
          }}>
            <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>音符</span>
            <span title="音符总数" style={{
              backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: '0 var(--space-2)',
              fontSize: 'var(--text-xs)', fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
            }}>{noteCount}</span>
            {selectedItems.length > 0 && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--accent-text)' }}>已选 {selectedItems.length}</span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
              <IconButton width="auto" size="sm" danger icon={<Trash2 size={14} />} title="删除选中" onClick={deleteSelectedNotes} />
              <IconButton width="auto" size="sm" icon={<ChevronRight size={14} />} title="收起右侧面板" onClick={toggleRightPanel} />
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3)', backgroundColor: 'var(--bg)' }}>
            <NoteInfoPanel />
          </div>
          <div style={{
            height: 'var(--panel-header-h)',
            backgroundColor: 'var(--bg)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 var(--space-3)',
            gap: 'var(--space-2)',
            flexShrink: 0,
            fontSize: 'var(--text-xs)',
            color: markerBeat !== null ? 'var(--warning)' : 'var(--text-subtle)',
          }}>
            {markerBeat !== null
              ? `起点标记 @ ${markerBeat.toFixed(2)} 拍`
              : '双击左沟槽设置起点标记'}
          </div>
          <div
            onMouseDown={(e) => { e.preventDefault(); startDrag('right'); }}
            style={{ position: 'absolute', top: 0, bottom: 0, left: -3, width: 6, cursor: 'col-resize', zIndex: 40, background: isDragging === 'right' ? 'var(--accent)' : 'transparent' }}
          />
        </div>
      )}
    </div>
  );
};

export default Editor;
