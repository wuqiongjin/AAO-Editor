// 离线音轨（chart-preview 07；ADR-0016 §5）：`OfflineAudioContext` 里渲染 BGM + 键音。
//
// **不新建第二套音量 / 调度口径**（票面「本票最深的一处」）：
//   - 事件表 = **同一份** `AudioTiming.buildKeyEvents`（由调用方建好传进来，与引擎 `setChart` 同源；
//     `beat < 0` 不键音、hidden 结点不计、BPM/System 不发声这些口径都在那一份里）；
//   - 采样加载 = **同一份** `keySoundBank`（07 从 `AudioEngine` 抽出来的共享缓存）；
//   - 包络 = **同一份** `scheduleKeySample` / `scheduleKeyTone`；
//   - 音量结构照实时那条链：BGM → master(volume) → destination，键音 → se(seVolume) → master。
//
// 除上面两条之外，再按 `sfx` 表调度**两端的游戏音效**（chart-preview 52：开场人潮 / 结尾章双声）：
// 表由 `exportVideo` 从 `../sfx` 组装，本文件不认识任何具体 SE 名，只负责"按秒放 + 包络"。
//
// 持久化：不落中间音轨文件（内存里直接喂 `AudioEncoder`）。
import { loadKeySoundSet } from '../../../audio/KeySound';
import { sampleSrcFor, scheduleKeySample, scheduleKeyTone, keySoundBank } from '../../../audio/keySoundSamples';
import type { KeySoundEvent } from '../../../audio/AudioTiming';
import { gameSfxUrl, type SfxCue } from '../sfx';
import { EXPORT_AUDIO_CHANNELS, EXPORT_AUDIO_SAMPLE_RATE, audioFramesFor } from './exportSpec';
import { yieldToMainThread } from '../../static/exportPanels';

export interface AudioTrackRequest {
  /** 谱面长度（秒，ADR-0005） */
  durationSeconds: number;
  /**
   * 开场段长度（秒，chart-preview 30）：`> 0` = 轨长 = 它 + 谱面长度，BGM 从它起、
   * 键音事件整体 + 它 ⇒ 谱面 0 秒落在开场段结束那刻（开场段无 BGM / 无键音）。
   */
  openingSeconds?: number;
  /**
   * 结尾段长度（秒，chart-preview 52）：`> 0` = 轨长在谱面之后再留这一段
   * （这段的**声**由 `sfx` 给；轨长必须与视频等长，否则封装时音画错位）。
   */
  endingSeconds?: number;
  /**
   * 两端的游戏音效（chart-preview 52）：开场人潮 + 结尾章双声，**整条轨的绝对秒**。
   * 空 / 缺 = 不出声；走 `se` 增益（与键音同一条音量口径，不另开设置）。
   */
  sfx?: readonly SfxCue[];
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
  /** 取消判定（票 67）：调度循环与离线渲染都要能中途退出来 */
  isCancelled?: () => boolean;
}

/**
 * 取消的返回值，与 `null`（静音导出）区分开：编排层据此直接回「已取消」，
 * 不会把取消当成"这条导出没有音轨"继续往下编码。
 */
export const AUDIO_TRACK_CANCELLED = Symbol('audio-track-cancelled');
export type AudioTrackResult = AudioTrack | typeof AUDIO_TRACK_CANCELLED | null;

/** 每调度这么多条键音让出一次主线程（缓存命中的 await 只是微任务，不 yield 输入事件） */
const KEY_EVENT_YIELD_EVERY = 64;

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
 * SE 解码缓存（按 URL）：一次导出里同一件只解码一次，多次导出之间也复用。
 * 用普通记录而不是 `new Map` / `new Set`：票 231 的静态锁要求离线渲染层不自建事件表 /
 * 归并容器，这里只是 URL → 解码结果的缓存，不该被那条门禁误判。
 */
const sfxBank: Record<string, Promise<AudioBuffer | null>> = {};

/** 读一件 SE；**取不到 = null**（缺件静音降级，不抛错、不阻断导出） */
function loadSfx(name: string, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
  const url = gameSfxUrl(name);
  let hit = sfxBank[url];
  if (!hit) {
    hit = fetch(url)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`SE ${res.status}: ${url}`))))
      .then((bytes) => ctx.decodeAudioData(bytes))
      .catch(() => null);
    sfxBank[url] = hit;
  }
  return hit;
}

/**
 * 按表把 SE 摆进离线轨：`at` 起播 →（可选）`endAt` 截断，最后 `fadeOut` 秒线性降到 0。
 *
 * 包络用 `linearRampToValueAtTime` 而不是直接 `stop`：开场人潮要"快结束时音量递减"，
 * 硬切会在 BGM 起点上留一记爆音。
 */
async function scheduleSfx(
  ctx: OfflineAudioContext,
  dest: AudioNode,
  cues: readonly SfxCue[],
  decodeCtx: BaseAudioContext,
): Promise<void> {
  for (const cue of cues) {
    if (!Number.isFinite(cue.at) || cue.at < 0) continue;
    const buffer = await loadSfx(cue.name, decodeCtx);
    if (!buffer) continue;
    const peak = Math.max(0, Math.min(1, cue.gain ?? 1));
    const fadeIn = Math.max(0, cue.fadeIn ?? 0);
    const endAt = Number.isFinite(cue.endAt) ? Math.max(cue.at, cue.endAt!) : cue.at + buffer.duration;
    if (endAt <= cue.at) continue;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    if (fadeIn > 0) {
      gain.gain.setValueAtTime(0, cue.at);
      gain.gain.linearRampToValueAtTime(peak, cue.at + fadeIn);
    } else {
      gain.gain.setValueAtTime(peak, cue.at);
    }
    src.connect(gain);
    gain.connect(dest);
    // `start` 必须早于 `stop`：Web Audio 对未起音的 `stop()` 直接抛 InvalidStateError
    // （票 53：开场人潮 7.105s > 开场段 6.75s，必然走到下面的截断分支）。
    src.start(cue.at);
    // 截断只发生在"素材比这一段长"时；素材自然结束的不去动它
    if (endAt < cue.at + buffer.duration) {
      const fadeOut = Math.max(0, cue.fadeOut ?? 0);
      const fadeAt = Math.max(cue.at + fadeIn, endAt - fadeOut);
      gain.gain.setValueAtTime(peak, fadeAt);
      gain.gain.linearRampToValueAtTime(0, endAt);
      src.stop(endAt);
    }
  }
}

/**
 * 渲染一条离线音轨。
 *
 * 返回 `null` = 静音导出（调用方据此把容器配成"无音轨"，省掉 `AudioEncoder`）；
 * `AUDIO_TRACK_CANCELLED` = 中途取消，调用方据此直接回「已取消」（票 67）。
 */
export async function renderAudioTrack(req: AudioTrackRequest): Promise<AudioTrackResult> {
  const cancelled = (): boolean => req.isCancelled?.() === true;
  // 取消优先于静音：已取消就该回哨兵，不能回一个会被当成"这条没有音轨"的 null
  if (cancelled()) return AUDIO_TRACK_CANCELLED;
  if (req.muted) return null;
  const sampleRate = req.sampleRate ?? EXPORT_AUDIO_SAMPLE_RATE;
  const channels = req.channels ?? EXPORT_AUDIO_CHANNELS;
  // 开场段在最前面（chart-preview 30）、结尾段在最后（52）：轨长 = 开场 + 谱面 + 结尾，
  // 与视频同一终点（这两段的声由 `sfx` 补，但轨长一定要够 —— 短了封装时音画就错位）
  const offset = Number.isFinite(req.openingSeconds) ? Math.max(0, req.openingSeconds!) : 0;
  const tail = Number.isFinite(req.endingSeconds) ? Math.max(0, req.endingSeconds!) : 0;
  const frames = audioFramesFor(req.durationSeconds + offset + tail, sampleRate);
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
    src.start(offset); // 开场段无声：BGM 从开场段结束那刻起
  }

  if (req.keyEvents.length > 0) {
    const decodeCtx = decodeContextFor(req.decodeContext);
    const set = await raceCancellation(loadKeySoundSet(req.keySetId), cancelled);
    if (set === AUDIO_TRACK_CANCELLED) return AUDIO_TRACK_CANCELLED;
    let processed = 0;
    for (const evt of req.keyEvents) {
      if (cancelled()) return AUDIO_TRACK_CANCELLED;
      // 采样缓存命中时的 await 只产生微任务：长谱几千条事件会挤进同一个宏任务，
      // 输入事件与重绘都排不上队（票 67 现场）⇒ 分批让出主线程。
      if (processed > 0 && processed % KEY_EVENT_YIELD_EVERY === 0) {
        await yieldToMainThread();
        if (cancelled()) return AUDIO_TRACK_CANCELLED;
      }
      processed++;
      // 轨外不调度：负时刻（倒流区把 beat 折成负秒）与超过谱面长度的都落不到这条轨上
      if (!Number.isFinite(evt.time) || evt.time < 0 || evt.time >= req.durationSeconds) continue;
      const sample = set.samples[evt.kind];
      const src = sampleSrcFor(sample, evt.kind, evt.tier);
      const buffer = src ? await keySoundBank.load(src, decodeCtx).catch(() => undefined) : undefined;
      // 键音整体后移开场段长度（过滤仍按**谱面时间** `[0, duration)` 判）
      const at = evt.time + offset;
      // 同刻响度归一系数由事件表算好，离线侧只透传（不在这里另算 / 另挂总线限幅）
      const gainScale = evt.gain ?? 1;
      if (buffer) scheduleKeySample(ctx, se, buffer, at, gainScale);
      else scheduleKeyTone(ctx, se, evt.kind, sample, at, gainScale);
    }
  }

  // 两端的游戏音效（52）：开场人潮收在 BGM 起点、结尾章双声落在结尾段 t=0。
  // 票 67：SE 的 fetch / decodeAudioData 同样没有 abort，取消命中就别再等它。
  if (req.sfx && req.sfx.length > 0) {
    const scheduled = await raceCancellation(
      scheduleSfx(ctx, se, req.sfx, decodeContextFor(req.decodeContext)),
      cancelled,
    );
    if (scheduled === AUDIO_TRACK_CANCELLED) return AUDIO_TRACK_CANCELLED;
  }

  if (cancelled()) return AUDIO_TRACK_CANCELLED;
  const rendered = await raceCancellation(ctx.startRendering(), cancelled);
  if (rendered === AUDIO_TRACK_CANCELLED) return AUDIO_TRACK_CANCELLED;
  return { buffer: rendered, sampleRate, numberOfChannels: channels, frames };
}

/** 取消轮询间隔：没有 abort 的浏览器 Promise 只能尽早不再等它 */
const CANCEL_POLL_MS = 25;

/**
 * 与取消轮询赛跑（票 67）：`startRendering()` / `decodeAudioData()` / 首次动态 import
 * 都没有 abort，取消命中就丢弃 work 的结果立刻返回，不等它 resolve。
 * work 自己仍会在浏览器内部线程跑完，但调用方不再被它拖住。
 */
export async function raceCancellation<T>(
  work: Promise<T>,
  cancelled: () => boolean,
): Promise<T | typeof AUDIO_TRACK_CANCELLED> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<typeof AUDIO_TRACK_CANCELLED>((resolve) => {
        const poll = (): void => {
          if (cancelled()) { resolve(AUDIO_TRACK_CANCELLED); return; }
          timer = setTimeout(poll, CANCEL_POLL_MS);
        };
        poll();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // 取消先赢时 work 可能稍后才 reject：挂一个空 catch，免得变成未处理的拒绝
    void work.catch(() => undefined);
  }
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
