import { describe, it, expect } from 'vitest';
import { countNotesUpToBeat, countChartNotes } from '@/src/chart/editing/NoteEditing';
import { formatTimePrecise, formatTimeWhole } from '@/src/chart/geometry/TimeFormat';
import type { ChartNote } from '@/src/chart/types';

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
    ] },                                         // 结点 1.5 / 2.5 均已过
    { type: 'System', beat: 9, data: {} },        // 不计入
  ];

  // issue 84：滑条/长条改**逐结点**计（与总数同口径），不再是"整条算 1"
  it('playhead beat 2.5 时返回 5（Single1/2 + LDir + Slide 两结点）', () => {
    expect(countNotesUpToBeat(notes, 2.5)).toBe(5);
  });

  it('playhead beat 0 时不计数（无 <=0 的可打击音符）', () => {
    expect(countNotesUpToBeat(notes, 0)).toBe(0);
  });

  it('playhead beat 覆盖全部时返回全部可打击音符数（Slide 计 2 结点）', () => {
    expect(countNotesUpToBeat(notes, 100)).toBe(6);
  });

  it('滑条按结点各自判过线（playhead 2.0 → 只过 1.5 那个结点）', () => {
    expect(countNotesUpToBeat(notes, 2.0)).toBe(3); // Single1/2 + Slide 首结点（LDir 2.25 未过）
  });

  it('空滑条（无结点）没有可击打结点 → 0（issue 84：不再保守计 1）', () => {
    const emptySlide: ChartNote = { type: 'Slide', connections: [] };
    expect(countNotesUpToBeat([emptySlide], 0)).toBe(0);
  });
});

describe('countChartNotes（音符总数，issue 36 口径 + issue 84 修订）', () => {
  const slide = (...conns: { beat: number; lane: number; hidden?: boolean }[]): ChartNote =>
    ({ type: 'Slide', connections: conns });

  it('BPM / System 不计入（它们不是音符）', () => {
    const notes: ChartNote[] = [
      { type: 'BPM', beat: 0, bpm: 120 },
      { type: 'Single', beat: 1, lane: 0 },
      { type: 'Single', beat: 2, lane: 1 },
      { type: 'Single', beat: 3, lane: 2 },
    ];
    expect(countChartNotes(notes)).toBe(3); // 修复前 4
  });

  it('只有 BPM/System → 0', () => {
    const notes = [
      { type: 'BPM', beat: 0, bpm: 120 },
      { type: 'BPM', beat: 32, bpm: 180 },
      { type: 'System', beat: 9, data: {} },
    ] as unknown as ChartNote[];
    expect(countChartNotes(notes)).toBe(0);
  });

  it('Slide 按**非 hidden 结点数**计：A→B = 2 / A→B→C = 3 / A→H→C = 2', () => {
    expect(countChartNotes([slide({ beat: 1, lane: 0 }, { beat: 2, lane: 1 })])).toBe(2);
    expect(countChartNotes([slide({ beat: 1, lane: 0 }, { beat: 2, lane: 1 }, { beat: 3, lane: 2 })])).toBe(3);
    expect(countChartNotes([slide(
      { beat: 1, lane: 0 },
      { beat: 2, lane: 1, hidden: true },
      { beat: 3, lane: 2 },
    )])).toBe(2);
  });

  it('混排：BPM + Slide(3 结点含 1 hidden) + 2 单键 + 方向键 = 6', () => {
    const notes = [
      { type: 'BPM', beat: 0, bpm: 120 },
      slide({ beat: 1, lane: 0 }, { beat: 2, lane: 1, hidden: true }, { beat: 3, lane: 2 }, { beat: 4, lane: 3 }),
      { type: 'Single', beat: 5, lane: 4 },
      { type: 'Single', beat: 6, lane: 5 },
      { type: 'LDirectional', beat: 7, lane: 0, length: 2 },
    ] as unknown as ChartNote[];
    // BPM 0 + Slide 3（4 结点 - 1 hidden）+ 单键 2 + 方向键 1
    expect(countChartNotes(notes)).toBe(6);
  });

  it('总数与"全部过线"的已过数同口径（两处计数一致）', () => {
    const notes = [
      { type: 'BPM', beat: 0, bpm: 120 },
      slide({ beat: 1, lane: 0 }, { beat: 2, lane: 1, hidden: true }, { beat: 3, lane: 2 }),
      { type: 'Single', beat: 4, lane: 3 },
    ] as unknown as ChartNote[];
    expect(countNotesUpToBeat(notes, 1000)).toBe(countChartNotes(notes));
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
