// @vitest-environment jsdom
// issue 226 锁测：谱面修改后音频引擎事件取消与游标重校准
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '@/src/audio/AudioEngine';
import type { ChartNote } from '@/src/chart/types';

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

interface OscRecord {
  when: number;
  stopped: boolean;
}

class MockAudioContext {
  currentTime = 0;
  state: AudioContextState = 'running';
  destination = {};
  sources: MockBufferSourceNode[] = [];
  oscRecords: OscRecord[] = [];

  createGain() {
    return new MockGainNode();
  }

  createBufferSource() {
    const rec: OscRecord = { when: 0, stopped: false };
    const src = new MockBufferSourceNode();
    src.start = vi.fn((when: number = 0) => {
      rec.when = when;
      this.oscRecords.push(rec);
    });
    src.stop = vi.fn((when?: number) => {
      // 只有无参 stop() 才是手动 cancel 取消；带 when 的是自然结束
      if (when === undefined) {
        rec.stopped = true;
      }
    });
    this.sources.push(src);
    return src;
  }

  createOscillator() {
    const rec: OscRecord = { when: 0, stopped: false };
    return {
      type: 'sine',
      frequency: { value: 440 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: (when: number) => {
        rec.when = when;
        this.oscRecords.push(rec);
      },
      stop: (when?: number) => {
        if (when === undefined) {
          rec.stopped = true;
        }
      },
    };
  }

  decodeAudioData(): Promise<AudioBuffer> {
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

describe('issue 226 · AudioEngine 谱面更新取消已调度节点与游标重校准', () => {
  let origAudioContext: unknown;

  beforeEach(() => {
    origAudioContext = window.AudioContext;
    (window as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
  });

  afterEach(() => {
    (window as unknown as { AudioContext: unknown }).AudioContext = origAudioContext;
  });

  const notesInitial: ChartNote[] = [
    { type: 'BPM', bpm: 120, beat: 0 },
    { type: 'Single', lane: 0, beat: 1 }, // 0.5s
    { type: 'Single', lane: 1, beat: 2 }, // 1.0s
    { type: 'Single', lane: 2, beat: 3 }, // 1.5s
    { type: 'Single', lane: 3, beat: 4 }, // 2.0s
    { type: 'Single', lane: 4, beat: 5 }, // 2.5s
  ];

  it('播放态下调用 setChart 时必须取消之前已调度的未来音频节点', async () => {
    const engine = new AudioEngine();
    const ctx = (engine as unknown as { ensureCtx: () => MockAudioContext }).ensureCtx();
    engine.setChart(notesInitial, 4);

    await engine.play();
    engine.tick();

    // 验证初始状态下未来 2 秒内的音符已进入调度
    expect(ctx.oscRecords.length).toBeGreaterThan(0);
    const activeBefore = ctx.oscRecords.filter((r) => !r.stopped);
    expect(activeBefore.length).toBeGreaterThan(0);

    // 模拟谱面被修改（删除了开头的音符）
    const notesAfterDelete: ChartNote[] = [
      { type: 'BPM', bpm: 120, beat: 0 },
      { type: 'Single', lane: 4, beat: 5 }, // 2.5s
    ];

    engine.setChart(notesAfterDelete, 4);

    // 核心断言：之前调度的旧音符全部被 cancel（stopped === true）
    for (const oldRecord of activeBefore) {
      expect(oldRecord.stopped).toBe(true);
    }
  });

  it('播放中调用 setChart 时游标与调度必须基于真实播放头 getSeconds() 而非静态 offsetSeconds', async () => {
    const engine = new AudioEngine();
    const ctx = (engine as unknown as { ensureCtx: () => MockAudioContext }).ensureCtx();
    engine.setChart(notesInitial, 4);

    await engine.play();

    // 清空开播时调度的记录
    ctx.oscRecords.length = 0;

    // 模拟时间推进到 1.2 秒（已过 beat 1 的 0.5s 和 beat 2 的 1.0s）
    vi.spyOn(engine, 'getSeconds').mockReturnValue(1.2);

    // 重新 setChart
    engine.setChart(notesInitial, 4);

    // 核心断言：
    // 1. 在 1.2 秒时重新调度，已过去的音符（0.5s, 1.0s）绝不应被调度；
    // 2. 只有当前及未来的音符（1.5s, 2.0s, 2.5s）被调度；
    const newlyScheduled = ctx.oscRecords.filter((r) => !r.stopped);
    expect(newlyScheduled.length).toBe(3); // 1.5s, 2.0s, 2.5s
    // 验证每个调度的时刻都是针对当前时间（ctx.currentTime）加未来偏移（>= 0.25s）
    for (const rec of newlyScheduled) {
      expect(rec.when).toBeGreaterThanOrEqual(ctx.currentTime + 0.25);
    }
  });
});
