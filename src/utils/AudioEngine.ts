// 音频播放引擎（渲染进程 Web Audio，ticket 03 定案 + ADR-0004 修订）：
// - 播放：AudioContext + AudioBufferSourceNode（精确 seek，不用 HTMLAudioElement）
// - 解码：渲染进程 decodeAudioData（SongUploader → File → ArrayBuffer → decode，不动主进程）
// - 按键音：RAF 驱动 tick()，提前 ~100ms 预调度；每次新建 oscillator（Web Audio 禁止复停 oscillator）
// - 双时钟（ADR-0004 §2）：有音频 = AudioContext 时间线；无音频 = performance.now + RAF 合成时间线，照常"播放谱面"
import type { ChartNote } from '../notes/Charts';
import { getBpmEvents, buildKeyEvents, type KeySoundEvent } from './AudioTiming';
import { DEFAULT_KEY_SOUND_SET_ID, keySoundSetById, type KeySoundSet, type KeySoundKind } from './KeySound';

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
  private scheduled = new Set<OscillatorNode>();
  /** 当前激活素材包（ADR-0004 §7） */
  private keySet: KeySoundSet = keySoundSetById(DEFAULT_KEY_SOUND_SET_ID);

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

  /** 切换激活素材包 */
  setKeySet(set: KeySoundSet): void {
    this.keySet = set;
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
    const ctx = this.ensureCtx(); // 无音频也要按键音，统一确保 ctx
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume(); // 播放是用户手势（点按钮/按空格），放行 AudioContext
      } catch {
        /* 提案：自动播放策略拒绝时静默（仍可编辑） */
      }
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
        this.playTick(ctx.currentTime + (evt.time - playhead), evt.kind);
      }
      this.keyIndex++;
    }
  }

  private playTick(when: number, kind: KeySoundKind): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const sample = this.keySet.samples[kind];
    const { osc, gain } = this.createTickNode(ctx);
    const now = ctx.currentTime;
    // 极短包络防爆音：快起 + 指数衰减；频率/波形按素材包击打样式分类
    osc.type = sample.oscillatorType;
    osc.frequency.value = sample.frequency;
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