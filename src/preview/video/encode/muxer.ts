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
import {
  CONTAINER_SPECS,
  EXPORT_AUDIO_CHANNELS,
  EXPORT_AUDIO_SAMPLE_RATE,
  muxerAudioCodecFor,
  type ContainerSpec,
  type VideoContainer,
} from './exportSpec';
import { audioChunkFrames } from './renderAudioTrack';

/** 编码器在队列里最多压这么多帧（超了就等一拍；06 §5.4 的端到端脚本用的是 6） */
const MAX_ENCODE_QUEUE = 8;

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

function sleepTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

  let failure: Error | null = null;
  const fail = (e: Error) => {
    failure ??= e;
  };

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
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

  let closed = false;
  /** 已入队帧数：首帧必须是关键帧，其余交给编码器自己挑 */
  let queuedFrames = 0;

  return {
    async addFrame(frame): Promise<void> {
      if (closed || failure) throw failure ?? new Error('导出已取消');
      videoEncoder.encode(frame, { keyFrame: queuedFrames === 0 });
      queuedFrames++;
      if (videoEncoder.encodeQueueSize > MAX_ENCODE_QUEUE) await sleepTick();
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
        audio.close();
        if (audioEncoder.encodeQueueSize > MAX_ENCODE_QUEUE) await sleepTick();
      }
    },
    async finish(): Promise<Uint8Array> {
      if (failure) throw failure;
      if (closed) throw new Error('导出已取消');
      await videoEncoder.flush().catch(fail);
      if (audioEncoder) await audioEncoder.flush().catch(fail);
      if (failure) throw failure;
      muxer.finalize();
      closed = true;
      videoEncoder.close();
      audioEncoder?.close();
      return new Uint8Array(target.buffer);
    },
    abort(): void {
      if (closed) return;
      closed = true;
      // 关了就不再产出：未 flush 的队列随编码器一起丢（取消不该写出半个文件）
      videoEncoder.close();
      audioEncoder?.close();
    },
  };
}

/** 默认音频轨参数（Opus 48 kHz 立体声） */
export const DEFAULT_AUDIO_TRACK = {
  sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
  numberOfChannels: EXPORT_AUDIO_CHANNELS,
} as const;

/** 容器规格表（编排层要按容器取 spec） */
export { CONTAINER_SPECS };
