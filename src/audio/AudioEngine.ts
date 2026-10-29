// 音频播放引擎（渲染进程 Web Audio，ticket 03 定案 + ADR-0004 修订）：
// - 播放：AudioContext + AudioBufferSourceNode（精确 seek，不用 HTMLAudioElement）
// - 解码：渲染进程 decodeAudioData（SongUploader → File → ArrayBuffer → decode，不动主进程）
// - 按键音：RAF 驱动 tick()，提前 ~100ms 预调度；每次新建 oscillator（Web Audio 禁止复停 oscillator）
// - 双时钟（ADR-0004 §2）：有音频 = AudioContext 时间线；无音频 = performance.now + RAF 合成时间线，照常"播放谱面"
import type { ChartNote } from '../chart/types';
import { getBpmEvents, buildKeyEvents, type KeySoundEvent } from './AudioTiming';
import { loadKeySoundSet, type KeySoundSet, type KeySoundKind } from './KeySound';
// chart-preview 07：采样加载与发声已抽到 `keySoundSamples`（离线音轨要用同一份口径），
// 本引擎只是它的一个消费方 —— 键音的音量 / 包络 / 采样路径解析都不在这里定义
import {
  keySoundBank,
  sampleSrcFor,
  scheduleKeySample,
  scheduleKeyTone,
  touchAudioBuffer,
} from './keySoundSamples';

export type PlaybackState = 'idle' | 'ready' | 'playing' | 'paused';

/** 按键音预调度提前量（秒）：需覆盖后台页 setInterval 被节流到 ~1s 的最坏间隔，避免切后台后丢音（bug 33） */
const KEY_SCHEDULE_AHEAD = 2.0;
/** 调度器驱动间隔（秒）：不依赖 rAF（页面切后台 rAF 会被浏览器暂停），用 setInterval 脱离 rAF 持续推进按键音调度 */
const SCHEDULE_INTERVAL = 0.2;
/** 播放速率钳制（chart-preview 20）：倍速是**连续值**（滑到哪算哪），这个区间既是上下限也是回收区间 */
export const PLAYBACK_RATE_RANGE = { min: 0.1, max: 4 } as const;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private masterGain: GainNode | null = null;
  /** 节奏图示 SE 音量（issue 39 #7）：独立于背景音乐的键音 GainNode，插在 masterGain 之前 */
  private seGain: GainNode | null = null;
  /** SE 音量暂存（ctx 未建时记录，建 seGain 时应用） */
  private seVolume = 1;
  /** 主音量暂存（同上；chart-preview 20 起播放器主音量走 `setVolume`） */
  private volume = 1;
  private offsetSeconds = 0;
  private startCtxSecond = 0;
  private startPerfSecond = 0;
  /** 播放速率（chart-preview 20）：BGM（`playbackRate`）与两条时钟一起缩放，键音经同一份时钟换算 */
  private rate = 1;
  private clock: 'audio' | 'synthetic' = 'synthetic';
  private state: PlaybackState = 'idle';
  private loadGen = 0;

  private keyEvents: KeySoundEvent[] = [];
  /** 下一个待调度的按键音下标（推进式游标，避免每帧全量扫描大谱面） */
  private keyIndex = 0;
  private scheduled = new Set<AudioScheduledSourceNode>();
  /** 当前激活素材包 id（issue 29 多包注册表；加载在途时保留最新一次切换的 id） */
  private keySetId = '';
  /** 当前激活素材包（ADR-0004 §7）；null = chunk 未加载完成/加载失败（走振荡器兜底） */
  private keySet: KeySoundSet | null = null;
  /** 当前 keySetId 是否正在异步加载中（防相同 id 重复 setOptions 把已就绪或加载中的 keySet 清空） */
  private keySetLoading = false;
  /** 是否已向音频混合图注入过非零微脉冲预热（issue 179） */
  private audioGraphPrimed = false;
  /** 按键音调度器定时器（bug 33：脱离 rAF，切后台仍持续推进调度；无则未在播放） */
  private schedTimer: ReturnType<typeof setInterval> | null = null;

  get isPlaying(): boolean {
    return this.state === 'playing';
  }

  /** ADR-0004 §2：合成时间线使无音频也可播放 → canPlay 恒真 */
  get canPlay(): boolean {
    return true;
  }

  /** 当前播放位置（秒）；未播放时为偏移量（暂停位/0）。双时钟：有音频走 AudioContext，无音频走 performance.now。
   *  **位置是谱面秒**：两条时钟的经过时间都要乘播放速率（chart-preview 20 的倍速）。 */
  getSeconds(): number {
    if (this.state === 'playing') {
      if (this.clock === 'audio' && this.ctx) {
        return this.offsetSeconds + (this.ctx.currentTime - this.startCtxSecond) * this.rate;
      }
      return this.offsetSeconds + (performance.now() / 1000 - this.startPerfSecond) * this.rate;
    }
    return this.offsetSeconds;
  }

  /** 有音频时的总时长（秒）；无音频返回 null（由调用方按谱面末端/默认给时长） */
  get duration(): number | null {
    return this.buffer ? this.buffer.duration : null;
  }

  /**
   * 切换激活素材包（issue 29）：动态 import 本包差异采样 chunk → 解码全部采样。
   * 进入工作台 / 切包时即预热；play() 不再 await（issue 101）。加载完成前 keySet 为 null，playTick 走振荡器兜底。
   * 快速连点切换包安全：只有最后一次切换的结果会挂载（id 竞态判定）。
   * 同 id 幂等（issue 179）：已就绪或同 id 正在加载时不重复置空 `keySet`，避免 `setOptions` 重跑冲掉键音包。
   */
  setKeySetId(id: string): void {
    if (this.keySetId === id && (this.keySet !== null || this.keySetLoading)) return;
    this.keySetId = id;
    this.keySet = null;
    this.keySetLoading = true;
    void (async () => {
      try {
        const set = await loadKeySoundSet(id);
        if (this.keySetId !== id) return; // 加载途中又切了包：丢弃过期结果
        this.keySet = set;
        await this.preloadKeySet(set);
      } finally {
        if (this.keySetId === id) this.keySetLoading = false;
      }
    })().catch(() => undefined); // chunk/解码失败：保持振荡器兜底（与旧"占位包"行为等价，不弹错）
  }

  /**
   * 试听（issue 29）：播放指定素材包某击打样式的采样（方向键按 tier 1..3 分档）。
   * 按需加载该包 chunk + 单采样解码；走 seGain（音量所见即所得）。失败退回振荡器兜底。
   */
  async previewKeySample(setId: string, kind: KeySoundKind, tier?: number): Promise<void> {
    const ctx = this.ensureCtx();
    // 试听通常由用户点击触发，是放行 AudioContext 的手势
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* 自动播放策略拒绝时静默 */
      }
    }
    try {
      const set = await loadKeySoundSet(setId);
      const sample = set.samples[kind];
      const src = sampleSrcFor(sample, kind, tier);
      if (src) {
        const buf = await keySoundBank.load(src, ctx);
        scheduleKeySample(ctx, this.seBus(), buf, ctx.currentTime);
        return;
      }
      scheduleKeyTone(ctx, this.seBus(), kind, sample, ctx.currentTime);
    } catch {
      scheduleKeyTone(ctx, this.seBus(), kind, undefined, ctx.currentTime);
    }
  }

  /** 主音量（0..1）：作用于音频与按键音（masterGain）。ctx 未建时先记下，建时应用（与 seVolume 同范式） */
  setVolume(volume: number): void {
    const v = Math.max(0, Math.min(1, volume));
    this.volume = v;
    if (this.masterGain) this.masterGain.gain.value = v;
  }

  /**
   * 播放速率（chart-preview 20；播放器给 0.5/0.75/1/1.5/2 五档）。
   * 三处一起缩放才不会有"音画不同步"：BGM 的 `playbackRate`、两条时钟的经过时间（`getSeconds`）、
   * 键音调度（`tick` 里把谱面秒差除以速率换成墙钟秒差）。**播放中改速率不跳位置**。
   */
  setPlaybackRate(rate: number): void {
    if (!Number.isFinite(rate)) return;
    const next = Math.min(PLAYBACK_RATE_RANGE.max, Math.max(PLAYBACK_RATE_RANGE.min, rate));
    if (next === this.rate) return;
    if (this.state === 'playing') {
      // 先按**旧**速率把当前位置定下来，再用新速率从那里续跑
      this.offsetSeconds = this.getSeconds();
      if (this.ctx) this.startCtxSecond = this.ctx.currentTime;
      this.startPerfSecond = performance.now() / 1000;
    }
    this.rate = next;
    if (this.source) this.source.playbackRate.value = next;
  }

  /** 当前播放速率（1 = 原速） */
  get playbackRate(): number {
    return this.rate;
  }

  /** 节奏图示 SE 音量（issue 39 #7，0..1）：仅作用于键音，不影响背景音乐 */
  setSeVolume(volume: number): void {
    const v = Math.max(0, Math.min(1, volume));
    if (this.seGain) this.seGain.gain.value = v;
    else this.seVolume = v; // ctx 未建时暂存，ensureCtx 创建 seGain 时应用
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume; // 暂存的主音量（chart-preview 20）在这里落地
      this.masterGain.connect(this.ctx.destination);
      // issue 39 #7：SE gain 插在 masterGain 之前，键音汇入 seGain → masterGain → destination
      this.seGain = this.ctx.createGain();
      this.seGain.gain.value = this.seVolume;
      this.seGain.connect(this.masterGain);
    }
    return this.ctx;
  }

  /**
   * 预热 `seGain → masterGain → destination` 音频混合链路与系统音频硬件（issue 179）：
   * Windows WASAPI / Chromium AudioService 对全零静音缓冲会做零值跳过优化，直到首个非零样本到达
   * （BGM 前导静音结束或首个键音触发）才真正激活重采样器与硬件输出流，导致与首音符画面同刻卡顿。
   * 在首次 `play()` 起播瞬间向 `seBus()` 发送一帧 64 样本、幅值 1e-6（-120 dBFS，人耳不可闻但非零）
   * 的微脉冲，把音频图与系统声卡唤醒锁定在点击播放的起播帧，而非落到首个音符时刻。
   */
  private primeAudioGraph(ctx: AudioContext): void {
    if (this.audioGraphPrimed) return;
    this.audioGraphPrimed = true;
    if (typeof ctx.createBuffer !== 'function' || typeof ctx.createBufferSource !== 'function') return;
    try {
      const rate = ctx.sampleRate || 48000;
      const buf = ctx.createBuffer(1, 64, rate);
      const ch = typeof buf.getChannelData === 'function' ? buf.getChannelData(0) : null;
      if (ch) {
        for (let i = 0; i < ch.length; i++) ch[i] = 1e-6;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.seBus());
      src.onended = () => {
        try {
          src.disconnect();
        } catch {
          /* ignore */
        }
      };
      src.start(ctx.currentTime);
    } catch {
      /* 测试替身或上下文未就绪时静默跳过 */
    }
  }

  /** 解码文件（ArrayBuffer → decodeAudioData），并复位播放进度（若已在播放中则平滑接入，防打断卡顿） */
  async load(file: File): Promise<void> {
    const ctx = this.ensureCtx();
    const gen = ++this.loadGen;
    const arrayBuffer = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    touchAudioBuffer(decoded);
    if (gen !== this.loadGen) return;

    this.buffer = decoded;
    if (this.state === 'playing') {
      const currentSec = this.getSeconds();
      this.stopCurrent();
      if (currentSec < decoded.duration) {
        const src = ctx.createBufferSource();
        src.buffer = decoded;
        src.playbackRate.value = this.rate;
        if (this.masterGain) src.connect(this.masterGain);
        else src.connect(ctx.destination);
        src.start(0, currentSec);
        this.source = src;
        this.startCtxSecond = ctx.currentTime;
        this.offsetSeconds = currentSec;
        this.clock = 'audio';
      }
      this.rewindKeyIndex();
      return;
    }

    this.offsetSeconds = 0;
    this.cancelScheduled();
    this.state = 'ready';
  }

  /** 清除当前音频（切换到无歌曲模式） */
  clear(): void {
    ++this.loadGen;
    this.cancelScheduled();
    this.stopCurrent();
    this.stopScheduler();
    this.buffer = null;
    this.offsetSeconds = 0;
    this.state = 'idle';
  }

  /** 释放引擎持有的 `AudioContext` 与节点（动态预览卸载 / 重建引擎时调用，防底层硬件句柄累积） */
  dispose(): void {
    this.clear();
    try {
      this.seGain?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.masterGain?.disconnect();
    } catch {
      /* ignore */
    }
    this.seGain = null;
    this.masterGain = null;
    this.audioGraphPrimed = false;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && typeof ctx.close === 'function') {
      void Promise.resolve(ctx.close()).catch(() => undefined);
    }
  }

  /** 依赖音：同步最新的按键事件（谱面编辑/BPM 变化时调用） */
  setChart(notes: ChartNote[], beatDisplay: number): void {
    const bpmEvents = getBpmEvents(notes);
    this.keyEvents = buildKeyEvents(notes, beatDisplay, bpmEvents);
    this.rewindKeyIndex();
  }

  async play(): Promise<void> {
    if (this.state === 'playing') return;
    const ctx = this.ensureCtx(); // 播放是用户手势（点按钮/按空格），放行 AudioContext
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* 提案：自动播放策略拒绝时静默（仍可编辑） */
      }
    }
    this.stopCurrent();
    this.primeAudioGraph(ctx);
    if (this.buffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      src.playbackRate.value = this.rate;
      if (this.masterGain) src.connect(this.masterGain);
      else src.connect(ctx.destination);
      src.start(0, this.offsetSeconds);
      this.source = src;
      this.startCtxSecond = ctx.currentTime;
      this.clock = 'audio';
    } else {
      // 无音频：合成时间线（performance.now + RAF 驱动）
      this.startPerfSecond = performance.now() / 1000;
      this.clock = 'synthetic';
    }
    this.state = 'playing';
    this.rewindKeyIndex();
    this.startScheduler();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.offsetSeconds = this.getSeconds();
    this.stopCurrent();
    this.cancelScheduled();
    this.stopScheduler();
    this.state = 'paused';
  }

  /** 停止并回到开头 */
  stop(): void {
    this.offsetSeconds = 0;
    this.stopCurrent();
    this.cancelScheduled();
    this.stopScheduler();
    this.state = this.buffer ? 'ready' : 'idle';
  }

  /**
   * 启动/停止按键音调度器（bug 33）：
   * 按键音原本由 Editor 的 rAF 回调驱动 tick()，但页面切后台后浏览器会暂停 rAF，
   * 而 AudioContext 时钟仍推进（音乐继续放），导致按键音丢失。这里用 setInterval
   * 脱离 rAF 独立推进调度，配合大提前量 KEY_SCHEDULE_AHEAD 覆盖后台 ~1s 节流。
   */
  private startScheduler(): void {
    this.stopScheduler();
    this.schedTimer = setInterval(() => this.tick(), SCHEDULE_INTERVAL * 1000);
  }

  private stopScheduler(): void {
    if (this.schedTimer !== null) {
      clearInterval(this.schedTimer);
      this.schedTimer = null;
    }
  }

  /** 精确 seek：暂停时直接改游标；播放中重建 source 从新位置续播（含合成时间线） */
  seek(seconds: number): void {
    const max = this.buffer ? this.buffer.duration : Infinity;
    this.offsetSeconds = Math.min(max, Math.max(0, seconds));
    if (this.state === 'playing' && this.ctx) {
      const ctx = this.ctx;
      this.stopCurrent();
      if (this.clock === 'audio' && this.buffer) {
        const src = ctx.createBufferSource();
        src.buffer = this.buffer;
        src.playbackRate.value = this.rate;
        if (this.masterGain) src.connect(this.masterGain);
        else src.connect(ctx.destination);
        src.start(0, this.offsetSeconds);
        this.source = src;
        this.startCtxSecond = ctx.currentTime;
      } else {
        this.startPerfSecond = performance.now() / 1000;
      }
    }
    this.cancelScheduled();
    this.rewindKeyIndex();
  }

  /**
   * 每帧 RAF 调用：按播放位置推进，把 horizon 内的按键音预调度到 AudioContext 时间线。
   * 只调度"未发声"的（time >= 播放头），已过的直接跳
   */
  tick(): void {
    if (this.state !== 'playing' || !this.ctx || this.keyEvents.length === 0) return;
    const ctx = this.ctx;
    const playhead = this.getSeconds();
    // 提前量按**墙钟**算：horizon 是谱面秒，故乘速率；调度时刻再把谱面秒差除以速率换回墙钟
    const horizon = playhead + KEY_SCHEDULE_AHEAD * this.rate;
    while (this.keyIndex < this.keyEvents.length && this.keyEvents[this.keyIndex].time <= horizon) {
      const evt = this.keyEvents[this.keyIndex];
      if (evt.time >= playhead) {
        this.playTick(ctx.currentTime + (evt.time - playhead) / this.rate, evt.kind, evt.tier);
      }
      this.keyIndex++;
    }
  }

  private playTick(when: number, kind: KeySoundKind, tier?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const sample = this.keySet?.samples[kind];
    const src = sampleSrcFor(sample, kind, tier);
    if (src) {
      const buf = keySoundBank.get(src);
      if (buf) {
        const node = scheduleKeySample(ctx, this.seBus(), buf, when, () => this.scheduled.delete(node));
        this.scheduled.add(node);
        return;
      }
      // 采样未就绪：异步补充加载（本次振荡器兜底，避免无声）
      void keySoundBank.load(src, ctx).catch(() => undefined);
    }
    const node = scheduleKeyTone(ctx, this.seBus(), kind, sample, when, () => this.scheduled.delete(node));
    this.scheduled.add(node);
  }

  /**
   * 键音的汇入点：独立 `seGain`（issue 39 #7 —— SE 音量不影响背景音乐），
   * 未建时退回 masterGain / destination（与离线音轨渲染器同一层结构）。
   */
  private seBus(): AudioNode {
    if (this.seGain) return this.seGain;
    if (this.masterGain) return this.masterGain;
    return this.ensureCtx().destination;
  }

  /** 预加载素材包内全部真实采样（走共享 bank；失败静默，振荡器兜底） */
  private async preloadKeySet(set: KeySoundSet): Promise<void> {
    await keySoundBank.preload(set, this.ensureCtx());
  }

  /** 取消全部已调度按键音（暂停/seek/换曲时调用；未起音的 stop 会抛错，兜底 try/catch） */
  private cancelScheduled(): void {
    for (const osc of this.scheduled) {
      try {
        osc.stop();
      } catch {
        // 未 start 的节点 stop() 抛 InvalidStateError，忽略
      }
    }
    this.scheduled.clear();
    this.keyIndex = 0;
  }

  private rewindKeyIndex(): void {
    const playhead = this.offsetSeconds;
    let i = 0;
    while (i < this.keyEvents.length && this.keyEvents[i].time < playhead) {
      i++;
    }
    this.keyIndex = i;
  }

  private stopCurrent(): void {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // 已停止的 source 再次 stop() 抛错，忽略
      }
      this.source.disconnect();
      this.source = null;
    }
  }
}