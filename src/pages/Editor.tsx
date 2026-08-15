import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight, PanelLeftOpen, PanelRightOpen, Trash2 } from 'lucide-react';
import Toolbar from '../components/Toolbar';
import FinalVirtualCanvas from '../components/FinalVirtualCanvas';
import NoteInfoPanel from '../components/NoteInfoPanel';
import { resolveAction, isCapturingShortcut, type FunctionId } from '../utils/ShortcutConfig';
import { AudioEngine } from '../utils/AudioEngine';
import { getBpmEvents, beatToSeconds } from '../utils/AudioTiming';
import { ChartProjectStore, DEFAULT_PROJECT_ID } from '../utils/ChartProject';
import { keySoundSetById } from '../utils/KeySound';
import PlayBar from '../components/PlayBar';
import { useEditing, useUI, useConfig, usePlayback } from '../contexts';
import { useAudioPageRegister } from '../contexts/AudioPageContext';
import { MAX_DURATION_SECONDS } from '../utils/AppSettings';
import { countChartNotes } from '../utils/NoteEditing';
import { AppNav, useAppNav } from './AppNav';
import { DEFAULT_SURFACE, type SurfaceSize } from '../utils/ChartGeometry';

// ---- 顶栏内联控件样式（统一走令牌） ----
const inlineIconBtn: React.CSSProperties = {
  width: 26, height: 26, padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  backgroundColor: 'var(--bg-inset)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer', color: 'var(--text-muted)',
  transition: 'background-color var(--dur) var(--ease), color var(--dur) var(--ease), transform var(--dur) var(--ease)',
};

// 折叠窄轨上的展开按钮（issue 28 P2：34px 窄轨 + 展开按钮）
const railBtn: React.CSSProperties = {
  width: 28, height: 28, padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  border: 'none', borderRadius: 'var(--radius-sm)',
  background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
  transition: 'background-color var(--dur) var(--ease), color var(--dur) var(--ease)',
};

interface EditorProps {
  // 入口直达（ADR-0003 §2 + issue 27）：Editor 不再接收 song/onBack，音频由音频面板管理
  /** issue 28 页面壳表面契约（Q16）：false 时暂停播放并抑制全局输入（工作台非激活页保活挂载） */
  active?: boolean;
}

/**
 * Editor（ADR-0003 §7 + M1 收口）：只保留【组装】职责——挂四域 Provider 的消费、播放编排、布局。
 * 编辑数据/状态归 EditingContext，UI 布局归 UIContext，配置归 ConfigContext，播放态归 PlaybackContext。
 * 子组件（Toolbar / PlayBar / NoteInfoPanel / FinalVirtualCanvas）按域直读 hooks，
 * 此处仅留 Editor 编排所需的最高层：音频引擎编排 / 滚动协调 / 布局壳。
 */
const Editor: React.FC<EditorProps> = ({ active = true }) => {
  // 四域状态（M1 收口：子组件已按域直读 hooks；此处仅取 Editor 编排所需）
  const editing = useEditing();
  const ui = useUI();
  const config = useConfig();
  const playback = usePlayback();

  const { notes, selectedItems, clipboard } = editing;
  const {
    mousePosition,
    setSelectedTool,
    beatDisplay,
    leftPanelWidth, rightPanelWidth, leftCollapsed, rightCollapsed,
    isDragging, startDrag, toggleLeftPanel, toggleRightPanel,
  } = ui;
  const {
    copy, cut, paste, deleteSelected, mirror, place, undo, redo,
  } = editing;
  const { settings } = config;
  const shortcutConfig = settings.shortcuts;
  const { navCollapsed } = useAppNav();
  const {
    setIsPlaying, setCanPlay,
    setCurrentSeconds,
    duration: ctxDuration, setDuration: setCtxDuration,
    volume: ctxVolume, setVolume: setCtxVolume,
    canPlay,
  } = playback;

  // 当前 BPM：谱面首个 BPM 标记的 bpm（无则兜底 120，与旧 Editor 行为一致）
  const currentBpm = useMemo(() => {
    const bpmNote = notes.find((n): n is { type: 'BPM'; beat: number; bpm: number } => n.type === 'BPM');
    return bpmNote ? bpmNote.bpm : 120;
  }, [notes]);

  // 音符数统计（issue 36）：滑条按非 hidden 结点数计，与按键音事件同一口径
  const noteCount = useMemo(() => countChartNotes(notes), [notes]);

  // 音频播放（ticket 14）：引擎全局单例（挂在 ref 上，避免重建 AudioContext）
  const engineRef = useRef<AudioEngine | null>(null);
  if (!engineRef.current) engineRef.current = new AudioEngine();
  // 播放 RAF 循环 + 滚动协调（滚动条=唯一滚动来源，播放头经它回写）
  const playbackRafRef = useRef<number | undefined>(undefined);
  const isPlayingRef = useRef(false);
  const durationRef = useRef(ctxDuration);
  const lastTargetScrollYRef = useRef(0);

  // 谱面工程持久化（ADR-0005 §2/§6）：IndexedDB 键值表，无音频也恢复时长/音符；音频加载即写、编辑防抖落盘
  const chartProjectStoreRef = useRef<ChartProjectStore | null>(null);
  if (!chartProjectStoreRef.current) chartProjectStoreRef.current = new ChartProjectStore();
  const audioDataRef = useRef<{ audioName?: string; audioBlob?: Blob }>({});
  const saveTimerRef = useRef<number | undefined>(undefined);
  // 最新 notes 快照（供持久化回调读取，避免 useCallback 闭包过期）
  const notesRef = useRef(notes);
  notesRef.current = notes;
  // durationRef 与 ctxDuration 保持同步（NoteInfoPanel 等经 setDuration 延时时，持久化/播放边界读到实时值）
  durationRef.current = ctxDuration;

  // 虚拟画布相关状态（虚拟高度经 onScrollChange 同步到滚动容器）
  const [virtualHeight, setVirtualHeight] = useState(0);

  // 当前音频文件名（无音频为 null）与导入/解码错误（issue 28 Q15：经 AudioPageContext 暴露给音频页）
  const [audioName, setAudioName] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  // 滚动同步相关：滚动条是滚动位置的唯一来源，虚拟画布只跟随滚动条
  const initialScrollDone = useRef(false);
  // issue24：实时记录"判定线处秒数"，供谱面长度变化后按秒数重新锚定滚动位置。
  // 应用谱面代码/改时长/BPM 事件会改变 chartEndVirtualY → 同一画布 scrollY 会映射到不同秒数，
  // 须在变化后按此秒数重算 scrollTop（不随谱面末端漂移到结尾）。
  const lastScrollSecondsRef = useRef(0);
  // issue24：待重锚标记。chartEnd 变化时置位，virtualHeight 就绪后真正执行按秒重锚。
  // 声明在 handleVirtualScrollChange 之前，供其在"非待重锚"时同步锚点秒数。
  const pendingAnchorKeyRef = useRef<string | null>(null);

  // 谱面画布容器引用
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const virtualCanvasRef = useRef<any>(null);

  // 渲染面尺寸（ADR-0006 §1）：随谱面画布容器变化，经 ResizeObserver 提供；缓冲 = surface × dpr
  // issue 36：窗口连续缩放期间 RO 每帧回调 setSurface → 几何重建 + 瓦片全量重建 + 重锚链
  // （3000+ 音符下体感明显卡顿）。首次立即应用；此后 150ms 尾随防抖合并为停止后一次应用，
  // 拖拽期间画布缓冲不变、由 CSS 拉伸显示（合成器 GPU 缩放，廉价），停止后一次高清重建。
  const [surface, setSurface] = useState<SurfaceSize>(DEFAULT_SURFACE);
  useEffect(() => {
    const el = chartAreaRef.current;
    if (!el) return;
    let timer: number | undefined;
    let lastKey = '';
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const next = { w: Math.round(width), h: Math.round(height) };
        const key = `${next.w}x${next.h}`;
        if (key === lastKey) continue;
        if (!lastKey) { // 挂载首次回调：立即应用，避免用兜底尺寸渲染
          lastKey = key;
          setSurface(next);
          continue;
        }
        if (timer !== undefined) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          lastKey = key;
          setSurface(next);
        }, 150);
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  // 处理虚拟画布滚动变化：仅记录虚拟高度，配合滚动条映射。
  // 同步更新"判定线处秒数"锚点（issue24）：正常浏览/缩放/播放时，凡画布 scrollY 变化都据此
  // 刷新 lastScrollSecondsRef，避免它只依赖 DOM 滚动事件而在缩放/播放/初始定位后失准。
  // 但谱面变更（chartEndKey 变化）进入待重锚期间，画布几何已是新值——此时不得用新几何覆盖旧锚点，
  // 否则按秒重锚会读到漂移值（跳尾）。故仅在 pendingAnchorKeyRef 为空（无待重锚）时同步。
  // 必须 useCallback([]) 保持引用稳定：否则每个 Editor 渲染都会生成新函数引用 → FinalVirtualCanvas
  // 的 onScrollChange effect 每帧触发 → 在导入代码那次渲染中会【早于】Editor 的 [chartEndKey]
  // effect 置位 pending 之前就调用本函数，此时 pending==null 会拿【新几何】覆盖旧锚点（SKIP 失效）。
  // 引用稳定后，onScrollChange 仅在 viewport.scrollY/virtualHeight 真正变化时触发，
  // 而此时 pendingAnchorKeyRef 必已置位，SKIP 才能可靠保护锚点。
  const handleVirtualScrollChange = useCallback((scrollY: number, height: number) => {
    setVirtualHeight(height);
    if (pendingAnchorKeyRef.current == null) {
      const secs = virtualCanvasRef.current?.getPlaybackSecondsForScrollY?.(scrollY);
      if (secs != null) lastScrollSecondsRef.current = secs;
    } else {
      // 谱面变更待重锚期间：不得用新几何覆盖旧锚点
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const scrollTopToCanvasY = (scrollTop: number, maxScroll: number) => {
    const { base, span } = chartRangeOf();
    const ratio = maxScroll > 0 ? scrollTop / maxScroll : 0;
    return base + Math.max(0, Math.min(1, ratio)) * span;
  };
  const canvasYToScrollTop = (canvasScrollY: number, maxScroll: number) => {
    const { base, span } = chartRangeOf();
    const ratio = (canvasScrollY - base) / span;
    return Math.max(0, Math.min(1, ratio)) * maxScroll;
  };

  // issue24：谱面末端变化源（时长 / BPM 事件）的唯一标识。仅当这些变化时才按秒重锚，
  // 普通放音符/改长度不改 BPM、缩放不触发，避免干扰缩放锚点与放音符后的正常滚动。
  const chartEndKey = useMemo(() => {
    const bpm = getBpmEvents(notes).map(e => `${e.beat}:${e.bpm}`).join(',');
    // 并入渲染面尺寸（ADR-0006 §3）：resize 时同样按秒重锚，保证判定线处秒数不变
    return `${ctxDuration}|${bpm}|${surface.w}x${surface.h}`;
  }, [notes, ctxDuration, surface]);

  // issue24：chartEnd 变化（应用谱面代码/改时长/BPM 事件）后，按 lastScrollSecondsRef 的
  // 秒数重新锚定 DOM 滚动条与画布 scrollY，避免同一 scrollY 因 chartEndVirtualY 变化而漂移到结尾。
  //
  // 关键时序：chartEnd 变化 → FinalVirtualCanvas 的 chartEndVirtualY 变化 → onScrollChange 把
  // 新的 virtualHeight 回写 Editor → Editor 设置 .virtual-content 高度 → scrollHeight 才更新到位。
  // 这条链跨多帧，若在 chartEnd 变化当帧立即用过期 maxScroll 重锚，时长不一致时会错算到偏结尾。
  // 因此这里只「标记待重锚」，真正重锚放到 virtualHeight 就绪的 effect（下方）执行。
  useEffect(() => {
    if (!initialScrollDone.current || isPlayingRef.current) return;
    pendingAnchorKeyRef.current = chartEndKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartEndKey]);

  // issue24：virtualHeight 就绪（DOM 高度已设置、scrollHeight 为最新）后，若存在待重锚项则执行。
  // 该 effect 依赖 virtualHeight：chartEnd 变化必然带来 virtualHeight 变化（缩放也会变，但缩放时
  // pendingAnchorKeyRef 为 null 直接返回，不影响缩放锚点）。重锚后同步 lastScrollSecondsRef，避免
  // 随后触发的 onScroll 读到漂移值。
  useEffect(() => {
    const canvas = virtualCanvasRef.current;
    const container = chartAreaRef.current;
    const pending = pendingAnchorKeyRef.current;
    if (!canvas || !container || !initialScrollDone.current || pending == null) return;
    // 播放中由 RAF 循环独占滚动，跳过重锚避免抢滚动
    if (isPlayingRef.current) return;
    pendingAnchorKeyRef.current = null;
    const maxScroll = container.scrollHeight - container.clientHeight;
    if (maxScroll <= 0) return;
    const targetScrollY = canvas.getScrollYForPlaybackSeconds(lastScrollSecondsRef.current);
    canvas.setScrollY(targetScrollY);
    container.scrollTop = canvasYToScrollTop(targetScrollY, maxScroll);
    lastScrollSecondsRef.current = canvas.getPlaybackSecondsForScrollY?.(targetScrollY) ?? lastScrollSecondsRef.current;
  }, [virtualHeight]);
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
    lastScrollSecondsRef.current = seconds;
    engineRef.current?.seek(seconds);
    setCurrentSeconds(seconds);
  };

  // 谱面/BPM 变化时同步按键音事件（编辑中先听局部段也保持正确）
  // issue 36：buildKeyEvents 为 O(n log n)（3000 音符 ≈1-2ms），原先同步跑在每次编辑的
  // 提交路径上；防抖 300ms 移出输入延迟路径（播放中仍即时同步，保证键音调度不滞后）
  useEffect(() => {
    if (isPlayingRef.current) {
      engineRef.current?.setChart(notes, beatDisplay);
      return;
    }
    const t = window.setTimeout(() => engineRef.current?.setChart(notes, beatDisplay), 300);
    return () => window.clearTimeout(t);
  }, [notes, beatDisplay]);

  // 谱面工程持久化（ADR-0005 §6）：读取最新 ref 快照写入 IndexedDB（接口抽象化，未来可换后端）
  const persistChartProject = useCallback(() => {
    const store = chartProjectStoreRef.current;
    if (!store) return;
    store.save({
      id: DEFAULT_PROJECT_ID,
      durationSeconds: durationRef.current,
      notes: notesRef.current,
      ...audioDataRef.current,
    }).catch(() => { /* 幂等落盘，失败静默（下次编辑再试） */ });
  }, []);

  // 自动防抖保存（ADR-0005 §6）：notes / 谱面时长变化后 ~800ms 落盘；切工具/切面板由状态变化自然触发
  useEffect(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => persistChartProject(), 800);
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
  }, [notes, ctxDuration, persistChartProject]);

  // 音频导入/更换（issue 27）：音频面板回调；加载即 persist（ADR-0005 §6，File 即 Blob 随工程持久化）。
  // 解码失败经 audioError 暴露（issue 28 Q15：音频页内联横幅）。
  const importAudio = useCallback((file: File) => {
    const engine = engineRef.current;
    if (!engine) return;
    setAudioError(null);
    engine.load(file)
      .then(() => {
        audioDataRef.current = { audioName: file.name, audioBlob: file };
        setAudioName(file.name);
        // bug 34：换音频时无论 canPlay 是否已 true 都直接按新音频时长刷新谱面时长，避免残留旧时长
        const ad = engine.duration;
        if (ad != null) {
          setCtxDuration(ad);
          durationRef.current = ad;
        }
        persistChartProject();
        setCanPlay(true);
        setIsPlaying(false);
      })
      .catch((err: unknown) => {
        setCanPlay(false);
        setIsPlaying(false);
        setAudioError(err instanceof Error && err.message ? err.message : '该文件无法解码为音频，请更换文件后重试。');
      });
  }, [persistChartProject]);

  // 清除音频（issue 27）：回到无音频态；时长保留当前值（可编辑），重载音频会覆盖（ADR-0005 §4）
  const clearAudio = useCallback(() => {
    const engine = engineRef.current;
    engine?.clear();
    audioDataRef.current = {};
    setAudioName(null);
    setAudioError(null);
    setCanPlay(false);
    setIsPlaying(false);
    persistChartProject();
  }, [persistChartProject]);

  // 挂载时恢复谱面工程（ADR-0005 §6）：重开恢复音符/时长/音频
  useEffect(() => {
    const store = chartProjectStoreRef.current;
    if (!store) return;
    let cancelled = false;
    store.get().then((project) => {
      if (cancelled || !project) return;
      if (project.notes.length > 0) editing.resetNotes(project.notes);
      // 有音频时以音频时长为准（ADR-0005 §4），仅在无音频时恢复持久化谱面时长
      if (project.durationSeconds > 0 && engineRef.current?.duration == null) {
        setCtxDuration(project.durationSeconds);
        durationRef.current = project.durationSeconds;
      }
      // 入口直达后无"显式选歌"概念：挂载即恢复持久化音频（无则无音频态）
      if (project.audioBlob && project.audioName) {
        audioDataRef.current = { audioName: project.audioName, audioBlob: project.audioBlob };
        setAudioName(project.audioName);
        const file = new File([project.audioBlob], project.audioName);
        engineRef.current?.load(file)
          .then(() => { if (!cancelled) { setCanPlay(true); setIsPlaying(false); } })
          .catch(() => { if (!cancelled) { setCanPlay(false); setIsPlaying(false); } });
      }
    });
    return () => { cancelled = true; };
    // 仅挂载执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const beat = canvas.getMarkerBeat?.();
    if (beat == null) return;
    const secs = beatToSeconds(getBpmEvents(notes), beat);
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
    return true;
  }, []);

  // 播放条：音量（作用于引擎 masterGain，状态经 PlaybackContext 共享）
  const handleVolumeChange = useCallback((v: number) => {
    setCtxVolume(v);
    engineRef.current?.setVolume(v);
  }, [setCtxVolume]);

  // 播放条：键音素材切换（持久化经 ConfigContext，引擎侧由 Editor 同步）
  const handleKeySetChange = useCallback((id: string) => {
    engineRef.current?.setKeySet(keySoundSetById(id));
  }, []);

  // 播放条：谱面时长编辑（ADR-0005 §4）：写入谱面时长字段并持久化（无音频时手动增长谱面长度）
  const handleDurationChange = useCallback((sec: number) => {
    if (!(sec > 0)) return;
    sec = Math.min(sec, MAX_DURATION_SECONDS); // 上限 30 分钟（issue 28 P6）
    setCtxDuration(sec);
    durationRef.current = sec;
  }, [setCtxDuration]);

  // 工作台 → 音频页桥接（issue 28 Q16 黑盒边界）：把音频数据/操作注册到 AudioPageContext，
  // 由应用壳的音频页读取，避免页面壳与播放引擎直接耦合。
  const registerAudioApi = useAudioPageRegister();
  useEffect(() => {
    registerAudioApi({
      audioName,
      duration: ctxDuration,
      error: audioError,
      importAudio,
      clearAudio,
      dismissError: () => setAudioError(null),
      onDurationChange: handleDurationChange,
    });
    return () => registerAudioApi(null);
  }, [audioName, audioError, ctxDuration, importAudio, clearAudio, handleDurationChange, registerAudioApi]);

  // 页面壳表面契约（issue 28 Q16）：工作台失活（切到其它页）时自动暂停播放。
  useEffect(() => {
    if (!active) stopPlayback();
  }, [active, stopPlayback]);

  // 播放时长（ADR-0005 §4）：有音频=音频时长（覆盖）；无音频=持久化值(默认30s)，随编辑持久化
  // bug 34：依赖补 audioName。换音频时 canPlay 已是 true，setCanPlay(true) 不产生状态变化 → 原 effect 不重跑、
  // 残留旧时长；setAudioName(file.name) 在换音频必然触发，据此用新音频时长刷新谱面时长。
  useEffect(() => {
    const engine = engineRef.current;
    const audioDuration = engine?.duration;
    if (audioDuration != null) {
      setCtxDuration(audioDuration);
      durationRef.current = audioDuration;
    }
  }, [canPlay, audioName, setCtxDuration]);

  // 初始化：把激活素材/音量应用到引擎
  useEffect(() => {
    engineRef.current?.setKeySet(keySoundSetById(settings.audio.keySet));
    engineRef.current?.setVolume(ctxVolume);
  }, [settings.audio.keySet, ctxVolume]);

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

  // 键盘快捷键（ADR-0002）：作用域仅画布；焦点在输入元素时放行原生行为。
  // 工作台非激活（保活挂载在后台）时抑制全局输入（issue 28 Q16）。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!active) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (isCapturingShortcut()) return;
      // Esc 收起所有打开的浮层面板（issue 28 P1/P2：点 Esc 关面板）
      if (e.key === 'Escape') {
        if (!leftCollapsed) toggleLeftPanel();
        if (!rightCollapsed) toggleRightPanel();
        return;
      }
      const fn = resolveAction(e, shortcutConfig);
      if (!fn) return;
      e.preventDefault();
      runFunction(fn);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, runFunction, shortcutConfig, notes, selectedItems, clipboard, mousePosition,
      leftCollapsed, rightCollapsed, toggleLeftPanel, toggleRightPanel]);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: 'var(--bg)' }}>
      {/* 左侧工具栏列（共享列：与画布同排、压缩画布，issue 28 P1 回滚） */}
      {leftCollapsed ? (
        <div style={{ display: 'flex', flexShrink: 0 }}>
          {/* 折叠态：导航栏固定不变地占用自身空间（52/156px），工具栏隐藏；仅展开时导航才挤占工具栏 */}
          <div className={`app-nav-inline${navCollapsed ? ' is-collapsed' : ''}`}>
            <AppNav />
          </div>
          {/* 折叠窄轨（bug 31：与右侧折叠 rail 对称的独立 div，承载「展开左侧工具栏」按钮） */}
          <div style={{
            width: 34, flexShrink: 0,
            backgroundColor: 'var(--bg-elevated)', borderRight: '1px solid var(--border)',
            display: 'flex', justifyContent: 'center', paddingTop: 'var(--space-1)',
          }}>
            <button onClick={toggleLeftPanel} title="展开左侧工具栏" style={railBtn}><PanelRightOpen size={16} /></button>
          </div>
        </div>
      ) : (
        <div style={{
          width: `min(${leftPanelWidth}px, 30vw)`, flexShrink: 0,
          backgroundColor: 'var(--bg)', borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'row', overflow: 'hidden', position: 'relative',
        }}>
          {/* 应用导航（与工具面板合成同一左列，纵向窄栏；展开/折叠仅控制标签显示） */}
          <div className={`app-nav-inline${navCollapsed ? ' is-collapsed' : ''}`}>
            <AppNav />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              <Toolbar onTogglePlay={togglePlay} />
            </div>
          </div>
          <button
            onClick={toggleLeftPanel}
            title="收起左侧工具栏"
            style={{ ...inlineIconBtn, position: 'absolute', top: 'var(--space-1)', right: 'var(--space-1)', zIndex: 40 }}
          ><ChevronLeft size={14} /></button>
          {/* 拖拽调宽手柄（贴面板右缘） */}
          <div
            onMouseDown={(e) => { e.preventDefault(); startDrag('left'); }}
            style={{ position: 'absolute', top: 0, bottom: 0, right: -3, width: 6, cursor: 'col-resize', zIndex: 40, background: isDragging === 'left' ? 'var(--accent)' : 'transparent' }}
          />
        </div>
      )}

      {/* 中间谱面画布区域（与左右面板共享一列，画布宽度随面板开合变化） */}
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
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'tabular-nums' }}>BPM {currentBpm}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'tabular-nums' }}>节拍: {beatDisplay}/4</span>
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
          {/* 高度用 100%（滚动容器可视高度）而非 100vh：画布区域下方还有播放条，
              100vh 会让 sticky 容器向下溢出 ~播放条高度，把判定线（画布底边）推到播放条之下被遮挡。
              改用 100% 使画布正好铺满滚动容器的可视视口，判定线=画布底边=PlayBar 正上方（ADR-0006 §2）。 */}
          <div style={{
            position: 'sticky',
            top: '0px',
            width: '100%',
            height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'var(--canvas-bg)',
            // ADR-0006 §1：去内边距，使 canvas 铺满谱面画布区域、无留白
            padding: '0',
            boxSizing: 'border-box',
            zIndex: 1
          }}>
            <FinalVirtualCanvas
              ref={virtualCanvasRef}
              onScrollChange={handleVirtualScrollChange}
              chartEndSeconds={ctxDuration}
              surface={surface}
            />
          </div>
        </div>
        {/* 底部播放条（ADR-0004 §5）：播放类控件收敛于此；状态经 PlaybackContext 共享 */}
        <PlayBar
          onTogglePlay={togglePlay}
          onDurationChange={handleDurationChange}
          onVolumeChange={handleVolumeChange}
          onKeySetChange={handleKeySetChange}
        />
      </div>

      {/* 右侧信息面板列（共享列：与画布同排、压缩画布，issue 28 P1 回滚） */}
      {rightCollapsed ? (
        <div style={{
          width: 34, flexShrink: 0,
          backgroundColor: 'var(--bg-elevated)', borderLeft: '1px solid var(--border)',
          display: 'flex', justifyContent: 'center', paddingTop: 'var(--space-1)',
        }}>
          <button onClick={toggleRightPanel} title="展开右侧面板" style={railBtn}><PanelLeftOpen size={16} /></button>
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
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>已选中 {selectedItems.length}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
              <button
                onClick={deleteSelectedNotes}
                title="删除选中"
                style={{
                  ...inlineIconBtn,
                  backgroundColor: 'var(--danger-soft)', borderColor: 'transparent', color: 'var(--danger-text)'
                }}
              ><Trash2 size={14} /></button>
              <button
                onClick={toggleRightPanel}
                title="收起右侧面板"
                style={inlineIconBtn}
              ><ChevronRight size={14} /></button>
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
            padding: '0 var(--space-3)',
            gap: 'var(--space-2)',
            flexShrink: 0
          }}>
            <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>谱面</span>
            <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>[ ] {noteCount}</span>
          </div>
          {/* 拖拽调宽手柄（贴面板左缘） */}
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
