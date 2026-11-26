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
// 主音量由 `settings.audio.volume`（票 60 起三处播放条共读写）经 `opts.volume` / `setOptions` 传入；
// 没传时回落引擎默认 1（其出厂值也是 1；导出侧同一口径，07 不再改）。
import { AudioEngine } from '../../../audio/AudioEngine';
import type { ChartNote } from '../../../chart/types';
import { drawSimFrameAt, prepareSimComboSprites, prepareSimFieldBitmap, prepareSimLifeGauge, type SimFrameInput, type SimFrameLayers } from './simField';

/**
 * 票 87：尺寸烘培让出约一帧。`scheduler.yield()` / `setTimeout(0)` 在播放中会排进同一帧
 * 立刻续上，ResizeObserver 与 `transferToImageBitmap` / 画布涨尺寸仍会叠成一次 longtask。
 */
function yieldPlaybackFrame(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 16); });
}

// 倍速的区间 / 常用档 / 步长 / 归一化随控件抽到 `src/playback/playbackRateState`（chart-preview 58，
// 引擎的 PLAYBACK_RATE_RANGE 仍是唯一真相源）。这里按旧名原样再导出，保住预览域 barrel 与
// 既有消费方 / 锁测的导入路径（对象引用不变，SimPlayback.test.ts 的 toBe 不受影响）。
export {
  PLAYBACK_RATE_RANGE,
  SIM_PLAYBACK_RATE_PRESETS,
  SIM_PLAYBACK_RATE_STEP,
  normalizePlaybackRate,
} from '../../../playback/playbackRateState';

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
  bandRenderer?: SimFrameLayers['bandRenderer'];
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
  setKeepPausedAudioReady(keep: boolean): void;
  /** 立即重画当前秒（暂停态改设置 / 换尺寸后） */
  render(): void;
  dispose(): void;
}

/** 一次性把当前秒画出来（暂停态、seek 后、外部改设置后都用它） */
export function createSimPlayback(opts: SimPlaybackOptions): SimPlayback {
  const { canvas, density: initialDensity } = opts;
  const layers: SimFrameLayers = { bandRenderer: opts.bandRenderer };
  let density = initialDensity;
  let fieldBitmapDensity = 0;
  /** 票 87：同一套素材 / 亮度 / 密度下按场地尺寸留最近两档底图，全屏往返不必重烤 */
  const fieldBitmaps = new Map<string, ImageBitmap>();
  let fieldBakeGen = 0;
  let pendingSizeInput: SimFrameInput | null = null;
  let shrinkGen = 0;
  let pendingShrink: { bw: number; bh: number } | null = null;
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
    // 票 69：键音表复用画面派生同一份 BPM 事件（缺省时引擎自己从 notes 提取）
    engine.setChart(notes, beatDisplay, input.bpmEvents);
  }

  function fieldSizeKey(input: SimFrameInput): string {
    return `${Math.round(input.metrics.w)}x${Math.round(input.metrics.h)}`;
  }

  function closeFieldBitmaps(): void {
    for (const bitmap of fieldBitmaps.values()) bitmap.close();
    fieldBitmaps.clear();
    layers.fieldBitmap = undefined;
  }

  function rememberFieldBitmap(key: string, bitmap: ImageBitmap): void {
    const previous = fieldBitmaps.get(key);
    if (previous && previous !== bitmap) previous.close();
    fieldBitmaps.delete(key);
    fieldBitmaps.set(key, bitmap);
    while (fieldBitmaps.size > 2) {
      const oldest = fieldBitmaps.keys().next().value;
      if (oldest == null || oldest === key) break;
      const evicted = fieldBitmaps.get(oldest);
      fieldBitmaps.delete(oldest);
      if (evicted && evicted !== layers.fieldBitmap) evicted.close();
    }
  }

  function installHud(input: SimFrameInput): SimFrameInput {
    layers.lifeGauge = input.scene.showGameUi === false
      ? undefined
      : prepareSimLifeGauge(
        input.metrics,
        density,
        input.assets.hud,
        input.scene.autoMode ?? false,
        input.chart.hitTimes.length,
      );
    layers.comboShadows = undefined;
    try {
      layers.comboShadows = prepareSimComboSprites(input.metrics, input.assets.sprites, density);
      return input;
    } catch (e) {
      // 字形回读 / 瓦片不可用时走既有缺精灵画法，不能在热路径中反复重试同一个失败。
      console.warn('[preview] combo 准备失败（按缺精灵渲染）:', e);
      return { ...input, assets: { ...input.assets, sprites: null } };
    }
  }

  function bakeFieldSync(input: SimFrameInput): void {
    const key = fieldSizeKey(input);
    const cached = fieldBitmaps.get(key);
    if (cached) {
      fieldBitmaps.delete(key);
      fieldBitmaps.set(key, cached);
      layers.fieldBitmap = cached;
      fieldBitmapDensity = density;
      return;
    }
    const bitmap = prepareSimFieldBitmap(input, density);
    fieldBitmapDensity = density;
    if (bitmap) {
      rememberFieldBitmap(key, bitmap);
      layers.fieldBitmap = bitmap;
    } else {
      layers.fieldBitmap = undefined;
    }
  }

  function cancelSizeBake(): void {
    pendingSizeInput = null;
    fieldBakeGen += 1;
  }

  function cancelBackingShrink(): void {
    pendingShrink = null;
    shrinkGen += 1;
  }

  /**
   * 票 88：退全屏当帧先复用旧尺寸 backing store（保留票 87 退出全屏零同步撕毁），
   * 让出两帧后再回缩到窗口目标像素 `bw × bh`，消除窗口态长期按全屏分辨率超分渲染与非整数拉伸。
   */
  function scheduleBackingShrink(bw: number, bh: number): void {
    if (pendingShrink && pendingShrink.bw === bw && pendingShrink.bh === bh) return;
    pendingShrink = { bw, bh };
    const gen = ++shrinkGen;
    void (async () => {
      try {
        await yieldPlaybackFrame();
        await yieldPlaybackFrame();
        if (disposed || gen !== shrinkGen || pendingSizeInput || !frame) return;
        const curBw = Math.max(1, Math.round(frame.metrics.w * density));
        const curBh = Math.max(1, Math.round(frame.metrics.h * density));
        if (curBw !== bw || curBh !== bh) return;
        if (canvas.width <= curBw && canvas.height <= curBh) return;
        canvas.width = curBw;
        canvas.height = curBh;
        render();
      } finally {
        if (gen === shrinkGen) pendingShrink = null;
      }
    })();
  }

  function queueSizeBake(input: SimFrameInput): void {
    pendingSizeInput = input;
    const gen = ++fieldBakeGen;
    void (async () => {
      // ResizeObserver 当帧先让出约两帧，播放循环能先用旧底图出画。
      await yieldPlaybackFrame();
      await yieldPlaybackFrame();
      if (disposed || gen !== fieldBakeGen) return;
      const pending = pendingSizeInput;
      if (!pending) return;
      const key = fieldSizeKey(pending);
      let bitmap = fieldBitmaps.get(key);
      if (!bitmap) {
        bitmap = prepareSimFieldBitmap(pending, density);
        if (bitmap) rememberFieldBitmap(key, bitmap);
      }
      await yieldPlaybackFrame();
      if (disposed || gen !== fieldBakeGen) return;
      const life = pending.scene.showGameUi === false
        ? undefined
        : prepareSimLifeGauge(
          pending.metrics,
          density,
          pending.assets.hud,
          pending.scene.autoMode ?? false,
          pending.chart.hitTimes.length,
        );
      let hud: SimFrameInput = pending;
      let combo = undefined as typeof layers.comboShadows;
      try {
        combo = prepareSimComboSprites(pending.metrics, pending.assets.sprites, density);
      } catch (e) {
        console.warn('[preview] combo 准备失败（按缺精灵渲染）:', e);
        hud = { ...pending, assets: { ...pending.assets, sprites: null } };
      }
      await yieldPlaybackFrame();
      if (disposed || gen !== fieldBakeGen) return;
      pendingSizeInput = null;
      layers.fieldBitmap = bitmap;
      layers.lifeGauge = life;
      layers.comboShadows = combo;
      fieldBitmapDensity = density;
      frame = hud;
      syncChart(hud);
      render();
    })();
  }

  function prepareFrame(input: SimFrameInput): SimFrameInput {
    const previous = frame;
    const materialChanged = previous == null
      || previous.assets !== input.assets
      || previous.scene.bgBrightness !== input.scene.bgBrightness
      || fieldBitmapDensity !== density
      || layers.fieldBitmap == null;
    if (materialChanged || previous == null) {
      cancelSizeBake();
      if (previous != null) closeFieldBitmaps();
      bakeFieldSync(input);
      return installHud(input);
    }
    const sizeChanged = fieldSizeKey(previous) !== fieldSizeKey(input);
    if (!sizeChanged) {
      cancelSizeBake();
      return installHud(input);
    }
    const cached = fieldBitmaps.get(fieldSizeKey(input));
    if (cached) {
      cancelSizeBake();
      fieldBitmaps.delete(fieldSizeKey(input));
      fieldBitmaps.set(fieldSizeKey(input), cached);
      layers.fieldBitmap = cached;
      return installHud(input);
    }
    // 票 87：全屏 / 窗口尺寸变了先继续用旧底图（CSS 拉伸），烘新图放到让出后的任务。
    queueSizeBake(input);
    return installHud({ ...input, metrics: previous.metrics });
  }

  function render(): void {
    if (disposed || !frame) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { metrics } = frame;
    const bw = Math.max(1, Math.round(metrics.w * density));
    const bh = Math.max(1, Math.round(metrics.h * density));
    if (canvas.width < bw || canvas.height < bh) {
      cancelBackingShrink();
      if (canvas.width < bw) canvas.width = bw;
      if (canvas.height < bh) canvas.height = bh;
    } else if (!pendingSizeInput && (canvas.width > bw || canvas.height > bh)) {
      scheduleBackingShrink(bw, bh);
    } else {
      cancelBackingShrink();
    }
    // transform 取「位图实际尺寸 / 场地尺寸」（照静态预览面板的同一口径）：
    // 精确写 density 会在取整后留下一点永不消失的重采样。过渡帧中画布可能暂时大于场地，
    // 用实际 backing store 铺满，CSS 再把整张图画进舞台。
    ctx.setTransform(canvas.width / metrics.w, 0, 0, canvas.height / metrics.h, 0, 0);
    drawSimFrameAt(ctx, frame, Math.min(duration, engine.getVisualSeconds()), layers);
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
      if (disposed) return;
      // 准备完成后才把新输入交给出帧；同步边界没有可迟到覆盖新尺寸 / 素材的异步结果。
      frame = prepareFrame(input);
      syncChart(input);
      render();
    },
    setOptions(patch): void {
      if (disposed) return;
      if (patch.density != null && Number.isFinite(patch.density) && patch.density > 0 && patch.density !== density) {
        density = patch.density;
        if (frame) frame = prepareFrame(frame);
      }
      if (patch.seVolume != null) engine.setSeVolume(patch.seVolume);
      if (patch.keySetId != null) engine.setKeySetId(patch.keySetId);
      if (patch.volume != null) engine.setVolume(patch.volume);
      if (patch.rate != null) engine.setPlaybackRate(patch.rate);
      render();
    },
    play,
    pause,
    setKeepPausedAudioReady: keep => engine.setKeepPausedAudioReady(keep),
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
      cancelSizeBake();
      cancelBackingShrink();
      stopRaf();
      engine.dispose();
      frame = null;
      closeFieldBitmaps();
      layers.lifeGauge = undefined;
      layers.comboShadows = undefined;
    },
  };
}
