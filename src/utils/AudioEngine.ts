// 音频播放引擎（渲染进程 Web Audio，ticket 03 定案）：
// - 播放：AudioContext + AudioBufferSourceNode（精确 seek，不用 HTMLAudioElement）
// - 解码：渲染进程 decodeAudioData（SongUploader → File → ArrayBuffer → decode，不动主进程）
// - 按键音：RAF 驱动 tick()，提前 ~100ms 预调度；复用对象池避免大谱面卡顿
import type { ChartNote } from '../notes/Charts';
import { getBpmEvents, buildKeyEvents, type KeySoundEvent } from './AudioTiming';

export type PlaybackState = 'idle' | 'ready' | 'playing' | 'paused';

/** 按键音预调度提前量（秒）：提前调度补偿 RAF/音频时间线误差，避免迟到爆音 */
const KEY_SCHEDULE_AHEAD = 0.1;
/** 单个按键音时长（秒） */
const KEY_SOUND_DURATION = 0.06;

interface PooledTick {
  osc: OscillatorNode;
  gain: GainNode;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private offsetSeconds = 0;
  private startCtxSecond = 0;
  private state: PlaybackState = 'idle';

  private keyEvents: KeySoundEvent[] = [];
  /** 下一个待调度的按键音下标（推进式游标，避免每帧全量扫描大谱面） */
  private keyIndex = 0;
  private scheduled = new Set<OscillatorNode>();
  private pool: PooledTick[] = [];

  get isPlaying(): boolean {
    return this.state === 'playing';
  }

  get canPlay(): boolean {
    return !!this.buffer;
  }

  /** 当前播放位置（秒）；未播放时为偏移量（暂停位/0） */
  getSeconds(): number {
    if (this.state === 'playing' && this.ctx) {
      return this.offsetSeconds + (this.ctx.currentTime - this.startCtxSecond);
    }
    return this.offsetSeconds;
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
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
    if (!this.buffer || this.state === 'playing') return;
    const ctx = this.ensureCtx();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume(); // 播放是用户手势（点按钮/按空格），放行 AudioContext
      } catch {
        /* 提案：自动播放策略拒绝时静默（仍可编辑） */
      }
    }
    this.stopCurrent();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(ctx.destination);
    src.start(0, this.offsetSeconds);
    this.source = src;
    this.startCtxSecond = ctx.currentTime;
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

  /** 精确 seek：暂停时直接改游标；播放中重建 source 从新位置续播 */
  seek(seconds: number): void {
    if (!this.buffer) return;
    const max = Math.max(0, this.buffer.duration);
    this.offsetSeconds = Math.min(max, Math.max(0, seconds));
    if (this.state === 'playing' && this.ctx) {
      const ctx = this.ctx;
      this.stopCurrent();
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      src.connect(ctx.destination);
      src.start(0, this.offsetSeconds);
      this.source = src;
      this.startCtxSecond = ctx.currentTime;
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
        this.playTick(ctx.currentTime + (evt.time - playhead));
      }
      this.keyIndex++;
    }
  }

  private playTick(when: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const pooled = this.pool.pop() ?? this.createTickNode(ctx);
    const { osc, gain } = pooled;
    const now = ctx.currentTime;
    // 极短包络防爆音：快起 + 指数衰减
    osc.type = 'square';
    osc.frequency.value = 880; // 全部音符同音（后续可扩展按 lane/类型差异化音高）
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(0.12, when + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + KEY_SOUND_DURATION);
    osc.onended = () => {
      this.scheduled.delete(osc);
      osc.disconnect();
      gain.disconnect();
      this.pool.push(pooled);
    };
    osc.start(when);
    osc.stop(when + KEY_SOUND_DURATION);
    this.scheduled.add(osc);
  }

  private createTickNode(ctx: AudioContext): PooledTick {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
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