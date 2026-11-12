// @vitest-environment jsdom
// 票 67：离线音轨这一段要能被取消打断。
// 真的 OfflineAudioContext 渲染在浏览器音频线程、单测摸不到，这里用假上下文把
// 「键音调度循环」与「等 startRendering」这两个可中断点钉住；页面是否不再冻住归人工验收。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleKeyTone } from '@/src/audio/keySoundSamples';
import type { KeySoundEvent } from '@/src/audio/AudioTiming';
import {
  AUDIO_TRACK_CANCELLED,
  renderAudioTrack,
  type AudioTrackRequest,
} from '@/src/preview/video/encode/renderAudioTrack';

vi.mock('@/src/audio/KeySound', () => ({
  loadKeySoundSet: vi.fn(async () => ({ samples: {} })),
}));
vi.mock('@/src/audio/keySoundSamples', () => ({
  sampleSrcFor: vi.fn(() => null),
  scheduleKeySample: vi.fn(),
  scheduleKeyTone: vi.fn(),
  keySoundBank: { load: vi.fn(async () => undefined) },
}));

const rendering = vi.fn(() => new Promise<AudioBuffer>(() => {}));

class FakeOfflineAudioContext {
  destination = {};
  createGain() { return { gain: { value: 0 }, connect: vi.fn() }; }
  createBufferSource() { return { buffer: null, connect: vi.fn(), start: vi.fn() }; }
  startRendering = rendering;
}

beforeEach(() => {
  rendering.mockClear();
  vi.mocked(scheduleKeyTone).mockReset();
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 实现不响应取消时别把测试挂到 vitest 超时（给一条可断言的超时支路） */
async function withTimeout<T>(p: Promise<T>): Promise<T | 'TIMED_OUT'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<'TIMED_OUT'>((resolve) => { timer = setTimeout(() => resolve('TIMED_OUT'), 300); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const baseReq = (patch: Partial<AudioTrackRequest> = {}): AudioTrackRequest => ({
  durationSeconds: 30,
  keyEvents: [],
  keySetId: 'skin00',
  bgm: null,
  volume: 1,
  seVolume: 0.8,
  // 注入假解码上下文，免得去 new 一个 node 里没有的 AudioContext
  decodeContext: {} as unknown as BaseAudioContext,
  ...patch,
});

describe('票 67 · 离线音轨的取消', () => {
  it('键音循环中途取消：不再调度剩余事件，也不启动离线渲染', async () => {
    let cancelled = false;
    let scheduled = 0;
    vi.mocked(scheduleKeyTone).mockImplementation(() => {
      if (++scheduled === 90) cancelled = true; // 模拟用户在这一刻点了取消
    });
    const keyEvents = Array.from({ length: 200 }, (_, i) => ({
      time: i * 0.1, kind: 'tap', tier: 1, gain: 1,
    })) as unknown as KeySoundEvent[];

    const result = await withTimeout(renderAudioTrack(baseReq({
      keyEvents,
      isCancelled: () => cancelled,
    })));

    expect(AUDIO_TRACK_CANCELLED).toBeDefined();
    expect(result).toBe(AUDIO_TRACK_CANCELLED);
    expect(scheduled).toBeLessThan(200);
    expect(rendering).not.toHaveBeenCalled();
  });

  it('离线渲染途中取消：不等 startRendering 跑完就返回取消', async () => {
    let cancelled = false;
    const timer = setTimeout(() => { cancelled = true; }, 20);
    try {
      const result = await withTimeout(renderAudioTrack(baseReq({
        isCancelled: () => cancelled,
      })));
      expect(result).toBe(AUDIO_TRACK_CANCELLED);
      expect(rendering).toHaveBeenCalledTimes(1);
    } finally {
      clearTimeout(timer);
    }
  });

  it('没取消时照常产出音轨；静音导出仍是 null（取消哨兵不与静音混淆）', async () => {
    const buffer = {} as AudioBuffer;
    rendering.mockResolvedValueOnce(buffer);
    const result = await renderAudioTrack(baseReq({ isCancelled: () => false }));
    expect(result).toMatchObject({ buffer, sampleRate: 48000, numberOfChannels: 2 });
    expect(rendering).toHaveBeenCalledTimes(1);
    expect(await renderAudioTrack(baseReq({ muted: true }))).toBeNull();
  });

  it('静音导出途中取消仍回取消哨兵（不冒充「这条没有音轨」）', async () => {
    expect(await renderAudioTrack(baseReq({ muted: true, isCancelled: () => true })))
      .toBe(AUDIO_TRACK_CANCELLED);
    expect(rendering).not.toHaveBeenCalled();
  });
});
