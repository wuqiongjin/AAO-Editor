// 键音的**采样加载与发声**（issue 39 #7 的 SE 分轨；chart-preview 07 抽出）：
//
// 这一层原本全在 `AudioEngine` 的 private 方法里（`loadSample` / `srcFor` / `playSampledTick` /
// `playOscillatorTick`）。07 的离线音轨要在 `OfflineAudioContext` 里用**同一份**采样与
// **同一份**音量 / 包络口径渲染键音，而引擎那几件是 private、且绑在引擎自己的节点图上 ⇒
// 抽出来两边共用（票面「接缝形态」选的第二种：独立的采样加载模块 + 离线渲染器）。
//
// 口径（**只有这一份**，改动即同时改实时与离线）：
//   - 采样路径解析：方向键按 tier 分档（`tierSrcs`），其余用 `src`；
//   - 真实采样：0.9 峰值 + 末尾极短淡出（不用整体指数包络 —— 那会把 0.748s 的 perfect.mp3
//     提前压到近静音，听感"被掐断"）；
//   - 振荡器兜底：0.12 峰值 + 指数衰减 `KEY_SOUND_DURATION`（0.06s）。
import { KEY_SOUND_DEFAULT_TONES, type KeySoundKind, type KeySoundSample, type KeySoundSet } from './KeySound';

/** 单个按键音时长（秒；振荡器兜底那一路的寿命） */
export const KEY_SOUND_DURATION = 0.06;

/**
 * 解析某采样实际要播放的文件路径：方向键按 tier 分档（`tier ?? 1`），其余用 `src`。
 * 实时播放与离线渲染都走它 —— 不许在离线侧再写一份"取哪个文件"。
 */
export function sampleSrcFor(
  sample: KeySoundSample | undefined,
  kind: KeySoundKind,
  tier?: number,
): string | undefined {
  if (kind === 'directional' && sample?.tierSrcs) return sample.tierSrcs[tier ?? 1];
  return sample?.src;
}

/**
 * 真实采样的发声：短包络防爆音 + 让采样按自身自然衰减播完（见文件头口径）。
 * `dest` 是汇入点（实时 = 引擎的 `seGain`，离线 = 离线上下文里同一位置的 SE gain）。
 */
export function scheduleKeySample(
  ctx: BaseAudioContext,
  dest: AudioNode,
  buffer: AudioBuffer,
  when: number,
  onEnded?: () => void,
): AudioScheduledSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  src.connect(gain);
  gain.connect(dest);
  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(0.9, when + 0.004);
  const endFade = Math.min(0.03, buffer.duration / 2);
  gain.gain.setValueAtTime(0.9, when + (buffer.duration - endFade));
  gain.gain.linearRampToValueAtTime(0.0001, when + buffer.duration);
  src.onended = () => {
    src.disconnect();
    gain.disconnect();
    onEnded?.();
  };
  src.start(when);
  return src;
}

/**
 * 振荡器兜底（素材包未加载 / 加载失败 / 采样缺失 —— 保证按键有反馈声）：
 * 频率与波形取采样自带的 `frequency` / `oscillatorType`，缺省回落 `KEY_SOUND_DEFAULT_TONES`。
 */
export function scheduleKeyTone(
  ctx: BaseAudioContext,
  dest: AudioNode,
  kind: KeySoundKind,
  sample: KeySoundSample | undefined,
  when: number,
  onEnded?: () => void,
): AudioScheduledSourceNode {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(dest);
  const tone = KEY_SOUND_DEFAULT_TONES[kind];
  osc.type = sample?.oscillatorType ?? tone.oscillatorType;
  osc.frequency.value = sample?.frequency ?? tone.frequency;
  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(0.12, when + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + KEY_SOUND_DURATION);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
    onEnded?.();
  };
  osc.start(when);
  osc.stop(when + KEY_SOUND_DURATION);
  return osc;
}

/**
 * 真实采样缓存：src → 已解码 `AudioBuffer`。
 *
 * 全仓**共享一份**（`keySoundBank`）：实时引擎与离线音轨渲染器都从它取，
 * 导出不重复 fetch / decode（采样是 Vite `?inline` 的 data-URI，解码一次即常驻）。
 * `AudioBuffer` 可跨上下文使用 —— 采样率不同由 `AudioBufferSourceNode` 重采样兜住。
 */
export class KeySoundSampleBank {
  private cache = new Map<string, AudioBuffer>();
  private inflight = new Map<string, Promise<AudioBuffer>>();

  /** 已解码的采样（未加载 = undefined） */
  get(src: string): AudioBuffer | undefined {
    return this.cache.get(src);
  }

  /** 加载并解码单个采样，缓存复用；并发去重 */
  async load(src: string, ctx: BaseAudioContext): Promise<AudioBuffer> {
    const cached = this.cache.get(src);
    if (cached) return cached;
    const inflight = this.inflight.get(src);
    if (inflight) return inflight;
    const p = (async () => {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`音效加载失败: ${src}`);
      const decoded = await ctx.decodeAudioData(await res.arrayBuffer());
      this.cache.set(src, decoded);
      return decoded;
    })();
    this.inflight.set(src, p);
    try {
      return await p;
    } finally {
      this.inflight.delete(src);
    }
  }

  /** 预整包（去重）；单个失败不影响其余（振荡器兜底） */
  async preload(set: KeySoundSet, ctx: BaseAudioContext): Promise<void> {
    await Promise.all(allSampleSrcs(set).map((src) => this.load(src, ctx).catch(() => undefined)));
  }
}

/** 一包里全部采样路径（含方向键的 tier 分档） */
export function allSampleSrcs(set: KeySoundSet): string[] {
  const srcs = new Set<string>();
  for (const kind of Object.keys(set.samples) as KeySoundKind[]) {
    const s = set.samples[kind];
    if (s.src) srcs.add(s.src);
    if (s.tierSrcs) {
      for (const v of Object.values(s.tierSrcs)) if (v) srcs.add(v);
    }
  }
  return [...srcs];
}

/** 实时引擎与离线渲染器共用的那一份采样缓存 */
export const keySoundBank = new KeySoundSampleBank();
