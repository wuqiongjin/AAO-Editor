// @vitest-environment jsdom
// 回放终点的锁测（chart-preview 20 起；issue 22 收掉循环能力后只守"停在末帧"这一侧）。
//
// "到谱面长度停在末帧、rAF 收手（不另起时钟）"是**回放内部的状态机** —— 控件那一层证明不了。
// 所以这里把 rAF 换成手动泵：推到终点 → 泵一帧 → 看它停住。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYBACK_RATE_RANGE as ENGINE_PLAYBACK_RATE_RANGE } from '@/src/audio/AudioEngine';
import {
  PLAYBACK_RATE_RANGE,
  SIM_PLAYBACK_RATE_STEP,
  createSimPlayback,
  normalizePlaybackRate,
} from '@/src/preview/video/sim/simPlayback';

/** 只满足 `AudioEngine.ensureCtx()` 的形状：不解码、不发声 */
class MockAudioContext {
  currentTime = 0;
  state: AudioContextState = 'running';
  destination = {};
  createGain() {
    return {
      gain: {
        value: 1,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
  createBufferSource() {
    return {
      buffer: null,
      playbackRate: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
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
  decodeAudioData(): Promise<AudioBuffer> {
    return Promise.resolve({ duration: 60 } as AudioBuffer);
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

/** 手动泵：rAF 的回调抓在手里，想推进几帧就调用几次 */
let rafCb: FrameRequestCallback | null = null;

/** 没有位图的画布（jsdom 不实现 2d 上下文）：`render()` 会自己跳过，不影响状态机 */
const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;

function makePlayback(duration = 4) {
  const ticks: [number, boolean][] = [];
  const pb = createSimPlayback({
    canvas,
    audio: null,
    keySetId: 'skin00',
    seVolume: 1,
    volume: 1,
    rate: 1,
    duration,
    density: 1,
    onTick: (seconds, playing) => ticks.push([seconds, playing]),
  });
  return { pb, ticks };
}

/** 起播 + 泵到"下一帧已排上" */
async function startPlaying(pb: ReturnType<typeof makePlayback>['pb']): Promise<void> {
  pb.play();
  await new Promise((resolve) => setTimeout(resolve, 0)); // engine.play().then(...) 里才排 rAF
}

beforeEach(() => {
  (window as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
  rafCb = null;
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    rafCb = cb;
    return 1;
  };
  window.cancelAnimationFrame = () => {
    rafCb = null;
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createSimPlayback · 播放终点', () => {
  it('到谱面长度停在末帧（不回绕、不再排帧）', async () => {
    const { pb, ticks } = makePlayback();
    await startPlaying(pb);
    expect(rafCb).toBeTruthy();

    pb.seek(4);
    const frame = rafCb!;
    rafCb = null;
    frame(0);

    expect(ticks.at(-1)).toEqual([4, false]); // 停在末帧、播放态结束
    expect(rafCb).toBeNull(); // rAF 已收（没有另起时钟）
    pb.dispose();
  });
});

// 倍速的上下限必须与**引擎那份钳制**同源（UI 侧不许另立第二份）。这条守的是"UI 挪了区间 /
// 引擎没跟着改"的口径漂移：两边一旦松开，输入框里写的值会和引擎实际跑的值对不上。
describe('倍速归一化（chart-preview 20）', () => {
  it('上下限就是引擎那份 PLAYBACK_RATE_RANGE 本身（不是抄一份）', () => {
    expect(PLAYBACK_RATE_RANGE).toBe(ENGINE_PLAYBACK_RATE_RANGE);
    expect(PLAYBACK_RATE_RANGE).toEqual({ min: 0.1, max: 4 });
    expect(SIM_PLAYBACK_RATE_STEP).toBe(0.1);
  });

  it('越界就地钳回、非法值回落到 fallback', () => {
    expect(normalizePlaybackRate(9)).toBe(4);
    expect(normalizePlaybackRate(0.05)).toBe(0.1);
    expect(normalizePlaybackRate(0.05, 2)).toBe(0.1); // 回落值仍旧要过一遍钳制
    expect(normalizePlaybackRate(Number.NaN)).toBe(1);
    expect(normalizePlaybackRate(Number.NaN, 0.5)).toBe(0.5);
    expect(normalizePlaybackRate('abc')).toBe(1);
    expect(normalizePlaybackRate('')).toBe(1);
    expect(normalizePlaybackRate(1.35)).toBe(1.35); // 档位表之外的手填值照原样收
  });
});

describe('createSimPlayback · 初始进度与异步解码保持（issue 35）', () => {
  it('传入 initialSeconds 时首帧通知目标秒数，异步音频解码完成后不被冲回 0', async () => {
    const ticks: [number, boolean][] = [];
    const mockAudio = { name: 'test.mp3', blob: new Blob(['mock-audio-data'], { type: 'audio/mp3' }) };
    const pb = createSimPlayback({
      canvas,
      audio: mockAudio,
      keySetId: 'skin00',
      seVolume: 1,
      volume: 1,
      rate: 1,
      duration: 30,
      initialSeconds: 12.5,
      density: 1,
      onTick: (seconds, playing) => ticks.push([seconds, playing]),
    });

    // 创建时立即向外部广播 initialSeconds
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    expect(ticks[0]).toEqual([12.5, false]);

    // 等待引擎内部 load(file) 异步解码 Promise 完成
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 解码完成后 targetSeconds 必须重新恢复，依然是 12.5，不会被 AudioEngine.load 内部的 offsetSeconds = 0 冲刷
    const lastTick = ticks.at(-1);
    expect(lastTick?.[0]).toBe(12.5);

    // 随后起播，第一帧应当从 12.5 处开始向后推进，而不是从 0 开始
    await startPlaying(pb);
    expect(rafCb).toBeTruthy();
    const frame = rafCb!;
    rafCb = null;
    frame(100);

    const playTick = ticks.at(-1);
    expect(playTick?.[0]).toBeGreaterThanOrEqual(12.5);
    expect(playTick?.[1]).toBe(true);

    pb.dispose();
  });
});

