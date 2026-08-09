import { describe, it, expect } from 'vitest';
import {
  getBpmEvents, beatToSeconds, secondsToBeat, buildKeyEvents, DEFAULT_BPM,
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
      { time: 0, lane: 0 },
      { time: 0.5, lane: 3 },
    ]);
  });

  it('滑条每个连接点都发声、方向键发声', () => {
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
    expect(events[0]).toEqual({ time: 0, lane: 0 });
    expect(events[1]).toEqual({ time: 0.5, lane: 3 });
    expect(events[2]).toEqual({ time: 1, lane: 1 });
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