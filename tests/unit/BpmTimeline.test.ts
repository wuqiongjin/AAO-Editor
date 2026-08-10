import { describe, it, expect } from 'vitest';
import { BpmTimeline } from '../../src/utils/BpmTimeline';
import { DEFAULT_BPM, getBpmEvents, beatToSeconds, secondsToBeat } from '../../src/utils/AudioTiming';
import type { ChartNote } from '../../src/notes/Charts';

describe('BpmTimeline（秒坐标系）', () => {
  const sec = (events: { beat: number; bpm: number }[]) => new BpmTimeline(events, (bpm) => 60 / bpm);

  it('单段：位置随拍线性（120bpm 每拍 0.5s）', () => {
    const tl = sec([{ beat: 0, bpm: 120 }]);
    expect(tl.positionOfBeat(0)).toBe(0);
    expect(tl.positionOfBeat(1)).toBeCloseTo(0.5);
    expect(tl.positionOfBeat(120)).toBeCloseTo(60);
  });

  it('分段：BPM 交界处累计正确', () => {
    const tl = sec([
      { beat: 0, bpm: 120 },
      { beat: 60, bpm: 240 },
    ]);
    expect(tl.positionOfBeat(60)).toBeCloseTo(30); // 60拍*0.5s
    expect(tl.positionOfBeat(90)).toBeCloseTo(30 + 30 * 0.25);
  });

  it('beatOfPosition 与 positionOfBeat 互逆', () => {
    const tl = sec([
      { beat: 0, bpm: 120 },
      { beat: 30, bpm: 240 },
    ]);
    for (const beat of [0, 5, 30, 42, 100]) {
      expect(tl.beatOfPosition(tl.positionOfBeat(beat))).toBeCloseTo(beat, 6);
    }
  });

  it('末段无限延伸，按末段速率延续', () => {
    const tl = sec([{ beat: 0, bpm: 240 }]);
    expect(tl.beatOfPosition(0.5)).toBeCloseTo(2);
    expect(tl.beatOfPosition(1)).toBeCloseTo(4);
  });

  it('空段返回 0', () => {
    const tl = sec([]);
    expect(tl.positionOfBeat(5)).toBe(0);
    expect(tl.beatOfPosition(5)).toBe(0);
  });
});

describe('AudioTiming 复用 BpmTimeline 后行为不变', () => {
  it('beatToSeconds / secondsToBeat 与 getBpmEvents 协作', () => {
    const notes: ChartNote[] = [
      { type: 'BPM', beat: 60, bpm: 240 },
      { type: 'BPM', beat: 30, bpm: 180 },
    ];
    const events = getBpmEvents(notes);
    expect(events[0]).toEqual({ beat: 0, bpm: DEFAULT_BPM });
    expect(beatToSeconds(events, 0)).toBe(0);
    expect(secondsToBeat(events, beatToSeconds(events, 30))).toBeCloseTo(30, 6);
  });
});