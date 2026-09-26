// AudioSession（架构深化评审候选 3 深模块）的核心单测。
// 注入假引擎：跳过真实 Web Audio，验证 session 的状态机 + 持久化钩子 + 订阅 + 竞态保护。
import { describe, it, expect, vi } from 'vitest';
import { AudioSession, type AudioSessionSnapshot } from '@/src/audio/AudioSession';
import type { AudioEngine } from '@/src/audio/AudioEngine';

/**
 * 假引擎：模拟 AudioEngine 的最小接口（不涉及 Web Audio）。
 * 暴露每个方法的调用历史供断言。
 */
class FakeAudioEngine {
  // duration 用 getter：load() 内部不写 this.duration，而是改 _simulatedDuration
  private _simulatedDuration: number | null = 12.5; // 默认 12.5s
  get duration(): number | null { return this._simulatedDuration; }
  set simulatedDuration(v: number | null) { this._simulatedDuration = v; }
  isPlaying = false;
  state: 'idle' | 'ready' | 'playing' | 'paused' = 'idle';
  loadCalls: File[] = [];
  clearCalls = 0;
  setKeySetCalls: string[] = [];
  setVolumeCalls: number[] = [];
  setSeVolumeCalls: number[] = [];
  setChartCalls: { notes: unknown; beatDisplay: number }[] = [];
  // 控制 load 何时 resolve（用于竞态测试）
  loadDelayMs = 0;
  async load(file: File): Promise<void> {
    this.loadCalls.push(file);
    if (this.loadDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.loadDelayMs));
    }
    // 不写 this.duration（保持 getter 由外部控制）
    this.state = 'ready';
  }
  clear(): void {
    this.clearCalls++;
    this._simulatedDuration = null;
    this.state = 'idle';
  }
  setKeySetId(id: string): void {
    this.setKeySetCalls.push(id);
  }
  previewCalls: { setId: string; kind: string; tier?: number }[] = [];
  async previewKeySample(setId: string, kind: string, tier?: number): Promise<void> {
    this.previewCalls.push({ setId, kind, tier });
  }
  setVolume(volume: number): void {
    this.setVolumeCalls.push(volume);
  }
  setSeVolume(volume: number): void {
    this.setSeVolumeCalls.push(volume);
  }
  setChart(notes: unknown, beatDisplay: number): void {
    this.setChartCalls.push({ notes, beatDisplay });
  }
  async play(): Promise<void> { this.isPlaying = true; this.state = 'playing'; }
  pause(): void { this.isPlaying = false; this.state = 'paused'; }
  seek(_sec: number): void { void _sec; }
  tick(): void { /* noop */ }
  getSeconds(): number { return 0; }
}

/** 工厂：返回同一个 fake 实例（便于断言 history） */
function makeFactory() {
  const fake = new FakeAudioEngine();
  const factory = () => fake as unknown as AudioEngine;
  return { fake, factory };
}

describe('AudioSession · 构造', () => {
  it('按初始 keySetId / seVolume / chartDuration / volume 建好，并把初始状态挂到引擎', () => {
    const { fake, factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin00', seVolume: 0.6, chartDuration: 45, volume: 0.4 });
    const snap = s.getSnapshot();
    expect(snap.keySetId).toBe('skin00');
    expect(snap.seVolume).toBe(0.6);
    expect(snap.chartDuration).toBe(45);
    expect(snap.audioName).toBeNull();
    expect(snap.audioError).toBeNull();
    expect(snap.hasAudio).toBe(false);
    // 引擎初始化：构造时挂初始值
    expect(fake.setVolumeCalls).toEqual([0.4]);
    expect(fake.setSeVolumeCalls).toEqual([0.6]);
    expect(fake.setKeySetCalls).toEqual(['skin00']);
  });

  it('chartDuration 缺省 = 30；volume 缺省 = 0.8；均被 clamp 到合法范围', () => {
    const { factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin01', seVolume: 1 });
    expect(s.getSnapshot().chartDuration).toBe(30);
    expect(s.getVolume()).toBe(0.8);
  });

  it('NaN / Infinity 会被安全 fallback（不污染状态）', () => {
    const { factory } = makeFactory();
    const s = new AudioSession({
      engineFactory: factory,
      keySetId: 'skin01',
      seVolume: Number.NaN,
      chartDuration: Number.POSITIVE_INFINITY,
      volume: Number.NaN,
    });
    // NaN/Inf 走 fallback：seVolume=1（默认值）, chartDuration=30, volume=0.8
    expect(s.getSnapshot().seVolume).toBe(1);
    expect(s.getSnapshot().chartDuration).toBe(30);
    expect(s.getVolume()).toBe(0.8);
  });
});

describe('AudioSession · importAudio / clearAudio / dismissError', () => {
  it('importAudio(file) 成功：audioName 设上、时长跟随音频、emit、persistNow 触发', async () => {
    const { fake, factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin00', seVolume: 1 });
    const persist = vi.fn();
    s.setPersistNow(persist);

    const events: AudioSessionSnapshot[] = [];
    s.subscribe((snap) => events.push(snap));

    const file = new File([new Uint8Array([1, 2, 3])], 'song.mp3', { type: 'audio/mpeg' });
    s.importAudio(file);

    // engine.load 是 async；等 microtask 队列清空
    await new Promise((r) => setTimeout(r, 0));

    expect(fake.loadCalls).toHaveLength(1);
    expect(fake.loadCalls[0]).toBe(file);
    expect(s.getSnapshot().audioName).toBe('song.mp3');
    expect(s.getSnapshot().hasAudio).toBe(true);
    expect(s.getSnapshot().chartDuration).toBe(12.5); // 跟随 fake.duration
    expect(s.getSnapshot().audioDuration).toBe(12.5);
    expect(s.getSnapshot().audioError).toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);
    // 订阅者至少收到一次：成功事件
    expect(events.some((e) => e.audioName === 'song.mp3')).toBe(true);
  });

  it('importAudio 失败：audioName=null、audioError 设上、不触发 persist', async () => {
    const failFactory = (): AudioEngine => {
      const f = new FakeAudioEngine();
      (f as unknown as { load: () => Promise<void> }).load = () => Promise.reject(new Error('decode fail'));
      return f as unknown as AudioEngine;
    };
    const s = new AudioSession({ engineFactory: failFactory, keySetId: 'skin01', seVolume: 1 });
    const persist = vi.fn();
    s.setPersistNow(persist);

    s.importAudio(new File([new Uint8Array([1])], 'bad.mp3'));
    await new Promise((r) => setTimeout(r, 0));

    const snap = s.getSnapshot();
    expect(snap.audioName).toBeNull();
    expect(snap.hasAudio).toBe(false);
    expect(snap.audioError).toBe('decode fail');
    expect(persist).not.toHaveBeenCalled();
  });

  it('clearAudio：engine.clear、audioName=null、persistNow 触发', () => {
    const { fake, factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin00', seVolume: 1 });
    const persist = vi.fn();
    s.setPersistNow(persist);

    s.clearAudio();
    expect(fake.clearCalls).toBe(1);
    expect(s.getSnapshot().audioName).toBeNull();
    expect(s.getSnapshot().hasAudio).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('hydrateFromProject 无音频：同步清空、改时长、不 persist', () => {
    const { fake, factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin00', seVolume: 1, chartDuration: 12 });
    const persist = vi.fn();
    s.setPersistNow(persist);
    s.hydrateFromProject({ audioName: null, durationSeconds: 45 });
    expect(fake.clearCalls).toBe(1);
    expect(s.getSnapshot().audioName).toBeNull();
    expect(s.getSnapshot().chartDuration).toBe(45);
    expect(persist).not.toHaveBeenCalled();
  });

  it('hydrateFromProject 有音频：同步写入 blob、不 persist', async () => {
    const { fake, factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin00', seVolume: 1 });
    const persist = vi.fn();
    s.setPersistNow(persist);
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    s.hydrateFromProject({ audioName: 'a.mp3', audioBlob: blob, durationSeconds: 200 });
    expect(s.getSnapshot().audioName).toBe('a.mp3');
    expect(s.getAudioBlob()).toBe(blob);
    expect(s.getSnapshot().chartDuration).toBe(200);
    expect(persist).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.loadCalls).toHaveLength(1);
    expect(s.getSnapshot().chartDuration).toBe(12.5);
    expect(persist).not.toHaveBeenCalled();
  });

  it('dismissError：仅在 audioError 非空时清空，emit 一次', async () => {
    const failFactory = (): AudioEngine => {
      const f = new FakeAudioEngine();
      (f as unknown as { load: () => Promise<void> }).load = () => Promise.reject(new Error('err'));
      return f as unknown as AudioEngine;
    };
    const s = new AudioSession({ engineFactory: failFactory, keySetId: 'skin01', seVolume: 1 });
    s.importAudio(new File([new Uint8Array([0])], 'x.mp3'));
    await new Promise((r) => setTimeout(r, 0));
    expect(s.getSnapshot().audioError).toBe('err');
    s.dismissError();
    expect(s.getSnapshot().audioError).toBeNull();
    // 再调一次不重复 emit（snapshot 不变）
    let emitCount = 0;
    s.subscribe(() => { emitCount++; });
    s.dismissError();
    // subscribe 不会立即触发，且第二次 dismissError 因 audioError 已为 null 早退
    expect(emitCount).toBe(0);
  });
});

describe('AudioSession · 竞态保护（inFlightToken）', () => {
  it('importAudio 后立即 clearAudio：旧 import 的回调被丢弃', async () => {
    const { fake, factory } = makeFactory();
    fake.loadDelayMs = 20; // 让 load 异步
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin01', seVolume: 1 });

    s.importAudio(new File([new Uint8Array([1])], 'a.mp3'));
    // 立即 clear（load 还没 resolve）
    s.clearAudio();
    // 等 load resolve
    await new Promise((r) => setTimeout(r, 30));

    // load 的 .then 已被 token 守卫丢弃：session 仍处于无音频态
    const snap = s.getSnapshot();
    expect(snap.audioName).toBeNull();
    expect(snap.hasAudio).toBe(false);
  });

  it('importAudio A → importAudio B：B 的结果生效，A 的回调被丢弃', async () => {
    const { fake, factory } = makeFactory();
    fake.loadDelayMs = 20;
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin01', seVolume: 1 });

    const fileA = new File([new Uint8Array([1])], 'a.mp3');
    const fileB = new File([new Uint8Array([2])], 'b.mp3');
    s.importAudio(fileA);
    s.importAudio(fileB); // 覆盖 A 的 token
    await new Promise((r) => setTimeout(r, 30));

    const snap = s.getSnapshot();
    expect(snap.audioName).toBe('b.mp3');
    expect(snap.hasAudio).toBe(true);
  });
});

describe('AudioSession · 时长', () => {
  it('setChartDuration：clamp 到 [0.1, MAX_DURATION_SECONDS]，<=0 忽略', () => {
    const { factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin01', seVolume: 1 });
    s.setChartDuration(0);
    // 0 被视为非法（<=0），新值 = fallback = 30（当前 chartDuration）→ 不变
    expect(s.getSnapshot().chartDuration).toBe(30);
    s.setChartDuration(-10);
    expect(s.getSnapshot().chartDuration).toBe(30);
    s.setChartDuration(100);
    expect(s.getSnapshot().chartDuration).toBe(100);
    s.setChartDuration(99_999);
    expect(s.getSnapshot().chartDuration).toBe(1800); // MAX
  });

  it('setChartDuration：相同值不 emit', () => {
    const { factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin01', seVolume: 1 });
    const events: AudioSessionSnapshot[] = [];
    s.subscribe((snap) => events.push(snap));
    s.setChartDuration(30); // 已经是 30
    expect(events).toHaveLength(0);
  });

  it('importAudio 超过 MAX_DURATION_SECONDS 时 clamp 到 30 分钟', async () => {
    const { fake, factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin01', seVolume: 1 });
    // 模拟一个 45 分钟的音频（但 fake 默认 12.5s；这里把"load 后读取 duration"模拟为 45min）
    fake.simulatedDuration = 45 * 60;
    s.importAudio(new File([new Uint8Array([0])], 'long.mp3'));
    await new Promise((r) => setTimeout(r, 0));
    expect(s.getSnapshot().chartDuration).toBe(1800); // MAX
  });
});

describe('AudioSession · 设置变更（keySet / seVolume）', () => {
  it('setKeySetId：相同值不调用引擎、不 emit', () => {
    const { fake, factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin00', seVolume: 1 });
    expect(fake.setKeySetCalls).toEqual(['skin00']); // 构造时
    s.setKeySetId('skin00'); // 相同
    expect(fake.setKeySetCalls).toEqual(['skin00']);
  });

  it('setKeySetId：新值调引擎、emit、persistKeySet 触发', () => {
    const { fake, factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin00', seVolume: 1 });
    const persistKey = vi.fn();
    s.setSettingsPersist({ persistKeySet: persistKey, persistSeVolume: vi.fn() });

    const events: AudioSessionSnapshot[] = [];
    s.subscribe((snap) => events.push(snap));

    s.setKeySetId('skin01');
    expect(fake.setKeySetCalls).toEqual(['skin00', 'skin01']);
    expect(s.getSnapshot().keySetId).toBe('skin01');
    expect(persistKey).toHaveBeenCalledWith('skin01');
    expect(events.some((e) => e.keySetId === 'skin01')).toBe(true);
  });

  it('setSeVolume：clamp 到 [0, 1]、调引擎、emit、persistSeVolume 触发', () => {
    const { fake, factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin01', seVolume: 1 });
    const persistSe = vi.fn();
    s.setSettingsPersist({ persistKeySet: vi.fn(), persistSeVolume: persistSe });

    s.setSeVolume(0.5);
    expect(s.getSnapshot().seVolume).toBe(0.5);
    expect(fake.setSeVolumeCalls[fake.setSeVolumeCalls.length - 1]).toBe(0.5);
    expect(persistSe).toHaveBeenCalledWith(0.5);

    s.setSeVolume(-0.5); // 钳到 0
    expect(s.getSnapshot().seVolume).toBe(0);
    s.setSeVolume(2); // 钳到 1
    expect(s.getSnapshot().seVolume).toBe(1);
  });

  it('setSeVolume(NaN) 被拒绝：状态不污染', () => {
    const { factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin01', seVolume: 1 });
    const before = s.getSnapshot().seVolume;
    s.setSeVolume(Number.NaN);
    expect(s.getSnapshot().seVolume).toBe(before); // 不变
  });

  it('syncSettingsFromConfig：外部 settings 变化时同步到 session', () => {
    const { fake, factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin00', seVolume: 0.8 });
    s.syncSettingsFromConfig('skin01', 0.3);
    expect(s.getSnapshot().keySetId).toBe('skin01');
    expect(s.getSnapshot().seVolume).toBe(0.3);
    expect(fake.setKeySetCalls).toEqual(['skin00', 'skin01']);
    expect(fake.setSeVolumeCalls[fake.setSeVolumeCalls.length - 1]).toBe(0.3);
  });
});

describe('AudioSession · 键音包归一化与试听（issue 29）', () => {
  it('构造/切换时历史 id（placeholder/bangdream）归一化回落 skin00', () => {
    const { fake, factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'placeholder', seVolume: 1 });
    expect(s.getSnapshot().keySetId).toBe('skin00');
    expect(fake.setKeySetCalls).toEqual(['skin00']);
    s.setKeySetId('bangdream'); // 归一化后与当前相同 → 不重复调引擎、不持久化
    expect(fake.setKeySetCalls).toEqual(['skin00']);
  });

  it('syncSettingsFromConfig：脏 keySet 归一化进 snapshot', () => {
    const { factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin01', seVolume: 1 });
    s.syncSettingsFromConfig('placeholder', 1);
    expect(s.getSnapshot().keySetId).toBe('skin00');
  });

  it('previewKeySample：透传引擎（含方向键分档 tier）', () => {
    const { fake, factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin00', seVolume: 1 });
    s.previewKeySample('skin02', 'tap');
    s.previewKeySample('skin02', 'directional', 3);
    expect(fake.previewCalls).toEqual([
      { setId: 'skin02', kind: 'tap', tier: undefined },
      { setId: 'skin02', kind: 'directional', tier: 3 },
    ]);
  });
});

describe('AudioSession · 订阅', () => {
  it('subscribe 返回的 unsubscribe 能正确取消订阅', () => {
    const { factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin01', seVolume: 1 });
    const events: AudioSessionSnapshot[] = [];
    const unsub = s.subscribe((snap) => events.push(snap));
    s.setChartDuration(40);
    expect(events).toHaveLength(1);
    unsub();
    s.setChartDuration(50);
    expect(events).toHaveLength(1); // 没新增
  });

  it('listener 抛错不影响其他订阅者', () => {
    const { factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin01', seVolume: 1 });
    const a = vi.fn(() => { throw new Error('boom'); });
    const b = vi.fn();
    s.subscribe(a);
    s.subscribe(b);
    s.setChartDuration(40);
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });
});

describe('AudioSession · 引擎透传（getEngine / setVolume）', () => {
  it('getEngine 返回的引用稳定（与构造时一致）', () => {
    const { fake, factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin01', seVolume: 1 });
    expect(s.getEngine()).toBe(fake as unknown as AudioEngine);
  });

  it('setVolume：clamp、调引擎、getVolume 返回最新值', () => {
    const { fake, factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin01', seVolume: 1, volume: 0.5 });
    s.setVolume(0.9);
    expect(s.getVolume()).toBe(0.9);
    expect(fake.setVolumeCalls[fake.setVolumeCalls.length - 1]).toBe(0.9);
  });

  it('setVolume(NaN) 被拒绝', () => {
    const { factory } = makeFactory();
    const s = new AudioSession({ engineFactory: factory, keySetId: 'skin01', seVolume: 1, volume: 0.5 });
    const before = s.getVolume();
    s.setVolume(Number.NaN);
    expect(s.getVolume()).toBe(before);
  });
});
