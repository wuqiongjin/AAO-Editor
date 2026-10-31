// issue 184 · 片段采集（ADR-0023 §1）。
// 锁的是：剥 `source`、起点 BPM 取前驱、事件区间 `(minBeat, maxBeat]` 与 `deltaBeat` 归一、
// 滑条按全部结点算包围盒、空选区不产出。
import { describe, expect, it } from 'vitest';
import type { ChartNote, SelectionItem } from '@/src/chart/types';
import { capturePattern } from '@/src/chart/patterns/capture';

const bpm = (beat: number, value: number): ChartNote => ({ type: 'BPM', beat, bpm: value });
const single = (beat: number, lane = 1, extra: Record<string, unknown> = {}): ChartNote =>
  ({ type: 'Single', beat, lane, ...extra }) as ChartNote;

const selectNotes = (...indices: number[]): SelectionItem[] =>
  indices.map((noteIndex) => ({ kind: 'note', noteIndex }));

describe('capturePattern · 音符载荷', () => {
  it('音符本体与滑条连接点的 `source` 都剥掉（任意嵌套深度）', () => {
    const notes: ChartNote[] = [
      bpm(0, 120),
      single(1, 1, { source: { rawType: 'Single', extra: { deep: 1 } } }),
      {
        type: 'Slide',
        connections: [
          { beat: 2, lane: 2, source: { rawType: 'Slide', note: { nested: true } } },
          { beat: 3, lane: 3, source: { rawType: 'Slide' } },
        ],
        source: { rawType: 'Slide' },
      },
    ];

    const payload = capturePattern(notes, selectNotes(1, 2));
    expect(payload).not.toBeNull();
    expect(JSON.stringify(payload!.notes)).not.toContain('"source"');
    expect(payload!.notes).toHaveLength(2);
  });

  it('复用 copySelection 的形态归一：单个滑条结点退化成独立音符', () => {
    const slide: ChartNote = {
      type: 'Slide',
      connections: [
        { beat: 4, lane: 0 },
        { beat: 5, lane: 1, flick: true },
        { beat: 6, lane: 2 },
      ],
    };
    const payload = capturePattern([bpm(0, 120), slide], [{ kind: 'slideNode', noteIndex: 1, connIndex: 1 }]);
    expect(payload!.notes).toEqual([{ type: 'Single', beat: 5, lane: 1, subBeat: 0, flick: true }]);
  });

  it('产物是深拷贝：改片段不会碰源谱面', () => {
    const notes = [bpm(0, 120), single(1, 1, { flick: true })];
    const payload = capturePattern(notes, selectNotes(1))!;
    (payload.notes[0] as { lane: number }).lane = 99;
    expect((notes[1] as { lane: number }).lane).toBe(1);
  });
});

describe('capturePattern · 速度语境', () => {
  it('startBpm 取最后一条 beat ≤ minBeat（同拍多条取数组序最后）', () => {
    const notes = [bpm(0, 120), bpm(4, 200), bpm(4, 210), single(6)];
    const payload = capturePattern(notes, selectNotes(3))!;
    expect(payload.bpmContext.startBpm).toBe(210);
    expect(payload.bpmContext.events).toEqual([]);
  });

  it('events 恰为 (minBeat, maxBeat]，deltaBeat 相对起点归一', () => {
    const notes = [
      bpm(0, 120),
      single(2),
      bpm(2, 150),
      bpm(5, 180),
      single(8),
      bpm(8, 200),
      bpm(10, 220),
    ];
    const payload = capturePattern(notes, selectNotes(1, 4))!;
    expect(payload.bpmContext.startBpm).toBe(150);
    expect(payload.bpmContext.events).toEqual([
      { deltaBeat: 3, bpm: 180 },
      { deltaBeat: 6, bpm: 200 },
    ]);
  });

  it('滑条按全部连接点算包围盒（含 hidden），事件随之取整段', () => {
    const slide: ChartNote = {
      type: 'Slide',
      connections: [
        { beat: 4, lane: 0 },
        { beat: 6, lane: 1, hidden: true },
        { beat: 9, lane: 2 },
      ],
    };
    const notes = [bpm(0, 120), bpm(7, 240), slide, single(12)];
    const payload = capturePattern(notes, selectNotes(2))!;
    expect(payload.bpmContext.startBpm).toBe(120);
    expect(payload.bpmContext.events).toEqual([{ deltaBeat: 3, bpm: 240 }]);
  });

  it('没有前驱 BPM 时回落到默认 BPM（谱面必有 beat 0，此路只在脏数据上出现）', () => {
    const payload = capturePattern([single(4)], selectNotes(0))!;
    expect(payload.bpmContext.startBpm).toBe(120);
  });
});

describe('capturePattern · 空选区', () => {
  it('空选区不产出', () => {
    expect(capturePattern([single(1)], [])).toBeNull();
  });

  it('选区下标全部落空不产出', () => {
    expect(capturePattern([single(1)], selectNotes(9))).toBeNull();
  });
});
