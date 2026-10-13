// 动态预览的舞台（chart-preview 05）：**装配层** —— 画面与回放全在 `src/preview/video/sim`，
// 本文件只做四件事：读素材 / 量舞台 / 建回放 / 画播放条。
//
//   - 素材：运行时素材树 `public/assets/sim/`（URL 前缀 `SIM_ASSET_BASE`，跟着构建 base）；
//     缺席 → 空态 + 获取命令（04 的文案）
//   - 一帧输入：`buildSimChart`（谱面 → 元素表）+ `fitDesignSurface`（设计面 contain + 钳制）
//   - 回放：`createSimPlayback`（自持引擎当秒源；rAF 驱动**同一份**任意秒出帧函数）
//   - 播放条：工作台同一件 `PlayBar`（issue 22 起复用）：播放/暂停 + 时间码（可双击编辑）
//     + 进度（可拖）+ 音量；倍速（票 20 的 `PlaybackRate`）接 `rateSlot`。空格由本层挂着
//     的 `useShortcutDispatch` 页面级接管（只认 play，Q2）。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Gauge } from 'lucide-react';
import type { AppSettings } from '../../chart/config/AppSettings';
import { formatKey, type FunctionId, type ShortcutConfig } from '../../chart/config/ShortcutConfig';
import { useShortcutDispatch } from '../../chart/config/useShortcutDispatch';
import { notesEqual } from '../../chart/editing/NotesEqual';
import { t } from '../../i18n';
import PlayBar from '../../playback/PlayBar';
import { resolveCanvasDpr } from '../../rendering';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '../../rendering/skin/noteSkin';
import IconButton from '../../ui/IconButton';
import CanvasSpriteIcon from '../../ui/CanvasSpriteIcon';
import {
  PLAYBACK_RATE_RANGE,
  SIM_PLAYBACK_RATE_PRESETS,
  SIM_PLAYBACK_RATE_STEP,
  buildSimChart,
  createSimPlayback,
  fitDesignSurface,
  loadSimAssets,
  normalizePlaybackRate,
  type SimAssets,
  type SimFrameInput,
  type SimPlayback,
  type SimPlaybackAudio,
  type SimScene,
} from '../../preview';

/** 浮点噪声收味：0.1 的倍数本身不精确，"自定义值 + 步进"混用会攒出 1.3000000000000003 一类的尾巴 */
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** 倍速文案：整数不带小数（`1×` / `2×`），手填的值原样（`1.35×`） */
function formatRate(rate: number): string {
  return `${rate}×`;
}

/** 预览页只接管 play 这一个功能键（issue 22 Q2）：其余绑定放行原生行为，不吞浏览器键（引用稳定） */
const PLAY_ONLY: readonly FunctionId[] = ['play'];

/**
 * 倍速控件（chart-preview 20）：触钮 = 播放条那一排的**同款图标钮**（速度表图标 + 当前倍速），
 * 点开在它上方给**一列**常用档 + 一个自定义输入。
 *
 * 手填**敲一下就生效**（范围内立刻应用到回放；越界 / 半截输入不动，等失焦或回车才钳回）；
 * 回车只是"确认"，不关面板。上下限取引擎的 `PLAYBACK_RATE_RANGE`；只改回放速度，
 * 不碰进度条量程（由调用方保证）。值由父级持有，这里只有"正在输入"的草稿态 ——
 * 手填期间不让 `value` 回写冲掉半截输入（否则 `1.50` 会被冲成 `1.5`）。
 */
function PlaybackRate({ value, onChange }: { value: number; onChange: (rate: number) => void }) {
  const [draft, setDraft] = useState(() => String(value));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** 正在手填（见组件头注：此刻不让 `value` 覆盖草稿） */
  const editingRef = useRef(false);
  const { min, max } = PLAYBACK_RATE_RANGE;

  // 选档 / 外部改值 → 输入框跟着走；手填期间不动
  useEffect(() => {
    if (editingRef.current) return;
    setDraft(String(value));
  }, [value]);

  // 面板：点外面 / Esc 收起（照站内浮层的口径，不做"焦点陷阱"）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const togglePanel = useCallback(() => {
    if (!open) {
      // 每次打开都是干净的那一次：上次没确认的输入不留着误导人
      editingRef.current = false;
      setDraft(String(value));
    }
    setOpen((prev) => !prev);
  }, [open, value]);

  /** 手填：范围内立刻生效；空的 / 半截的 / 越界的都不动（等确认时再钳回，免得刚敲下就被拉回去） */
  const applyLive = useCallback((raw: string) => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) return;
    if (n < PLAYBACK_RATE_RANGE.min || n > PLAYBACK_RATE_RANGE.max) return;
    if (n === value) return;
    onChange(n);
  }, [onChange, value]);

  /** 确认（失焦 / 回车）：非法输入回落当前值，越界就地钳回，并把钳后值回显进输入框 */
  const commit = useCallback((raw: string) => {
    const next = normalizePlaybackRate(raw, value);
    editingRef.current = false;
    onChange(next);
    setDraft(String(next));
  }, [onChange, value]);

  const step = useCallback((dir: 1 | -1) => {
    const next = normalizePlaybackRate(round4(value + dir * SIM_PLAYBACK_RATE_STEP), value);
    setDraft(String(next)); // 手填中按 ↑↓ 也要让输入框跟着走
    onChange(next);
  }, [onChange, value]);

  /** 手填值在范围外：给个"确认时会被拉回来"的提示色 */
  const draftNumber = Number(draft);
  const outOfRange = draft.trim() !== '' && Number.isFinite(draftNumber) && (draftNumber < min || draftNumber > max);

  return (
    <div className="pv-rate" ref={rootRef}>
      {/* 不做"选中"态：当前倍速就写在钮上；它是菜单不是开关，不该带 `aria-pressed` 语义 */}
      <IconButton
        width="auto"
        size="sm"
        icon={<Gauge size={15} />}
        label={formatRate(value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('preview.video.rate')}
        onClick={togglePanel}
      />

      {open && (
        <div className="pv-rate__panel" role="menu" aria-label={t('preview.video.rate')}>
          {SIM_PLAYBACK_RATE_PRESETS.map((r) => (
            <button
              key={r}
              type="button"
              role="menuitem"
              className={`pv-rate__option${r === value ? ' is-active' : ''}`}
              aria-current={r === value}
              onClick={() => {
                onChange(r);
                setOpen(false);
              }}
            >
              {formatRate(r)}
            </button>
          ))}

          <label className="pv-rate__custom">
            <span className="pv-rate__custom-label">{t('preview.video.rate.custom')}</span>
            <input
              className={`pv-rate__value${outOfRange ? ' is-out-of-range' : ''}`}
              type="number"
              inputMode="decimal"
              min={min}
              max={max}
              // 不是 `step={SIM_PLAYBACK_RATE_STEP}`：那样浏览器会把 1.35 这类手填值判成 step 不匹配
              // （`:invalid` + 原生箭头把值吸到网格上）。步长由 ↑↓ 自己按那个常量走。
              step="any"
              value={draft}
              onFocus={(e) => {
                editingRef.current = true;
                e.currentTarget.select(); // 聚焦即全选：直接覆写，不用手动删
              }}
              onChange={(e) => {
                editingRef.current = true;
                setDraft(e.target.value);
                applyLive(e.target.value);
              }}
              onBlur={() => commit(draft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit(draft); // 回车 = 确认（越界的钳回），面板不关，方便连着试
                } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  step(e.key === 'ArrowUp' ? 1 : -1);
                }
              }}
            />
            <span className="pv-rate__unit" aria-hidden="true">×</span>
          </label>
        </div>
      )}
    </div>
  );
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
  /** 快捷键配置（空格页面级接管 play，issue 22 Q2）：由页面从 `settings.shortcuts` 传 */
  shortcuts: ShortcutConfig;
  /** 当前看哪张谱面（切谱面重置秒数） */
  chartId?: string | null;
  /** 初始/恢复播放秒数（切回页面或切回动态形态时恢复） */
  initialSeconds?: number;
  /** 播放秒数变动回调（通知父层记忆最新进度） */
  onSecondsChange?: (seconds: number) => void;
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
  shortcuts,
  chartId,
  initialSeconds,
  onSecondsChange,
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
   * 播放器旋钮（chart-preview 20）：倍速是"这一屏怎么看"（页面内 state，不落设置）；
   * 主音量落 `settings.audio.volume`（跨会话记住，07 的视频导出也按它取）。
   * 「回开头」「循环」不给入口：回放那一层的循环能力还在，只是没有 UI 调它。
   */
  const [rate, setRate] = useState<number>(1);

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
      duration,
      density,
      initialSeconds,
      onTick: (seconds, playing) => {
        setTick((prev) => (prev.seconds === seconds && prev.playing === playing ? prev : { seconds, playing }));
        onSecondsChange?.(seconds);
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
    playbackRef.current?.setOptions({ density, seVolume, keySetId, volume, rate });
  }, [density, seVolume, keySetId, volume, rate, ready]);

  // 谱面长度变化（切谱面 / 换工程）
  useEffect(() => {
    playbackRef.current?.setDuration(duration);
  }, [duration, ready]);

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
    runFunction: useCallback((fn: FunctionId) => {
      if (fn === 'play') togglePlay();
    }, [togglePlay]),
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
        shortcutKey={formatKey(shortcuts.play)}
        rateSlot={<PlaybackRate value={rate} onChange={setRate} />}
        onTogglePlay={togglePlay}
        onVolumeChange={onVolumeChange}
        onSeek={seekTo}
      />
    </div>
  );
}
