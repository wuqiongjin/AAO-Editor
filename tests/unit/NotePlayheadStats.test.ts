import { describe, it, expect } from 'vitest';
import { countNotesUpToBeat } from '../../src/utils/NoteEditing';
import { formatTimePrecise, formatTimeWhole } from '../../src/utils/TimeFormat';
import type { ChartNote } from '../../src/notes/Charts';

describe('countNotesUpToBeat（判定线前音符数，issue 22）', () => {
  const notes: ChartNote[] = [
    { type: 'BPM', beat: 0, bpm: 120 },          // 不计入
    { type: 'Single', beat: 1, lane: 0 },         // 已过（=1）
    { type: 'Single', beat: 2, lane: 1 },         // 已过（<2.5）
    { type: 'Single', beat: 3, lane: 2 },         // 未过（>2.5）
    { type: 'LDirectional', beat: 2.25, lane: 3, length: 2 }, // 已过
    { type: 'Slide', connections: [
        { beat: 1.5, lane: 0 },
        { beat: 2.5, lane: 1 },
    ] },                                         // 首结点 1.5 已过
    { type: 'System', beat: 9, data: {} },        // 不计入
  ];

  it('playhead beat 2.5 时返回 4（Single1/2 + LDir + Slide）', () => {
    expect(countNotesUpToBeat(notes, 2.5)).toBe(4);
  });

  it('playhead beat 0 时不计数（无 <=0 的可打击音符）', () => {
    expect(countNotesUpToBeat(notes, 0)).toBe(0);
  });

  it('playhead beat 覆盖全部时返回全部可打击音符数', () => {
    expect(countNotesUpToBeat(notes, 100)).toBe(5);
  });

  it('空滑条（无结点）保守计为已过线', () => {
    const emptySlide: ChartNote = { type: 'Slide', connections: [] };
    expect(countNotesUpToBeat([emptySlide], 0)).toBe(1);
  });
});

describe('formatTimePrecise（0.1s 时间码，issue 22）', () => {
  it('mm:ss.s 格式，0.1 精度', () => {
    expect(formatTimePrecise(0)).toBe('00:00.0');
    expect(formatTimePrecise(83.4)).toBe('01:23.4');
    expect(formatTimePrecise(59.96)).toBe('00:59.9');
  });

  it('负值钳制到 0', () => {
    expect(formatTimePrecise(-3)).toBe('00:00.0');
  });
});

describe('formatTimeWhole（整秒）', () => {
  it('mm:ss', () => {
    expect(formatTimeWhole(83.9)).toBe('01:23');
    expect(formatTimeWhole(30)).toBe('00:30');
  });
});
