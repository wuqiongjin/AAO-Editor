// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '@/src/audio/AudioEngine';

class MockGainNode {
  gain = {
    value: 1,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockBufferSourceNode {
  buffer: AudioBuffer | null = null;
  /** chart-preview 20：播放速率（真节点自带；引擎按它设倍速） */
  playbackRate = { value: 1 };
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class MockAudioContext {
  currentTime = 0;
  state: AudioContextState = 'running';
  destination = {};

  createGain() {
    return new MockGainNode();
  }

  createBufferSource() {
    return new MockBufferSourceNode();
  }

  createOscillator() {
    return {
      type: 'sine',
      frequency: { value: 440 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
  }

  decodeAudioData(buf: ArrayBuffer): Promise<AudioBuffer> {
    return Promise.resolve({
      duration: 100,
      length: 100 * 44100,
      numberOfChannels: 2,
      sampleRate: 44100,
    } as unknown as AudioBuffer);
  }

  resume() {
    return Promise.resolve();
  }
}

describe('Issue 165 · AudioEngine 首次播放卡顿防回潮测试', () => {
  let origAudioContext: unknown;

  beforeEach(() => {
    origAudioContext = window.AudioContext;
    (window as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
  });

  afterEach(() => {
    (window as unknown as { AudioContext: unknown }).AudioContext = origAudioContext;
  });

  it('播放中后台音频解码完成时：不篡改 playing 状态，平滑切入音频时钟，秒数不归零', async () => {
    const engine = new AudioEngine();

    // 1. 无音频时开播，使用合成时间线（synthetic clock）
    await engine.play();
    expect(engine.isPlaying).toBe(true);

    const secBefore = engine.getSeconds();
    expect(secBefore).toBeGreaterThanOrEqual(0);

    // 2. 模拟延迟返回的解码任务
    let resolveDecode!: (buf: AudioBuffer) => void;
    const decodePromise = new Promise<AudioBuffer>((resolve) => {
      resolveDecode = resolve;
    });

    const ctx = (engine as unknown as { ensureCtx: () => MockAudioContext }).ensureCtx();
    vi.spyOn(ctx, 'decodeAudioData').mockReturnValueOnce(decodePromise);

    const dummyFile = new File([new Uint8Array([1, 2, 3])], 'song.mp3', { type: 'audio/mpeg' });
    const loadPromise = engine.load(dummyFile);

    // 播放持续进行
    expect(engine.isPlaying).toBe(true);

    // 3. 解码完成
    resolveDecode({
      duration: 120,
      length: 120 * 44100,
      numberOfChannels: 2,
      sampleRate: 44100,
    } as unknown as AudioBuffer);

    await loadPromise;

    // 4. 关键断言：状态依然是 playing（而不是被置为 ready），时钟未被清零
    expect(engine.isPlaying).toBe(true);
    const secAfter = engine.getSeconds();
    expect(secAfter).toBeGreaterThanOrEqual(secBefore);
    expect(engine.duration).toBe(120);
  });

  it('非播放状态下加载新音频：复位 offsetSeconds 为 0，准备从头播放', async () => {
    const engine = new AudioEngine();

    // 播放后暂停在 10 秒
    await engine.play();
    engine.seek(10);
    engine.pause();
    expect(engine.getSeconds()).toBeCloseTo(10);

    const dummyFile = new File([new Uint8Array([1, 2, 3])], 'song.mp3', { type: 'audio/mpeg' });
    await engine.load(dummyFile);

    // 新音频加载后复位为 0，进入 ready 状态
    expect(engine.isPlaying).toBe(false);
    expect(engine.getSeconds()).toBe(0);
  });

  it('多任务竞态保护：新 load / clear 会使旧异步解码结果失效', async () => {
    const engine = new AudioEngine();

    let resolve1!: (buf: AudioBuffer) => void;
    const decode1 = new Promise<AudioBuffer>((r) => { resolve1 = r; });

    const ctx = (engine as unknown as { ensureCtx: () => MockAudioContext }).ensureCtx();
    vi.spyOn(ctx, 'decodeAudioData')
      .mockReturnValueOnce(decode1)
      .mockResolvedValueOnce({
        duration: 200,
        length: 200 * 44100,
        numberOfChannels: 2,
        sampleRate: 44100,
      } as unknown as AudioBuffer);

    const f1 = new File([new Uint8Array([1])], 'song1.mp3');
    const f2 = new File([new Uint8Array([2])], 'song2.mp3');

    const p1 = engine.load(f1);
    const p2 = engine.load(f2);

    await p2;
    expect(engine.duration).toBe(200);

    // 此时慢速的 f1 才返回
    resolve1({
      duration: 100,
      length: 100 * 44100,
      numberOfChannels: 2,
      sampleRate: 44100,
    } as unknown as AudioBuffer);

    await p1;

    // f1 的结果被丢弃，保留最新的 f2 (duration 200)
    expect(engine.duration).toBe(200);
  });
});
