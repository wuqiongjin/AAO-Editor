// ADR-0008 §6：指针态拖拽移动（planDragMove/draggableFromItems）。Issue 55。
import { describe, it, expect } from 'vitest';
import type { ChartNote, SelectionItem, SlideNote } from '../../src/chart/types';
import { planDragMove, draggableFromItems } from '../../src/chart/editing/NoteDragging';

const single = (beat: number, lane: number): ChartNote =>
  ({ type: 'Single', beat, lane, subBeat: 0 } as ChartNote);
const slide = (...flat: number[]): ChartNote => {
  const connections = [];
  for (let i = 0; i < flat.length; i += 2) connections.push({ beat: flat[i], lane: flat[i + 1], subBeat: 0 });
  return { type: 'Slide', connections };
};
const noteSel = (...idxs: number[]): SelectionItem[] => idxs.map(i => ({ kind: 'note' as const, noteIndex: i }));
const B = { chartEndBeat: 16 };

describe('draggableFromItems', () => {
  it('键型/整条滑条/结点可拖；BPM/System/slideRegion 不可', () => {
    const notes: ChartNote[] = [single(1, 1), { type: 'BPM', beat: 2, bpm: 120 }, slide(3, 1, 4, 2)];
    const items: SelectionItem[] = [
      ...noteSel(0, 1, 2),
      { kind: 'slideNode', noteIndex: 2, connIndex: 0 },
      { kind: 'slideRegion', noteIndex: 2, connIndex: 0 },
    ];
    const drag = draggableFromItems(notes, items);
    expect(drag).toEqual([...noteSel(0, 2), { kind: 'slideNode', noteIndex: 2, connIndex: 0 }]);
  });
});

describe('planDragMove（ADR-0008 §6）', () => {
  it('普通音符整格位移；结构共享：未动音符复用引用', () => {
    const keep = { type: 'BPM', beat: 0, bpm: 120 };
    const notes: ChartNote[] = [single(1, 1), single(5, 2), keep];
    const r = planDragMove(notes, noteSel(0), { dBeat: 2, dLane: 1 }, B);
    expect(r.ok).toBe(true);
    expect(r.notes[0]).toEqual(single(3, 2));
    expect(r.notes[1]).toBe(notes[1]);
    expect(r.notes[2]).toBe(keep);
    expect(notes[0].beat).toBe(1); // 无就地变异
  });

  it('碰撞未动音符 → 回弹（collision）', () => {
    const notes: ChartNote[] = [single(1, 1), single(3, 2)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 2, dLane: 1 }, B);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('collision');
    expect(r.notes).toBe(notes);
  });

  it('越过 lane 边界 / 谱面末端 → 回弹（out-of-bounds）', () => {
    const notes: ChartNote[] = [single(1, 0)];
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: -1 }, B).reason).toBe('out-of-bounds');
    expect(planDragMove(notes, noteSel(0), { dBeat: 16, dLane: 0 }, B).reason).toBe('out-of-bounds');
  });

  it('多选组移动：整体位移，组内互撞豁免', () => {
    const notes: ChartNote[] = [single(1, 1), single(3, 1)];
    const r = planDragMove(notes, noteSel(0, 1), { dBeat: 2, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    expect((r.notes[0] as any).beat).toBe(3);
    expect((r.notes[1] as any).beat).toBe(5);
  });

  it('整条滑条拖动：全部结点位移', () => {
    const notes: ChartNote[] = [slide(2, 1, 4, 2)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 1, dLane: 1 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[3, 2], [5, 3]]);
  });

  it('端点延伸/收缩合法；越过另一邻居 → 回弹', () => {
    const notes: ChartNote[] = [slide(2, 1, 4, 2)];
    const shrink: SelectionItem = { kind: 'slideNode', noteIndex: 0, connIndex: 0 };
    expect(planDragMove(notes, [shrink], { dBeat: 1, dLane: 0 }, B).ok).toBe(true);
    // 起点越过终点（2→5 > 4）→ 失败
    expect(planDragMove(notes, [shrink], { dBeat: 3, dLane: 0 }, B).ok).toBe(false);
  });

  it('中间结点改形状：lane 自由、beat 保持邻居之间', () => {
    const notes: ChartNote[] = [slide(2, 1, 4, 2, 6, 1)];
    const mid: SelectionItem = { kind: 'slideNode', noteIndex: 0, connIndex: 1 };
    const r = planDragMove(notes, [mid], { dBeat: 0.5, dLane: 3 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    expect(s.connections[1]).toMatchObject({ beat: 4.5, lane: 5 });
    expect(s.connections[0]).toMatchObject({ beat: 2, lane: 1 }); // 邻居不动
    expect(s.connections[2]).toMatchObject({ beat: 6, lane: 1 });
  });

  it('结点撞上其它音符 → collision', () => {
    const notes: ChartNote[] = [slide(2, 1, 4, 2, 6, 1), single(4, 5)];
    const mid: SelectionItem = { kind: 'slideNode', noteIndex: 0, connIndex: 1 };
    const r = planDragMove(notes, [mid], { dBeat: 0, dLane: 3 }, B);
    expect(r.reason).toBe('collision');
  });

  it('delta=0 → ok 且原数组引用（等价点击）', () => {
    const notes: ChartNote[] = [single(1, 1)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 0, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    expect(r.notes).toBe(notes);
  });

  it('拖拽集合含不可拖条目（BPM）→ 忽略之只拖可拖部分', () => {
    const notes: ChartNote[] = [single(1, 1), { type: 'BPM', beat: 2, bpm: 120 }];
    const r = planDragMove(notes, noteSel(0, 1), { dBeat: 1, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    expect((r.notes[0] as any).beat).toBe(2);
    expect(r.notes[1]).toBe(notes[1]);
    expect(r.items).toEqual(noteSel(0));
  });
});
