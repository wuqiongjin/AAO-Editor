// ADR-0008 §6：指针态拖拽移动（planDragMove/draggableFromItems）。Issue 55。
import { describe, it, expect } from 'vitest';
import type { ChartNote, SelectionItem, SlideNote } from '../../src/chart/types';
import { planDragMove, draggableFromItems, dragDeltaBeat, itemTrueBeat } from '../../src/chart/editing/NoteDragging';

const single = (beat: number, lane: number): ChartNote =>
  ({ type: 'Single', beat, lane, subBeat: 0 } as ChartNote);
const slide = (...flat: number[]): ChartNote => {
  const connections = [];
  for (let i = 0; i < flat.length; i += 2) connections.push({ beat: flat[i], lane: flat[i + 1], subBeat: 0 });
  return { type: 'Slide', connections };
};
const noteSel = (...idxs: number[]): SelectionItem[] => idxs.map(i => ({ kind: 'note' as const, noteIndex: i }));
const B = { chartEndBeat: 16, beatDisplay: 4 };

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

  it('键音符拖到滑条结点 → 回弹（§1.2 属放置语义，移动不适用）', () => {
    const notes: ChartNote[] = [single(1, 1), slide(3, 2, 4, 2)];
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

describe('planDragMove 落点覆盖/接合（ADR-0008 §6 四轮修订）', () => {
  it('键音符 ↔ 键音符 → §1.1 替换：目标被拖拽件消耗（方向键 length 不叠加）', () => {
    const notes: ChartNote[] = [single(1, 1), single(3, 2), single(9, 9)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 2, dLane: 1 }, B);
    expect(r.ok).toBe(true);
    expect(r.notes).toHaveLength(2);            // 目标 (3,2) 被覆盖
    expect(r.notes[0]).toEqual(single(3, 2));   // 拖拽件落在目标位（类型/标记随拖拽件）
    expect(r.notes[1]).toBe(notes[2]);          // 无关音符结构共享
    expect(r.items).toEqual(noteSel(0));
    expect(r.ghost).toEqual([single(3, 2)]);
  });

  it('滑条端点拖到另一条滑条端点 → §3 接合：两条并为一条链', () => {
    const notes: ChartNote[] = [slide(1, 1, 2, 2), slide(4, 4, 5, 5)];
    const r = planDragMove(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }], { dBeat: 2, dLane: 2 }, B);
    expect(r.ok).toBe(true);
    expect(r.notes).toHaveLength(1);
    const s = r.notes[0] as SlideNote;
    expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[1, 1], [4, 4], [5, 5]]);
    expect(s.connections[1]).toEqual({ beat: 4, lane: 4, subBeat: 0, hidden: false }); // 共享点降途径结点
    expect(r.items).toEqual([{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }]);       // 下标已重映射
  });

  it('反向：拖另一条的头端点来接（C→D 的头拖到 A→B 的尾）→ 同样成链', () => {
    const notes: ChartNote[] = [slide(1, 1, 2, 2), slide(5, 5, 6, 6)];
    const r = planDragMove(notes, [{ kind: 'slideNode', noteIndex: 1, connIndex: 0 }], { dBeat: -3, dLane: -3 }, B);
    expect(r.ok).toBe(true);
    expect(r.notes).toHaveLength(1);
    expect((r.notes[0] as SlideNote).connections.map(c => [c.beat, c.lane]))
      .toEqual([[1, 1], [2, 2], [6, 6]]);
    expect(r.items).toEqual([{ kind: 'slideNode', noteIndex: 0, connIndex: 0 }]); // 合并链补到下标 0
  });

  it('整条滑条拖动后端点与既有端点重合 → 同样接合', () => {
    const notes: ChartNote[] = [slide(1, 1, 2, 2), slide(3, 3, 4, 4), slide(9, 1, 10, 1)];
    const r = planDragMove(notes, noteSel(1), { dBeat: -1, dLane: -1 }, B); // (3,3)→(2,2)
    expect(r.ok).toBe(true);
    expect(r.notes).toHaveLength(2); // 合并链 + 无关的第三条
    expect((r.notes[0] as SlideNote).connections.map(c => [c.beat, c.lane]))
      .toEqual([[1, 1], [2, 2], [3, 3]]);
    expect(r.items).toEqual(noteSel(0)); // 被拖件下标重映射为 0（原目标被消耗，合并链补位）
    expect(r.ghost).toEqual([r.notes[0]]);
    expect(r.notes[1]).toBe(notes[2]); // 无关滑条结构共享
  });

  it('滑条端点覆盖键音符 → 键音符被消耗（removeOverlappedNotes 同语义）', () => {
    const notes: ChartNote[] = [slide(1, 1, 2, 2), single(4, 4)];
    const r = planDragMove(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }], { dBeat: 2, dLane: 2 }, B);
    expect(r.ok).toBe(true);
    expect(r.notes).toHaveLength(1);
    expect((r.notes[0] as SlideNote).connections.map(c => [c.beat, c.lane])).toEqual([[1, 1], [4, 4]]);
  });

  it('滑条中间结点撞键音符 → 回弹（只有端点覆盖）', () => {
    const notes: ChartNote[] = [slide(1, 1, 2, 2, 3, 3), single(2, 5)];
    const r = planDragMove(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }], { dBeat: 0, dLane: 3 }, B);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('collision');
  });

  it('端点撞另一条滑条的中间结点 → 回弹', () => {
    const notes: ChartNote[] = [slide(1, 1, 2, 2), slide(4, 4, 5, 5, 6, 6)];
    const r = planDragMove(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }], { dBeat: 3, dLane: 3 }, B);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('collision');
  });

  it('组内不互覆盖：两件一起移动，各自原位置互不视为碰撞', () => {
    const notes: ChartNote[] = [single(1, 1), single(3, 1)];
    const r = planDragMove(notes, noteSel(0, 1), { dBeat: 1, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    expect(r.notes.map(n => (n as any).beat)).toEqual([2, 4]);
  });

  it('接合级联：一条端点接上后新端点又撞第三条 → 三段串一条', () => {
    const notes: ChartNote[] = [slide(1, 1, 2, 2), slide(3, 3, 4, 4), slide(4, 4, 5, 5)];
    const r = planDragMove(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }], { dBeat: 1, dLane: 1 }, B);
    expect(r.ok).toBe(true);
    expect(r.notes).toHaveLength(1);
    expect((r.notes[0] as SlideNote).connections.map(c => [c.beat, c.lane]))
      .toEqual([[1, 1], [3, 3], [4, 4], [5, 5]]);
  });

  it('接合保型：被拖件为 Long → 结果 Long', () => {
    const long = { type: 'Long', connections: [{ beat: 1, lane: 1, subBeat: 0 }, { beat: 2, lane: 2, subBeat: 0 }] } as ChartNote;
    const notes: ChartNote[] = [long, slide(4, 4, 5, 5)];
    const r = planDragMove(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }], { dBeat: 2, dLane: 2 }, B);
    expect(r.ok).toBe(true);
    expect(r.notes[0].type).toBe('Long');
  });

  it('无就地变异：入参数组与未动音符引用不变', () => {
    const keep = slide(9, 1, 10, 1);
    const notes: ChartNote[] = [single(1, 1), single(3, 2), keep];
    const r = planDragMove(notes, noteSel(0), { dBeat: 2, dLane: 1 }, B);
    expect(notes).toHaveLength(3);
    expect((notes[0] as any).beat).toBe(1);
    expect(r.notes[r.notes.length - 1]).toBe(keep);
  });
});

describe('planDragMove - subBeat 单位（1/beatDisplay）', () => {
  it('越界判定按真实拍位：subBeat 不再是"整拍小数"', () => {
    // beat 15、subBeat 1（beatDisplay=4 → 真实 15.25）
    const notes: ChartNote[] = [{ type: 'Single', beat: 15, lane: 0, subBeat: 1 } as ChartNote];
    // 右移 0.5 → 真实 15.75 ≤ 16 → 合法（旧实现按 15.5+1=16.5 判越界，误杀）
    expect(planDragMove(notes, noteSel(0), { dBeat: 0.5, dLane: 0 }, B).ok).toBe(true);
    // 右移 1 → 真实 16.25 > 16 → 越界
    expect(planDragMove(notes, noteSel(0), { dBeat: 1, dLane: 0 }, B).reason).toBe('out-of-bounds');
  });
});

// ───────────────────────── issue 61：拖拽落点的吸附相位 ─────────────────────────
// 旧算法 dBeat = snap(光标现在) − snap(光标按下)，把"snap(按下点) − 对象真实拍位"这个相位
// 偏移永久带进落点：1/8 网格放的音符切到 1/4 后拖动，步长是 1/4 却只能踩在 1/8 的相位线上。
describe('dragDeltaBeat（issue 61：量化对象 = 落点，不是光标）', () => {
  const bd4 = 4;

  it('对象已在当前网格上：与旧"光标差"算法逐点等价（不改变既有手感）', () => {
    // 音符在 beat 2，光标也从 beat 2 起手（无抓取偏移）
    expect(dragDeltaBeat({ anchorBeat: 2, rawPressBeat: 2, rawCurBeat: 2.6, beatDisplay: bd4 }))
      .toBeCloseTo(2.5 - 2, 10); // snap(2.6)=2.5
  });

  it('1/8 相位上的音符切到 1/4 网格拖动 → 落点踩在 1/4 线上（旧算法踩不到）', () => {
    const anchor = 2 + 1 / 8; // 1/8 吸附放下的：2.125，不在 1/4 网格上
    const d = dragDeltaBeat({ anchorBeat: anchor, rawPressBeat: anchor, rawCurBeat: 3.3, beatDisplay: bd4 });
    const landing = anchor + d;
    expect(landing).toBeCloseTo(3.25, 10);
    // 旧算法：snap(3.3) − snap(2.125) = 3.25 − 2.25 = 1 → 落点 3.125（1/8 相位，永远回不到 1/4 线）
    expect(landing * bd4 % 1).toBeCloseTo(0, 10);
  });

  it('带抓取偏移起手（按住对象旁边 0.03 拍）：落点仍然精确在网格上', () => {
    const anchor = 1 + 3 / 8;
    const grab = 0.03;
    const d = dragDeltaBeat({ anchorBeat: anchor, rawPressBeat: anchor + grab, rawCurBeat: 4.4 + grab, beatDisplay: bd4 });
    expect(anchor + d).toBeCloseTo(4.5, 10); // snap(4.4, 1/4) = 4.5，抓取偏移被完整抵消
  });

  it('切回更细的网格（1/8）时以新网格量化', () => {
    const anchor = 2;
    const d = dragDeltaBeat({ anchorBeat: anchor, rawPressBeat: anchor, rawCurBeat: 2.31, beatDisplay: 8 });
    expect(anchor + d).toBeCloseTo(2.25, 10);
  });
});

describe('itemTrueBeat（issue 61：量化基准取被按住那件对象）', () => {
  it('键音符 / 滑条结点含 subBeat 折算；slideRegion 与 BPM 不可拖 → null', () => {
    const notes: ChartNote[] = [
      { type: 'Single', beat: 1, lane: 0, subBeat: 2 } as ChartNote,
      { type: 'BPM', beat: 2, bpm: 120 } as ChartNote,
      slide(3, 1, 4.5, 2),
    ];
    expect(itemTrueBeat(notes, { kind: 'note', noteIndex: 0 }, 4)).toBeCloseTo(1.5, 10);
    expect(itemTrueBeat(notes, { kind: 'note', noteIndex: 1 }, 4)).toBeNull();
    expect(itemTrueBeat(notes, { kind: 'slideNode', noteIndex: 2, connIndex: 1 }, 4)).toBeCloseTo(4.5, 10);
    expect(itemTrueBeat(notes, { kind: 'note', noteIndex: 2 }, 4)).toBeCloseTo(3, 10); // 整条 → 首结点
    expect(itemTrueBeat(notes, { kind: 'slideRegion', noteIndex: 2, connIndex: 0 }, 4)).toBeNull();
  });
});

// ───────────────────────── issue 62：方向滑键是"一整组" ─────────────────────────
describe('方向滑键整组越界（issue 62）', () => {
  const dir = (type: 'LDirectional' | 'RDirectional', beat: number, lane: number, length: number): ChartNote =>
    ({ type, beat, lane, subBeat: 0, length } as ChartNote);

  it('length=3 的右方向键：根轨还在界内、组尾溢出即非法（旧实现只判根轨 → 放得出去）', () => {
    const notes: ChartNote[] = [dir('RDirectional', 1, 3, 3)]; // 占 3/4/5
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: 1 }, B).ok).toBe(true);   // 占 4/5/6 → 合法
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: 2 }, B).reason).toBe('out-of-bounds'); // 占 5/6/7
  });

  it('左方向键同理判整组（向 -1 溢出即非法）', () => {
    const notes: ChartNote[] = [dir('LDirectional', 1, 3, 3)]; // 占 3/2/1
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: -1 }, B).ok).toBe(true);  // 占 2/1/0 → 合法
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: -2 }, B).reason).toBe('out-of-bounds'); // 占 1/0/-1
  });
});
