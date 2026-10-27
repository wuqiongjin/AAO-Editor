// 票 53：导出离线音轨的 SE 调度顺序 —— `start()` 必须先于 `stop()`（Web Audio 规范）。
// node 环境没有 Web Audio，这里用最小 stub 复刻两条规范行为：
//   ① 未 start 就 stop ⇒ 抛 InvalidStateError（就是用户现场那条日志）；
//   ② 记录每个 source 的 start / stop 与包络事件，供断言。
// 现场：开场人潮素材 7.105s > 开场段 6.75s ⇒ 必走截断分支（旧代码在这里先 stop 后 start）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAudioTrack, type AudioTrack } from '@/src/preview/video/encode/renderAudioTrack';
import { OPENING_SECONDS } from '@/src/preview/video/opening/openingSpec';
import { endingSfxCues, openingSfxCues, type SfxCue } from '@/src/preview/video/sfx';

/** 开场人潮素材实测时长（秒，`public/assets/game-ui/audio/SE_RHYTHM_GAYA.mp3`） */
const CROWD_SECONDS = 7.105;

interface Call {
  source: number;
  kind: 'start' | 'stop';
  when: number;
}

let calls: Call[] = [];
let sources: FakeBufferSource[] = [];
let nextSourceId = 0;

class FakeAudioParam {
  value = 0;
  readonly events: Array<{ value: number; when: number }> = [];

  setValueAtTime(value: number, when: number): this {
    this.events.push({ value, when });
    return this;
  }

  linearRampToValueAtTime(value: number, when: number): this {
    this.events.push({ value, when });
    return this;
  }
}

class FakeNode {
  readonly targets: FakeNode[] = [];

  connect(target: FakeNode): this {
    this.targets.push(target);
    return this;
  }

  disconnect(): void {}
}

class FakeGainNode extends FakeNode {
  readonly gain = new FakeAudioParam();
}

class FakeBufferSource extends FakeNode {
  readonly id = nextSourceId++;
  buffer: AudioBuffer | null = null;
  private started = false;

  /** 这条 source 汇入的 gain（`scheduleSfx` 里第一个 connect 目标） */
  get gainNode(): FakeGainNode {
    return this.targets[0] as FakeGainNode;
  }

  start(when: number): void {
    calls.push({ source: this.id, kind: 'start', when });
    this.started = true;
  }

  stop(when = 0): void {
    if (!this.started) {
      throw new DOMException(
        "Failed to execute 'stop' on 'AudioScheduledSourceNode': cannot call stop without calling start first.",
        'InvalidStateError',
      );
    }
    calls.push({ source: this.id, kind: 'stop', when });
  }
}

class FakeOfflineAudioContext {
  readonly destination = new FakeNode();

  createGain(): FakeGainNode {
    return new FakeGainNode();
  }

  createBufferSource(): FakeBufferSource {
    const src = new FakeBufferSource();
    sources.push(src);
    return src;
  }

  async startRendering(): Promise<AudioBuffer> {
    return { duration: 0 } as AudioBuffer;
  }
}

/** 解码上下文（注入用）：所有 SE 解码成同一段假素材 */
function decodeContext(): BaseAudioContext {
  return {
    decodeAudioData: async () => ({ duration: CROWD_SECONDS }) as AudioBuffer,
  } as unknown as BaseAudioContext;
}

function renderSfx(sfx: readonly SfxCue[]): Promise<AudioTrack | null> {
  return renderAudioTrack({
    durationSeconds: 30,
    openingSeconds: OPENING_SECONDS,
    endingSeconds: 7.5,
    sfx,
    keyEvents: [],
    keySetId: 'test',
    bgm: null,
    volume: 1,
    seVolume: 1,
    decodeContext: decodeContext(),
  });
}

/** 某条 source 的调用序（按发生先后） */
function callsOf(src: FakeBufferSource): Call[] {
  return calls.filter((c) => c.source === src.id);
}

beforeEach(() => {
  calls = [];
  sources = [];
  nextSourceId = 0;
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('53 · SE 调度顺序', () => {
  it('开场人潮截断到开场段末尾：start 先于 stop，淡出仍走完到 0', async () => {
    await renderSfx(openingSfxCues(OPENING_SECONDS));

    expect(sources).toHaveLength(1);
    const src = sources[0];
    expect(callsOf(src).map((c) => c.kind)).toEqual(['start', 'stop']);
    expect(callsOf(src)[0].when).toBe(0);
    expect(callsOf(src)[1].when).toBeCloseTo(OPENING_SECONDS, 5);
    // 包络口径不变（票 53「淡出时间不动」）：最后一段 ramp 到 0，终点 = endAt
    expect(src.gainNode.gain.events.at(-1)).toEqual({ value: 0, when: OPENING_SECONDS });
  });

  it('素材自然结束（结尾段，无 endAt）：只 start、不 stop', async () => {
    await renderSfx(endingSfxCues(30, 'ap'));

    expect(sources).toHaveLength(2);
    for (const src of sources) expect(callsOf(src).map((c) => c.kind)).toEqual(['start']);
  });

  it('开场 + 结尾同时给（真实三 cue 表）：每个 source 各自先 start，只有开场被截断', async () => {
    await renderSfx([...openingSfxCues(OPENING_SECONDS), ...endingSfxCues(30, 'ap')]);

    expect(sources).toHaveLength(3);
    for (const src of sources) expect(callsOf(src)[0].kind).toBe('start');
    // 两端同一条轨：开场人潮 1 条被 endAt 截断，结尾两条自然收尾
    const stopped = sources.filter((src) => callsOf(src).some((c) => c.kind === 'stop'));
    expect(stopped).toHaveLength(1);
    expect(callsOf(stopped[0])[1].when).toBeCloseTo(OPENING_SECONDS, 5);
  });
});
