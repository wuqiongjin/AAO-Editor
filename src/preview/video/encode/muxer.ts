// 编码 + 封装（chart-preview 07；ADR-0016 §5）：WebCodecs `VideoEncoder` / `AudioEncoder` →
// `webm-muxer` / `mp4-muxer` → 一段内存字节（落盘交给 03 建的 `saveBinaryAs`）。
//
// **不自写 EBML / ISOBMFF**（06 §5.5）：`webm-muxer` 5.1.4 与 `mp4-muxer` 5.2.2 都是 0 依赖
// 单文件 ESM（65 KB / 69 KB，gzip 12 / 14 KB）。两个库**按容器动态 import**，一次导出只付一份。
//
// 体积记账（票面要求记在 Comments）：
//   - `webm-muxer` 5.1.4 —— ESM 64,944 B / gzip 11,825 B
//   - `mp4-muxer`  5.2.2 —— ESM 69,011 B / gzip 14,345 B
//   - 运行时实际只加载当选容器那一份（动态 import），不是两份都进主包。
//
// 编码不是瓶颈（06 §5.3：入队 0.6–1.2 ms/帧，瓶颈是快照与光栅）⇒ 别指望降码率提速。
//
// **背压是内存闸门**（2026-10-11 现场故障修正）：往编码器里塞的帧不是"入队即消化"——
// 在途帧数 × 一帧位图（720p ≈ 3 MB / 1080p ≈ 8 MB）就是这条链的常驻内存，所以
// 上限 `MAX_ENCODE_QUEUE` 是**硬性的**：满了要**等编码器吐帧**，不能只"等一拍"。
// 旧写法在 Firefox（libvpx 比出帧慢）上把 30s@720p 的队列堆到 1511 帧、进程 RSS 6.2 GB
// （页面白屏 + 导出失败）；Chromium 软编上同一份活峰值只有 9。
import {
  CONTAINER_SPECS,
  EXPORT_AUDIO_CHANNELS,
  EXPORT_AUDIO_SAMPLE_RATE,
  muxerAudioCodecFor,
  type ContainerSpec,
  type VideoContainer,
} from './exportSpec';
import { audioChunkFrames } from './renderAudioTrack';

/**
 * 在途帧上限（常驻）：**已交给编码器、还没吐出来**的帧最多这么多。
 *
 * 它就是**内存上限**（在途帧数 × 一帧位图：720p ≈ 3 MB / 1080p ≈ 8 MB），所以它是硬性闸门：
 * 满了要**等编码器吐帧**，不是"等一拍"。
 *
 * 旧写法（`encodeQueueSize > 8` 时 `await sleepTick()`）只**限速**不限量 —— 编码器比出帧慢时
 * 队列照样无界增长：实测 Firefox 导出 30s@720p 时 `encodeQueueSize` 冲到 **1511**、进程 RSS 6.2 GB
 * （页面白屏 + 导出失败），同一份活在 Chromium 上峰值只有 9。**等一拍 ≠ 等编码器。**
 */
const MAX_ENCODE_QUEUE = 32;

/**
 * 等这么久**没有任何输出**就认定"它不会自己吐"，用 `flush()` 逼它吐（见 `createEncodeGate`）。
 *
 * 1 s 是"单帧编码慢于 1 秒"的分界：健康编码器 1080p 一帧也就几十毫秒量级，正常不会触发；
 * 真触发也只是多一次 flush（代价 = 那一段提前收 GOP），**换的是绝不死锁**。
 */
const STARVE_MS = 1000;

/**
 * 一条编码通道的背压闸门（视频 / 音频各一条）。
 *
 * 常驻上限 = `MAX_ENCODE_QUEUE`（满了**等编码器吐**，不是"等一拍"）。
 * 等不到就 `flush()` —— **这就是"不死锁"的根据**：`flush()` 保证把已提交的都吐出来，
 * 所以"在途 ≥ 上限"这个状态一定能被打破。
 *
 * 反面教材（2026-10-11 用户现场）：早先的退让只是"把上限翻倍后重等"，一旦涨到封顶值，
 * `while (在途 >= 上限)` 就永远成立 ⇒ 导出**挂死在进度条最后**、取消也无效（取消只在出帧循环里查）。
 * 别再用"放宽上限"当兜底：放宽不产生输出，只有 flush 会。
 */
function createEncodeGate(
  inFlight: () => number,
  flush: () => Promise<void>,
): {
  wait: () => Promise<void>;
  output: () => void;
  close: () => void;
} {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const waiters: Array<(gotOutput: boolean) => void> = [];

  const release = (gotOutput: boolean): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const pending = waiters.splice(0);
    for (const resolve of pending) resolve(gotOutput);
  };

  return {
    async wait(): Promise<void> {
      while (!closed && inFlight() >= MAX_ENCODE_QUEUE) {
        const gotOutput = await new Promise<boolean>((resolve) => {
          waiters.push(resolve);
          // 只有一个定时器：第一个等的人设上，吐帧 / 超时时清掉
          timer ??= setTimeout(() => release(false), STARVE_MS);
        });
        // 它不自己吐（起搏不够深 / 要攒一批才吐 / 只在 flush 时吐）⇒ 逼它吐，别死等
        if (!gotOutput && !closed) await flush();
      }
    },
    output(): void {
      release(true);
    },
    close(): void {
      closed = true;
      release(false);
    },
  };
}

/** 不可用时的原因（UI 文案按它分档，不静默失败） */
export type UnsupportedReason =
  /** 这台机器没有 WebCodecs（老浏览器 / 非安全上下文） */
  | 'missing'
  /** 视频 codec 全不支持 */
  | 'video'
  /** 音频 codec 全不支持 */
  | 'audio';

export interface ContainerSupport {
  container: VideoContainer;
  ok: boolean;
  videoCodec?: string;
  audioCodec?: string;
  reason?: UnsupportedReason;
}

export interface ProbeInput {
  width: number;
  height: number;
  fps: number;
  /**
   * 无音轨（静音导出）时传 null：不探音频编码器。
   * `codecs` = 只用这几个 codec 探（省略 = 用容器候选表全量）。
   * 探"这台机器能不能出真 mp4"时传 `AAC_AUDIO_CODECS`：AAC 不可用 ⇒ 本次判不支持，
   * 由编排层退到 webm，而不是产出 mp4 + Opus 那个兼容面更窄的混合体。
   */
  audio: { sampleRate: number; numberOfChannels: number; codecs?: readonly string[] } | null;
}

/** 按候选表试 `isConfigSupported`，第一个通过的当选（H.264 的偶数边长门槛在这一步才会暴露） */
export async function probeContainer(spec: ContainerSpec, input: ProbeInput): Promise<ContainerSupport> {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') {
    return { container: spec.id, ok: false, reason: 'missing' };
  }
  let videoCodec: string | undefined;
  for (const codec of spec.videoCodecs) {
    const res = await VideoEncoder.isConfigSupported({
      codec,
      width: input.width,
      height: input.height,
      framerate: input.fps,
    });
    if (res.supported === true) {
      videoCodec = codec;
      break;
    }
  }
  if (!videoCodec) return { container: spec.id, ok: false, reason: 'video' };

  let audioCodec: string | undefined;
  if (input.audio) {
    for (const codec of input.audio.codecs ?? spec.audioCodecs) {
      const res = await AudioEncoder.isConfigSupported({
        codec,
        sampleRate: input.audio.sampleRate,
        numberOfChannels: input.audio.numberOfChannels,
      });
      if (res.supported === true) {
        audioCodec = codec;
        break;
      }
    }
    if (!audioCodec) return { container: spec.id, ok: false, reason: 'audio', videoCodec };
  }

  return { container: spec.id, ok: true, videoCodec, audioCodec };
}

export interface VideoSinkOptions {
  spec: ContainerSpec;
  /** `probeContainer` 选出来的视频 codec */
  videoCodec: string;
  /** null = 静音导出（容器里没有音轨） */
  audioCodec: string | null;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  audio: { sampleRate: number; numberOfChannels: number } | null;
  /**
   * 取消判定（chart-preview 33）：出帧循环里的取消只在帧边界查一次，而**等背压 / 切音轨**
   * 这两处都可能停住 ⇒ 也要在这里查，否则取消钮形同虚设（用户现场："卡在 2100/2100，点取消没反应"）。
   */
  isCancelled?: () => boolean;
}

export interface VideoSink {
  /** 编码一帧（帧由 `frameDriver` 建好，调完即 `close()`） */
  addFrame(frame: VideoFrame): Promise<void>;
  /** 编码整条音轨（切块喂 `AudioEncoder`） */
  addAudio(buffer: AudioBuffer): Promise<void>;
  /** 收尾：flush 两个编码器 + finalize 封装，返回文件字节 */
  finish(): Promise<Uint8Array>;
  /** 中途放弃（取消 / 失败）：关掉编码器，不产出文件 */
  abort(): void;
}

/** 两个封装库形状一致（`Muxer` + `ArrayBufferTarget`），按容器动态取 */
interface MuxerLike {
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
  finalize(): void;
}
interface MuxerModule {
  Muxer: new (options: Record<string, unknown>) => MuxerLike;
  ArrayBufferTarget: new () => { buffer: ArrayBuffer };
}


/**
 * 建一条编码 / 封装的槽。
 * 抛出即失败（编码器不可用应先走 `probeContainer`）；`abort()` 后不再产出文件。
 */
export async function createVideoSink(opts: VideoSinkOptions): Promise<VideoSink> {
  const mod = (await import(
    opts.spec.id === 'webm' ? 'webm-muxer' : 'mp4-muxer'
  )) as unknown as MuxerModule;
  const target = new mod.ArrayBufferTarget();
  const muxerOptions: Record<string, unknown> = {
    target,
    video: {
      codec: opts.spec.muxerCodec.video,
      width: opts.width,
      height: opts.height,
      frameRate: opts.fps,
    },
  };
  if (opts.audioCodec && opts.audio) {
    muxerOptions.audio = {
      // `mp4a.40.2` 之类是 WebCodecs 的说法，封装库要的是 `'aac' | 'opus'`
      codec: muxerAudioCodecFor(opts.spec, opts.audioCodec),
      numberOfChannels: opts.audio.numberOfChannels,
      sampleRate: opts.audio.sampleRate,
    };
  }
  // mp4 要显式的 fastStart（'in-memory' = 元数据前置，播放最顺）；webm 没有这一项
  if (opts.spec.id === 'mp4') muxerOptions.fastStart = 'in-memory';
  const muxer = new mod.Muxer(muxerOptions);

  let closed = false;
  let failure: Error | null = null;

  /**
   * 在途帧数（已交给编码器、还没吐出来的）。**在途 = 内存**，所以它是硬性上限：
   * 见 `MAX_ENCODE_QUEUE` 的文件头 —— 旧实现靠"等一拍"限速，慢编码器上会涨到 GB 级。
   */
  let videoInFlight = 0;
  let audioInFlight = 0;
  /** 闸门在编码器建好之后装配（`fail` 早于它被引用，故用 `let`；实际调用都在构造之后） */
  let videoGate: ReturnType<typeof createEncodeGate> | null = null;
  let audioGate: ReturnType<typeof createEncodeGate> | null = null;
  const fail = (e: Error) => {
    failure ??= e;
    // 出错也必须把等背压的放行，否则调用方永远挂在这里
    videoGate?.close();
    audioGate?.close();
  };

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      // 夹在 0：对账后仍可能有多余的输出在路上，别让计数变成负数（那会短暂放大闸门）
      videoInFlight = Math.max(0, videoInFlight - 1);
      videoGate?.output();
      try {
        muxer.addVideoChunk(chunk, meta);
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    },
    error: fail,
  });
  videoEncoder.configure({
    codec: opts.videoCodec,
    width: opts.width,
    height: opts.height,
    bitrate: opts.bitrate,
    framerate: opts.fps,
    // 离线导出不赶实时：'quality' 让编码器自己挑 B 帧结构
    latencyMode: 'quality',
  });

  const audioEncoder =
    opts.audioCodec && opts.audio
      ? new AudioEncoder({
        output: (chunk, meta) => {
          audioInFlight = Math.max(0, audioInFlight - 1);
          audioGate?.output();
          try {
            muxer.addAudioChunk(chunk, meta);
          } catch (e) {
            fail(e instanceof Error ? e : new Error(String(e)));
          }
        },
        error: fail,
      })
      : null;
  if (audioEncoder && opts.audio) {
    audioEncoder.configure({
      codec: opts.audioCodec!,
      sampleRate: opts.audio.sampleRate,
      numberOfChannels: opts.audio.numberOfChannels,
    });
  }

  // 两个编码器都建好了 ⇒ 装配闸门（`recover()` 是"不死锁"的兜底）
  /**
   * 等不到输出时的兜底。两条路，先便宜的对账、再贵的逼吐：
   *
   * 1. **对账**（`encodeQueueSize` < 上限，或读不到就跳过）：编码器手上没压着活 ⇒
   *    "在途"只是我们**按输入:输出 1:1 记账**留下的残渣。音频编码器不是 1:1：AAC 一帧
   *    1024 采样、而 `addAudio` 按 960 采样一块喂，约 6% 的输入不会变成输出 ⇒ 计数只涨不还。
   *    真编码器自己是健康的，把账清回 0 即可（不打乱 GOP，也不多花时间）。
   * 2. **逼吐**（`flush()` + 清账）：编码器确实压着活却不吐（起搏不够深 / 要攒一批），
   *    `flush()` 的语义保证"已提交的都处理完" ⇒ 它手上的账清空，我们也必须清回 0。
   *
   * 用户现场（2026-10-11，chart-preview 33）：第 1 条缺失 ⇒ 残渣把闸门吊死在
   * 「2100 / 2100 帧」那一条上（每秒 flush 一次、永远等不满），而 cancel 是好的。
   */
  const recover = async (encoder: VideoEncoder | AudioEncoder, clear: () => void): Promise<void> => {
    const queued = (encoder as { encodeQueueSize?: number }).encodeQueueSize;
    if (typeof queued !== 'number' || queued < MAX_ENCODE_QUEUE) {
      clear();
      return;
    }
    try {
      await encoder.flush();
    } catch (e) {
      fail(e instanceof Error ? e : new Error(String(e)));
    }
    clear();
  };
  videoGate = createEncodeGate(() => videoInFlight, () =>
    recover(videoEncoder, () => {
      videoInFlight = 0;
    }),
  );
  audioGate = createEncodeGate(() => audioInFlight, () =>
    audioEncoder
      ? recover(audioEncoder, () => {
        audioInFlight = 0;
      })
      : Promise.resolve(),
  );

  /** 已入队帧数：首帧必须是关键帧，其余交给编码器自己挑 */
  let queuedFrames = 0;
  /** 取消：等背压时也要查（否则导出挂在最后一帧、取消钮形同虚设） */
  const isCancelled = (): boolean => opts.isCancelled?.() === true;
  const cancelledNow = (): boolean => {
    if (!isCancelled()) return false;
    abort();
    return true;
  };

  function abort(): void {
    if (closed) return;
    closed = true;
    // 等背压的那一帧也要退出（否则取消后导出永不返回）
    videoGate?.close();
    audioGate?.close();
    // 关了就不再产出：未 flush 的队列随编码器一起丢（取消不该写出半个文件）
    videoEncoder.close();
    audioEncoder?.close();
  }

  return {
    async addFrame(frame): Promise<void> {
      if (closed || failure) throw failure ?? new Error('导出已取消');
      if (cancelledNow()) throw new Error('导出已取消');
      // 背压：在途满就**等编码器吐帧**（不是等一拍）；上限即内存上限
      await videoGate.wait();
      if (cancelledNow()) throw new Error('导出已取消');
      if (closed || failure) throw failure ?? new Error('导出已取消');
      videoEncoder.encode(frame, { keyFrame: queuedFrames === 0 });
      queuedFrames++;
      videoInFlight++;
    },
    async addAudio(buffer): Promise<void> {
      if (!audioEncoder || closed || failure) return;
      const sampleRate = buffer.sampleRate;
      const channels = Math.max(1, buffer.numberOfChannels);
      const chunk = audioChunkFrames(sampleRate);
      const planes: Float32Array[] = [];
      for (let c = 0; c < channels; c++) planes.push(buffer.getChannelData(c));
      for (let offset = 0; offset < buffer.length; offset += chunk) {
        if (closed || failure) return;
        if (cancelledNow()) return;
        // 同一套背压（块比帧小得多，但"等一拍"同样挡不住慢编码器）
        await audioGate.wait();
        if (cancelledNow()) return;
        if (closed || failure) return;
        const n = Math.min(chunk, buffer.length - offset);
        // 'f32-planar'：整块 = 各声道平面首尾相接（AudioData 的要求）
        const data = new Float32Array(n * channels);
        for (let c = 0; c < channels; c++) data.set(planes[c]!.subarray(offset, offset + n), c * n);
        const audio = new AudioData({
          format: 'f32-planar',
          sampleRate,
          numberOfFrames: n,
          numberOfChannels: channels,
          timestamp: Math.round((offset * 1_000_000) / sampleRate),
          data,
        });
        audioEncoder.encode(audio);
        audioInFlight++;
        audio.close();
      }
    },
    async finish(): Promise<Uint8Array> {
      if (failure) throw failure;
      if (closed) throw new Error('导出已取消');
      await videoEncoder.flush().catch(fail);
      if (audioEncoder) await audioEncoder.flush().catch(fail);
      if (failure) throw failure;
      muxer.finalize();
      abort();
      return new Uint8Array(target.buffer);
    },
    abort,
  };
}

/** 默认音频轨参数（Opus 48 kHz 立体声） */
export const DEFAULT_AUDIO_TRACK = {
  sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
  numberOfChannels: EXPORT_AUDIO_CHANNELS,
} as const;

/** 容器规格表（编排层要按容器取 spec） */
export { CONTAINER_SPECS };
