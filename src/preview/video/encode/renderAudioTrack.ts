// 离线音轨（chart-preview 07；ADR-0016 §5）：`OfflineAudioContext` 里渲染 BGM + 键音。
//
// **不新建第二套音量 / 调度口径**（票面「本票最深的一处」）：
//   - 事件表 = **同一份** `AudioTiming.buildKeyEvents`（由调用方建好传进来，与引擎 `setChart` 同源；
//     `beat < 0` 不键音、hidden 结点不计、BPM/System 不发声这些口径都在那一份里）；
//   - 采样加载 = **同一份** `keySoundBank`（07 从 `AudioEngine` 抽出来的共享缓存）；
//   - 包络 = **同一份** `scheduleKeySample` / `scheduleKeyTone`；
//   - 音量结构照实时那条链：BGM → master(volume) → destination，键音 → se(seVolume) → master。
//
// 持久化：不落中间音轨文件（内存里直接喂 `AudioEncoder`）。
import { loadKeySoundSet } from '../../../audio/KeySound';
import { sampleSrcFor, scheduleKeySample, scheduleKeyTone, keySoundBank } from '../../../audio/keySoundSamples';
import type { KeySoundEvent } from '../../../audio/AudioTiming';
import { EXPORT_AUDIO_CHANNELS, EXPORT_AUDIO_SAMPLE_RATE, audioFramesFor } from './exportSpec';

export interface AudioTrackRequest {
  /** 谱面长度（秒，ADR-0005）：轨长 = 它，与视频同一终点 */
  durationSeconds: number;
  /** 键音事件表（`buildKeyEvents` 的输出，按 time 升序） */
  keyEvents: readonly KeySoundEvent[];
  /** 键音素材包（`settings.audio.keySet`） */
  keySetId: string;
  /** 工程音频（null = 无音频 → 只有键音） */
  bgm: AudioBuffer | null;
  /** 播放器主音量（`settings.audio.volume`，0..1） */
  volume: number;
  /** 节奏图示 SE 音量（`settings.audio.seVolume`，0..1） */
  seVolume: number;
  /** 静音导出：整条轨不出（容器里就没有音轨，而不是出一条静音轨） */
  muted?: boolean;
  sampleRate?: number;
  channels?: number;
  /** 解码上下文（注入用；默认新建一个 `AudioContext`） */
  decodeContext?: BaseAudioContext;
}

export interface AudioTrack {
  /** 渲染结果（长度 = `audioFramesFor(durationSeconds, sampleRate)`） */
  buffer: AudioBuffer;
  sampleRate: number;
  numberOfChannels: number;
  frames: number;
}

let sharedDecodeContext: BaseAudioContext | null = null;

/** 解码用的上下文（建一次复用；采样解码不需要出声，挂起态照样能 decode） */
function decodeContextFor(injected?: BaseAudioContext): BaseAudioContext {
  if (injected) return injected;
  if (!sharedDecodeContext) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedDecodeContext = new Ctor();
  }
  return sharedDecodeContext;
}

/**
 * 渲染一条离线音轨。
 *
 * 返回 `null` = 静音导出（调用方据此把容器配成"无音轨"，省掉 `AudioEncoder`）。
 */
export async function renderAudioTrack(req: AudioTrackRequest): Promise<AudioTrack | null> {
  if (req.muted) return null;
  const sampleRate = req.sampleRate ?? EXPORT_AUDIO_SAMPLE_RATE;
  const channels = req.channels ?? EXPORT_AUDIO_CHANNELS;
  const frames = audioFramesFor(req.durationSeconds, sampleRate);
  const ctx = new OfflineAudioContext(channels, frames, sampleRate);

  // 与实时同一条链：master 是主音量，se 是键音的独立音量（issue 39 #7）
  const master = ctx.createGain();
  master.gain.value = Math.max(0, Math.min(1, req.volume));
  master.connect(ctx.destination);
  const se = ctx.createGain();
  se.gain.value = Math.max(0, Math.min(1, req.seVolume));
  se.connect(master);

  if (req.bgm) {
    const src = ctx.createBufferSource();
    src.buffer = req.bgm;
    src.connect(master);
    src.start(0);
  }

  if (req.keyEvents.length > 0) {
    const decodeCtx = decodeContextFor(req.decodeContext);
    const set = await loadKeySoundSet(req.keySetId);
    for (const evt of req.keyEvents) {
      // 轨外不调度：负时刻（倒流区把 beat 折成负秒）与超过谱面长度的都落不到这条轨上
      if (!Number.isFinite(evt.time) || evt.time < 0 || evt.time >= req.durationSeconds) continue;
      const sample = set.samples[evt.kind];
      const src = sampleSrcFor(sample, evt.kind, evt.tier);
      const buffer = src ? await keySoundBank.load(src, decodeCtx).catch(() => undefined) : undefined;
      if (buffer) scheduleKeySample(ctx, se, buffer, evt.time);
      else scheduleKeyTone(ctx, se, evt.kind, sample, evt.time);
    }
  }

  const buffer = await ctx.startRendering();
  return { buffer, sampleRate, numberOfChannels: channels, frames };
}

/** 把渲染出的音轨切成编码器要的块（20 ms/块：Opus 的常用帧长） */
export function audioChunkFrames(sampleRate: number = EXPORT_AUDIO_SAMPLE_RATE): number {
  return Math.round(sampleRate * 0.02);
}

/**
 * 解码工程音频（BGM）为 `AudioBuffer`。
 * 与渲染音轨共用同一个解码上下文（建一次复用，不出声）。
 */
export async function decodeBgmBytes(
  bytes: ArrayBuffer,
  decodeContext?: BaseAudioContext,
): Promise<AudioBuffer> {
  return decodeContextFor(decodeContext).decodeAudioData(bytes);
}
