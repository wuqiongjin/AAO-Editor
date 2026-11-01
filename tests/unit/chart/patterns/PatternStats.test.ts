// issue 190 锁测：片段卡片的两个**派生值**（音符数 / 拍数）、显示格式，以及
// 「派生值不写进载荷」的静态锁。
// 口径：音符数直接复用画布 / combo 的 `countChartNotes`；拍数与 `capturePattern` 的包围盒
// 同口径（存的是 `beat`，不折算 `subBeat`；滑条 / 长条含 hidden 连接点；BPM / System / Opaque 不参与）。
import { describe, expect, it } from 'vitest';
import { countChartNotes } from '@/src/chart/editing/NoteEditing';
import {
  formatPatternBeatSpan,
  patternBeatSpan,
  patternNoteCount,
  patternStats,
} from '@/src/chart/patterns/stats';
import type { ChartNote } from '@/src/chart/types';
import { makePattern } from '@/tests/support/patterns';
import { readStripped } from '@/tests/support/source';

const countOf = (notes: ChartNote[]) => patternNoteCount(makePattern({ notes }));
const spanOf = (notes: ChartNote[]) => patternBeatSpan(makePattern({ notes }));

describe('issue 190 · 音符数（与画布 / combo 同口径）', () => {
  it('单键 / 左方向 / 右方向各计 1', () => {
    expect(countOf([
      { type: 'Single', beat: 0, lane: 0 },
      { type: 'LDirectional', beat: 1, lane: 1, length: 2 },
      { type: 'RDirectional', beat: 2, lane: 2, length: 3 },
    ])).toBe(3);
  });

  it('滑条 / 长条按非 hidden 连接点逐点计', () => {
    expect(countOf([
      {
        type: 'Slide',
        connections: [
          { beat: 0, lane: 0 },
          { beat: 1, lane: 1, hidden: true },
          { beat: 2, lane: 2 },
        ],
      },
      {
        type: 'Long',
        connections: [{ beat: 3, lane: 3 }, { beat: 4, lane: 4 }],
      },
    ])).toBe(4); // Slide 2 个可击打结点 + Long 2 个
  });

  it('BPM / System / Opaque 不计', () => {
    expect(countOf([
      { type: 'BPM', beat: 0, bpm: 120 },
      { type: 'System', beat: 1, data: 'x' },
      { type: 'Opaque', beat: 2, sourceType: 'Unknown', source: {} },
      { type: 'Single', beat: 3, lane: 0 },
    ])).toBe(1);
  });

  it('直接复用 countChartNotes（同一批音符结果一致，不另写第二个定义）', () => {
    const notes: ChartNote[] = [
      { type: 'Single', beat: 0, lane: 0 },
      { type: 'Slide', connections: [{ beat: 1, lane: 0 }, { beat: 2, lane: 1, hidden: true }] },
      { type: 'BPM', beat: 3, bpm: 180 },
    ];
    expect(countOf(notes)).toBe(countChartNotes(notes));
    expect(countOf(notes)).toBe(2);
  });
});

describe('issue 190 · 拍数（maxBeat − minBeat）', () => {
  it('单键 / 方向键取拍位的极值差', () => {
    expect(spanOf([
      { type: 'Single', beat: 2, lane: 0 },
      { type: 'LDirectional', beat: 12, lane: 1, length: 2 },
    ])).toBe(10);
  });

  it('滑条 / 长条按全部连接点（含 hidden）计拍数；hidden 不计音符数但计拍数', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 1, lane: 0 },
        { beat: 6, lane: 1, hidden: true },
        { beat: 11, lane: 2 },
      ],
    }];
    expect(countOf(notes)).toBe(2);
    expect(spanOf(notes)).toBe(10);
  });

  it('hidden 连接点的负 beat 也仍在跨度内（ADR-0014：负 beat = hidden）', () => {
    const notes: ChartNote[] = [{
      type: 'Long',
      connections: [
        { beat: -1, lane: 0, hidden: true },
        { beat: 10, lane: 1 },
      ],
    }];
    expect(countOf(notes)).toBe(1);
    expect(spanOf(notes)).toBe(11);
  });

  it('BPM / System / Opaque 不参与跨度', () => {
    expect(spanOf([
      { type: 'BPM', beat: -100, bpm: 120 },
      { type: 'System', beat: 0, data: 'x' },
      { type: 'Single', beat: 3, lane: 0 },
      { type: 'Opaque', beat: 100, sourceType: 'Unknown', source: {} },
      { type: 'Single', beat: 13, lane: 1 },
    ])).toBe(10);
  });

  it('非整数拍保留小数；subBeat 不折算（与 capture 的 beat 口径一致）', () => {
    expect(spanOf([
      { type: 'Single', beat: 2.5, lane: 0 },
      { type: 'Single', beat: 13, subBeat: 2, lane: 1 },
    ])).toBe(10.5);
  });

  it('空片段 / 只有 BPM、System、空滑条的脏数据 → 0，不抛错', () => {
    expect(spanOf([])).toBe(0);
    expect(spanOf([{ type: 'BPM', beat: 0, bpm: 120 }])).toBe(0);
    expect(spanOf([{ type: 'System', beat: 0, data: 'x' }])).toBe(0);
    expect(spanOf([{ type: 'Slide', connections: [] }])).toBe(0);
    expect(patternStats(makePattern({ notes: [] }))).toEqual({ noteCount: 0, beatSpan: 0 });
  });
});

describe('issue 190 · 拍数显示格式', () => {
  it('整数显示为整数，不带 .0', () => {
    expect(formatPatternBeatSpan(10)).toBe('10');
    expect(formatPatternBeatSpan(0)).toBe('0');
  });

  it('非整数保留一位小数', () => {
    expect(formatPatternBeatSpan(10.5)).toBe('10.5');
  });

  it('舍入后是整数时去掉无意义的 .0', () => {
    expect(formatPatternBeatSpan(10.04)).toBe('10');
  });

  it('超过一位小数按四舍五入保留一位', () => {
    expect(formatPatternBeatSpan(10.25)).toBe('10.3');
  });
});

describe('issue 190 · 派生值不进载荷（静态锁）', () => {
  const payloadFiles = [
    'src/chart/patterns/types.ts',
    'src/chart/patterns/record.ts',
    'src/chart/patterns/share.ts',
  ];

  it.each(payloadFiles)('%s 不含 noteCount / beatSpan 字段', (file) => {
    expect(readStripped(file)).not.toMatch(/noteCount|beatSpan/);
  });

  it('stats.ts 的音符数直接复用 countChartNotes', () => {
    expect(readStripped('src/chart/patterns/stats.ts')).toMatch(/countChartNotes/);
  });

  it('卡片统计行用 --text-2xs + muted 弱化色 + 等宽数字（静态 CSS 锁）', () => {
    const css = readStripped('src/pages/workspace/PatternLibraryDrawer.css');
    const block = css.match(/\.pld-card__stats\s*\{[\s\S]*?\}/)?.[0] ?? '';
    expect(block).toContain('var(--text-2xs)');
    expect(block).toContain('var(--text-muted)');
    expect(block).toContain('font-variant-numeric: tabular-nums');
  });
});
