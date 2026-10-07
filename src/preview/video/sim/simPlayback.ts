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
import { AudioEngine } from '../../../audio/AudioEngine';
import type { ChartNote } from '../../../chart/types';
import { drawSimFrameAt, type SimFrameInput } from './simField';

/** 作用域工程的音频（null = 无音频 → 合成时间线） */
export interface SimPlaybackAudio {
  name: string;
  blob: Blob;
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
   * 改引擎侧 / 画布侧的旋钮（画质档、SE 音量、键音包）：**不重建引擎、不重载音频** ——
   * 这三样都随设置面板随时可动，重建一次就要把音频重新解码。
   */
  setOptions(patch: { density?: number; seVolume?: number; keySetId?: string }): void;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(seconds: number): void;
  /** 回到开头（停在暂停态） */
  restart(): void;
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

  engine.setKeySetId(opts.keySetId);
  engine.setSeVolume(opts.seVolume);
  if (opts.audio) {
    const file = new File([opts.audio.blob], opts.audio.name);
    void engine.load(file).catch((err: unknown) => {
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

  /** 播放终点：到谱面长度就停住（不回绕），停在末帧 */
  function stopAtEnd(): void {
    engine.pause();
    engine.seek(duration);
  }

  function tick(): void {
    rafId = null;
    if (disposed) return;
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
    if (engine.getSeconds() >= duration) engine.seek(0);
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
    engine.seek(Math.min(duration, Math.max(0, seconds)));
    render();
    opts.onTick?.(engine.getSeconds(), engine.isPlaying);
  }

  return {
    setFrame(input: SimFrameInput): void {
      frame = input;
      syncChart(input);
      render();
    },
    setOptions(patch: { density?: number; seVolume?: number; keySetId?: string }): void {
      if (disposed) return;
      if (patch.density != null && Number.isFinite(patch.density) && patch.density > 0) density = patch.density;
      if (patch.seVolume != null) engine.setSeVolume(patch.seVolume);
      if (patch.keySetId != null) engine.setKeySetId(patch.keySetId);
      render();
    },
    play,
    pause,
    toggle(): void {
      if (engine.isPlaying) pause();
      else play();
    },
    seek,
    restart(): void {
      seek(0);
    },
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
      engine.pause();
      engine.clear();
      frame = null;
    },
  };
}
