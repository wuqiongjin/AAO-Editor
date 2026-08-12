import { describe, it, expect } from 'vitest';
import {
  getBpmEvents, beatToSeconds, secondsToBeat, buildKeyEvents, chartLengthToEndBeat, maxNoteEndSeconds,
  EMPTY_CHART_DURATION_SECONDS, DEFAULT_BPM,
  type BpmEvent,
} from '../../src/utils/AudioTiming';
import type { ChartNote } from '../../src/notes/Charts';

describe('getBpmEvents', () => {
  it('无 BPM 音符时补默认 120 于 beat 0', () => {
    expect(getBpmEvents([])).toEqual([{ beat: 0, bpm: DEFAULT_BPM }]);
  });

  it('首事件不在 0 拍时补默认，其余按 beat 升序', () => {
    const notes: ChartNote[] = [
      { type: 'BPM', beat: 60, bpm: 240 },
      { type: 'BPM', beat: 30, bpm: 180 },
    ];
    expect(getBpmEvents(notes)).toEqual([
      { beat: 0, bpm: DEFAULT_BPM },
      { beat: 30, bpm: 180 },
      { beat: 60, bpm: 240 },
    ]);
  });

  it('普通音符不产出 BPM 事件', () => {
    const notes: ChartNote[] = [{ type: 'Single', beat: 4, lane: 1, subBeat: 0 }];
    expect(getBpmEvents(notes)).toEqual([{ beat: 0, bpm: DEFAULT_BPM }]);
  });
});

describe('beatToSeconds / secondsToBeat', () => {
  const singleBpm: BpmEvent[] = [{ beat: 0, bpm: 120 }];

  it('120bpm：每拍 0.5 秒', () => {
    expect(beatToSeconds(singleBpm, 0)).toBe(0);
    expect(beatToSeconds(singleBpm, 1)).toBeCloseTo(0.5);
    expect(beatToSeconds(singleBpm, 120)).toBeCloseTo(60);
  });

  it('分量段：BPM 变化交界处的累计', () => {
    const events: BpmEvent[] = [
      { beat: 0, bpm: 120 },
      { beat: 60, bpm: 240 },
    ];
    expect(beatToSeconds(events, 60)).toBeCloseTo(30); // 60 拍 * 0.5s
    expect(beatToSeconds(events, 90)).toBeCloseTo(30 + 30 * 0.25); // 240bpm 每拍 0.25s
  });

  it('secondsToBeat 与 beatToSeconds 互逆', () => {
    const events: BpmEvent[] = [
      { beat: 0, bpm: 120 },
      { beat: 30, bpm: 240 },
    ];
    for (const beat of [0, 5, 30, 42, 100]) {
      expect(secondsToBeat(events, beatToSeconds(events, beat))).toBeCloseTo(beat, 6);
    }
  });

  it('超出最后一个 BPM 段后按该段速率延续', () => {
    const events: BpmEvent[] = [{ beat: 0, bpm: 240 }];
    expect(secondsToBeat(events, 0.5)).toBeCloseTo(2); // 240bpm：0.5s = 2 拍
    expect(secondsToBeat(events, 1)).toBeCloseTo(4);
  });
});

describe('buildKeyEvents', () => {
  const bpm120: BpmEvent[] = [{ beat: 0, bpm: 120 }];

  it('普通音符（含子拍）换算为秒并按时间升序', () => {
    const notes: ChartNote[] = [
      { type: 'Single', lane: 3, beat: 1, subBeat: 0 },
      { type: 'Single', lane: 0, beat: 0, subBeat: 0 },
    ];
    const events = buildKeyEvents(notes, 4, bpm120);
    expect(events).toEqual([
      { time: 0, lane: 0, kind: 'tap' },
      { time: 0.5, lane: 3, kind: 'tap' },
    ]);
  });

  it('滑条每个连接点都发声、方向键发声（按组合长度分档）', () => {
    const notes: ChartNote[] = [
      {
        type: 'Slide',
        connections: [
          { beat: 0, lane: 0 },
          { beat: 1, lane: 3 },
        ],
      },
      { type: 'RDirectional', lane: 1, beat: 2, subBeat: 0, length: 1 },
    ];
    const events = buildKeyEvents(notes, 4, bpm120);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ time: 0, lane: 0, kind: 'slide' });
    expect(events[1]).toEqual({ time: 0.5, lane: 3, kind: 'slide' });
    expect(events[2]).toEqual({ time: 1, lane: 1, kind: 'directional', tier: 1 });
  });

  it('hidden 连接结点不发声（SP 绿条/新型滑条中间隐藏点）', () => {
    const notes: ChartNote[] = [
      {
        type: 'Slide',
        connections: [
          { beat: 0, lane: 0 },
          { beat: 1, lane: 3, hidden: true },
          { beat: 2, lane: 1 },
        ],
      },
    ];
    const events = buildKeyEvents(notes, 4, bpm120);
    expect(events.map(e => e.time)).toEqual([0, 1]);
  });

  it('滑条结点按键音跟随击打样式：flick 发声效、skill 发技能音、普通发 slide 音', () => {
    const notes: ChartNote[] = [
      {
        type: 'Slide',
        connections: [
          { beat: 0, lane: 0 },
          { beat: 1, lane: 1, flick: true },
          { beat: 2, lane: 2, skill: true },
        ],
      },
    ];
    const events = buildKeyEvents(notes, 4, bpm120);
    expect(events.map(e => e.kind)).toEqual(['slide', 'flick', 'skill']);
    expect(events[1].time).toBeCloseTo(0.5);
    expect(events[2].time).toBeCloseTo(1);
  });

  it('方向键按组合长度 length 分档采样（1/2/3）', () => {
    const notes: ChartNote[] = [
      { type: 'LDirectional', lane: 0, beat: 0, subBeat: 0, length: 1 },
      { type: 'LDirectional', lane: 1, beat: 1, subBeat: 0, length: 2 },
      { type: 'RDirectional', lane: 2, beat: 2, subBeat: 0, length: 3 },
    ];
    const events = buildKeyEvents(notes, 4, bpm120);
    expect(events.map(e => e.tier)).toEqual([1, 2, 3]);
    expect(events.every(e => e.kind === 'directional')).toBe(true);
  });

  it('BPM / 系统音符不发声', () => {
    const notes: ChartNote[] = [
      { type: 'BPM', beat: 0, bpm: 200 },
      { type: 'System', beat: 0, data: 'x' },
    ];
    expect(buildKeyEvents(notes, 4, bpm120)).toEqual([]);
  });

  it('subBeat 按 beatDisplay 折算为分数拍', () => {
    const notes: ChartNote[] = [{ type: 'Single', lane: 2, beat: 0, subBeat: 2 }];
    // beatDisplay=4：precise = 0 + 2/4 = 0.5 拍 → 0.25s
    expect(buildKeyEvents(notes, 4, bpm120)[0].time).toBeCloseTo(0.25);
    // beatDisplay=8：precise = 2/8 = 0.25 拍 → 0.125s
    expect(buildKeyEvents(notes, 8, bpm120)[0].time).toBeCloseTo(0.125);
  });
});

describe('chartLengthToEndBeat', () => {
  const bpm120: BpmEvent[] = [{ beat: 0, bpm: 120 }];

  it('谱面末端 beat = 谱面长度(秒) 经 BPM 换算，与音符无关（ADR-0005）', () => {
    // 30s @120bpm → 60 拍
    expect(chartLengthToEndBeat(bpm120, 30)).toBeCloseTo(60);
    // 60s @120bpm → 120 拍
    expect(chartLengthToEndBeat(bpm120, 60)).toBeCloseTo(120);
  });

  it('BPM 变化时按事件分段换算（时间锚定，不因音符变化）', () => {
    const events: BpmEvent[] = [{ beat: 0, bpm: 120 }, { beat: 30, bpm: 240 }];
    // 20s：前 15s(30拍@120) + 后 5s(20拍@240) → 50 拍
    expect(chartLengthToEndBeat(events, 20)).toBeCloseTo(50);
  });

  it('空谱（无音符）同样按谱面长度换算，不塌缩到个位数拍', () => {
    // 无音频默认 30s @120 → 60 拍，而非旧版"空谱仅 8 拍/1 拍"
    expect(chartLengthToEndBeat(bpm120, EMPTY_CHART_DURATION_SECONDS)).toBeCloseTo(60);
  });
});

describe('maxNoteEndSeconds', () => {
  const bpm120: BpmEvent[] = [{ beat: 0, bpm: 120 }];

  it('返回最后音符结束时间（秒，不含尾量）', () => {
    // 最大 beat=8 @120bpm → 4s
    const notes: ChartNote[] = [{ type: 'Single', lane: 0, beat: 8, subBeat: 0 }];
    expect(maxNoteEndSeconds(notes, 4, bpm120)).toBeCloseTo(4);
  });

  it('滑条取末尾结点（含子拍）', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [{ beat: 0, lane: 0 }, { beat: 4, lane: 3, subBeat: 2 }],
    }];
    // 末尾结点 beat=4.5 @120 → 2.25s
    expect(maxNoteEndSeconds(notes, 4, bpm120)).toBeCloseTo(2.25);
  });

  it('BPM 变化时按事件分段换算', () => {
    const events: BpmEvent[] = [{ beat: 0, bpm: 120 }, { beat: 4, bpm: 240 }];
    const notes: ChartNote[] = [{ type: 'Single', lane: 0, beat: 8, subBeat: 0 }];
    // beat0-4 @120 → 2s；beat4-8 @240 → 1s；合计 3s
    expect(maxNoteEndSeconds(notes, 4, events)).toBeCloseTo(3);
  });

  it('空谱返回 0', () => {
    expect(maxNoteEndSeconds([], 4, bpm120)).toBe(0);
  });
});

describe('EMPTY_CHART_DURATION_SECONDS', () => {
  it('空谱默认时长 30s', () => {
    expect(EMPTY_CHART_DURATION_SECONDS).toBe(30);
  });
});