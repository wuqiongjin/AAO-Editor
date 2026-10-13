// 锁 `createVideoSink` 的**背压**（chart-preview 07 / 33）：
//   ① 内存闸门：在途（已交给编码器、还没吐出来的帧）× 一帧位图 = 这条链的常驻内存 ⇒ 必须封顶；
//   ② 不许死锁：编码器"攒够一批才吐""只在 flush 时吐"都要能跑完（挂住比内存高更糟）；
//   ③ 取消要能穿透背压（等的时候点取消，必须 ≤1 拍退出，不是等导出自己结束）。
//
// 现场（2026-10-11 实测，见 `.cache/export-fail-repro.mjs`）：
//   - Firefox 30s@720p：`encodeQueueSize` 峰值 **1511**、RSS **6273 MB**（Chromium 同一份活峰值 9 / 738 MB）；
//   - 修法上线后用户当场撞到**死锁**：进度停在「2100 / 2100 帧」（出帧循环已跑完）——
//     卡的是其后 `sink.addAudio()`，而"退让"到上限后只会重等 ⇒ 永不返回 + 取消无效。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTAINER_SPECS } from '@/src/preview/video/encode/exportSpec';

// 封装库在真导出里是**动态 import**；换成不校验 chunk 的假货，
// 好让本用例只盯背压、不牵扯 EBML / ISOBMFF 的 chunk 形状。
vi.mock('webm-muxer', () => ({
  ArrayBufferTarget: class {
    buffer = new ArrayBuffer(8);
  },
  Muxer: class {
    addVideoChunk(): void {}
    addAudioChunk(): void {}
    finalize(): void {}
  },
}));

/** 在途上限（= `muxer.ts` 的 `MAX_ENCODE_QUEUE`）：本用例的判据就钉在它上 */
const IN_FLIGHT_CAP = 32;

/** 一帧都不主动消化的假编码器；`autoDrain = true` 之后每拍消化一帧 */
class FakeVideoEncoder {
  static submitted = 0;
  static pending = 0;
  static peakPending = 0;
  static autoDrain = false;
  static lastInstance: FakeVideoEncoder | null = null;
  /**
   * 起搏需求：攒够这么多帧之前**一帧都不吐**（照 Firefox VP9：在途 8 时永不吐第一帧）。
   * `Number.POSITIVE_INFINITY` = 只在 `flush()` 时吐（照"攒一批才吐"的极端实现）。
   */
  static primeNeeded = 0;
  static flushCount = 0;
  /**
   * 几个输入才换一个输出。**音频编码器不是 1:1**：AAC 一帧是 1024 采样，而 `addAudio`
   * 按 `audioChunkFrames()` = 960 采样一块喂 ⇒ 约 6% 的输入不会立刻变成输出。
   * 闸门若按 1:1 记"在途"，这些账永远还不掉 ⇒ 把导出吊死在闸门上（用户现场）。
   */
  static inputsPerOutput = 1;
  /** `'manual'` = 只在测试放行时吐；`'when-ready'` = 攒够 `inputsPerOutput` 就吐（照真编码器） */
  static drainMode: 'manual' | 'when-ready' = 'manual';

  private readonly output: (chunk: unknown, meta?: unknown) => void;
  private readonly onError: (e: Error) => void;
  private closed = false;

  constructor(init: { output: (c: unknown, m?: unknown) => void; error: (e: Error) => void }) {
    this.output = init.output;
    this.onError = init.error;
    FakeVideoEncoder.lastInstance = this;
  }

  static reset(): void {
    FakeVideoEncoder.submitted = 0;
    FakeVideoEncoder.pending = 0;
    FakeVideoEncoder.peakPending = 0;
    FakeVideoEncoder.autoDrain = false;
    FakeVideoEncoder.primeNeeded = 0;
    FakeVideoEncoder.flushCount = 0;
    FakeVideoEncoder.inputsPerOutput = 1;
    FakeVideoEncoder.drainMode = 'manual';
    FakeVideoEncoder.lastInstance = null;
  }

  static isConfigSupported(): Promise<{ supported: boolean }> {
    return Promise.resolve({ supported: true });
  }

  get encodeQueueSize(): number {
    return FakeVideoEncoder.pending;
  }

  configure(): void {}

  encode(): void {
    if (this.closed) return;
    FakeVideoEncoder.submitted++;
    FakeVideoEncoder.pending++;
    FakeVideoEncoder.peakPending = Math.max(FakeVideoEncoder.peakPending, FakeVideoEncoder.pending);
    // 起搏期：攒够 `primeNeeded` 之前不吐（真实编码器的 lookahead 行为）
    if (FakeVideoEncoder.submitted < FakeVideoEncoder.primeNeeded) return;
    if (FakeVideoEncoder.drainMode === 'when-ready') {
      if (FakeVideoEncoder.pending >= FakeVideoEncoder.inputsPerOutput) this.drainOne();
      return;
    }
    if (FakeVideoEncoder.autoDrain) setTimeout(() => this.drainOne(), 0);
  }

  /**
   * 消化**一个输出**（消费 `inputsPerOutput` 个输入）。
   * 手动放行 / 自动放行都走它 —— 保证"输出数 ≠ 输入数"时账目与真编码器一致。
   */
  drainOne(): void {
    if (this.closed) return;
    if (FakeVideoEncoder.pending < FakeVideoEncoder.inputsPerOutput) return;
    FakeVideoEncoder.pending -= FakeVideoEncoder.inputsPerOutput;
    try {
      this.output({ byteLength: 1 }, undefined);
    } catch (e) {
      this.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /** 真 API 语义：`flush()` 把**已提交的**都处理完（数量受 `inputsPerOutput` 约束） */
  flush(): Promise<void> {
    FakeVideoEncoder.flushCount++;
    while (FakeVideoEncoder.pending >= FakeVideoEncoder.inputsPerOutput) this.drainOne();
    return Promise.resolve();
  }

  /** 让编码器报错（测试"停摆 + 唤醒"那条用） */
  failWith(message: string): void {
    this.onError(new Error(message));
  }

  close(): void {
    this.closed = true;
  }
}

/** 音频侧：同一套假货（用户现场卡的就是 `addAudio`） */
class FakeAudioData {
  close(): void {}
}

function stubAudioWorld(): void {
  (globalThis as Record<string, unknown>).AudioData = FakeAudioData;
  (globalThis as Record<string, unknown>).AudioEncoder = FakeVideoEncoder;
}

function clearEncoders(): void {
  delete (globalThis as Record<string, unknown>).VideoEncoder;
  delete (globalThis as Record<string, unknown>).AudioEncoder;
  delete (globalThis as Record<string, unknown>).AudioData;
}

const fakeFrame = (i: number) => ({ timestamp: i * 16_666 }) as unknown as VideoFrame;

/** `addAudio()` 要的 `AudioBuffer`（node 里没有 Web Audio） */
const fakeAudioBuffer = (chunks: number) => {
  const chunk = 960;
  const length = chunk * chunks;
  const plane = new Float32Array(length);
  return {
    sampleRate: 48_000,
    numberOfChannels: 2,
    length,
    getChannelData: () => plane,
  } as unknown as AudioBuffer;
};

const sinkOptions = (over: Record<string, unknown> = {}) => ({
  spec: CONTAINER_SPECS.webm,
  videoCodec: 'vp09.00.10.08',
  audioCodec: null,
  width: 1280,
  height: 720,
  fps: 60,
  bitrate: 6_000_000,
  audio: null,
  ...over,
});

const loadSink = async () => {
  const { createVideoSink } = await import('@/src/preview/video/encode/muxer');
  return createVideoSink;
};

/** 超时就判失败（不许挂死是这些用例的核心断言） */
async function within<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))]);
}

describe('视频封装 · 编码背压（慢编码器不得让在途帧无界增长）', () => {
  afterEach(() => {
    FakeVideoEncoder.reset();
    clearEncoders();
  });

  it('编码器一帧都不消化时，在途帧被压在上限内（不是一路提交到底）', async () => {
    (globalThis as Record<string, unknown>).VideoEncoder = FakeVideoEncoder;
    const createVideoSink = await loadSink();
    const sink = await createVideoSink(sinkOptions());

    const TOTAL = 50;
    let finished = false;
    const addAll = (async () => {
      for (let i = 0; i < TOTAL; i++) await sink.addFrame(fakeFrame(i));
      finished = true;
    })();

    // 给足时间：旧实现下这 50 帧早就提交完了（等一拍 ≈ 1~4 ms）
    await new Promise((r) => setTimeout(r, 150));

    expect(FakeVideoEncoder.peakPending).toBeLessThanOrEqual(IN_FLIGHT_CAP);
    expect(FakeVideoEncoder.submitted).toBeLessThanOrEqual(IN_FLIGHT_CAP);
    expect(finished).toBe(false); // 真背压会**等**住，而不是冲到底

    // 放行编码器 → 全部帧提交完、在途清零
    FakeVideoEncoder.autoDrain = true;
    FakeVideoEncoder.lastInstance?.drainOne();
    expect(await within(addAll, 5000)).not.toBe('timeout');
    expect(FakeVideoEncoder.submitted).toBe(TOTAL);
    expect(FakeVideoEncoder.peakPending).toBeLessThanOrEqual(IN_FLIGHT_CAP);
    sink.abort();
  });

  it('编码器停摆时 `addFrame` 会等住；`abort()` / 编码器报错不许把导出挂死', async () => {
    (globalThis as Record<string, unknown>).VideoEncoder = FakeVideoEncoder;
    const createVideoSink = await loadSink();
    const sink = await createVideoSink(sinkOptions());

    // ① 先把在途填满 ⇒ 下一帧必须等住
    for (let i = 0; i < IN_FLIGHT_CAP; i++) await sink.addFrame(fakeFrame(i));
    let settled = false;
    const blocked = sink.addFrame(fakeFrame(99)).then(
      () => {
        settled = true;
        return 'resolved';
      },
      () => {
        settled = true;
        return 'rejected';
      },
    );
    await new Promise((r) => setTimeout(r, 80));
    expect(settled).toBe(false); // 编码器不吐东西 ⇒ 一直等（限流生效）

    // ② 编码器报错 = 这一票已经废了：等住的那一帧必须被唤醒并抛错，不能永久挂住
    FakeVideoEncoder.lastInstance?.failWith('编码器炸了');
    expect(await blocked).toBe('rejected');
  });

  it('编码器要攒一批才吐第一帧（Firefox VP9）时，也必须跑完 —— 不许死等', async () => {
    (globalThis as Record<string, unknown>).VideoEncoder = FakeVideoEncoder;
    const createVideoSink = await loadSink();
    // 起搏需求**高于常驻上限**：只按上限收口 ⇒ 永远等不到第一帧
    FakeVideoEncoder.primeNeeded = IN_FLIGHT_CAP + 8;
    const sink = await createVideoSink(sinkOptions());

    const TOTAL = IN_FLIGHT_CAP + 16;
    const addAll = (async () => {
      for (let i = 0; i < TOTAL; i++) await sink.addFrame(fakeFrame(i));
    })();

    expect(await within(addAll, 8000)).not.toBe('timeout');
    expect(FakeVideoEncoder.submitted).toBe(TOTAL);
    sink.abort();
  }, 15_000);

  it('编码器只在 flush 时吐（迟迟不吐）时，超过上限的帧数也必须跑完 —— 用户现场那条', async () => {
    (globalThis as Record<string, unknown>).VideoEncoder = FakeVideoEncoder;
    const createVideoSink = await loadSink();
    // 一帧都不主动吐：只能靠"饿死就 flush"把它逼出来
    FakeVideoEncoder.primeNeeded = Number.POSITIVE_INFINITY;
    const sink = await createVideoSink(sinkOptions());

    // 关键：帧数要**超过**上限才逼得出"退让到上限后重等"的死锁（旧实现：190 帧只提交 128 就卡死）
    const TOTAL = IN_FLIGHT_CAP * 6;
    const addAll = (async () => {
      for (let i = 0; i < TOTAL; i++) await sink.addFrame(fakeFrame(i));
    })();

    expect(await within(addAll, 20_000)).not.toBe('timeout');
    expect(FakeVideoEncoder.submitted).toBe(TOTAL);
    expect(FakeVideoEncoder.flushCount).toBeGreaterThan(0); // 兜底是 flush，不是"硬放行"
    sink.abort();
  }, 25_000);

  it('音频通道同一套闸门：只在 flush 时吐的音频编码器 + 超过上限的块数，也不许挂死', async () => {
    (globalThis as Record<string, unknown>).VideoEncoder = FakeVideoEncoder;
    stubAudioWorld();
    const createVideoSink = await loadSink();
    FakeVideoEncoder.primeNeeded = Number.POSITIVE_INFINITY;
    const sink = await createVideoSink(
      sinkOptions({ audioCodec: 'opus', audio: { sampleRate: 48_000, numberOfChannels: 2 } }),
    );

    // 用户现场卡的就是这一步（出帧循环跑完、进度停在 2100/2100，随后 addAudio 永不返回）
    const chunks = IN_FLIGHT_CAP * 6;
    const done = within(sink.addAudio(fakeAudioBuffer(chunks)), 20_000);
    expect(await done).not.toBe('timeout');
    expect(FakeVideoEncoder.submitted).toBe(chunks);
    sink.abort();
  }, 25_000);

  it('音频编码器输入:输出不是 1:1（照 AAC 的 1024 采样帧 vs 我们 960 的块）⇒ 不许把导出吊死', async () => {
    (globalThis as Record<string, unknown>).VideoEncoder = FakeVideoEncoder;
    stubAudioWorld();
    const createVideoSink = await loadSink();
    // 每 2 块吐 1 个输出：编码器自己是健康的（攒够就吐），只是**输出数 ≠ 输入数**
    FakeVideoEncoder.inputsPerOutput = 2;
    FakeVideoEncoder.drainMode = 'when-ready';
    const sink = await createVideoSink(
      sinkOptions({ audioCodec: 'opus', audio: { sampleRate: 48_000, numberOfChannels: 2 } }),
    );

    const chunks = 200;
    expect(await within(sink.addAudio(fakeAudioBuffer(chunks)), 10_000)).not.toBe('timeout');
    expect(FakeVideoEncoder.submitted).toBe(chunks);
    // 这条走**对账**（编码器手上没压着活 ⇒ 是我们的记账残渣），不该白 flush 打乱 GOP
    expect(FakeVideoEncoder.flushCount).toBe(0);
    sink.abort();
  }, 15_000);

  it('等背压时点取消：必须退出（不是等导出自己结束）', async () => {
    (globalThis as Record<string, unknown>).VideoEncoder = FakeVideoEncoder;
    const createVideoSink = await loadSink();
    FakeVideoEncoder.primeNeeded = Number.POSITIVE_INFINITY; // 永不吐 ⇒ 必然等背压
    let cancelled = false;
    const sink = await createVideoSink(sinkOptions({ isCancelled: () => cancelled }));

    for (let i = 0; i < IN_FLIGHT_CAP; i++) await sink.addFrame(fakeFrame(i));
    const blocked = sink.addFrame(fakeFrame(999)).then(
      () => 'resolved',
      () => 'rejected',
    );
    cancelled = true;
    // 上限内退出即可（一拍 `STARVE` 的量级），关键是**不许一直挂**
    expect(await within(blocked, 4000)).toBe('rejected');
  }, 10_000);
});
