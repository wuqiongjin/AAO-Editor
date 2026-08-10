import React, { useState, useRef, useEffect, useCallback } from 'react';
import Toolbar from '../components/Toolbar';
import FinalVirtualCanvas from '../components/FinalVirtualCanvas';
import NoteInfoPanel from '../components/NoteInfoPanel';
import SettingsPanel from '../components/SettingsPanel';
import { selectionNoteIndices } from '../utils/SelectionEditing';
import { resolveAction, isCapturingShortcut, type FunctionId } from '../utils/ShortcutConfig';
import { AudioEngine } from '../utils/AudioEngine';
import { getBpmEvents, beatToSeconds, computeChartEndSeconds, EMPTY_CHART_DURATION_SECONDS } from '../utils/AudioTiming';
import { keySoundSetById } from '../utils/KeySound';
import PlayBar from '../components/PlayBar';
import { useEditing, useUI, useConfig } from '../contexts';

interface EditorProps {
  song: File | null;
  onBack?: () => void;
}

/**
 * Editor（ADR-0003 §7）：只保留【组装】职责——挂三个 Provider 的消费、播放编排、布局。
 * 编辑数据/状态归 EditingContext，UI 布局归 UIContext，配置归 ConfigContext，不再在 Editor 堆全部编辑状态。
 */
const Editor: React.FC<EditorProps> = ({ song, onBack }) => {
  // 三域状态
  const editing = useEditing();
  const ui = useUI();
  const config = useConfig();

  const {
    notes, selectedItems, clipboard,
    setSelectedItems,
    handleNotesChange,
    history, historyIndex, canUndo, canRedo, undo, redo,
    copy, cut, paste, deleteSelected, mirror, place,
    editToolAction, editToolPaste,
  } = editing;
  const {
    selectedTool, setSelectedTool, scale, setScale,
    beatDisplay, setBeatDisplay, isCombinationMode, setCombinationMode,
    showSettings, setShowSettings, currentBpm, mousePosition, setMousePosition,
    leftPanelWidth, rightPanelWidth, leftCollapsed, rightCollapsed,
    isDragging, startDrag, toggleLeftPanel, toggleRightPanel,
  } = ui;
  const { shortcutConfig, updateShortcutConfig, keySetId, setKeySetId } = config;

  // 音频播放（ticket 14）：引擎全局单例（挂在 ref 上，避免重建 AudioContext）
  const engineRef = useRef<AudioEngine | null>(null);
  if (!engineRef.current) engineRef.current = new AudioEngine();
  const [isPlaying, setIsPlaying] = useState(false);
  const [canPlay, setCanPlay] = useState(false);
  // 播放条（ADR-0004 §5/§7）：时长（会话级）、音量、素材包
  const [duration, setDuration] = useState(EMPTY_CHART_DURATION_SECONDS);
  const [volume, setVolume] = useState(0.8);
  // 播放 RAF 循环 + 滚动协调（滚动条=唯一滚动来源，播放头经它回写）
  const playbackRafRef = useRef<number | undefined>(undefined);
  const isPlayingRef = useRef(false);
  const durationRef = useRef(duration);
  const durationEditedRef = useRef(false);
  const lastTargetScrollYRef = useRef(0);

  // 当前播放位置（秒）：供播放条时间码显示
  const [currentSeconds, setCurrentSeconds] = useState(0);
  // 起点标记（存于 canvas 内，经 ref 访问）
  const [markerState, setMarkerState] = useState<{ beat: number | null; selected: boolean }>({ beat: null, selected: false });

  // 虚拟画布相关状态
  const [virtualHeight, setVirtualHeight] = useState(0);

  // 滚动同步相关：滚动条是滚动位置的唯一来源，虚拟画布只跟随滚动条
  const initialScrollDone = useRef(false); // 是否已做初始滚动（滚动条默认在最下面）

  // 谱面画布容器引用
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const virtualCanvasRef = useRef<any>(null);

  // 处理虚拟画布滚动变化：仅记录虚拟高度，配合滚动条映射
  const handleVirtualScrollChange = (_scrollY: number, height: number) => {
    setVirtualHeight(height);
  };

  // 设置虚拟内容高度，并在首次设置时把滚动条放到最底部（起始拍位置）
  useEffect(() => {
    const scrollContainer = chartAreaRef.current;
    if (!scrollContainer || virtualHeight <= 0) return;
    const contentElement = scrollContainer.querySelector('.virtual-content') as HTMLElement;
    if (!contentElement) return;
    contentElement.style.height = `${virtualHeight}px`;
    if (!initialScrollDone.current) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      initialScrollDone.current = true;
    }
  }, [virtualHeight]);

  // 滚动条 ↔ 画布 scrollY 的偏移映射（ADR-0004 §3 修订：滚动条只覆盖谱面实际长度，无空白）。
  const chartRangeOf = () => {
    const canvas = virtualCanvasRef.current;
    const range = canvas?.getChartScrollRange?.() ?? null;
    const base = range ? range.top : 0;
    const span = range ? Math.max(1, range.bottom - range.top) : (canvas?.getMaxScrollY?.() ?? 1);
    return { base, span };
  };
  // DOM scrollTop → 画布 scrollY（用户拖动滚动条读取）
  const scrollTopToCanvasY = (scrollTop: number, maxScroll: number) => {
    const { base, span } = chartRangeOf();
    const ratio = maxScroll > 0 ? scrollTop / maxScroll : 0;
    return base + Math.max(0, Math.min(1, ratio)) * span;
  };
  // 画布 scrollY → DOM scrollTop（播放头写滚动条）
  const canvasYToScrollTop = (canvasScrollY: number, maxScroll: number) => {
    const { base, span } = chartRangeOf();
    const ratio = (canvasScrollY - base) / span;
    return Math.max(0, Math.min(1, ratio)) * maxScroll;
  };
  // 处理滚动条变化：滚动条是唯一滚动来源，把其位置按偏移映射到画布虚拟坐标。
  // 播放中完全锁定滚动（Bug1：不再回写 setScrollY/seek，消除"播放头↔滚动条"双向反馈自锁；Bug2：播放中禁止滚动）；
  // 暂停滚动 = 设播放起点（seek 到该处但【不自动播放】，再次空格才开播）。
  const handleScrollbarChange = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const scrollTop = target.scrollTop;
    const maxScroll = target.scrollHeight - target.clientHeight;
    if (maxScroll <= 0 || !virtualCanvasRef.current) return;
    if (isPlayingRef.current) return;
    const canvasScrollY = scrollTopToCanvasY(scrollTop, maxScroll);
    virtualCanvasRef.current.setScrollY(canvasScrollY);
    const seconds = virtualCanvasRef.current.getPlaybackSecondsForScrollY?.(canvasScrollY) ?? 0;
    engineRef.current?.seek(seconds);
    setCurrentSeconds(seconds);
  };

  // 音频解码（ticket 14）：song 变化时 decode；无歌曲（跳过）→ 清除音频
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (!song) {
      engine.clear();
      setCanPlay(false);
      setIsPlaying(false);
      return;
    }
    let cancelled = false;
    engine.load(song)
      .then(() => { if (!cancelled) { setCanPlay(true); setIsPlaying(false); } })
      .catch(() => { if (!cancelled) { setCanPlay(false); setIsPlaying(false); } });
    return () => { cancelled = true; };
  }, [song]);

  // 谱面/BPM 变化时同步按键音事件（编辑中先听局部段也保持正确）
  useEffect(() => {
    engineRef.current?.setChart(notes, beatDisplay);
  }, [notes, beatDisplay]);

  // 播放时长（ADR-0004 §3）：有音频=音频长度；无音频=谱面末端+1小节尾量；空谱默认30s；播放条可改（会话级）
  const computeDuration = useCallback((): number => {
    const engine = engineRef.current;
    const audioDuration = engine?.duration;
    if (audioDuration != null) return audioDuration;
    const chartEnd = computeChartEndSeconds(notes, beatDisplay, getBpmEvents(notes));
    return chartEnd != null ? chartEnd : EMPTY_CHART_DURATION_SECONDS;
  }, [notes, beatDisplay]);

  // 播放 RAF 循环（ADR-0004 §1）：逐帧读播放位置 → 驱动画布滚动跟随 → 同步滚动条 + 按键音调度
  const startPlaybackLoop = useCallback(() => {
    if (playbackRafRef.current) cancelAnimationFrame(playbackRafRef.current);
    isPlayingRef.current = true;
    const loop = () => {
      if (!isPlayingRef.current) return;
      const engine = engineRef.current;
      const canvas = virtualCanvasRef.current;
      if (!engine || !canvas) return;
      const current = engine.getSeconds();
      setCurrentSeconds(current);
      if (current >= durationRef.current) {
        stopPlayback();
        return;
      }
      const targetScrollY = canvas.getScrollYForPlaybackSeconds(current);
      lastTargetScrollYRef.current = targetScrollY;
      canvas.setScrollY(targetScrollY);
      if (chartAreaRef.current) {
        const maxScroll = chartAreaRef.current.scrollHeight - chartAreaRef.current.clientHeight;
        const nextScrollTop = canvasYToScrollTop(targetScrollY, maxScroll);
        if (Math.abs(nextScrollTop - chartAreaRef.current.scrollTop) > 0.5) {
          chartAreaRef.current.scrollTop = nextScrollTop;
        }
      }
      engine.tick(); // 按键音预调度
      playbackRafRef.current = requestAnimationFrame(loop);
    };
    playbackRafRef.current = requestAnimationFrame(loop);
  }, []);

  // 停止播放 RAF 循环并冻结引擎（停在当前位置，不循环）
  const stopPlayback = useCallback(() => {
    isPlayingRef.current = false;
    if (playbackRafRef.current) {
      cancelAnimationFrame(playbackRafRef.current);
      playbackRafRef.current = undefined;
    }
    const engine = engineRef.current;
    if (engine?.isPlaying) engine.pause();
    setIsPlaying(false);
  }, []);

  // 播放/暂停切换（工具栏按钮 + 空格快捷键共用；ADR-0004 §2 无音频也照常播）
  const togglePlay = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.isPlaying) {
      stopPlayback();
    } else {
      if (engine.getSeconds() >= durationRef.current) {
        engine.seek(0);
      }
      void engine.play().then(() => {
        setIsPlaying(true);
        startPlaybackLoop();
      });
    }
  }, [stopPlayback, startPlaybackLoop]);

  // 回到起点标记并播放（ADR-0004 §4）：跳回标记 beat → 自动播放
  const jumpToMarker = useCallback(() => {
    const engine = engineRef.current;
    const canvas = virtualCanvasRef.current;
    if (!engine || !canvas) return;
    const markerBeat = canvas.getMarkerBeat?.();
    if (markerBeat == null) return;
    const secs = beatToSeconds(getBpmEvents(notes), markerBeat);
    engine.seek(secs);
    if (!engine.isPlaying) {
      void engine.play().then(() => {
        setIsPlaying(true);
        startPlaybackLoop();
      });
    }
  }, [notes, startPlaybackLoop]);

  // 删除选中起点标记（ADR-0004 §4）：标记选中态与音符选择互斥
  const deleteMarkerIfSelected = useCallback((): boolean => {
    const canvas = virtualCanvasRef.current;
    if (!canvas?.getMarkerSelected?.()) return false;
    canvas.clearMarker?.();
    setMarkerState({ beat: null, selected: false });
    return true;
  }, []);

  // 画布标记状态同步（始源在 canvas 内，Editor 经此刷新播放条提示）
  const handleMarkerChange = useCallback((state: { beat: number | null; selected: boolean }) => {
    setMarkerState(state);
  }, []);

  // 播放条：音量（作用于引擎 masterGain）
  const handleVolumeChange = useCallback((v: number) => {
    setVolume(v);
    engineRef.current?.setVolume(v);
  }, []);

  // 播放条：键音素材切换 + 持久化（ADR-0004 §7 settings，经 ConfigContext）
  const handleKeySetChange = useCallback((id: string) => {
    setKeySetId(id);
    engineRef.current?.setKeySet(keySoundSetById(id));
  }, [setKeySetId]);

  // 播放条：无音频时长编辑（会话级，不写入谱面）
  const handleDurationChange = useCallback((sec: number) => {
    if (!(sec > 0)) return;
    setDuration(sec);
    durationRef.current = sec;
    durationEditedRef.current = true;
  }, []);

  // 播放时长（ADR-0004 §3）：有音频=音频长度；无音频=谱面末端/默认30s；用户改过则沿用
  useEffect(() => {
    const engine = engineRef.current;
    const audioDuration = engine?.duration;
    if (audioDuration != null) {
      setDuration(audioDuration);
      durationRef.current = audioDuration;
      durationEditedRef.current = false;
      return;
    }
    if (durationEditedRef.current) return;
    const d = computeDuration();
    setDuration(d);
    durationRef.current = d;
  }, [canPlay, notes, beatDisplay, computeDuration]);

  // 初始化：把激活素材/音量应用到引擎
  useEffect(() => {
    engineRef.current?.setKeySet(keySoundSetById(keySetId));
    engineRef.current?.setVolume(volume);
  }, [keySetId, volume]);

  // 删除选中（含起点标记优先）：标记选中时 Delete 删除标记
  const deleteSelectedNotes = () => {
    if (deleteMarkerIfSelected()) return;
    deleteSelected();
  };

  // 在当前光标位置立即放置/粘贴音符（ADR-0002 §2.1）
  const placeAtCursor = (tool: string) => {
    if (mousePosition) place(tool, mousePosition);
  };
  const pasteAtCursor = () => {
    if (mousePosition) paste(mousePosition);
  };

  // 具体功能分发（ADR-0002）：切换功能切换工具态；执行功能立即执行
  const runFunction = (fn: FunctionId) => {
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
  };

  // 键盘快捷键（ADR-0002）：作用域仅画布；焦点在输入元素时放行原生行为
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (isCapturingShortcut()) return;
      const fn = resolveAction(e, shortcutConfig);
      if (!fn) return;
      e.preventDefault();
      runFunction(fn);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runFunction, shortcutConfig, notes, selectedItems, clipboard, mousePosition, history, historyIndex]);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* 左侧工具栏区域 */}
      <div style={{
        width: leftCollapsed ? '0px' : `min(${leftPanelWidth}px, 34vw)`,
        minWidth: leftCollapsed ? '0px' : 'min(160px, 20vw)',
        backgroundColor: '#f3f4f6',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
        zIndex: 10,
        position: 'relative'
      }}>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <Toolbar
            selectedTool={selectedTool}
            setSelectedTool={setSelectedTool}
            shortcutConfig={shortcutConfig}
            beatDisplay={beatDisplay}
            setBeatDisplay={setBeatDisplay}
            isPlaying={isPlaying}
            canPlay={canPlay}
            onTogglePlay={togglePlay}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            onCopy={copy}
            onCut={cut}
            onPaste={pasteAtCursor}
            onDelete={deleteSelectedNotes}
            onMirror={mirror}
            canCopy={selectedItems.length > 0}
            canPaste={clipboard.length > 0 && mousePosition !== null}
            scale={scale}
            onZoomIn={() => setScale(prev => Math.min(prev + 0.1, 3))}
            onZoomOut={() => setScale(prev => Math.max(prev - 0.1, 0.1))}
            isCombinationMode={isCombinationMode}
            setCombinationMode={setCombinationMode}
          />
        </div>
        {!leftCollapsed && (
          <button
            onClick={toggleLeftPanel}
            title="收起左侧工具栏"
            style={{
              position: 'absolute', top: 4, right: 4, zIndex: 40,
              width: 22, height: 22, padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'rgba(55,65,81,0.15)', border: 'none', borderRadius: 4,
              cursor: 'pointer', color: '#374151', fontSize: 12
            }}
          >◀</button>
        )}
      </div>

      {/* 左侧拖拽分隔条 */}
      <div
        style={{
          width: '4px',
          backgroundColor: isDragging === 'left' ? '#3b82f6' : '#e5e7eb',
          cursor: 'col-resize',
          flexShrink: 0,
          transition: 'background-color 0.2s',
          zIndex: 10,
          position: 'relative'
        }}
        onMouseDown={(e) => { if (leftCollapsed) toggleLeftPanel(); e.preventDefault(); startDrag('left'); }}
      >
        {leftCollapsed && (
          <button
            onClick={toggleLeftPanel}
            title="展开左侧工具栏"
            style={{
              position: 'absolute', top: 8, right: 6, zIndex: 40,
              width: 20, height: 20, padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: '#3b82f6', border: 'none', borderRadius: 4,
              cursor: 'pointer', color: 'white', fontSize: 11
            }}
          >▶</button>
        )}
      </div>

      {/* 中间谱面画布区域 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#000000', minWidth: 0 }}>
        {/* 顶部控制栏 */}
        <div style={{
          height: '32px',
          backgroundColor: '#e5e7eb',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          borderBottom: '1px solid #333333',
          flexShrink: 0,
          width: 'calc(100% - 20px)',
          position: 'relative',
          overflow: 'visible'
        }}>
          <span style={{
            flexShrink: 0,
            minWidth: '60px'
          }}>谱面画布</span>
          <div style={{
            position: 'absolute',
            right: '20px',
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span style={{ color: '#374151', fontSize: '14px' }}>BPM {currentBpm}</span>
            <span style={{ color: '#374151', fontSize: '14px' }}>节拍: {beatDisplay}/4</span>
            {onBack && (
              <button
                style={{
                  backgroundColor: '#374151', color: 'white', border: 'none',
                  borderRadius: '4px', padding: '2px 8px', fontSize: '12px', cursor: 'pointer'
                }}
                onClick={onBack}
                title={song ? "重新选择歌曲" : "选择歌曲（当前为无歌曲模式）"}
              >{song ? '换歌' : '选歌'}</button>
            )}
            <button
              style={{
                backgroundColor: '#374151', color: 'white', border: 'none',
                borderRadius: '4px', padding: '2px 8px', fontSize: '12px', cursor: 'pointer'
              }}
              onClick={() => setShowSettings(true)}
            >快捷键</button>
          </div>
        </div>

        {/* 谱面画布滚动容器 */}
        <div ref={chartAreaRef} style={{
          flex: 1,
          overflow: 'auto',
          overflowX: 'hidden',
          backgroundColor: '#000000',
          position: 'relative'
        }} onScroll={handleScrollbarChange}>
          {/* 虚拟内容区域 - 用于控制滚动条长度，适配虚拟画布高度 */}
          <div className="virtual-content" style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: virtualHeight > 0 ? `${virtualHeight}px` : 'auto',
            pointerEvents: 'none'
          }} />

          {/* 谱面画布 - 使用sticky定位，固定在视口中 */}
          <div style={{
            position: 'sticky',
            top: '0px',
            width: '100%',
            height: '100vh',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#000000',
            padding: '20px',
            boxSizing: 'border-box',
            zIndex: 1
          }}>
            <FinalVirtualCanvas
              ref={virtualCanvasRef}
              notes={notes}
              setNotes={handleNotesChange}
              selectedTool={selectedTool}
              selectedItems={selectedItems}
              setSelectedItems={setSelectedItems}
              beatDisplay={beatDisplay}
              onMousePositionChange={setMousePosition}
              scale={scale}
              onScrollChange={handleVirtualScrollChange}
              clipboard={clipboard}
              onEditToolAction={editToolAction}
              onEditToolPaste={editToolPaste}
              onMarkerChange={handleMarkerChange}
            />
          </div>
        </div>
        {/* 底部播放条（ADR-0004 §5）：播放类控件收敛于此 */}
        <PlayBar
          isPlaying={isPlaying}
          hasAudio={canPlay}
          currentSeconds={currentSeconds}
          duration={duration}
          onTogglePlay={togglePlay}
          onDurationChange={handleDurationChange}
          volume={volume}
          onVolumeChange={handleVolumeChange}
          keySetId={keySetId}
          onKeySetChange={handleKeySetChange}
          hasMarker={markerState.beat !== null}
          markerBeat={markerState.beat}
          jumpBinding={shortcutConfig.jumpToMarker}
        />
      </div>

      {/* 右侧拖拽分隔条 */}
      <div
        style={{
          width: '4px',
          backgroundColor: isDragging === 'right' ? '#3b82f6' : '#e5e7eb',
          cursor: 'col-resize',
          flexShrink: 0,
          transition: 'background-color 0.2s',
          zIndex: 10,
          position: 'relative'
        }}
        onMouseDown={(e) => { if (rightCollapsed) toggleRightPanel(); e.preventDefault(); startDrag('right'); }}
      >
        {rightCollapsed && (
          <button
            onClick={toggleRightPanel}
            title="展开右侧面板"
            style={{
              position: 'absolute', top: 8, right: 6, zIndex: 40,
              width: 20, height: 20, padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: '#3b82f6', border: 'none', borderRadius: 4,
              cursor: 'pointer', color: 'white', fontSize: 11
            }}
          >◀</button>
        )}
      </div>

      {/* 右侧信息面板区域 */}
      <div style={{
        width: rightCollapsed ? '0px' : `min(${rightPanelWidth}px, 24vw)`,
        minWidth: rightCollapsed ? '0px' : 'min(160px, 20vw)',
        backgroundColor: '#f3f4f6',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
        zIndex: 10,
        position: 'relative'
      }}>
        <div style={{
          height: '32px',
          backgroundColor: '#e5e7eb',
          color: '#374151',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          borderBottom: '1px solid #333333',
          flexShrink: 0
        }}>
          <span style={{ fontWeight: 'bold' }}>音符</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>已选中 {selectedItems.length}</span>
            <button style={{
              backgroundColor: '#ef4444',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              border: 'none',
              cursor: 'pointer'
            }} onClick={deleteSelectedNotes}>删</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          <NoteInfoPanel
            selectedNotes={selectionNoteIndices(selectedItems)}
            notes={notes}
            onNotesChange={handleNotesChange}
          />
        </div>
        <div style={{
          height: '32px',
          backgroundColor: '#e5e7eb',
          color: '#374151',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          borderTop: '1px solid #333333',
          flexShrink: 0
        }}>
          <span style={{ fontWeight: 'bold' }}>谱面</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>[ ] {notes.length}</span>
          </div>
        </div>
        {!rightCollapsed && (
          <button
            onClick={toggleRightPanel}
            title="收起右侧面板"
            style={{
              position: 'absolute', top: 4, left: 4, zIndex: 40,
              width: 22, height: 22, padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'rgba(55,65,81,0.15)', border: 'none', borderRadius: 4,
              cursor: 'pointer', color: '#374151', fontSize: 12
            }}
          >▶</button>
        )}
      </div>
      {/* 快捷键设置面板（ADR-0002 §5） */}
      {showSettings && (
        <SettingsPanel
          config={shortcutConfig}
          onChange={updateShortcutConfig}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
};

export default Editor;