// @vitest-environment jsdom
// chart-preview 20 锁测：播放速率（倍速）。
// 速率要三处一起缩放，否则音画不同步：① 两条时钟的经过时间（`getSeconds`）；② BGM 音源的
// `playbackRate`；③ 键音调度（谱面秒差 ÷ 速率 = 墙钟秒差）。另外：**播放中改速率不跳位置**。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYBACK_RATE_RANGE, AudioEngine } from '@/src/audio/AudioEngine';
import { SIM_PLAYBACK_RATE_PRESETS, SIM_PLAYBACK_RATE_STEP } from '@/src/preview/video/sim/simPlayback';

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
  sources: MockBufferSourceNode[] = [];
  /** 每次按键音（振荡器兜底）的 start 时刻 */
  oscStarts: number[] = [];

  createGain() {
    return new MockGainNode();
  }

  createBufferSource() {
    const src = new MockBufferSourceNode();
    this.sources.push(src);
    return src;
  }

  createOscillator() {
    return {
      type: 'sine',
      frequency: { value: 440 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: (when: number) => { this.oscStarts.push(when); },
      stop: vi.fn(),
    };
  }

  decodeAudioData(): Promise<AudioBuffer> {
    return Promise.resolve({
      duration: 100, length: 100 * 44100, numberOfChannels: 2, sampleRate: 44100,
    } as unknown as AudioBuffer);
  }

  resume() {
    return Promise.resolve();
  }
}

const engineCtx = (engine: AudioEngine) => (engine as unknown as { ctx: MockAudioContext }).ctx;

describe('AudioEngine · 播放速率（chart-preview 20）', () => {
  let origAudioContext: unknown;
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    origAudioContext = window.AudioContext;
    (window as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
    // 合成时间线用 performance.now：钉住它才能断言"墙钟 → 谱面秒"的换算
    nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    (window as unknown as { AudioContext: unknown }).AudioContext = origAudioContext;
    nowSpy.mockRestore();
  });

  it('有音频：位置按速率推进、BGM 音源 playbackRate 跟随，改速率当刻不跳位置', async () => {
    const engine = new AudioEngine();
    await engine.load(new File([new Uint8Array([1])], 'a.mp3', { type: 'audio/mpeg' }));
    await engine.play();
    const ctx = engineCtx(engine);

    ctx.currentTime = 10;
    expect(engine.getSeconds()).toBeCloseTo(10, 6); // 原速：墙钟 10s = 谱面 10s

    engine.setPlaybackRate(2);
    expect(engine.getSeconds()).toBeCloseTo(10, 6); // 改速率不跳位置
    expect(ctx.sources.at(-1)!.playbackRate.value).toBe(2);

    ctx.currentTime = 12; // 再走 2s 墙钟
    expect(engine.getSeconds()).toBeCloseTo(14, 6); // 2s × 2 倍速 = 4 谱面秒
  });

  it('无音频（合成时间线）：同样按速率推进，且位置连续', async () => {
    const engine = new AudioEngine();
    await engine.play(); // 无 buffer → 合成时钟

    nowSpy.mockReturnValue(5000); // 墙钟走了 5s
    expect(engine.getSeconds()).toBeCloseTo(5, 6);

    engine.setPlaybackRate(0.5);
    expect(engine.getSeconds()).toBeCloseTo(5, 6);

    nowSpy.mockReturnValue(7000); // 再走 2s 墙钟
    expect(engine.getSeconds()).toBeCloseTo(6, 6); // 2s × 0.5 倍速 = 1 谱面秒
  });

  it('键音调度：谱面秒差 ÷ 速率 = 墙钟秒差（1s 处的键音在 2 倍速下 0.5s 后发声）', async () => {
    const engine = new AudioEngine();
    engine.setChart(
      [
        { type: 'BPM', beat: 0, bpm: 120 },
        { type: 'Single', beat: 2, lane: 3 }, // beat 2 @120BPM = 1s
      ],
      4,
    );
    await engine.play();
    const ctx = engineCtx(engine);
    nowSpy.mockReturnValue(0); // 播放头钉在 0

    engine.setPlaybackRate(2);
    (engine as unknown as { tick: () => void }).tick();
    expect(ctx.oscStarts).toHaveLength(1);
    expect(ctx.oscStarts[0]!).toBeCloseTo(0.5, 6); // (1 − 0) / 2
  });

  it('速率钳制在引擎允许区间内，每一档常用倍速都合法', () => {
    const engine = new AudioEngine();
    engine.setPlaybackRate(0);
    expect(engine.playbackRate).toBe(PLAYBACK_RATE_RANGE.min);
    engine.setPlaybackRate(99);
    expect(engine.playbackRate).toBe(PLAYBACK_RATE_RANGE.max);
    engine.setPlaybackRate(Number.NaN);
    expect(engine.playbackRate).toBe(PLAYBACK_RATE_RANGE.max); // 非法值不动
    for (const rate of SIM_PLAYBACK_RATE_PRESETS) {
      expect(rate).toBeGreaterThanOrEqual(PLAYBACK_RATE_RANGE.min);
      expect(rate).toBeLessThanOrEqual(PLAYBACK_RATE_RANGE.max);
    }
  });

  it('倍速控件的边界就是引擎边界：0.1 与 4 照收，再往外一步就被钳回', () => {
    const engine = new AudioEngine();
    engine.setPlaybackRate(PLAYBACK_RATE_RANGE.min); // 最低档 0.1×
    expect(engine.playbackRate).toBe(0.1);
    engine.setPlaybackRate(PLAYBACK_RATE_RANGE.max); // 手填上限 4×
    expect(engine.playbackRate).toBe(4);

    engine.setPlaybackRate(0.1 - SIM_PLAYBACK_RATE_STEP); // 再往下一档（0）⇒ 钳回下限
    expect(engine.playbackRate).toBe(0.1);
    engine.setPlaybackRate(4 + SIM_PLAYBACK_RATE_STEP); // 再往上一档 ⇒ 钳回上限
    expect(engine.playbackRate).toBe(4);
  });

  it('issue 179 · load 解码后预触碰各声道 PCM 页，首次 play 预热音频混合图且不干扰 BGM source', async () => {
    const ch0 = new Float32Array(2049);
    const ch1 = new Float32Array(2049);
    const getChannelData = vi.fn((ch: number) => (ch === 0 ? ch0 : ch1));
    const primerBuffers: Float32Array[] = [];
    const closeSpy = vi.fn(() => Promise.resolve());

    class PrimedMockAudioContext extends MockAudioContext {
      sampleRate = 48000;
      override decodeAudioData(): Promise<AudioBuffer> {
        return Promise.resolve({
          duration: 30,
          numberOfChannels: 2,
          getChannelData,
        } as unknown as AudioBuffer);
      }
      createBuffer(_ch: number, len: number): AudioBuffer {
        const arr = new Float32Array(len);
        primerBuffers.push(arr);
        return {
          duration: len / 48000,
          numberOfChannels: 1,
          getChannelData: () => arr,
        } as unknown as AudioBuffer;
      }
      close = closeSpy;
    }

    (window as unknown as { AudioContext: unknown }).AudioContext = PrimedMockAudioContext;
    const engine = new AudioEngine();

    await engine.load(new File([new Uint8Array(8)], 'bgm.mp3'));
    expect(getChannelData).toHaveBeenCalledWith(0);
    expect(getChannelData).toHaveBeenCalledWith(1);

    await engine.play();
    const ctx = engineCtx(engine);
    // 首次 play 先跑 1 次微脉冲预热（非零 1e-6），紧接着启动 BGM source（位于 sources 末尾）
    expect(primerBuffers).toHaveLength(1);
    expect(primerBuffers[0]![0]).toBeCloseTo(1e-6, 10);
    expect(ctx.sources).toHaveLength(2);
    engine.setPlaybackRate(1.5);
    expect(ctx.sources.at(-1)!.playbackRate.value).toBe(1.5);

    // 同 id 重复调用 setKeySetId 幂等，不会把已挂载的 keySet 置回 null
    const fakeSet = { id: 'skin00', samples: {} };
    (engine as unknown as { keySetId: string; keySet: unknown }).keySetId = 'skin00';
    (engine as unknown as { keySetId: string; keySet: unknown }).keySet = fakeSet;
    engine.setKeySetId('skin00');
    expect((engine as unknown as { keySet: unknown }).keySet).toBe(fakeSet);

    engine.dispose();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
