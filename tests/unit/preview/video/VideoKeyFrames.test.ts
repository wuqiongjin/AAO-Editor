// 锁导出视频的**周期关键帧**（chart-preview 63）：静态场景 + `latencyMode:'quality'` 时
// H.264 全片只吐 1 个 key chunk ⇒ 拖进度条 / 剪辑刮擦都要从第 0 帧解码。
//
// 这里不碰真 WebCodecs：把 `VideoEncoder` 换成「只认 `keyFrame:true`」的假编码器，
// 但**封装库用真的**（`mp4-muxer` / `webm-muxer`）⇒ `finish()` 出来的是真容器字节，
// 可以像验第三方文件一样读 MP4 的 `stss`（同步样本表 = 播放器能直接跳到哪几帧）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVideoSink } from '@/src/preview/video/encode/muxer';
import { CONTAINER_SPECS, type VideoContainer } from '@/src/preview/video/encode/exportSpec';

/** Node 里没有 `EncodedVideoChunk`；给封装库一个够用的替身（`copyTo` 会喂 1 字节哑数据） */
class FakeEncodedVideoChunk {
  readonly type: 'key' | 'delta';
  readonly timestamp: number;
  readonly duration: number;
  readonly byteLength = 1;

  constructor(init: { type: 'key' | 'delta'; timestamp: number; duration: number }) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration;
  }

  copyTo(dest: Uint8Array): void {
    dest.fill(0);
  }
}

/** 假编码器：只在被要求时吐 key chunk（模拟静态场景里编码器自己不挑关键帧） */
class FakeVideoEncoder {
  static keyFrameFlags: boolean[] = [];
  static frameDurationUs = Math.round(1_000_000 / 60);

  private readonly output: (chunk: unknown, meta?: unknown) => void;

  constructor(init: { output: (chunk: unknown, meta?: unknown) => void; error: (e: Error) => void }) {
    this.output = init.output;
  }

  static reset(): void {
    FakeVideoEncoder.keyFrameFlags = [];
    FakeVideoEncoder.frameDurationUs = Math.round(1_000_000 / 60);
  }

  get encodeQueueSize(): number {
    return 0;
  }

  configure(): void {}

  encode(frame: VideoFrame, options?: { keyFrame?: boolean }): void {
    const keyFrame = options?.keyFrame === true;
    FakeVideoEncoder.keyFrameFlags.push(keyFrame);
    this.output(
      new FakeEncodedVideoChunk({
        type: keyFrame ? 'key' : 'delta',
        timestamp: frame.timestamp,
        duration: FakeVideoEncoder.frameDurationUs,
      }),
      {
        // `mp4-muxer` 写 `avcC` 要 decoderConfig；字节内容不影响 `stss`
        decoderConfig: { codec: 'avc1.640033', description: new Uint8Array([1, 2, 3, 4]) },
      },
    );
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }

  close(): void {}
}

const sinkOptions = (container: VideoContainer, fps: number) => ({
  spec: CONTAINER_SPECS[container],
  videoCodec: container === 'mp4' ? 'avc1.640033' : 'vp09.00.10.08',
  audioCodec: null,
  width: 1280,
  height: 720,
  fps,
  bitrate: 6_000_000,
  audio: null,
});

/** 走完整个 sink，返回真容器字节 */
async function exportBytes(container: VideoContainer, frameCount: number, fps: number): Promise<Uint8Array> {
  FakeVideoEncoder.frameDurationUs = Math.round(1_000_000 / fps);
  const sink = await createVideoSink(sinkOptions(container, fps));
  for (let i = 0; i < frameCount; i++) {
    await sink.addFrame({
      timestamp: Math.round((i * 1_000_000) / fps),
    } as unknown as VideoFrame);
  }
  return sink.finish();
}

/** 读 `stss`：box type 之后是 version+flags(4) + entry_count(4) + N 个 1-indexed 样本号 */
function syncSamples(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 12 <= bytes.length; i++) {
    if (bytes[i] !== 0x73 || bytes[i + 1] !== 0x74 || bytes[i + 2] !== 0x73 || bytes[i + 3] !== 0x73) continue;
    const count = view.getUint32(i + 8, false);
    return Array.from({ length: count }, (_, k) => view.getUint32(i + 12 + k * 4, false));
  }
  return [];
}

describe('视频封装 · 周期关键帧（票 63）', () => {
  beforeEach(() => {
    vi.stubGlobal('VideoEncoder', FakeVideoEncoder);
    vi.stubGlobal('EncodedVideoChunk', FakeEncodedVideoChunk);
  });

  afterEach(() => {
    FakeVideoEncoder.reset();
    vi.unstubAllGlobals();
  });

  it('5s / 60fps 的 MP4 每 2s 有一个同步样本（不是全片只有第 0 帧）', async () => {
    const bytes = await exportBytes('mp4', 300, 60);
    expect(syncSamples(bytes)).toEqual([1, 121, 241]);
  });

  it('WebM 共用 sink 同节奏：10fps 下仍是每 2s 一个，不写死 60fps 的帧数', async () => {
    const bytes = await exportBytes('webm', 45, 10);
    expect(bytes.length).toBeGreaterThan(0); // 真的走完了 finalize()
    const forced = FakeVideoEncoder.keyFrameFlags.flatMap((flag, i) => (flag ? [i] : []));
    expect(forced).toEqual([0, 20, 40]);
  });
});
