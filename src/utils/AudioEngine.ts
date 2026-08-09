// 音频播放引擎（渲染进程 Web Audio，ticket 03 定案 + ADR-0004 修订）：
// - 播放：AudioContext + AudioBufferSourceNode（精确 seek，不用 HTMLAudioElement）
// - 解码：渲染进程 decodeAudioData（SongUploader → File → ArrayBuffer → decode，不动主进程）
// - 按键音：RAF 驱动 tick()，提前 ~100ms 预调度；每次新建 oscillator（Web Audio 禁止复停 oscillator）
// - 双时钟（ADR-0004 §2）：有音频 = AudioContext 时间线；无音频 = performance.now + RAF 合成时间线，照常"播放谱面"
import type { ChartNote } from '../notes/Charts';
import { getBpmEvents, buildKeyEvents, type KeySoundEvent } from './AudioTiming';
import { DEFAULT_KEY_SOUND_SET_ID, keySoundSetById, type KeySoundSet, type KeySoundKind, type KeySoundSample } from './KeySound';

export type PlaybackState = 'idle' | 'ready' | 'playing' | 'paused';

/** 按键音预调度提前量（秒）：提前调度补偿 RAF/音频时间线误差，避免迟到爆音 */
const KEY_SCHEDULE_AHEAD = 0.1;
/** 单个按键音时长（秒） */
const KEY_SOUND_DURATION = 0.06;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private masterGain: GainNode | null = null;
  private offsetSeconds = 0;
  private startCtxSecond = 0;
  private startPerfSecond = 0;
  private clock: 'audio' | 'synthetic' = 'synthetic';
  private state: PlaybackState = 'idle';

  private keyEvents: KeySoundEvent[] = [];
  /** 下一个待调度的按键音下标（推进式游标，避免每帧全量扫描大谱面） */
  private keyIndex = 0;
  private scheduled = new Set<AudioScheduledSourceNode>();
  /** 当前激活素材包（ADR-0004 §7） */
  private keySet: KeySoundSet = keySoundSetById(DEFAULT_KEY_SOUND_SET_ID);
  /** 真实采样缓存：src 路径 → 已解码 AudioBuffer（issue 18） */
  private sampleCache = new Map<string, AudioBuffer>();
  /** 进行中的采样加载（去重并发，避免重复 fetch/decode） */
  private sampleLoads = new Map<string, Promise<AudioBuffer>>();
  /** 当前素材包的全部采样预加载 Promise（play() 前 await，保证首拍就走真实采样，避免振荡器兜底） */
  private preloadPromise: Promise<void> | null = null;

  get isPlaying(): boolean {
    return this.state === 'playing';
  }

  /** ADR-0004 §2：合成时间线使无音频也可播放 → canPlay 恒真 */
  get canPlay(): boolean {
    return true;
  }

  /** 当前播放位置（秒）；未播放时为偏移量（暂停位/0）。双时钟：有音频走 AudioContext，无音频走 performance.now */
  getSeconds(): number {
    if (this.state === 'playing') {
      if (this.clock === 'audio' && this.ctx) {
        return this.offsetSeconds + (this.ctx.currentTime - this.startCtxSecond);
      }
      return this.offsetSeconds + (performance.now() / 1000 - this.startPerfSecond);
    }
    return this.offsetSeconds;
  }

  /** 有音频时的总时长（秒）；无音频返回 null（由调用方按谱面末端/默认给时长） */
  get duration(): number | null {
    return this.buffer ? this.buffer.duration : null;
  }

  /** 切换激活素材包；异步预加载其真实采样（本地小文件，加载快）；play() 前会 await 此 Promise */
  setKeySet(set: KeySoundSet): void {
    this.keySet = set;
    this.preloadPromise = this.preloadKeySet(set);
  }

  /** 主音量（0..1）：作用于音频与按键音（masterGain） */
  setVolume(volume: number): void {
    if (this.masterGain) this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** 解码文件（ArrayBuffer → decodeAudioData），并复位播放进度 */
  async load(file: File): Promise<void> {
    const ctx = this.ensureCtx();
    const arrayBuffer = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    this.buffer = decoded;
    this.offsetSeconds = 0;
    this.cancelScheduled();
    this.state = 'ready';
  }

  /** 清除当前音频（切换到无歌曲模式） */
  clear(): void {
    this.cancelScheduled();
    this.stopCurrent();
    this.buffer = null;
    this.offsetSeconds = 0;
    this.state = 'idle';
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
    // 确保真实采样已就绪再开播：避免首拍采样未命中而走振荡器兜底，
    // 造成 tap 音不像 perfect.mp3、方向键"叠声"（振荡器占位声）。采样小、仅首次耗时。
    if (this.preloadPromise) {
      await this.preloadPromise.catch(() => undefined);
    }
    this.stopCurrent();
    if (this.buffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
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
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.offsetSeconds = this.getSeconds();
    this.stopCurrent();
    this.cancelScheduled();
    this.state = 'paused';
  }

  /** 停止并回到开头 */
  stop(): void {
    this.offsetSeconds = 0;
    this.stopCurrent();
    this.cancelScheduled();
    this.state = this.buffer ? 'ready' : 'idle';
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
    const horizon = playhead + KEY_SCHEDULE_AHEAD;
    while (this.keyIndex < this.keyEvents.length && this.keyEvents[this.keyIndex].time <= horizon) {
      const evt = this.keyEvents[this.keyIndex];
      if (evt.time >= playhead) {
        this.playTick(ctx.currentTime + (evt.time - playhead), evt.kind, evt.tier);
      }
      this.keyIndex++;
    }
  }

  private playTick(when: number, kind: KeySoundKind, tier?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const sample = this.keySet.samples[kind];
    if (!sample) return;
    const src = this.srcFor(sample, kind, tier);
    if (src) {
      const buf = this.sampleCache.get(src);
      if (buf) {
        this.playSampledTick(ctx, buf, when);
        return;
      }
      // 采样未就绪：异步补充加载（本次振荡器兜底，避免无声）
      void this.loadSample(src);
    }
    this.playOscillatorTick(ctx, sample, when);
  }

  /** 解析某采样实际要播放的文件路径：方向键按 tier分档，其余用 src */
  private srcFor(sample: KeySoundSample, kind: KeySoundKind, tier?: number): string | undefined {
    if (kind === 'directional' && sample.tierSrcs) return sample.tierSrcs[tier ?? 1];
    return sample.src;
  }

  /** 预加载素材包内全部真实采样（去重）；失败静默（振荡器兜底） */
  private async preloadKeySet(set: KeySoundSet): Promise<void> {
    const srcs = new Set<string>();
    for (const kind of Object.keys(set.samples) as KeySoundKind[]) {
      const s = set.samples[kind];
      if (s.src) srcs.add(s.src);
      if (s.tierSrcs) {
        for (const v of Object.values(s.tierSrcs)) if (v) srcs.add(v);
      }
    }
    await Promise.all([...srcs].map(src => this.loadSample(src).catch(() => undefined)));
  }

  /** 加载并解码单个采样，缓存复用；并发去重 */
  private async loadSample(src: string): Promise<AudioBuffer> {
    const cached = this.sampleCache.get(src);
    if (cached) return cached;
    const inflight = this.sampleLoads.get(src);
    if (inflight) return inflight;
    const p = (async () => {
      const ctx = this.ensureCtx();
      const res = await fetch(src);
      if (!res.ok) throw new Error(`音效加载失败: ${src}`);
      const arrayBuffer = await res.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      this.sampleCache.set(src, decoded);
      return decoded;
    })();
    this.sampleLoads.set(src, p);
    try {
      return await p;
    } finally {
      this.sampleLoads.delete(src);
    }
  }

  /** 真实采样播放：AudioBufferSourceNode + 短包络；可复停（不复用节点） */
  private playSampledTick(ctx: AudioContext, buffer: AudioBuffer, when: number): void {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    src.connect(gain);
    if (this.masterGain) gain.connect(this.masterGain);
    else gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(0.9, when + 0.004);
    // 让采样按自身自然衰减播完，仅末尾做极短淡出防爆音。
    // 不要用指数包络整体衰减：那会把 0.748s 的 perfect.mp3 提前压到近静音，听感"被掐断/没播完"。
    const endFade = Math.min(0.03, buffer.duration / 2);
    gain.gain.setValueAtTime(0.9, when + (buffer.duration - endFade));
    gain.gain.linearRampToValueAtTime(0.0001, when + buffer.duration);
    src.onended = () => {
      this.scheduled.delete(src);
      src.disconnect();
      gain.disconnect();
    };
    src.start(when);
    this.scheduled.add(src);
  }

  /** 振荡器占位（无 src 或采样未加载时兜底） */
  private playOscillatorTick(ctx: AudioContext, sample: KeySoundSample, when: number): void {
    const { osc, gain } = this.createTickNode(ctx);
    const now = ctx.currentTime;
    // 极短包络防爆音：快起 + 指数衰减；频率/波形按素材包击打样式分类
    osc.type = sample.oscillatorType ?? 'square';
    osc.frequency.value = sample.frequency ?? 880;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(0.12, when + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + KEY_SOUND_DURATION);
    osc.onended = () => {
      this.scheduled.delete(osc);
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(when);
    osc.stop(when + KEY_SOUND_DURATION);
    this.scheduled.add(osc);
  }

  private createTickNode(ctx: AudioContext): { osc: OscillatorNode; gain: GainNode } {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    if (this.masterGain) gain.connect(this.masterGain);
    else gain.connect(ctx.destination);
    return { osc, gain };
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