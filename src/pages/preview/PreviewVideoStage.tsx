// 动态预览的舞台（chart-preview 05）：**装配层** —— 画面与回放全在 `src/preview/video/sim`，
// 本文件只做四件事：读素材 / 量舞台 / 建回放 / 画播放条。
//
//   - 素材：04 的**开发期直读通道**（`/__bestdori-assets/`）；缺席 → 空态 + 获取命令（04 的文案）
//   - 一帧输入：`buildSimChart`（谱面 → 元素表）+ `fitDesignSurface`（设计面 contain + 钳制）
//   - 回放：`createSimPlayback`（自持引擎当秒源；rAF 驱动**同一份**任意秒出帧函数）
//   - 播放条：播放/暂停 + 进度（可拖）+ 时间码 + 回开头（2026-10-07 用户定案：舞台底部一排，照 Bestdori）
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Repeat, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { formatTimePrecise, formatTimeWhole } from '../../chart/geometry/TimeFormat';
import type { AppSettings } from '../../chart/config/AppSettings';
import { t } from '../../i18n';
import { resolveCanvasDpr } from '../../rendering';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '../../rendering/skin/noteSkin';
import IconButton from '../../ui/IconButton';
import CanvasSpriteIcon from '../../ui/CanvasSpriteIcon';
import {
  SIM_PLAYBACK_RATES,
  buildSimChart,
  createSimPlayback,
  fitDesignSurface,
  loadSimAssets,
  type SimAssets,
  type SimFrameInput,
  type SimPlayback,
  type SimPlaybackAudio,
  type SimScene,
} from '../../preview';

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
}: PreviewVideoStageProps) {
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playbackRef = useRef<SimPlayback | null>(null);
  const spriteIconRef = useRef<CanvasSpriteIcon | null>(null);
  if (spriteIconRef.current === null) spriteIconRef.current = new CanvasSpriteIcon();

  const [assets, setAssets] = useState<SimAssets | null>(null);
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 });
  const [tick, setTick] = useState({ seconds: 0, playing: false });
  /** 皮肤图集到位后 +1：重推一帧（暂停态也要把缺图那帧补上） */
  const [skinVersion, setSkinVersion] = useState(0);
  /**
   * 播放器旋钮（chart-preview 20）：倍速与循环是"这一屏怎么看"（页面内 state，不落设置）；
   * 主音量落 `settings.audio.volume`（跨会话记住，07 的视频导出也按它取）。
   */
  const [rate, setRate] = useState<number>(1);
  const [loop, setLoop] = useState(false);

  const noteIcons = useMemo(() => buildActiveNoteIcons(normalizeNoteSkinSelection(noteSkin)), [noteSkin]);
  // 实时画布位图密度：画布那套口径（min(设备像素比, 档位)）——逐帧直绘，不叠超采样；
  // 导出侧的固定档由 07 显式给，不跟这里走
  const density = resolveCanvasDpr(imageQuality);

  // 音符皮肤图集预热（与静态预览同一套）
  useEffect(() => {
    let cancelled = false;
    void CanvasSpriteIcon.ensureImagesLoaded(noteIcons.preloadSrcs())
      .catch((e) => console.warn('[preview] 仿真场音符皮肤预热失败（按缺图渲染）:', e))
      .then(() => { if (!cancelled) setSkinVersion((v) => v + 1); });
    return () => { cancelled = true; };
  }, [noteIcons]);

  // 场地素材（只走 04 的直读通道）：缺席 = 空态。带体取色跟皮肤走 → 皮肤换了重读一次
  useEffect(() => {
    let cancelled = false;
    void loadSimAssets({ bandSrc: noteIcons.slideBand.src, bandSpSrc: noteIcons.slideBandSp.src })
      .then((next) => { if (!cancelled) setAssets(next); });
    return () => { cancelled = true; };
  }, [noteIcons]);

  // 谱面 → 仿真场派生表（元素 / 带体 / 同时点击线 / combo 时刻）
  const chart = useMemo(() => buildSimChart(scene, noteIcons), [scene, noteIcons]);

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
  const ready = metrics != null && assets != null && !assets.missing;

  // ---------------- 回放：只在「音频身份」或「素材」变化时重建（引擎不随设置面板抖） ----------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const currentAssets = assets;
    if (!ready || !canvas || !currentAssets) return;
    const pb = createSimPlayback({
      canvas,
      audio,
      keySetId,
      seVolume,
      volume,
      rate,
      loop,
      duration,
      density,
      onTick: (seconds, playing) => {
        setTick((prev) => (prev.seconds === seconds && prev.playing === playing ? prev : { seconds, playing }));
      },
    });
    playbackRef.current = pb;
    return () => {
      playbackRef.current = null;
      pb.dispose();
    };
    // 只有音频身份与素材进场会重建引擎：keySetId / seVolume / density 走下面的 setOptions
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 故意只跟「音频身份 + 素材进场」：别的旋钮走 setOptions，重建就要重载音频
  }, [ready, audio, assets]);

  // 引擎侧 / 画布侧的旋钮：不重建引擎（重建一次就要把音频重新解码）
  useEffect(() => {
    playbackRef.current?.setOptions({ density, seVolume, keySetId, volume, rate, loop });
  }, [density, seVolume, keySetId, volume, rate, loop, ready]);

  // 谱面长度变化（切谱面 / 换工程）
  useEffect(() => {
    playbackRef.current?.setDuration(duration);
  }, [duration, ready]);

  // 切走这一页就停声：保活挂载不做这件事，仿真场就会和别处的播放叠着响
  useEffect(() => {
    if (!active) playbackRef.current?.pause();
  }, [active]);

  // 一帧输入：谱面 / 设置 / 场地尺寸 / 素材任一变化都重推（内部按需重建键音事件表并立即重画）
  useEffect(() => {
    const pb = playbackRef.current;
    const spriteIcon = spriteIconRef.current;
    if (!pb || !spriteIcon || !assets || !metrics || assets.missing) return;
    const input: SimFrameInput = { chart, scene, metrics, assets, noteIcons, spriteIcon };
    pb.setFrame(input);
    // skinVersion 是"图集到位"的信号：它不进 input，但要触发重推（暂停态那帧是缺图画的）
  }, [chart, scene, metrics, assets, noteIcons, skinVersion, ready]);

  const togglePlay = useCallback(() => playbackRef.current?.toggle(), []);
  const restart = useCallback(() => playbackRef.current?.restart(), []);
  const seekTo = useCallback((seconds: number) => playbackRef.current?.seek(seconds), []);

  if (assets?.missing) {
    // 空态（04 定案：必须**直接给出获取命令**，不是一句"素材缺失"）
    return (
      <div className="pv-stage is-empty" role="status">
        <p className="pv-empty__text">{t('preview.video.assetsMissing')}</p>
        <code className="pv-empty__cmd">{t('preview.video.assetsCommand')}</code>
      </div>
    );
  }

  const playLabel = tick.playing ? t('preview.video.pause') : t('preview.video.play');
  // 进度条量程：谱面长度为 0（还没读到记录）时给个非零量程 —— `range` 不接受 min === max
  const seekMax = duration > 0 ? duration : 1;
  return (
    <div className="pv-stage">
      {/* 量尺那一层**恒在**：场地尺寸靠它测出来，若"还没测量"就不渲染它，就永远测不出来
          （loading 那一下是叠在场地层里的，不是另一套骨架） */}
      <div className="pv-field" ref={fieldRef}>
        {ready && metrics ? (
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

      {/* 播放条（2026-10-07 用户定案：舞台底部一排；chart-preview 20 起补播放器控件 ——
          倍速五档 / 循环 / 主音量，照 Bestdori 的播放器那一排）：播放/暂停 + 当前时间 + 进度（可拖）
          + 总时长 + 回开头 + 倍速 + 循环 + 音量 */}
      <div className="pv-bar">
        <IconButton
          width="auto"
          size="sm"
          icon={tick.playing ? <Pause size={15} /> : <Play size={15} />}
          title={playLabel}
          aria-label={playLabel}
          onClick={togglePlay}
        />
        <span className="pv-bar__time">{formatTimePrecise(tick.seconds)}</span>
        <input
          className="pv-bar__seek"
          type="range"
          min={0}
          max={seekMax}
          step={0.05}
          value={Math.min(tick.seconds, seekMax)}
          aria-label={t('preview.video.seek')}
          onChange={(e) => seekTo(Number(e.target.value))}
        />
        <span className="pv-bar__time">{formatTimeWhole(duration)}</span>
        <IconButton
          width="auto"
          size="sm"
          icon={<RotateCcw size={15} />}
          title={t('preview.video.restart')}
          aria-label={t('preview.video.restart')}
          onClick={restart}
        />

        {/* 倍速（五档，照 Bestdori）：只改回放速度，进度条量程仍是谱面秒 */}
        <select
          className="select-control pv-bar__rate"
          value={String(rate)}
          aria-label={t('preview.video.rate')}
          title={t('preview.video.rate')}
          onChange={(e) => setRate(Number(e.target.value))}
        >
          {SIM_PLAYBACK_RATES.map((r) => (
            <option key={r} value={String(r)}>{r}×</option>
          ))}
        </select>

        {/* 循环：到谱面长度回绕到 0 继续（关 = 停在末帧） */}
        <IconButton
          width="auto"
          size="sm"
          active={loop}
          icon={<Repeat size={15} />}
          title={t('preview.video.loop')}
          aria-label={t('preview.video.loop')}
          aria-pressed={loop}
          onClick={() => setLoop((prev) => !prev)}
        />

        {/* 主音量（图标 + 滑杆，照工作台播放条那套）：落 settings.audio.volume */}
        <label className="pv-bar__volume" title={t('preview.video.volume')}>
          {volume <= 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            aria-label={t('preview.video.volume')}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
          />
        </label>
      </div>
    </div>
  );
}
