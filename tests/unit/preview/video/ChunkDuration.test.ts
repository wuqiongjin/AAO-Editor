// 锁票 64：`EncodedVideoChunk.duration` 是可选属性，Edge 会缺省、Chromium 在输入帧不给
// duration 时给 0。`mp4-muxer` 的 `addVideoChunkRaw` 断言「有限非负实数」，前者整票失败、
// 后者写出全帧零时长（票 63 的播放异常同源）⇒ 进封装库前必须统一兜成帧间隔。
//
// 和 VideoKeyFrames.test.ts 同口径：换掉 WebCodecs 的编码器 / chunk，**封装库用真的**，
// `finish()` 出来的是真容器字节，能读 `stts`。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readStripped } from '@/tests/support/source';
import { createVideoSink, withValidDuration } from '@/src/preview/video/encode/muxer';
import { CONTAINER_SPECS, frameDurationUs, type VideoContainer } from '@/src/preview/video/encode/exportSpec';

interface ChunkInit {
  type: 'key' | 'delta';
  timestamp: number;
  duration?: number | null;
}

class FakeEncodedVideoChunk {
  readonly type: 'key' | 'delta';
  readonly timestamp: number;
  readonly duration: number | null | undefined;
  readonly byteLength = 1;

  constructor(init: ChunkInit) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration;
  }

  copyTo(dest: Uint8Array): void {
    dest.fill(0);
  }
}

class FakeVideoEncoder {
  static chunkDuration: number | null | undefined = undefined;
  private readonly output: (chunk: unknown, meta?: unknown) => void;

  constructor(init: { output: (chunk: unknown, meta?: unknown) => void; error: (e: Error) => void }) {
    this.output = init.output;
  }

  get encodeQueueSize(): number {
    return 0;
  }

  configure(): void {}

  encode(frame: VideoFrame, options?: { keyFrame?: boolean }): void {
    this.output(
      new FakeEncodedVideoChunk({
        type: options?.keyFrame ? 'key' : 'delta',
        timestamp: frame.timestamp,
        duration: FakeVideoEncoder.chunkDuration,
      }),
      { decoderConfig: { codec: 'avc1.640033', description: new Uint8Array([1, 2, 3, 4]) } },
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

async function exportBytes(container: VideoContainer, fps: number): Promise<Uint8Array> {
  const sink = await createVideoSink(sinkOptions(container, fps));
  await sink.addFrame({ timestamp: 0 } as VideoFrame);
  return sink.finish();
}

/** 读 `stts`：type(4) + version/flags(4) + entry_count(4)，每条 = sample_count(4) + sample_delta(4) */
function sttsDeltas(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 16 <= bytes.length; i++) {
    if (String.fromCharCode(...bytes.subarray(i, i + 4)) !== 'stts') continue;
    const count = view.getUint32(i + 8, false);
    // 误命中（任意 4 字节恰为 'stts'）时别按一个离谱的 count 越界读
    if (i + 12 + count * 8 > bytes.length) return [];
    return Array.from({ length: count }, (_, k) => view.getUint32(i + 12 + k * 8 + 4, false));
  }
  return [];
}

describe('视频封装 · chunk.duration 归一化（票 64）', () => {
  beforeEach(() => {
    vi.stubGlobal('VideoEncoder', FakeVideoEncoder);
    vi.stubGlobal('EncodedVideoChunk', FakeEncodedVideoChunk);
    FakeVideoEncoder.chunkDuration = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([undefined, null, 0, Number.NaN])(
    'duration=%s 不再整票失败：兜成帧间隔并写出真 MP4',
    async (bad) => {
      FakeVideoEncoder.chunkDuration = bad;
      const bytes = await exportBytes('mp4', 60);
      expect(bytes.length).toBeGreaterThan(0);
      expect(sttsDeltas(bytes).length).toBeGreaterThan(0);
      expect(sttsDeltas(bytes).every((d) => d > 0)).toBe(true);
    },
  );

  it('WebM 共用 sink：非法 duration 同样不抛（库不读 duration）', async () => {
    const bytes = await exportBytes('webm', 60);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('合法的 duration 原样返回；非法的才包装成帧间隔', () => {
    const good = new FakeEncodedVideoChunk({ type: 'key', timestamp: 0, duration: 12345 }) as unknown as EncodedVideoChunk;
    expect(withValidDuration(good, frameDurationUs(60))).toBe(good);

    const bad = new FakeEncodedVideoChunk({ type: 'key', timestamp: 0, duration: undefined }) as unknown as EncodedVideoChunk;
    const wrapped = withValidDuration(bad, frameDurationUs(30));
    expect(wrapped.duration).toBe(frameDurationUs(30));
    expect(wrapped).not.toBe(bad);
    // 封装库的 instanceof 检查与原生的 copyTo 都要靠「原对象身份 / this 绑定」
    expect(wrapped instanceof FakeEncodedVideoChunk).toBe(true);
    const dest = new Uint8Array(1);
    wrapped.copyTo(dest);
    expect(dest[0]).toBe(0);
  });

  // 出帧侧要 DOM canvas，Node 单测到不了 ⇒ 用源码断言锁「输入帧 / 音频 output 都接了这条口径」，
  // 真浏览器的行为由本地一次性探针 /tmp/verify-export-chunk-duration.mjs（不入库）的②环境层复核。
  it('出帧侧给 VideoFrame 带 duration，音频 output 也走归一化', () => {
    const frameDriver = readStripped('src/preview/video/encode/frameDriver.ts');
    const muxer = readStripped('src/preview/video/encode/muxer.ts');
    expect(frameDriver).toMatch(/new VideoFrame\(canvas, \{[\s\S]*?timestamp: frameTimestampUs\(timeline, k\),[\s\S]*?duration,/);
    expect(muxer).toMatch(/muxer\.addAudioChunk\(withValidDuration\(chunk, audioChunkUs\), meta\)/);
  });
});
