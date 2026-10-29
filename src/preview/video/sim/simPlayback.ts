// 仿真场实时回放（ADR-0016 §5 的「实时」那一半；chart-preview 05）。
//
//   秒来自**自持的 `AudioEngine`**（ADR-0004 §2 双时钟：有音频走 `AudioContext`，无音频走合成时间线），
//   逐帧把 `drawSimFrameAt` 画进舞台画布。**任意秒出帧的那份实现就是 `simField.drawSimFrameAt`** ——
//   07 的离线逐帧导出复用它（导出自己驱动帧循环，不用本模块的 rAF）。
//
// 音频口径（用户 2026-10-07 定案）：仿真场**自持一个引擎**，读**作用域工程**的音频 ——
// 有音频放 BGM + 键音，无音频走合成时间线；作用域切到非当前工程也照样有正确的声源。
// 键音 = 同一份事件表（引擎的 `setChart` 内部就是 `AudioTiming.buildKeyEvents`，含"beat < 0 不键音"
// 与 hidden 结点不计）+ 同一份采样加载与音量口径（`settings.audio`）。
// 主音量不落设置（工作台那档是页面内状态），故这里用引擎默认 1（导出侧同一口径，07 不再改）。
import { PLAYBACK_RATE_RANGE, AudioEngine } from '../../../audio/AudioEngine';
import type { ChartNote } from '../../../chart/types';
import { drawSimFrameAt, type SimFrameInput } from './simField';

/** 倍速上下限 = 引擎既有的钳制区间（chart-preview 20 验收回修 #2：不为此改引擎，也不另立第二来源） */
export { PLAYBACK_RATE_RANGE };

/** 作用域工程的音频（null = 无音频 → 合成时间线） */
export interface SimPlaybackAudio {
  name: string;
  blob: Blob;
}

/** 倍速输入框里 ↑↓ 的步长 */
export const SIM_PLAYBACK_RATE_STEP = 0.1;

/**
 * 常用倍速档（面板里那一列）：**0.25× 起、2× 止**。
 * 区间上下限那两档**不进表**（0.1× 只有手填到得了）；手填值不受这张表限制。
 * 只在区间内、升序去重（锁测守）。
 */
export const SIM_PLAYBACK_RATE_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/**
 * 倍速归一化：上下限就是引擎的钳制区间（不另立第二来源），越界**就地钳回**；
 * 非法输入（空串 / 非数字 / NaN）回落 `fallback`（缺省 1 = 原速）。
 */
export function normalizePlaybackRate(raw: unknown, fallback: number = 1): number {
  const { min, max } = PLAYBACK_RATE_RANGE;
  const n = raw === '' || (typeof raw === 'string' && raw.trim() === '') ? Number.NaN : Number(raw);
  if (!Number.isFinite(n)) return Math.min(max, Math.max(min, fallback));
  return Math.min(max, Math.max(min, n));
}

export interface SimPlaybackOptions {
  /** 舞台画布（本模块负责它的**位图尺寸**与 transform） */
  canvas: HTMLCanvasElement;
  audio: SimPlaybackAudio | null;
  /** 键音素材包（`settings.audio.keySet`） */
  keySetId: string;
  /** 节奏图示 SE 音量（`settings.audio.seVolume`） */
  seVolume: number;
  /** 谱面长度（秒，ADR-0005 第一性）：播到这里停住 */
  duration: number;
  /**
   * 画布位图密度：**实时画布那套** `min(设备像素比, 画质档)`（逐帧直绘，与工作台画布同一行口径；ADR-0017 §2）。
   * 不用静态位图那套 `dpr × 超采样档`：那是给"出一次图"的链路用的，实时逐帧叠超采样只会白烧帧时间。
   * 导出侧的固定密度由 07 显式给（同 ADR-0016 §7 的"导出与预览解耦"）。
   */
  density: number;
  /** 播放器主音量（0..1；chart-preview 20；缺省 1） */
  volume?: number;
  /** 播放速率（缺省 1；任意落在 `PLAYBACK_RATE_RANGE` 内的值，步进取 0.25） */
  rate?: number;
  /** 初始播放秒数（恢复播放位置，防异步解码覆盖） */
  initialSeconds?: number;
  /** 每次推进 / 暂停 / seek 后回调（HUD 时间码与进度条读它，不自己轮询） */
  onTick?: (seconds: number, playing: boolean) => void;
}

export interface SimPlayback {
  /**
   * 换一帧的输入（谱面 / 设置 / 场地尺寸 / 素材变了就调它）：
   * 内部按需重建键音事件表（谱面或细分档变了才动）并立即重画。
   */
  setFrame(input: SimFrameInput): void;
  /**
   * 改引擎侧 / 画布侧的旋钮（画质档、SE 音量、键音包、主音量、倍速）：**不重建引擎、不重载音频** ——
   * 这些都随设置面板 / 播放条随时可动，重建一次就要把音频重新解码。
   */
  setOptions(patch: {
    density?: number;
    seVolume?: number;
    keySetId?: string;
    /** 播放器主音量（0..1；chart-preview 20） */
    volume?: number;
    /** 播放速率（chart-preview 20） */
    rate?: number;
  }): void;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(seconds: number): void;
  /** 换谱面长度（切谱面时；播放中会被新的终点截住） */
  setDuration(seconds: number): void;
  /** 立即重画当前秒（暂停态改设置 / 换尺寸后） */
  render(): void;
  dispose(): void;
}

/** 一次性把当前秒画出来（暂停态、seek 后、外部改设置后都用它） */
export function createSimPlayback(opts: SimPlaybackOptions): SimPlayback {
  const { canvas, density: initialDensity } = opts;
  let density = initialDensity;
  const engine = new AudioEngine();
  let frame: SimFrameInput | null = null;
  let rafId: number | null = null;
  let duration = Math.max(0, opts.duration);
  let disposed = false;
  /** 已经喂给引擎的谱面身份（换谱面 / 换细分档才重建键音表） */
  let fedNotes: ChartNote[] | null = null;
  let fedBeatDisplay = Number.NaN;
  /** 目标播放进度：防止引擎 load(file) 异步解码完成时将游标重置回 0 */
  let targetSeconds = Math.min(duration, Math.max(0, opts.initialSeconds ?? 0));

  engine.setKeySetId(opts.keySetId);
  engine.setSeVolume(opts.seVolume);
  engine.setVolume(opts.volume ?? 1);
  engine.setPlaybackRate(opts.rate ?? 1);
  if (targetSeconds > 0) {
    engine.seek(targetSeconds);
    opts.onTick?.(engine.getSeconds(), engine.isPlaying);
  }
  if (opts.audio) {
    const file = new File([opts.audio.blob], opts.audio.name);
    void engine.load(file).then(() => {
      if (disposed) return;
      // 引擎 load 内部会重置 offsetSeconds=0；若之前有目标进度且未起播，在此精准恢复。
      // 若解码期间用户已点击播放，AudioEngine.load 已平滑续播，不可强行拽回 targetSeconds。
      if (!engine.isPlaying && targetSeconds > 0) {
        engine.seek(targetSeconds);
        render();
        opts.onTick?.(engine.getSeconds(), engine.isPlaying);
      }
    }).catch((err: unknown) => {
      // 解码失败 = 按无音频回放（合成时间线照样能看谱），不打断页面
      console.warn('[preview] 仿真场音频解码失败，按无音频回放：', err);
    });
  }

  function syncChart(input: SimFrameInput): void {
    const { notes, beatDisplay } = input.scene;
    if (fedNotes === notes && fedBeatDisplay === beatDisplay) return;
    fedNotes = notes;
    fedBeatDisplay = beatDisplay;
    engine.setChart(notes, beatDisplay);
  }

  function render(): void {
    if (disposed || !frame) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { metrics } = frame;
    const bw = Math.max(1, Math.round(metrics.w * density));
    const bh = Math.max(1, Math.round(metrics.h * density));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    // transform 取「位图实际尺寸 / 场地尺寸」（照静态预览面板的同一口径）：
    // 精确写 density 会在取整后留下一点永不消失的重采样
    ctx.setTransform(bw / metrics.w, 0, 0, bh / metrics.h, 0, 0);
    drawSimFrameAt(ctx, frame, engine.getSeconds());
  }

  function stopRaf(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  /** 播放终点：到谱面长度就停住，停在末帧（ADR-0005 第一性） */
  function stopAtEnd(): void {
    engine.pause();
    engine.seek(duration);
  }

  function tick(): void {
    rafId = null;
    if (disposed) return;
    engine.tick();
    const seconds = engine.getSeconds();
    if (seconds >= duration) {
      stopAtEnd();
      render();
      opts.onTick?.(engine.getSeconds(), false);
      return;
    }
    render();
    opts.onTick?.(seconds, true);
    rafId = requestAnimationFrame(tick);
  }

  function play(): void {
    if (disposed || rafId !== null) return;
    if (engine.getSeconds() >= duration) {
      targetSeconds = 0;
      engine.seek(0);
    }
    void engine.play().then(() => {
      if (disposed) return;
      render();
      opts.onTick?.(engine.getSeconds(), engine.isPlaying);
      if (rafId === null) rafId = requestAnimationFrame(tick);
    });
  }

  function pause(): void {
    if (disposed) return;
    stopRaf();
    engine.pause();
    render();
    opts.onTick?.(engine.getSeconds(), false);
  }

  function seek(seconds: number): void {
    if (disposed) return;
    targetSeconds = Math.min(duration, Math.max(0, seconds));
    engine.seek(targetSeconds);
    render();
    opts.onTick?.(engine.getSeconds(), engine.isPlaying);
  }

  return {
    setFrame(input: SimFrameInput): void {
      frame = input;
      syncChart(input);
      render();
    },
    setOptions(patch): void {
      if (disposed) return;
      if (patch.density != null && Number.isFinite(patch.density) && patch.density > 0) density = patch.density;
      if (patch.seVolume != null) engine.setSeVolume(patch.seVolume);
      if (patch.keySetId != null) engine.setKeySetId(patch.keySetId);
      if (patch.volume != null) engine.setVolume(patch.volume);
      if (patch.rate != null) engine.setPlaybackRate(patch.rate);
      render();
    },
    play,
    pause,
    toggle(): void {
      if (engine.isPlaying) pause();
      else play();
    },
    seek,
    setDuration(seconds: number): void {
      duration = Math.max(0, seconds);
      if (engine.getSeconds() > duration) {
        stopRaf();
        stopAtEnd();
        render();
        opts.onTick?.(engine.getSeconds(), false);
      }
    },
    render,
    dispose(): void {
      disposed = true;
      stopRaf();
      engine.dispose();
      frame = null;
    },
  };
}
