// 票 15 定案 8（症状 a 的对齐不变量）：音频会话与工程记录必须有明确的收口——
// 有音频的工程 hydrate 后必带音频；**无音频的工程 hydrate 后引擎必被清空**；
// 锁定态挡的是「改变共享资源的动作」，不是「对齐阅读」。
//
// 不依赖 DOM 测试基建（issue 08）：假引擎 + 纯 class 即可，故落在 tests/unit。
import { describe, it, expect } from 'vitest';
import { AudioSession } from '@/src/audio/AudioSession';
import type { AudioEngine } from '@/src/audio/AudioEngine';

/** 假引擎：只记调用历史 + 可控 duration（同 AudioSession.test.ts 的口径，不碰 Web Audio）。 */
class FakeAudioEngine {
  private _duration: number | null = null;
  get duration(): number | null { return this._duration; }
  set simulatedDuration(v: number | null) { this._duration = v; }
  loadCalls: File[] = [];
  clearCalls = 0;

  async load(file: File): Promise<void> { this.loadCalls.push(file); }
  clear(): void { this.clearCalls++; this._duration = null; }
  setKeySetId(): void { /* noop */ }
  async previewKeySample(): Promise<void> { /* noop */ }
  setVolume(): void { /* noop */ }
  setSeVolume(): void { /* noop */ }
  setChart(): void { /* noop */ }
  async play(): Promise<void> { /* noop */ }
  pause(): void { /* noop */ }
  seek(): void { /* noop */ }
  tick(): void { /* noop */ }
  getSeconds(): number { return 0; }
}

function makeSession() {
  const engine = new FakeAudioEngine();
  const session = new AudioSession({
    engineFactory: () => engine as unknown as AudioEngine,
    keySetId: 'skin00',
    seVolume: 1,
  });
  return { engine, session };
}

function blobsOf(...bytes: number[]): Blob {
  return new Blob([new Uint8Array(bytes)]);
}

describe('票 15 · 音频会话与工程记录的对齐', () => {
  it('无音频工程 hydrate 后音频名与 blob 必为空，且引擎被清空（上个工程的音频不许留下）', async () => {
    const { engine, session } = makeSession();
    session.hydrateFromProject({
      audioName: '上一个工程.mp3',
      audioBlob: blobsOf(1, 2, 3),
      durationSeconds: 88,
    });
    const clearsBefore = engine.clearCalls;

    session.hydrateFromProject({ audioName: null, durationSeconds: 30 });

    expect(session.getSnapshot().audioName).toBeNull();
    expect(session.getSnapshot().hasAudio).toBe(false);
    expect(session.getAudioBlob()).toBeNull();
    expect(engine.clearCalls).toBe(clearsBefore + 1);
    expect(engine.loadCalls).toHaveLength(1);
  });

  it('有音频工程 hydrate 后按记录恢复音频名 / blob，解码完成后时长跟随音频', async () => {
    const { engine, session } = makeSession();
    const blob = blobsOf(7, 7, 7);
    engine.simulatedDuration = 123.5;

    session.hydrateFromProject({ audioName: '曲目.mp3', audioBlob: blob, durationSeconds: 30 });
    expect(session.getSnapshot().audioName).toBe('曲目.mp3');
    expect(session.getAudioBlob()).toBe(blob);
    expect(engine.loadCalls[0]?.name).toBe('曲目.mp3');

    await Promise.resolve();
    await Promise.resolve();
    expect(session.getSnapshot().chartDuration).toBe(123.5);
  });

  it('锁定态下 importAudio / clearAudio 无操作（改共享资源的动作被挡）', () => {
    const { engine, session } = makeSession();
    session.hydrateFromProject({
      audioName: '原音频.mp3',
      audioBlob: blobsOf(1),
      durationSeconds: 60,
      audioLocked: true,
    });
    const loadsBefore = engine.loadCalls.length;
    const clearsBefore = engine.clearCalls;

    session.importAudio(new File([blobsOf(2)], '换.mp3'));
    session.clearAudio();
    session.setChartDuration(120);

    expect(engine.loadCalls).toHaveLength(loadsBefore);
    expect(engine.clearCalls).toBe(clearsBefore);
    expect(session.getSnapshot().audioName).toBe('原音频.mp3');
    expect(session.getSnapshot().chartDuration).toBe(60);
  });

  it('锁定态下仍可 hydrate 重新对齐（读不是改：锁定工程也能被作用域切换查看）', () => {
    const { session } = makeSession();
    session.hydrateFromProject({
      audioName: '锁定工程的音频.mp3',
      audioBlob: blobsOf(3),
      durationSeconds: 210,
      audioLocked: true,
    });

    expect(session.getSnapshot().audioName).toBe('锁定工程的音频.mp3');
    expect(session.getSnapshot().audioLocked).toBe(true);
    expect(session.getSnapshot().chartDuration).toBe(210);
  });
});
