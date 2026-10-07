// @vitest-environment jsdom
// chart-preview 20 的循环锁测（票面「锁测」：`tests/dom/preview/` 那条之外，回绕本身在回放这一层）。
//
// 循环（到谱面长度回绕到 0 继续播）与"关 = 停在末帧"是**回放内部的状态机** —— 控件那一层只能
// 证明"开关把 `loop` 传下来了"，证明不了"到点真的回绕"。所以这里把 rAF 换成手动泵：
// 推到终点 → 泵一帧 → 看它回绕还是停住。
//
// 单一时钟那条同时被锁住：回绕只允许 `engine.seek(0)`（ADR-0004 §2），不另起 rAF / 计时器。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSimPlayback } from '@/src/preview/video/sim/simPlayback';

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
    return Promise.resolve({} as AudioBuffer);
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

/** 手动泵：rAF 的回调抓在手里，想推进几帧就调用几次 */
let rafCb: FrameRequestCallback | null = null;

/** 没有位图的画布（jsdom 不实现 2d 上下文）：`render()` 会自己跳过，不影响状态机 */
const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;

function makePlayback(loop: boolean, duration = 4) {
  const ticks: [number, boolean][] = [];
  const pb = createSimPlayback({
    canvas,
    audio: null,
    keySetId: 'skin00',
    seVolume: 1,
    volume: 1,
    rate: 1,
    loop,
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

describe('createSimPlayback · 循环（chart-preview 20）', () => {
  it('开循环：到谱面长度回绕到 0 继续播（仍在同一条时钟上）', async () => {
    const { pb, ticks } = makePlayback(true);
    await startPlaying(pb);
    expect(rafCb).toBeTruthy();

    pb.seek(4); // 推到终点
    const frame = rafCb!;
    rafCb = null;
    frame(0);

    expect(ticks.at(-1)).toEqual([0, true]); // 回绕到 0，且**还在播**
    expect(rafCb).toBeTruthy(); // 继续排下一帧（没有停）
    pb.dispose();
  });

  it('关循环：到谱面长度停在末帧（不回绕、不再排帧）', async () => {
    const { pb, ticks } = makePlayback(false);
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

  it('循环开关可以在播放中切换：只走 setOptions，不重建', async () => {
    const { pb } = makePlayback(false);
    await startPlaying(pb);
    pb.setOptions({ loop: true });
    pb.seek(4);
    const frame = rafCb!;
    rafCb = null;
    frame(0);
    expect(rafCb).toBeTruthy(); // 中途打开也照样回绕
    pb.dispose();
  });
});
