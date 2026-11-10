// @vitest-environment jsdom
// chart-preview 20 锁测：播放速率（倍速）。
// 速率要三处一起缩放，否则音画不同步：① 两条时钟的经过时间（`getSeconds`）；② BGM 音源的
// `playbackRate`；③ 键音调度（谱面秒差 ÷ 速率 = 墙钟秒差）。另外：**播放中改速率不跳位置**。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYBACK_RATE_RANGE, AudioEngine } from '@/src/audio/AudioEngine';
import { AudioSession } from '@/src/audio/AudioSession';
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
  /** 与 oscStarts 一一对应：该节点是否被「手动 cancel」（无参 stop()）撤销 —— 区别于自然结束的 stop(when) */
  oscRecords: Array<{ when: number; cancelled: boolean }> = [];

  createGain() {
    return new MockGainNode();
  }

  createBufferSource() {
    const src = new MockBufferSourceNode();
    this.sources.push(src);
    return src;
  }

  createOscillator() {
    const rec = { when: 0, cancelled: false };
    this.oscRecords.push(rec);
    return {
      type: 'sine',
      frequency: { value: 440 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: (when: number) => { rec.when = when; this.oscStarts.push(when); },
      stop: (when?: number) => { if (when === undefined) rec.cancelled = true; },
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

  it('工作台侧（chart-preview 58）：AudioSession 转发后 rate=1 行为逐位不变、改速率不跳位置', async () => {
    // 隔离无关异步：构造 session 时的 setKeySetId 会触发素材包动态加载，本例只关心倍速通道
    const keySpy = vi.spyOn(AudioEngine.prototype, 'setKeySetId').mockImplementation(() => {});
    try {
      const engine = new AudioEngine();
      const session = new AudioSession({ engineFactory: () => engine, keySetId: 'skin00', seVolume: 1 });
      await engine.load(new File([new Uint8Array([1])], 'a.mp3', { type: 'audio/mpeg' }));
      await engine.play();
      const ctx = engineCtx(engine);

      ctx.currentTime = 10;
      expect(engine.playbackRate).toBe(1);             // rate=1 行为逐位不变
      expect(engine.getSeconds()).toBeCloseTo(10, 6); // 原速：墙钟 10s = 谱面 10s

      session.setPlaybackRate(2);                     // 工作台通道：共享值 → AudioSession → 引擎
      expect(engine.playbackRate).toBe(2);
      expect(engine.getSeconds()).toBeCloseTo(10, 6); // 改速率不跳位置
      expect(ctx.sources.at(-1)!.playbackRate.value).toBe(2);

      ctx.currentTime = 12;
      expect(engine.getSeconds()).toBeCloseTo(14, 6); // 之后按 2× 推进
      engine.dispose();
    } finally {
      keySpy.mockRestore();
    }
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

  // chart-preview 58 验收回修（既有问题：动态预览同样复现）：键音提前 ~2s 预排到 AudioContext
  // 时间线上，播放中改速率若只换时钟与 BGM，那批已 start(when) 的节点仍按**旧**速率的墙钟时刻
  // 发声（"2× 余音"），且 keyIndex 已越过新 horizon，调度器在播放头追上前不再补排（"静默一段"）。
  it.each([
    {
      title: '2× → 1×',
      from: 2,
      preStarts: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
      to: 1,
      freshStarts: [0.5, 1, 1.5, 2],
    },
    {
      title: '1× → 0.25×',
      from: 1,
      preStarts: [0.5, 1, 1.5, 2],
      to: 0.25,
      freshStarts: [2],
    },
  ])('播放中改速率（$title）：撤销旧速率预排键音并按新速率重排', async ({ from, preStarts, to, freshStarts }) => {
    const engine = new AudioEngine();
    engine.setChart(
      [
        { type: 'BPM', beat: 0, bpm: 120 },
        { type: 'Single', beat: 1, lane: 3 }, // 0.5s
        { type: 'Single', beat: 2, lane: 3 }, // 1.0s
        { type: 'Single', beat: 3, lane: 3 }, // 1.5s
        { type: 'Single', beat: 4, lane: 3 }, // 2.0s
        { type: 'Single', beat: 5, lane: 3 }, // 2.5s
        { type: 'Single', beat: 6, lane: 3 }, // 3.0s
        { type: 'Single', beat: 7, lane: 3 }, // 3.5s
        { type: 'Single', beat: 8, lane: 3 }, // 4.0s
      ],
      4,
    );
    await engine.play();
    const ctx = engineCtx(engine);

    // 旧速率把 horizon（= 2s 墙钟 × 速率）内的键音预排到时间线上；播放头钉在 0
    if (from !== 1) engine.setPlaybackRate(from);
    engine.tick();
    expect(ctx.oscStarts).toEqual(preStarts);
    const oldRecords = ctx.oscRecords.slice();
    expect(oldRecords).toHaveLength(preStarts.length);

    // 播放中改速率：这些键音还没发声
    engine.setPlaybackRate(to);

    // ① 旧速率那批预排键音必须被撤销（否则仍按旧节奏发声）
    for (const rec of oldRecords) expect(rec.cancelled).toBe(true);

    // ② 游标回到播放头、按新速率立即补排（否则调度器空转 = 突然没声音 / 过一会才好）
    expect(ctx.oscStarts.slice(preStarts.length)).toEqual(freshStarts);

    engine.dispose();
  });

  // 上面两条把播放头钉在 0；这里补用户 repro 的「先 2× 播一段时间再调回 1×」：
  // 播放头非 0 时的重锚（offsetSeconds/startCtxSecond/startPerfSecond）不能跳位置，预排撤销与重排照样成立。
  it('播放中改速率（播放头已推进）：位置不跳、旧预排撤销、按新速率重排', async () => {
    const engine = new AudioEngine();
    engine.setChart(
      [
        { type: 'BPM', beat: 0, bpm: 120 },
        ...[2, 4, 6, 8, 10, 12, 14, 16, 18, 20].map((beat) => ({ type: 'Single' as const, beat, lane: 3 })),
      ],
      4,
    );
    await engine.play(); // 无 buffer → 合成时间线，startPerfSecond = 0
    const ctx = engineCtx(engine);

    engine.setPlaybackRate(2); // 2× 预排 1..4s（墙钟 0.5/1/1.5/2）
    expect(ctx.oscStarts).toEqual([0.5, 1, 1.5, 2]);

    nowSpy.mockReturnValue(2000); // 墙钟走 2s ⇒ 2× 下谱面播放头 = 4s
    ctx.currentTime = 2;
    expect(engine.getSeconds()).toBeCloseTo(4, 6);
    engine.tick(); // 再预排 5..8s（墙钟 2.5/3/3.5/4）
    const oldRecords = ctx.oscRecords.slice();
    expect(oldRecords).toHaveLength(8);

    engine.setPlaybackRate(1);
    expect(engine.getSeconds()).toBeCloseTo(4, 6); // 改速率当刻不跳位置
    for (const rec of oldRecords) expect(rec.cancelled).toBe(true);
    // 按 1× 从 4s 续排：horizon = 6s ⇒ 4s / 5s / 6s 三枚（rewindKeyIndex 是 `< playhead` 严格小于，
    // 恰在播放头的 4s 那枚也重排），墙钟 = 2 + (t − 4)/1 = 2 / 3 / 4
    expect(ctx.oscStarts.slice(8)).toEqual([2, 3, 4]);

    engine.dispose();
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

  it('issue 179 / 188 / 210 · load 预触碰 PCM 页，play 挂载高于 16-bit 量化下限的单次短脉冲保活源（严禁常驻 loop），且长时静置后复播重新唤醒', async () => {
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

    nowSpy.mockReturnValue(1000);
    await engine.play();
    const ctx = engineCtx(engine);
    // 保活源严禁死循环（issue 210：防 CoreAudio 持续高采样率轮询及阻止休眠），单次短脉冲幅值高于 16-bit 1 LSB (3.05e-5)，紧接着启动 BGM source（位于 sources 末尾）
    expect(primerBuffers.length).toBeGreaterThanOrEqual(1);
    expect(primerBuffers[0]![0]).toBeGreaterThanOrEqual(1 / 16384);
    const firstKeepaliveSrc = ctx.sources[0]! as MockBufferSourceNode & { loop?: boolean };
    expect(firstKeepaliveSrc.loop).toBeFalsy();
    expect(firstKeepaliveSrc.connect).toHaveBeenCalledWith(ctx.destination);
    expect(ctx.sources).toHaveLength(2);
    engine.setPlaybackRate(1.5);
    expect(ctx.sources.at(-1)!.playbackRate.value).toBe(1.5);

    // 暂停并静置超过 30s（SilentSinkSuspender 阈值）后再次 play：不能被单次布尔锁短路，应重新唤醒保活源
    engine.pause();
    const sourcesBeforeIdlePlay = ctx.sources.length;
    nowSpy.mockReturnValue(35_000);
    await engine.play();
    expect(ctx.sources.length).toBe(sourcesBeforeIdlePlay + 2); // 新保活源 + 新 BGM source
    expect(firstKeepaliveSrc.stop).toHaveBeenCalled();

    // 再次暂停并静置超过 10s，用户按下鼠标（pointerdown 早于 click 触发 play）：提前在 pointerdown 阶段完成保活流重建
    engine.pause();
    const sourcesBeforePointerDown = ctx.sources.length;
    nowSpy.mockReturnValue(50_000);
    window.dispatchEvent(new Event('pointerdown'));
    expect(ctx.sources.length).toBe(sourcesBeforePointerDown + 1); // pointerdown 已提前重建保活源
    await engine.play();
    expect(ctx.sources.length).toBe(sourcesBeforePointerDown + 2); // play() 直接复用刚预热的保活源，仅新增 BGM source

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
