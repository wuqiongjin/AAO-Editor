// 动态预览的舞台（chart-preview 05）：**装配层** —— 画面与回放全在 `src/preview/video/sim`，
// 本文件只做四件事：读素材 / 量舞台 / 建回放 / 画播放条。
//
//   - 素材：运行时素材树 `public/assets/sim/`（URL 前缀 `SIM_ASSET_BASE`，跟着构建 base）；
//     缺席 → 空态 + 获取命令（04 的文案）
//   - 一帧输入：`buildSimChart`（谱面 → 元素表）+ `fitDesignSurface`（设计面 contain + 钳制）
//   - 回放：`createSimPlayback`（自持引擎当秒源；rAF 驱动**同一份**任意秒出帧函数）
//   - 播放条：工作台同一件 `PlayBar`（issue 22 起复用）：播放/暂停 + 时间码（可双击编辑）
//     + 进度（可拖）+ 音量；倍速（`src/playback/PlaybackRate`，58 起两处共用）接 `rateSlot`，
//     值读共享单点 `usePlaybackRate`。空格由本层挂着的 `useShortcutDispatch` 页面级接管（只认 play，Q2）。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getBpmEvents, type BpmEvent } from '../../audio/AudioTiming';
import type { AppSettings } from '../../settings/AppSettings';
import { formatKey, type FunctionId, type ShortcutConfig } from '../../settings/ShortcutConfig';
import { useShortcutDispatch } from '../../settings/useShortcutDispatch';
import { notesEqual } from '../../chart/editing/NotesEqual';
import { t } from '../../i18n';
import PlayBar from '../../playback/PlayBar';
import PlaybackRate from '../../playback/PlaybackRate';
import { getPlaybackRate, usePlaybackRate } from '../../playback/playbackRateState';
import {
  PLAYBACK_SHORTCUT_IDS,
  stepAudioVolume,
  stepPlaybackRatePreset,
} from '../../playback/playbackShortcuts';
import { PLAYBACK_HUD_PERIOD_MS } from '../../playback/usePlaybackCoordinator';
import { resolveCanvasDpr } from '../../rendering';
import { buildActiveNoteIcons, normalizeNoteSkinSelection, type ActiveNoteIcons } from '../../rendering/skin/noteSkin';
import CanvasSpriteIcon from '../../ui/CanvasSpriteIcon';
import { prepareSimNoteSprites } from '../../preview/video/sim/prepareSimNoteSprites';
import {
  buildSimChartInChunks,
  createSimPlayback,
  fitDesignSurface,
  loadSimAssets,
  yieldToMainThread,
  type SimAssets,
  type SimChart,
  type SimFrameInput,
  type SimPlayback,
  type SimPlaybackAudio,
  type SimScene,
} from '../../preview';

/**
 * 预览页只接管 play + 四个倍速 / 音量键（issue 22 Q2 / issue 230）：其余绑定放行原生行为，
 * 不吞浏览器键（引用稳定）。倍速 / 音量在这页也必须有反应 —— 状态与工作台同源，按了没用会被当成坏掉。
 */
const PLAY_ONLY: readonly FunctionId[] = ['play', ...PLAYBACK_SHORTCUT_IDS];

/** 票 69 复验整改：动态舞台同步令牌（按对象身份标识一次数据版本与谱面目标） */
export interface VideoSyncToken {
  dataVersion: number;
  chartId: string | null;
}

/** 票 69：异步派生的结果连带它属于哪份 scene / 皮肤，避免拿到过期表还往回放里推 */
interface DerivedChart {
  scene: SimScene;
  noteIcons: ActiveNoteIcons;
  chart: SimChart;
  bpmEvents: BpmEvent[];
}

export interface PreviewVideoStageProps {
  /**
   * 这一页此刻是不是前台页（应用壳的保活挂载会给 `active`）。
   * 失活就**停声**：仿真场自持引擎，切走不停就会和工作台 / 音频页的播放叠在一起。
   */
  active?: boolean;
  /** 谱面 + 作者设置（页面 useMemo 构建；谱面或设置变 → 派生表重建） */
  scene: SimScene;
  /** 谱面长度（秒，ADR-0005 第一性）：播到这里停住 */
  duration: number;
  /** 作用域工程的音频（null = 无音频 → 引擎走合成时间线） */
  audio: SimPlaybackAudio | null;
  /** 键音素材包（`settings.audio.keySet`） */
  keySetId: string;
  /** 节奏图示 SE 音量（`settings.audio.seVolume`） */
  seVolume: number;
  /** 播放器主音量（`settings.audio.volume`，chart-preview 20） */
  volume: number;
  /** 播放器主音量写回（落 `settings.audio.volume`） */
  onVolumeChange: (volume: number) => void;
  /** 画质档（`settings.display.imageQuality`）：实时画布走**画布那套** min(设备像素比, 档位) */
  imageQuality: string;
  /** 音符皮肤（`settings.visual.noteSkin`） */
  noteSkin: AppSettings['visual']['noteSkin'];
  /** 时间显示精度（issue 200）：由页面从 `settings.display.timePrecision` 传 */
  timePrecision?: AppSettings['display']['timePrecision'];
  /** 快捷键配置（空格页面级接管 play，issue 22 Q2）：由页面从 `settings.shortcuts` 传 */
  shortcuts: ShortcutConfig;
  /** 当前看哪张谱面（切谱面重置秒数） */
  chartId?: string | null;
  /** 初始/恢复播放秒数（切回页面或切回动态形态时恢复） */
  initialSeconds?: number;
  /** 播放秒数变动回调（通知父层记忆最新进度） */
  onSecondsChange?: (seconds: number) => void;
  /** 票 69 复验整改：调用方给出的同步令牌，在分片派生完成并推入 setFrame 后原样回传以撤下遮罩 */
  syncToken?: VideoSyncToken | null;
  onSyncComplete?: (token: VideoSyncToken) => void;
}

export default function PreviewVideoStage({
  active = true,
  scene,
  duration,
  audio,
  keySetId,
  seVolume,
  volume,
  onVolumeChange,
  imageQuality,
  noteSkin,
  timePrecision,
  shortcuts,
  chartId,
  initialSeconds,
  onSecondsChange,
  syncToken = null,
  onSyncComplete,
}: PreviewVideoStageProps) {
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playbackRef = useRef<SimPlayback | null>(null);
  const spriteIconRef = useRef<CanvasSpriteIcon | null>(null);
  if (spriteIconRef.current === null) spriteIconRef.current = new CanvasSpriteIcon();

  const [assets, setAssets] = useState<SimAssets | null>(null);
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 });
  const [tick, setTick] = useState({ seconds: initialSeconds ?? 0, playing: false });
  /** 皮肤图集到位后 +1：重推一帧（暂停态也要把缺图那帧补上） */
  const [skinVersion, setSkinVersion] = useState(0);
  /**
   * 播放器旋钮（chart-preview 20 / 58）：主音量落 `settings.audio.volume`（跨会话记住，
   * 07 的视频导出也按它取）；倍速改读 `usePlaybackRate()` 的**共享单点**（工作台与预览两处
   * 实时同步，本次运行内、不落设置、刷新回 1×）。「回开头」「循环」不给入口：回放那一层的
   * 循环能力还在，只是没有 UI 调它。
   */
  const [rate, setRate] = usePlaybackRate();
  // issue 230：快捷键读「此刻」的主音量，不把 runFunction 挂到每次改值的重渲染上
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  const noteIcons = useMemo(() => buildActiveNoteIcons(normalizeNoteSkinSelection(noteSkin)), [noteSkin]);
  const [preparedIcons, setPreparedIcons] = useState<typeof noteIcons | null>(null);
  /** 票 69：谱面派生表异步进场 —— 首帧不再被 O(notes) 的同步派生压住 */
  const [derived, setDerived] = useState<DerivedChart | null>(null);
  // 实时画布位图密度：画布那套口径（min(设备像素比, 档位)）——逐帧直绘，不叠超采样；
  // 导出侧的固定档由 07 显式给，不跟这里走
  const density = resolveCanvasDpr(imageQuality);

  // 开播前准备当前皮肤的独立切片与 mip（含按住端帽、方向键与挂件）。
  useEffect(() => {
    let cancelled = false;
    void prepareSimNoteSprites(noteIcons)
      .catch((e) => console.warn('[preview] 仿真场音符皮肤预热失败（按缺图渲染）:', e))
      .then(() => {
        if (!cancelled) {
          setPreparedIcons(noteIcons);
          setSkinVersion((v) => v + 1);
        }
      });
    return () => { cancelled = true; };
  }, [noteIcons]);

  // 场地素材（只走 04 的直读通道）：缺席 = 空态。带体取色跟皮肤走 → 皮肤换了重读一次；
  // 背景 / 轨道包（41）换了也重读 —— 包 ID 随 scene 进来（settings.preview），
  // 实时预览与视频导出 / 开场第③段因此永远是同一份素材（ADR-0018 §5）。
  useEffect(() => {
    let cancelled = false;
    void loadSimAssets({
      bandSrc: noteIcons.slideBand.src,
      bandSpSrc: noteIcons.slideBandSp.src,
      packs: { field: scene?.fieldPackId, background: scene?.bgPackId },
    })
      .then((next) => { if (!cancelled) setAssets(next); });
    return () => { cancelled = true; };
  }, [noteIcons, scene?.fieldPackId, scene?.bgPackId]);

  // 谱面 → 仿真场派生表（元素 / 带体 / 同时点击线 / combo 时刻）。
  // 票 69：不再用同步 useMemo —— 挪到 effect 里分批 yieldToMainThread()，让骨架 /「正在读取场地素材…」
  // 先画出来，长谱派生期间导航、缩放仍可点。BPM 事件只提取一次，画面派生与键音事件表共用。
  useEffect(() => {
    let cancelled = false;
    const bpmEvents = getBpmEvents(scene.notes);
    void buildSimChartInChunks(scene, noteIcons, {
      bpmEvents,
      yieldNow: yieldToMainThread,
      isCancelled: () => cancelled,
    }).then((next) => {
      if (!cancelled && next) setDerived({ scene, noteIcons, chart: next, bpmEvents });
    });
    return () => { cancelled = true; };
  }, [scene, noteIcons]);

  // ---------------- 量舞台（jsdom 无布局：ResizeObserver 缺席时靠挂载 / resize 两条同步路径） ----------------
  const syncFromHost = useCallback(() => {
    const host = fieldRef.current;
    if (!host) return;
    const w = host.clientWidth;
    const h = host.clientHeight;
    setHostSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, []);
  useLayoutEffect(() => { syncFromHost(); }, [syncFromHost]);
  useEffect(() => {
    const host = fieldRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => syncFromHost());
    ro.observe(host);
    return () => ro.disconnect();
  }, [syncFromHost]);
  useEffect(() => {
    window.addEventListener('resize', syncFromHost);
    return () => window.removeEventListener('resize', syncFromHost);
  }, [syncFromHost]);

  // 场地几何：设计面 contain 进舞台并钳制（未测量 = null，先不出图）
  const metrics = useMemo(
    () => (hostSize.w > 0 && hostSize.h > 0 ? fitDesignSurface(hostSize.w, hostSize.h) : null),
    [hostSize.w, hostSize.h],
  );
  const ready = metrics != null && assets != null && !assets.missing && preparedIcons === noteIcons;
  // 票 69：派生表没到齐就别把空白画布顶上来（否则加载态会在还没画面时先消失）。
  // `ready` 本身保持票 05 / 68 的门禁不动，只在它的下游追加「派生表到了」这一条。
  const chartReady = derived != null;
  const stageReady = ready && chartReady;
  const frameReady = ready && derived?.scene === scene && derived?.noteIcons === noteIcons;

  const onSecondsChangeRef = useRef(onSecondsChange);
  onSecondsChangeRef.current = onSecondsChange;

  // ---------------- 回放：只在「音频身份」或「素材」变化时重建（引擎不随设置面板抖） ----------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const currentAssets = assets;
    if (!stageReady || !canvas || !currentAssets) return;
    let lastHudCommitMs = -Infinity;
    let lastPlaying = false;
    let latestSeconds = initialSeconds ?? 0;
    let latestPlaying = false;
    const pb = createSimPlayback({
      canvas,
      audio,
      keySetId,
      seVolume,
      volume,
      rate,
      duration,
      density,
      initialSeconds,
      onTick: (seconds, playing) => {
        latestSeconds = seconds;
        latestPlaying = playing;
        const now = performance.now();
        // chart-preview 57 / issue 188：播放期本组件内部 HUD（PlayBar）按 80ms 节流；
        // 父级 onSecondsChange（PreviewPage state）在 playing=true 期间绝不触发（否则每 80ms 引发
        // PreviewPage → ScopePicker / PreviewDisplayPanel / VideoExportControl 整页 React 重渲，与画布 rAF 抢帧预算），
        // 仅在暂停态（!playing：暂停 / seek / 播完停在末帧）或播放途中切模式卸载时回写父级记忆进度。
        if (!playing || playing !== lastPlaying || now - lastHudCommitMs >= PLAYBACK_HUD_PERIOD_MS) {
          lastHudCommitMs = now;
          lastPlaying = playing;
          setTick((prev) => (prev.seconds === seconds && prev.playing === playing ? prev : { seconds, playing }));
          if (!playing) {
            onSecondsChangeRef.current?.(seconds);
          }
        }
      },
    });
    playbackRef.current = pb;
    return () => {
      playbackRef.current = null;
      if (latestPlaying) {
        onSecondsChangeRef.current?.(latestSeconds);
      }
      pb.dispose();
    };
    // 只有音频身份与素材进场会重建引擎：keySetId / seVolume / density 走下面的 setOptions
    // stageReady 是布尔量（派生表首次到位才翻一次），换谱面重新派生不会重建引擎 / 重载音频
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 故意只跟「音频身份 + 素材进场」：别的旋钮走 setOptions，重建就要重载音频
  }, [stageReady, audio, assets]);

  // 引擎侧 / 画布侧的旋钮：不重建引擎（重建一次就要把音频重新解码）
  useEffect(() => {
    playbackRef.current?.setOptions({ density, seVolume, keySetId, volume, rate });
  }, [density, seVolume, keySetId, volume, rate, stageReady]);

  // 谱面长度变化（切谱面 / 换工程）
  useEffect(() => {
    playbackRef.current?.setDuration(duration);
  }, [duration, stageReady]);

  // 谱面音符内容变化（工作台改谱 / 换谱面代码 / 切谱面）：重置回 00:00:0 并暂停
  const prevNotesRef = useRef(scene.notes);
  const prevChartIdRef = useRef(chartId);
  useEffect(() => {
    const chartChanged = prevChartIdRef.current !== chartId;
    prevChartIdRef.current = chartId;
    const notesChanged = !notesEqual(prevNotesRef.current, scene.notes);
    prevNotesRef.current = scene.notes;
    if (chartChanged || notesChanged) {
      playbackRef.current?.pause();
      playbackRef.current?.seek(0);
      onSecondsChange?.(0);
    }
  }, [scene.notes, chartId, onSecondsChange]);

  // 切走这一页就停声：保活挂载不做这件事，仿真场就会和别处的播放叠着响
  useEffect(() => {
    if (!active) playbackRef.current?.pause();
  }, [active]);

  // 一帧输入：谱面 / 设置 / 场地尺寸 / 素材任一变化都重推（内部按需重建键音事件表并立即重画）。
  // frameReady 还钉住「派生表属于当前 scene / 皮肤」：换谱面重新派生那几帧不推过期的表。
  useEffect(() => {
    const pb = playbackRef.current;
    const spriteIcon = spriteIconRef.current;
    if (!pb || !frameReady || !derived || !spriteIcon || !assets || !metrics || assets.missing) return;
    const input: SimFrameInput = {
      chart: derived.chart,
      scene,
      metrics,
      assets,
      noteIcons,
      spriteIcon,
      bpmEvents: derived.bpmEvents,
    };
    pb.setFrame(input);
    if (syncToken != null) onSyncComplete?.(syncToken);
    // skinVersion 是"图集到位"的信号：它不进 input，但要触发重推（暂停态那帧是缺图画的）
  }, [derived, frameReady, scene, metrics, assets, noteIcons, skinVersion, ready, syncToken, onSyncComplete]);

  const togglePlay = useCallback(() => playbackRef.current?.toggle(), []);
  const seekTo = useCallback((seconds: number) => {
    playbackRef.current?.seek(seconds);
    onSecondsChange?.(seconds);
  }, [onSecondsChange]);

  // 空格（play）页面级接管（issue 22 Q2）：预览页 active 时按空格 = 播放 / 暂停。
  // 焦点在 input / textarea / select 内由 hook 放行原生（与工作台同口径）；only 只认 play——
  // 表里其余编辑功能键不 preventDefault，放行浏览器自己的行为（如 Ctrl+D / Ctrl+T）。
  useShortcutDispatch({
    shortcutConfig: shortcuts,
    active,
    only: PLAY_ONLY,
    noRepeat: PLAYBACK_SHORTCUT_IDS,
    runFunction: useCallback((fn: FunctionId) => {
      switch (fn) {
        case 'play': togglePlay(); break;
        // issue 230：与工作台同一套预设档 / 步长；倍速读共享单点，音量写回 settings.audio.volume
        case 'rateDown': setRate(stepPlaybackRatePreset(getPlaybackRate(), -1)); break;
        case 'rateUp': setRate(stepPlaybackRatePreset(getPlaybackRate(), 1)); break;
        case 'volumeDown': onVolumeChange(stepAudioVolume(volumeRef.current, -1)); break;
        case 'volumeUp': onVolumeChange(stepAudioVolume(volumeRef.current, 1)); break;
      }
    }, [togglePlay, setRate, onVolumeChange]),
  });

  if (assets?.missing) {
    // 空态只陈述"加载失败 + 可能原因"，不摆取件命令：看到这个空态的是打包应用的使用者，
    // `npm run assets:sync` 是对开发者的话术，摆出来也跑不了（取件入口记在 scripts/README.md）。
    // 另一个原因是不该猜成因——素材没取件、和素材在包里但 URL 解析不到，在这一层长得一样。
    return (
      <div className="pv-stage is-empty" role="status">
        <p className="pv-empty__text">{t('preview.video.assetsMissing')}</p>
      </div>
    );
  }

  return (
    <div className="pv-stage">
      {/* 量尺那一层**恒在**：场地尺寸靠它测出来，若"还没测量"就不渲染它，就永远测不出来
          （loading 那一下是叠在场地层里的，不是另一套骨架） */}
      <div className="pv-field" ref={fieldRef}>
        {stageReady && metrics ? (
          <canvas
            ref={canvasRef}
            className="pv-field__canvas"
            style={{ width: metrics.w, height: metrics.h }}
            role="img"
            aria-label={t('preview.video.aria')}
          />
        ) : (
          <p className="preview-stage__pending">{t('preview.video.loading')}</p>
        )}
      </div>

      {/* 播放条（工作台同一件 PlayBar，issue 22）：外壳走 `--preview` 变体（舞台底部一行），
          倍速（票 20 的控件）接 `rateSlot`；时间码双击编辑在预览恒允许（Q3：有音频也允许，
          不照工作台 `canPlay` gate 走） */}
      <PlayBar
        variant="preview"
        isPlaying={tick.playing}
        currentSeconds={tick.seconds}
        duration={duration}
        volume={volume}
        canEditTime
        timePrecision={timePrecision}
        shortcutKey={formatKey(shortcuts.play)}
        rateSlot={<PlaybackRate value={rate} onChange={setRate} />}
        onTogglePlay={togglePlay}
        onVolumeChange={onVolumeChange}
        onSeek={seekTo}
      />
    </div>
  );
}
