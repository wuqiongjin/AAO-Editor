// @vitest-environment jsdom
// issue 210 锁测：macOS 能耗异常与音频硬件及应用壳保活优化。
// 验证：
// 1. 保活源为单次非循环短脉冲（loop 恒为 falsy），不泄漏持续活动的 AudioNode。
// 2. 长时间空闲（30s 无播放/音效）自动调用 ctx.suspend() 释放系统电源锁与硬件资源。
// 3. 用户重新交互（手势/播放/试听）无缝调用 ctx.resume() 并按需预热唤醒硬件。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '@/src/audio/AudioEngine';

class MockGainNode {
  gain = {
    value: 1,
    setValueAtTime: vi.fn(),
  };
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockBufferSourceNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  playbackRate = { value: 1 };
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
  onended: (() => void) | null = null;
}

class IdleMockAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  state: AudioContextState = 'running';
  destination = {};
  sources: MockBufferSourceNode[] = [];
  primerBuffers: Float32Array[] = [];

  suspend = vi.fn(() => {
    this.state = 'suspended';
    return Promise.resolve();
  });

  resume = vi.fn(() => {
    this.state = 'running';
    return Promise.resolve();
  });

  close = vi.fn(() => {
    this.state = 'closed';
    return Promise.resolve();
  });

  createGain() {
    return new MockGainNode();
  }

  createBufferSource() {
    const src = new MockBufferSourceNode();
    this.sources.push(src);
    return src;
  }

  createBuffer(_ch: number, len: number, _rate: number): AudioBuffer {
    const arr = new Float32Array(len);
    this.primerBuffers.push(arr);
    return {
      duration: len / 48000,
      numberOfChannels: 1,
      getChannelData: () => arr,
    } as unknown as AudioBuffer;
  }

  decodeAudioData(): Promise<AudioBuffer> {
    return Promise.resolve({
      duration: 10,
      numberOfChannels: 2,
      sampleRate: 48000,
      getChannelData: () => new Float32Array(1024),
    } as unknown as AudioBuffer);
  }
}

const engineCtx = (engine: AudioEngine) => (engine as unknown as { ctx: IdleMockAudioContext | null }).ctx;

describe('AudioEngine · issue 210 空闲挂起与短脉冲保活机制', () => {
  let origAudioContext: unknown;
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    origAudioContext = window.AudioContext;
    (window as unknown as { AudioContext: unknown }).AudioContext = IdleMockAudioContext;
    nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    (window as unknown as { AudioContext: unknown }).AudioContext = origAudioContext;
    nowSpy.mockRestore();
  });

  it('保活脉冲为非循环节点（loop 为 falsy），且首样本幅值高于 16-bit 1 LSB 门槛', async () => {
    const engine = new AudioEngine();
    await engine.play();
    const ctx = engineCtx(engine)!;

    expect(ctx.sources.length).toBeGreaterThanOrEqual(1);
    const primerSrc = ctx.sources[0]!;
    expect(primerSrc.loop).toBeFalsy(); // 严禁死循环常驻
    expect(ctx.primerBuffers.length).toBeGreaterThanOrEqual(1);
    expect(ctx.primerBuffers[0]![0]).toBeGreaterThanOrEqual(1 / 16384); // 满足 2 LSB 唤醒硬件
    expect(primerSrc.connect).toHaveBeenCalledWith(ctx.destination);

    engine.dispose();
  });

  it('停止/暂停后静置满 30 秒自动调用 ctx.suspend() 释放电源断言', async () => {
    const engine = new AudioEngine();
    await engine.play();
    const ctx = engineCtx(engine)!;
    expect(ctx.state).toBe('running');

    engine.pause();
    expect(ctx.suspend).not.toHaveBeenCalled();

    // 快进 29 秒：仍保持 running
    vi.advanceTimersByTime(29_000);
    expect(ctx.suspend).not.toHaveBeenCalled();

    // 满 30 秒：优雅调用 suspend
    vi.advanceTimersByTime(1_000);
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe('suspended');

    engine.dispose();
  });

  it('在 suspended 状态下，用户交互（手势 pointerdown）无缝 resume 并按需唤醒音频链路', async () => {
    const engine = new AudioEngine();
    await engine.play();
    const ctx = engineCtx(engine)!;

    engine.pause();
    vi.advanceTimersByTime(30_000);
    expect(ctx.state).toBe('suspended');

    const sourcesBeforeGesture = ctx.sources.length;
    nowSpy.mockReturnValue(40_000);

    // 用户按下指针手势
    window.dispatchEvent(new Event('pointerdown'));

    expect(ctx.resume).toHaveBeenCalled();
    // 唤醒后应当发出单次短脉冲
    expect(ctx.sources.length).toBe(sourcesBeforeGesture + 1);
    const wakeSrc = ctx.sources.at(-1)!;
    expect(wakeSrc.loop).toBeFalsy();

    engine.dispose();
  });

  it('dispose 及时清理挂起定时器并断开上下文', async () => {
    const engine = new AudioEngine();
    await engine.play();
    const ctx = engineCtx(engine)!;

    engine.pause();
    engine.dispose();

    // dispose 之后即使经过 30 秒，也不应调用已销毁 context 的 suspend
    vi.advanceTimersByTime(35_000);
    expect(ctx.suspend).not.toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
  });
});
