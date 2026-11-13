// ADR-0008 §6：指针态拖拽移动（planDragMove/draggableFromItems）。Issue 55。
import { describe, it, expect } from 'vitest';
import type { ChartNote, SelectionItem, SlideNote } from '@/src/chart/types';
import { planDragMove, draggableFromItems, dragDeltaBeat, itemTrueBeat } from '@/src/chart/editing/NoteDragging';
import { buildChainedSlide } from '@/src/chart/editing/SpanCurve';
import { mirrorNote } from '@/src/chart/editing/NoteEditing';

const single = (beat: number, lane: number): ChartNote =>
  ({ type: 'Single', beat, lane, subBeat: 0 } as ChartNote);
const slide = (...flat: number[]): ChartNote => {
  const connections = [];
  for (let i = 0; i < flat.length; i += 2) connections.push({ beat: flat[i], lane: flat[i + 1], subBeat: 0 });
  return { type: 'Slide', connections };
};
const noteSel = (...idxs: number[]): SelectionItem[] => idxs.map(i => ({ kind: 'note' as const, noteIndex: i }));
const B = { chartEndBeat: 16, beatDisplay: 4 };

// issue 76：键音符拖到滑条结点上，**复用放置规则**（ADR-0001 §1.2），不再一律回弹。
// 放置规则会把拖拽件本身消耗掉（加标记 / 拆条），故产物是"滑条被改造 + 拖拽件消失"。
describe('planDragMove · 落点撞滑条结点 = 放置规则（issue 76）', () => {
  const key = (type: 'Single' | 'LDirectional' | 'RDirectional', beat: number, lane: number, extra: Record<string, unknown> = {}): ChartNote =>
    ({ type, beat, lane, subBeat: 0, ...extra } as ChartNote);
  const skill = (beat: number, lane: number) => key('Single', beat, lane, { skill: true });
  const flick = (beat: number, lane: number) => key('Single', beat, lane, { flick: true });

  it('技能键拖到滑条**首**端点 → 端点加 skill，拖拽件被消耗（不落地）', () => {
    const notes: ChartNote[] = [skill(1, 1), slide(3, 2, 5, 2)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 2, dLane: 1 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes.find(n => n.type === 'Slide') as SlideNote;
    expect(s.connections[0].skill).toBe(true);
    expect(r.notes.some(n => n.type === 'Single')).toBe(false); // 拖拽件被消耗
    expect(r.items).toEqual([]);                                 // 无产物可选
  });

  it('技能键拖到滑条**尾**端点 → 同样加 skill', () => {
    const notes: ChartNote[] = [skill(1, 2), slide(3, 2, 5, 2)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 4, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes.find(n => n.type === 'Slide') as SlideNote;
    expect(s.connections[1].skill).toBe(true);
  });

  it('滑键拖到**尾**端点 → 加 flick；拖到首/中间 → 回弹（与放置同规则）', () => {
    const tail = planDragMove([flick(1, 2), slide(3, 2, 5, 2)], noteSel(0), { dBeat: 4, dLane: 0 }, B);
    expect(tail.ok).toBe(true);
    expect(((tail.notes.find(n => n.type === 'Slide')) as SlideNote).connections[1].flick).toBe(true);

    const head = planDragMove([flick(1, 1), slide(3, 2, 5, 2)], noteSel(0), { dBeat: 2, dLane: 1 }, B);
    expect(head.ok).toBe(false); // 滑键只对尾端点生效
    expect(head.reason).toBe('collision');
  });

  it('方向滑键拖到**中间**结点 → 拆条（与放置路径同产物：两侧退化 + 中间方向键）', () => {
    const notes: ChartNote[] = [key('LDirectional', 1, 1, { length: 1 }), slide(3, 1, 4, 1, 5, 1)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 3, dLane: 0 }, B); // 落到中间结点 (4,1)
    expect(r.ok).toBe(true);
    expect(r.notes.filter(n => n.type === 'Slide')).toHaveLength(0); // 原滑条被拆
    expect(r.notes.some(n => n.type === 'LDirectional')).toBe(true);
  });

  it('回归：单键拖到任意滑条结点 → 仍回弹（放置规则 = 忽略）', () => {
    const r = planDragMove([single(1, 2), slide(3, 2, 5, 2)], noteSel(0), { dBeat: 2, dLane: 0 }, B);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('collision');
  });

  // issue 76 二轮：组拖同样支持 —— 落滑条的成员走放置规则，其余成员照常移动
  it('组拖（2 件）：一件落滑条端点（走放置规则）+ 一件落空位（照常移动）', () => {
    const notes: ChartNote[] = [skill(1, 1), single(1, 5), slide(3, 1, 5, 1)];
    const r = planDragMove(notes, noteSel(0, 1), { dBeat: 2, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes.find(n => n.type === 'Slide') as SlideNote;
    expect(s.connections[0].skill).toBe(true);                 // 技能键扣进首端点
    const moved = r.notes.filter(n => n.type === 'Single' && (n as any).beat === 3);
    expect(moved).toHaveLength(1);                              // 另一件正常移到 beat 3
    expect((moved[0] as any).lane).toBe(5);
  });

  it('组拖两件分别落**同一条**滑条的首/尾端点 → 回弹（防两条放置规则交叠）', () => {
    // 斜滑条 [首(3,1) → 尾(5,3)]；组拖共用一个 delta(+2 拍)：
    // A(1,1) → 首端点 (3,1)，B(3,3) → 尾端点 (5,3) —— 同一条滑条被两件认领
    const notes: ChartNote[] = [skill(1, 1), skill(3, 3), slide(3, 1, 5, 3)];
    const r = planDragMove(notes, noteSel(0, 1), { dBeat: 2, dLane: 0 }, B);
    expect(r.ok).toBe(false);
  });

  it('组拖预存重叠音符落滑条端点 → 拆条并完全替换，不回弹（issue 224 对齐 Bestdori）', () => {
    const notes: ChartNote[] = [skill(1, 1), skill(1, 1 + 0), slide(3, 1, 5, 1)];
    const r = planDragMove(notes, noteSel(0, 1), { dBeat: 2, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    expect(r.notes).toHaveLength(3); // 拆条退化的 Single(5,1) + 2 个落地的 skill(3,1)
  });

  it('覆盖落点也有**幽灵**：ghost = 被拖音符的落点形态（issue 76 二轮）', () => {
    const notes: ChartNote[] = [skill(1, 1), slide(3, 2, 5, 2)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 2, dLane: 1 }, B);
    expect(r.ok).toBe(true);
    expect(r.ghost).toHaveLength(1);
    expect(r.ghost![0]).toMatchObject({ type: 'Single', beat: 3, lane: 2, skill: true });
  });
});

// issue 130：拖动 = 移动口径 —— 被拖方向键落到滑条结点触发拆条时，
// 拆出的独立方向键**继承被拖件的 length / flick / skill**（不再被压成 length=1）。
describe('planDragMove · 拖方向键到滑条结点保留自身属性（issue 130）', () => {
  const dir = (beat: number, lane: number, extra: Record<string, unknown>): ChartNote =>
    ({ type: 'LDirectional', beat, lane, subBeat: 0, ...extra } as ChartNote);

  it('拖 length=3 到**中间**结点 → 拆成两条滑条 + 独立方向键 length=3', () => {
    const notes: ChartNote[] = [dir(1, 1, { length: 3 }), slide(2, 1, 3, 1, 4, 1, 5, 1, 6, 1)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 3, dLane: 0 }, B); // 落到中间结点 (4,1)
    expect(r.ok).toBe(true);
    expect(r.notes.filter(n => n.type === 'Slide')).toHaveLength(2); // 两侧各成一条（ADR §1.2.1）
    expect(r.notes.filter(n => n.type === 'Single')).toHaveLength(0); // 无结点退化
    const d = r.notes.find(n => n.type === 'LDirectional') as any;
    expect(d).toMatchObject({ beat: 4, lane: 1, length: 3 });
  });

  it('拖 length=2 到**首**端点 → 拆条产物 length=2', () => {
    const notes: ChartNote[] = [dir(1, 2, { length: 2 }), slide(3, 2, 5, 2)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 2, dLane: 0 }, B); // 落到首端点 (3,2)
    expect(r.ok).toBe(true);
    const d = r.notes.find(n => n.type === 'LDirectional') as any;
    expect(d).toMatchObject({ beat: 3, lane: 2, length: 2 });
  });

  it('拖 length=2 到**尾**端点 → 拆条产物 length=2', () => {
    const notes: ChartNote[] = [dir(1, 2, { length: 2 }), slide(3, 2, 5, 2)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 4, dLane: 0 }, B); // 落到尾端点 (5,2)
    expect(r.ok).toBe(true);
    const d = r.notes.find(n => n.type === 'LDirectional') as any;
    expect(d).toMatchObject({ beat: 5, lane: 2, length: 2 });
  });

  it('拖带 flick 的方向键 → 拆条产物保留 flick', () => {
    const notes: ChartNote[] = [dir(1, 1, { length: 2, flick: true }), slide(3, 1, 4, 1, 5, 1)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 3, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    const d = r.notes.find(n => n.type === 'LDirectional') as any;
    expect(d).toMatchObject({ length: 2, flick: true });
  });

  it('回归：拖 length=1 的方向键 → 产物仍 length=1（issue 76 既有用例口径）', () => {
    const notes: ChartNote[] = [dir(1, 1, { length: 1 }), slide(3, 1, 4, 1, 5, 1)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 3, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    const d = r.notes.find(n => n.type === 'LDirectional') as any;
    expect(d).toMatchObject({ length: 1 });
  });

  // 定案 1 的护栏：拖动**不**触发 ADR §1.1 的 length+1／归 1 —— 被拖件原样落地，
  // 目标只负责让位。此前这条语义零覆盖（既有用例拖的是 Single↔Single）。
  it('拖 length=1 的方向键到 length=2 的同类型方向键上 → 仍 1（不叠加）', () => {
    const notes: ChartNote[] = [dir(1, 1, { length: 1 }), dir(4, 1, { length: 2 })];
    const r = planDragMove(notes, noteSel(0), { dBeat: 3, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    expect(r.notes).toHaveLength(1); // 目标被覆盖消耗
    expect(r.notes[0]).toMatchObject({ type: 'LDirectional', beat: 4, length: 1 });
  });

  it('拖 length=2 的方向键到 length=1 的同类型方向键上 → 仍 2（不被目标改写）', () => {
    const notes: ChartNote[] = [dir(1, 1, { length: 2 }), dir(4, 1, { length: 1 })];
    const r = planDragMove(notes, noteSel(0), { dBeat: 3, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ type: 'LDirectional', beat: 4, length: 2 });
  });
});

describe('draggableFromItems', () => {
  it('键型/整条滑条/结点/滑条段可拖；BPM/System 不可（issue 09 S3：slideRegion 可拖 = 拉弓变形）', () => {
    const notes: ChartNote[] = [single(1, 1), { type: 'BPM', beat: 2, bpm: 120 }, slide(3, 1, 4, 2)];
    const items: SelectionItem[] = [
      ...noteSel(0, 1, 2),
      { kind: 'slideNode', noteIndex: 2, connIndex: 0 },
      { kind: 'slideRegion', noteIndex: 2, connIndex: 0 },
    ];
    const drag = draggableFromItems(notes, items);
    expect(drag).toEqual([...noteSel(0, 2), { kind: 'slideNode', noteIndex: 2, connIndex: 0 }, { kind: 'slideRegion', noteIndex: 2, connIndex: 0 }]);
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

  it('越过 lane 边界夹进 0..6；谱面末端仍回弹（ADR-0014）', () => {
    const notes: ChartNote[] = [single(1, 0)];
    const clamped = planDragMove(notes, noteSel(0), { dBeat: 0, dLane: -1 }, B);
    expect(clamped.ok).toBe(true);
    expect((clamped.notes[0] as { lane: number }).lane).toBe(0);
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

  it('端点延伸/收缩合法；越过另一邻居（issue 220 自动重排颠倒）', () => {
    const notes: ChartNote[] = [slide(2, 1, 4, 2)];
    const shrink: SelectionItem = { kind: 'slideNode', noteIndex: 0, connIndex: 0 };
    expect(planDragMove(notes, [shrink], { dBeat: 1, dLane: 0 }, B).ok).toBe(true);
    // 起点越过终点（2→5 > 4）→ issue 220：成功并重排为 [4, 5]，选区下标重映射至 1
    const r = planDragMove(notes, [shrink], { dBeat: 3, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    expect((r.notes[0] as SlideNote).connections.map(c => [c.beat, c.lane])).toEqual([[4, 2], [5, 1]]);
    expect(r.items[0]).toMatchObject({ connIndex: 1 });
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

  it('issue 111 · 位移为 0 或捏形无 lane 位移时 ghost 为空（禁止全谱幽灵）', () => {
    const notes: ChartNote[] = [single(1, 1)];
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: 0 }, B).ghost).toBeUndefined();
    const slideNote: ChartNote = {
      type: 'Slide',
      connections: [{ beat: 1, lane: 0 }, { beat: 2, lane: 0, hidden: true }, { beat: 3, lane: 0 }],
    };
    const r = planDragMove(
      [slideNote],
      [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }],
      { dBeat: 0.5, dLane: 0 },
      B,
    );
    expect(r.ok).toBe(true);
    expect(r.ghost).toBeUndefined();
    expect(r.ghost?.length ?? 0).toBe(0);
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

  it('接合是形态变化：被拖 Long 并入后变为 Slide', () => {
    const long = { type: 'Long', connections: [{ beat: 1, lane: 1, subBeat: 0 }, { beat: 2, lane: 2, subBeat: 0 }] } as ChartNote;
    const notes: ChartNote[] = [long, slide(4, 4, 5, 5)];
    const r = planDragMove(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }], { dBeat: 2, dLane: 2 }, B);
    expect(r.ok).toBe(true);
    expect(r.notes[0].type).toBe('Slide');
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

// issue 70 候选 2：占位表改为「只建落点窗口内的键」（性能）。下面三条钉住**裁剪不改变裁决**：
// 窗口由 moved 各件的**全部**结点算出，落在窗口外的对象不参与裁决，落在窗口内的照常命中。
// 长谱（chartEndBeat 很大）是为了让"窗口算窄了"真的能被抓到——短谱里全谱都在窗口内，测不出。
describe('planDragMove 占位表窗口裁剪（issue 70 候选 2，行为等价）', () => {
  const FAR = { chartEndBeat: 1000, beatDisplay: 4 };

  it('远处的键音符仍在窗口内：拖上去照常 §1.1 覆盖消耗', () => {
    const notes: ChartNote[] = [single(0, 0), single(900, 0)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 900, dLane: 0 }, FAR);
    expect(r.ok).toBe(true);
    expect(r.notes).toEqual([single(900, 0)]); // 目标被 §1.1 消耗
  });

  it('远处的键音符在窗口外：不参与裁决（不误判碰撞）', () => {
    const notes: ChartNote[] = [single(0, 0), single(900, 0)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 1, dLane: 0 }, FAR);
    expect(r.ok).toBe(true);
    expect(r.notes).toEqual([single(1, 0), single(900, 0)]);
  });

  it('窗口覆盖被拖滑条的**全部**结点：尾端点撞远处滑条头 → 照常 §3 接合', () => {
    // 若窗口只按首个结点算（[4,4]），B 的结点 5/6 会被裁掉 → 接合丢失，退化成"擦肩而过"
    const notes: ChartNote[] = [slide(0, 0, 1, 0), slide(5, 0, 6, 0)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 4, dLane: 0 }, FAR);
    expect(r.ok).toBe(true);
    expect(r.notes).toHaveLength(1);
    expect((r.notes[0] as SlideNote).connections.map(c => c.beat)).toEqual([4, 5, 6]);
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
    expect(itemTrueBeat(notes, { kind: 'slideRegion', noteIndex: 2, connIndex: 0 }, 4)).toBeCloseTo(3, 10); // issue 09 S3：区域可拖，锚拍 = 段起点
  });
});

// ───────────────────────── issue 62 + issue 66 §4b：方向滑键整组的越界口径 ─────────────────────────
// issue 62 定"方向键是一整组"（命中/框选/描边都按组）；越界判据则经 issue 66 §4b 修订：
// **只有根轨必须留在 0..6 内，组尾溢出合法**（与放置链路"允许 lane 6 放 length=3 右方向键"同口径）。
// 故下面"组尾溢出"的用例由 62 的 expect(非法) 翻转为 expect(合法)，并补"根轨出界才非法"。
describe('方向滑键整组越界（issue 62 整组 + issue 66 §4b 只判根轨）', () => {
  const dir = (type: 'LDirectional' | 'RDirectional', beat: number, lane: number, length: number): ChartNote =>
    ({ type, beat, lane, subBeat: 0, length } as ChartNote);

  it('右方向键 length=3：根轨在界内即合法，组尾溢出轨道外也允许（§4b）', () => {
    const notes: ChartNote[] = [dir('RDirectional', 1, 3, 3)]; // 占 3/4/5
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: 1 }, B).ok).toBe(true);   // 根 4 → 占 4/5/6
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: 2 }, B).ok).toBe(true);   // 根 5 → 组尾 7 溢出，仍合法
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: 3 }, B).ok).toBe(true);   // 根 6 → 组尾 8 溢出，仍合法
  });

  it('右方向键：根轨出界夹进 0..6，不回弹', () => {
    const notes: ChartNote[] = [dir('RDirectional', 1, 3, 3)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 0, dLane: 4 }, B);
    expect(r.ok).toBe(true);
    expect((r.notes[0] as { lane: number }).lane).toBe(6);
  });

  it('左方向键 length=3：向 -1 溢出合法，根轨出界夹进 0', () => {
    const notes: ChartNote[] = [dir('LDirectional', 1, 3, 3)]; // 占 3/2/1
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: -1 }, B).ok).toBe(true);  // 根 2 → 占 2/1/0
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: -2 }, B).ok).toBe(true);  // 根 1 → 组尾 -1 溢出，仍合法
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: -3 }, B).ok).toBe(true);  // 根 0 → 组尾 -2 溢出，仍合法
    const r = planDragMove(notes, noteSel(0), { dBeat: 0, dLane: -4 }, B);
    expect(r.ok).toBe(true);
    expect((r.notes[0] as { lane: number }).lane).toBe(0);
  });

  it('单键根轨出界夹进 0..6（ADR-0014 拖拽归合法轨）', () => {
    const notes: ChartNote[] = [single(1, 6)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 0, dLane: 1 }, B);
    expect(r.ok).toBe(true);
    expect((r.notes[0] as { lane: number }).lane).toBe(6);
  });
});

describe('planDragMove · 拖带弯曲（issue 09 S3 / ADR-0009 §4）', () => {
  const eased = (withParams = true): ChartNote => {
    const conns = [{ beat: 1, lane: 2, subBeat: 0 }];
    for (let p = 1; p < 16; p++) conns.push({ beat: 1 + p / 16, lane: 2, subBeat: 0, hidden: true });
    conns.push({ beat: 2, lane: 2, subBeat: 0 });
    return {
      type: 'Slide',
      connections: conns,
      ...(withParams ? { spanParams: { visibleCount: 2, bySpan: { 0: { kind: 'easing', family: 'quad', type: 'in', precision: 16 } } } } : {}),
    } as ChartNote;
  };

  it('单独拖段（region）= 拉弓变形：端点锚定、中点全跟、自由化清参数、beat 不动', () => {
    const notes: ChartNote[] = [eased(true)];
    const r = planDragMove(notes, [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }], { dBeat: 0, dLane: 2 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    expect(s.connections[0]).toMatchObject({ lane: 2 });
    expect(s.connections.at(-1)).toMatchObject({ lane: 2 });
    const mid = s.connections.find(c => c.hidden && Math.abs(c.beat - 1.5) < 1e-9)!;
    expect(mid.lane).toBe(4); // t=0.5 → w=1
    expect(s.connections.map(c => c.beat)).toEqual((notes[0] as SlideNote).connections.map(c => c.beat));
    // 一动就自由化：参数清除（spanParams 整体消失）
    expect(s.spanParams).toBeUndefined();
    // 选区保留 = 该 region
    expect(r.items).toEqual([{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }]);
  });

  it('纯 dBeat 拖段 = 无事发生（拉弓只吃 lane 分量）', () => {
    const notes: ChartNote[] = [eased(false)];
    const r = planDragMove(notes, [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }], { dBeat: 1, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    expect(r.notes[0]).toBe(notes[0]);
  });

  it('拖段带 grabBeat = 捏形（issue 108）：峰值在抓取点、两端锚定、beat 不动', () => {
    const notes: ChartNote[] = [eased(false)];
    const r = planDragMove(
      notes,
      [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }],
      { dBeat: 0, dLane: 2, grabBeat: 1.25 },
      B,
    );
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    const at = (b: number) => s.connections.find(c => Math.abs(c.beat - b) < 1e-9)!.lane;
    expect(at(1.25)).toBeCloseTo(4, 9);                    // 抓取点 w=1 → 2+2
    expect(at(1.5)).toBeCloseTo(2 + 2 * (0.5 / 0.75), 9);  // 右侧更缓
    expect(s.connections[0]!.lane).toBe(2);                // 端点锚定
    expect(s.connections.at(-1)!.lane).toBe(2);
    expect(s.connections.map(c => c.beat)).toEqual((notes[0] as SlideNote).connections.map(c => c.beat));
  });

  it('拖段不传 grabBeat = 抓中点（旧拉弓行为，回归）', () => {
    const notes: ChartNote[] = [eased(false)];
    const r = planDragMove(notes, [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }], { dBeat: 0, dLane: 2 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    expect(s.connections.find(c => Math.abs(c.beat - 1.5) < 1e-9)!.lane).toBe(4);
  });

  it('捏形无状态：同一原始 notes + 同一 delta（含 grabBeat）重复裁决结果恒定（按下锁定、不累加）', () => {
    const notes: ChartNote[] = [eased(false)];
    const sel: SelectionItem[] = [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }];
    const d = { dBeat: 0, dLane: 2, grabBeat: 1.25 };
    const a = planDragMove(notes, sel, d, B).notes[0] as SlideNote;
    const b = planDragMove(notes, sel, d, B).notes[0] as SlideNote; // 从同一原始 notes 重算
    expect(b.connections.map(c => c.lane)).toEqual(a.connections.map(c => c.lane));
    expect(b.connections.map(c => c.beat)).toEqual(a.connections.map(c => c.beat));
  });

  it('拨普通段 = 补采样点转化（出生即 SP 段）', () => {
    const notes: ChartNote[] = [slide(1, 0, 2, 0)];
    const r = planDragMove(notes, [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }], { dBeat: 0, dLane: 1 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    expect(s.connections.filter(c => c.hidden).length).toBeGreaterThanOrEqual(8);
    expect(s.spanParams).toBeUndefined();
  });

  it('拖端点 = 移动意图：缓动段按原参数重烘焙（hidden 全程存在、参数保留）', () => {
    const notes: ChartNote[] = [eased(true)];
    // 拖头端点：dBeat=+0.25（1/4 栅格）、dLane=+1
    const r = planDragMove(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 0 }], { dBeat: 0.25, dLane: 1 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    expect(s.connections[0]).toMatchObject({ beat: 1.25, lane: 3 });
    // hidden 点重烘焙后铺满新跨度（0.75 拍 × 1/16 → f=12 → 11 点）
    const hiddens = s.connections.filter(c => c.hidden);
    expect(hiddens.length).toBe(11);
    expect(hiddens[0]!.beat).toBeGreaterThan(1.25);
    // 参数保留（可见数未变）
    expect((s.spanParams?.visibleCount)).toBe(2);
    expect(s.spanParams?.bySpan[0]).toEqual({ kind: 'easing', family: 'quad', type: 'in', precision: 16 });
  });

  it('拖端点 = 自由段相对形态保持（拉伸重映射：hidden 仍夹在新端点之间）', () => {
    const notes: ChartNote[] = [eased(false)];
    const r = planDragMove(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 0 }], { dBeat: 0.25, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    const hiddens = s.connections.filter(c => c.hidden);
    expect(hiddens).toHaveLength(15);
    for (const h of hiddens) {
      expect(h.beat).toBeGreaterThan(1.25 - 1e-9);
      expect(h.beat).toBeLessThan(2 + 1e-9);
    }
  });

  it('验收 #4：拖**上端点**向下（跨度变短 → 重烘焙删采样点）不崩溃、落点正确、选区下标重映射', () => {
    const notes: ChartNote[] = [eased(true)];
    const lastIdx = (notes[0] as SlideNote).connections.length - 1; // = 16
    const r = planDragMove(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: lastIdx }], { dBeat: -0.25, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    // 0.75 拍 × 1/16 → f=12 → 11 hidden + 2 visible = 13 点：旧下标 16 已越界
    expect(s.connections.length).toBe(13);
    expect(s.connections.at(-1)).toMatchObject({ beat: 1.75 });
    // 选区条目指向重烘焙后的新下标（而非越界的 16）
    expect(r.items).toEqual([{ kind: 'slideNode', noteIndex: 0, connIndex: 12 }]);
  });

  it('验收 #4：拖上端点向上（跨度变长 → 重烘焙增采样点）同样按新下标裁决与回写', () => {
    const notes: ChartNote[] = [eased(true)];
    const r = planDragMove(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 16 }], { dBeat: 0.5, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    expect(s.connections.at(-1)).toMatchObject({ beat: 2.5 });
    expect(r.items[0]).toMatchObject({ connIndex: s.connections.length - 1 });
  });

  it('验收 #4：下端点向下拖（远离上端点）不受重烘焙影响，下标保持', () => {
    const notes: ChartNote[] = [eased(true)];
    const r = planDragMove(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 0 }], { dBeat: -0.25, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    expect((r.notes[0] as SlideNote).connections[0]).toMatchObject({ beat: 0.75 });
    expect(r.items[0]).toMatchObject({ connIndex: 0 });
  });

  it('验收 #4：自由段（无参数）拖上端点向下 = 拉伸重映射，不增删点、下标稳定', () => {
    const notes: ChartNote[] = [eased(false)];
    const r = planDragMove(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 16 }], { dBeat: -0.25, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    expect(s.connections.length).toBe(17); // 重映射不改点数
    expect(s.connections.at(-1)).toMatchObject({ beat: 1.75 });
    expect(r.items[0]).toMatchObject({ connIndex: 16 });
  });

  it('混合选区（region + 其它）不 bend：region 条目按不可拖处理，其余照常移动', () => {
    const notes: ChartNote[] = [single(1, 0), eased(false)];
    const r = planDragMove(
      notes,
      [{ kind: 'slideRegion', noteIndex: 1, connIndex: 0 }, { kind: 'note', noteIndex: 0 }],
      { dBeat: 1, dLane: 1 },
      B,
    );
    expect(r.ok).toBe(true);
    expect(r.notes[0]).toEqual(single(2, 1));
    // 滑条未动（bend 未触发：dBeat 分量也不应作用于段内 hidden）
    expect(r.notes[1]).toBe(notes[1]);
  });
});

describe('planDragMove · 整组刚体贴墙（与粘贴同口径）', () => {
  it('多选贴墙：靠墙的停、里面的不继续走，相对 lane 不变', () => {
    const notes: ChartNote[] = [single(1, 0), single(2, 2)];
    const r = planDragMove(notes, noteSel(0, 1), { dBeat: 0, dLane: -3 }, B);
    expect(r.ok).toBe(true);
    expect((r.notes[0] as { lane: number }).lane).toBe(0);
    expect((r.notes[1] as { lane: number }).lane).toBe(2);
  });

  it('整条滑条贴墙：可见包围盒卡住，不夹扁两端', () => {
    const notes: ChartNote[] = [slide(1, 0, 3, 2)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 0, dLane: -1 }, B);
    expect(r.ok).toBe(true);
    expect((r.notes[0] as SlideNote).connections.map(c => c.lane)).toEqual([0, 2]);
  });

  it('只拖一个结点仍可单独夹轨（改形是结点编辑，不是整组平移）', () => {
    const notes: ChartNote[] = [slide(1, 0, 3, 2)];
    const r = planDragMove(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }], { dBeat: 0, dLane: -4 }, B);
    expect(r.ok).toBe(true);
    expect((r.notes[0] as SlideNote).connections.map(c => c.lane)).toEqual([0, 0]);
  });

  it('整条滑条贴墙：hidden 越界相对位置不变', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 1, lane: 0, subBeat: 0 },
        { beat: 2, lane: -0.5, hidden: true, subBeat: 0 },
        { beat: 3, lane: 1, subBeat: 0 },
      ],
    }];
    const r = planDragMove(notes, noteSel(0), { dBeat: 0, dLane: -1 }, { chartEndBeat: 16, beatDisplay: 4 });
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    expect(s.connections.map(c => c.lane)).toEqual([0, -0.5, 1]);
  });

  it('可见包围盒比 7 轨更宽：横向拖整组回弹，不把轨内顶出去', () => {
    const notes: ChartNote[] = [single(1, -1), single(2, 6)];
    const r = planDragMove(notes, noteSel(0, 1), { dBeat: 0, dLane: 1 }, B);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('out-of-bounds');
    expect(r.notes).toBe(notes);
    expect((notes[0] as { lane: number }).lane).toBe(-1);
    expect((notes[1] as { lane: number }).lane).toBe(6);
  });

  it('可见包围盒能放进 0..6：整组刚体滑进合法区', () => {
    const notes: ChartNote[] = [single(1, -1), single(2, 5)];
    const r = planDragMove(notes, noteSel(0, 1), { dBeat: 0, dLane: 1 }, B);
    expect(r.ok).toBe(true);
    expect((r.notes[0] as { lane: number }).lane).toBe(0);
    expect((r.notes[1] as { lane: number }).lane).toBe(6);
  });

  it('放不进时纯纵向拖仍可走', () => {
    const notes: ChartNote[] = [single(1, -1), single(2, 6)];
    const r = planDragMove(notes, noteSel(0, 1), { dBeat: 1, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    expect((r.notes[0] as { beat: number; lane: number }).beat).toBe(2);
    expect((r.notes[1] as { beat: number; lane: number }).beat).toBe(3);
    expect((r.notes[0] as { lane: number }).lane).toBe(-1);
    expect((r.notes[1] as { lane: number }).lane).toBe(6);
  });
});

describe('planDragMove · 同拍中间结点拖动与弱序时序（issue 202）', () => {
  const userSlide = (): ChartNote => ({
    type: 'Slide',
    connections: [
      { beat: 0.5, lane: 5, subBeat: 0 },
      { beat: 0.75, lane: 2, subBeat: 0 },
      { beat: 0.75, lane: 5, subBeat: 0 },
      { beat: 1, lane: 1, subBeat: 0 },
      { beat: 1, lane: 4, subBeat: 0 },
      { beat: 1.25, lane: 3, subBeat: 0 },
    ],
  });

  const nodeItem = (ci: number): SelectionItem => ({ kind: 'slideNode', noteIndex: 0, connIndex: ci });

  it('用例 1（本绿条 4 个中间结点单拖横向变轨）', () => {
    // 结点 1: (0.75, 2) -> lane 3
    const r1 = planDragMove([userSlide()], [nodeItem(1)], { dBeat: 0, dLane: 1 }, B);
    expect(r1.ok).toBe(true);
    expect((r1.notes[0] as SlideNote).connections[1].lane).toBe(3);
    expect((r1.notes[0] as SlideNote).connections[1].beat).toBe(0.75);

    // 结点 2: (0.75, 5) -> lane 4
    const r2 = planDragMove([userSlide()], [nodeItem(2)], { dBeat: 0, dLane: -1 }, B);
    expect(r2.ok).toBe(true);
    expect((r2.notes[0] as SlideNote).connections[2].lane).toBe(4);

    // 结点 3: (1, 1) -> lane 2
    const r3 = planDragMove([userSlide()], [nodeItem(3)], { dBeat: 0, dLane: 1 }, B);
    expect(r3.ok).toBe(true);
    expect((r3.notes[0] as SlideNote).connections[3].lane).toBe(2);

    // 结点 4: (1, 4) -> lane 3
    const r4 = planDragMove([userSlide()], [nodeItem(4)], { dBeat: 0, dLane: -1 }, B);
    expect(r4.ok).toBe(true);
    expect((r4.notes[0] as SlideNote).connections[4].lane).toBe(3);
  });

  it('用例 2（本绿条同拍同轨碰撞回弹 · 策略 A）', () => {
    // 结点 1: (0.75, 2) 移到 lane 5（撞同拍结点 2 的轨道）-> collision
    const r1 = planDragMove([userSlide()], [nodeItem(1)], { dBeat: 0, dLane: 3 }, B);
    expect(r1.ok).toBe(false);
    expect(r1.reason).toBe('collision');

    // 结点 2: (0.75, 5) 移到 lane 2（撞同拍结点 1 的轨道）-> collision
    const r2 = planDragMove([userSlide()], [nodeItem(2)], { dBeat: 0, dLane: -3 }, B);
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe('collision');
  });

  it('用例 3（本绿条纵向弱序边界）', () => {
    const B8 = { chartEndBeat: 16, beatDisplay: 8 };

    // 结点 1 移至 0.625（合法开阔区）
    const rValid = planDragMove([userSlide()], [nodeItem(1)], { dBeat: -0.125, dLane: 0 }, B8);
    expect(rValid.ok).toBe(true);
    expect((rValid.notes[0] as SlideNote).connections[1].beat).toBe(0.625);

    // 结点 1 移至 0.5 (lane 2)，与结点 0 (0.5, lane 5) 同拍不同轨 -> 允许拖成同拍 (Q3)
    const rSameBeat = planDragMove([userSlide()], [nodeItem(1)], { dBeat: -0.25, dLane: 0 }, B8);
    expect(rSameBeat.ok).toBe(true);
    expect((rSameBeat.notes[0] as SlideNote).connections[1].beat).toBe(0.5);

    // 结点 1 移至 0.5 (lane 5)，撞结点 0 (0.5, lane 5) -> collision
    const rCol = planDragMove([userSlide()], [nodeItem(1)], { dBeat: -0.25, dLane: 3 }, B8);
    expect(rCol.ok).toBe(false);
    expect(rCol.reason).toBe('collision');

    // 结点 1 移至 0.375（越过结点 0 beat 0.5）-> issue 220：允许跨越并自动重排
    const rUnder = planDragMove([userSlide()], [nodeItem(1)], { dBeat: -0.375, dLane: 0 }, B8);
    expect(rUnder.ok).toBe(true);
    expect((rUnder.notes[0] as SlideNote).connections[0].beat).toBe(0.375);
    expect((rUnder.notes[0] as SlideNote).connections[1].beat).toBe(0.5);
    expect(rUnder.items[0]).toMatchObject({ connIndex: 0 });

    // 结点 1 移至 0.875（越过同拍伙伴结点 2 beat 0.75）-> issue 220：允许跨越并自动重排
    const rOver = planDragMove([userSlide()], [nodeItem(1)], { dBeat: 0.125, dLane: 0 }, B8);
    expect(rOver.ok).toBe(true);
    expect((rOver.notes[0] as SlideNote).connections[1].beat).toBe(0.75);
    expect((rOver.notes[0] as SlideNote).connections[2].beat).toBe(0.875);
    expect(rOver.items[0]).toMatchObject({ connIndex: 2 });
  });

  it('用例 4（多选组拖联动 · Q4 组内互免）', () => {
    const B8 = { chartEndBeat: 16, beatDisplay: 8 };
    const items = [nodeItem(1), nodeItem(2)];

    // 组拖横向平移 (+1 轨)：(0.75, 2)->3, (0.75, 5)->6
    const rLane = planDragMove([userSlide()], items, { dBeat: 0, dLane: 1 }, B8);
    expect(rLane.ok).toBe(true);
    expect((rLane.notes[0] as SlideNote).connections[1].lane).toBe(3);
    expect((rLane.notes[0] as SlideNote).connections[2].lane).toBe(6);

    // 组拖纵向平移 (+0.125 拍)：(0.75, 2)->0.875, (0.75, 5)->0.875
    const rBeat = planDragMove([userSlide()], items, { dBeat: 0.125, dLane: 0 }, B8);
    expect(rBeat.ok).toBe(true);
    expect((rBeat.notes[0] as SlideNote).connections[1].beat).toBe(0.875);
    expect((rBeat.notes[0] as SlideNote).connections[2].beat).toBe(0.875);

    // 组拖越过外部后邻居结点 3 (beat 1) -> issue 220：允许跨越并自动重排
    const rOver = planDragMove([userSlide()], items, { dBeat: 0.375, dLane: 0 }, B8);
    expect(rOver.ok).toBe(true);
    const connsOver = (rOver.notes[0] as SlideNote).connections;
    expect(connsOver.map(c => c.beat)).toEqual([0.5, 1, 1, 1.125, 1.125, 1.25]);
    expect(rOver.items).toMatchObject([{ connIndex: 3 }, { connIndex: 4 }]);
  });

  it('用例 5（普通滑条吸附成同拍 · Q3 允许）', () => {
    const s = slide(1, 1, 2, 2, 3, 3);
    // 将中间结点 (2, 2) 拖至 beat 1 (lane 4)
    const r = planDragMove([s], [nodeItem(1)], { dBeat: -1, dLane: 2 }, B);
    expect(r.ok).toBe(true);
    expect((r.notes[0] as SlideNote).connections.map(c => [c.beat, c.lane])).toEqual([[1, 1], [1, 4], [3, 3]]);

    // 若拖至 beat 1 (lane 1)，与端点重叠同轨 -> collision
    const rCol = planDragMove([s], [nodeItem(1)], { dBeat: -1, dLane: -1 }, B);
    expect(rCol.ok).toBe(false);
    expect(rCol.reason).toBe('collision');
  });
});

describe('issue 203 · planDragMove 拖段圆滑与三角模式派发', () => {
  const plainSlide = (): ChartNote => ({
    type: 'Slide',
    connections: [{ beat: 1, lane: 2, subBeat: 0 }, { beat: 2, lane: 2, subBeat: 0 }],
  } as ChartNote);

  it('默认或 pinchMode=smooth 传入 pinchCursor 时派发圆滑捏形，曲线穿过光标且无尖角', () => {
    const notes = [plainSlide()];
    const r = planDragMove(
      notes,
      [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }],
      {
        dBeat: 0,
        dLane: 0,
        pinchCursor: { pressBeat: 1.5, pressLane: 2, curBeat: 1.5, curLane: 3.5 },
      },
      B,
    );
    expect(r.ok).toBe(true);
    expect(r.ghost).toBeDefined();
    const s = r.notes[0] as SlideNote;
    const mid = s.connections.find(c => Math.abs(c.beat - 1.5) < 1e-9)!;
    expect(mid.lane).toBeCloseTo(3.5, 6);
  });

  it('连续小数 lane 拖动：即使整轨 dLane=0，只要 pinchCursor 有偏移仍能产生幽灵', () => {
    const notes = [plainSlide()];
    const r = planDragMove(
      notes,
      [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }],
      {
        dBeat: 0,
        dLane: 0,
        pinchCursor: { pressBeat: 1.5, pressLane: 2, curBeat: 1.5, curLane: 2.4 },
      },
      B,
    );
    expect(r.ok).toBe(true);
    expect(r.ghost).toBeDefined();
    const s = r.notes[0] as SlideNote;
    const mid = s.connections.find(c => Math.abs(c.beat - 1.5) < 1e-9)!;
    expect(mid.lane).toBeCloseTo(2.4, 6);
  });

  it('pinchMode=triangle 派发三角捏形，支持小数 exactDLane', () => {
    const notes = [plainSlide()];
    const r = planDragMove(
      notes,
      [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }],
      {
        dBeat: 0,
        dLane: 0,
        pinchMode: 'triangle',
        exactDLane: 1.5,
        grabBeat: 1.5,
      },
      B,
    );
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    const mid = s.connections.find(c => Math.abs(c.beat - 1.5) < 1e-9)!;
    expect(mid.lane).toBeCloseTo(3.5, 9); // 2 + 1.5
  });

  it('非 slideRegion（如普通音符拖拽）不受 pinchMode/pinchCursor 干扰，保持整数 dLane 行为', () => {
    const notes: ChartNote[] = [single(1, 2)];
    const r = planDragMove(
      notes,
      [{ kind: 'note', noteIndex: 0 }],
      {
        dBeat: 1,
        dLane: 2,
        pinchMode: 'smooth',
        pinchCursor: { pressBeat: 1, pressLane: 2, curBeat: 2, curLane: 4 },
      },
      B,
    );
    expect(r.ok).toBe(true);
    expect(r.notes[0]).toMatchObject({ beat: 2, lane: 4 });
  });
});



describe('issue 220 · Slide 结点拖拽跨越邻居与自动重排', () => {
  const issueSlide = (): ChartNote => ({
    type: 'Slide',
    connections: [
      { beat: 4, lane: 2, subBeat: 0 },
      { beat: 6, lane: 0, subBeat: 0 },
      { beat: 6, lane: 3, subBeat: 0, flick: true },
    ],
  });

  const nodeItem = (ci: number): SelectionItem => ({ kind: 'slideNode', noteIndex: 0, connIndex: ci });

  it('用户诉求场景：中间结点 6/L0 向上拖至 beat 7，跨越尾端点 6/L3 并自动重排', () => {
    const notes = [issueSlide()];
    const r = planDragMove(notes, [nodeItem(1)], { dBeat: 1, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    // 重排为 4/L2 -> 6/L3 -> 7/L0
    expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[4, 2], [6, 3], [7, 0]]);
    // 属性各自保留（Q2 对齐 Bestdori）：6/L3 仍保留 flick，7/L0 无 flick
    expect(s.connections[1].flick).toBe(true);
    expect(s.connections[2].flick).toBeUndefined();
    // 选区条目跟踪至新下标 2
    expect(r.items).toEqual([{ kind: 'slideNode', noteIndex: 0, connIndex: 2 }]);
    // 幽灵与结果一致
    expect(r.ghost).toBeDefined();
    expect((r.ghost![0] as SlideNote).connections).toEqual(s.connections);
  });

  it('中间结点 6/L0 向下拖至 beat 3，跨越首端点 4/L2 并自动重排为新起点', () => {
    const notes = [issueSlide()];
    const r = planDragMove(notes, [nodeItem(1)], { dBeat: -3, dLane: 1 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    // 重排为 3/L1 -> 4/L2 -> 6/L3
    expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[3, 1], [4, 2], [6, 3]]);
    // 选区条目跟踪至新下标 0
    expect(r.items).toEqual([{ kind: 'slideNode', noteIndex: 0, connIndex: 0 }]);
    expect(s.connections[2].flick).toBe(true);
  });

  it('尾端点 8/L3 向下拖至 beat 5，跨越中间点 6/L0 成为中间结点（保留 flick 属性）', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 4, lane: 2, subBeat: 0 },
        { beat: 6, lane: 0, subBeat: 0 },
        { beat: 8, lane: 3, subBeat: 0, flick: true },
      ],
    }];
    const r = planDragMove(notes, [nodeItem(2)], { dBeat: -3, dLane: -2 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    // 重排为 4/L2 -> 5/L1 -> 6/L0
    expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[4, 2], [5, 1], [6, 0]]);
    // 原尾端点变成中间结点，其内部属性仍然保留 flick: true（Q2 Bestdori 同构）
    expect(s.connections[1].flick).toBe(true);
    expect(s.connections[2].flick).toBeUndefined();
    // 选区跟踪至新下标 1
    expect(r.items).toEqual([{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }]);
  });

  it('首端点 4/L2 向上拖至 beat 7，跨越中间点 6/L0 成为中间结点', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 4, lane: 2, subBeat: 0 },
        { beat: 6, lane: 0, subBeat: 0 },
        { beat: 8, lane: 3, subBeat: 0 },
      ],
    }];
    const r = planDragMove(notes, [nodeItem(0)], { dBeat: 3, dLane: 0 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    // 重排为 6/L0 -> 7/L2 -> 8/L3
    expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[6, 0], [7, 2], [8, 3]]);
    expect(r.items).toEqual([{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }]);
  });

  it('拖动吸附至同拍不同轨：按原相对数组序稳定排序', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 4, lane: 2, subBeat: 0 },
        { beat: 6, lane: 0, subBeat: 0 },
        { beat: 8, lane: 3, subBeat: 0 },
      ],
    }];
    // 将结点 0 (beat 4) 拖至 beat 6 (lane 4)
    const r = planDragMove(notes, [nodeItem(0)], { dBeat: 2, dLane: 2 }, B);
    expect(r.ok).toBe(true);
    const s = r.notes[0] as SlideNote;
    // 原 index 0 与原 index 1 同在 beat 6，稳定排序按原数组序 0 在前：(6, 4) -> (6, 0) -> (8, 3)
    expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[6, 4], [6, 0], [8, 3]]);
    expect(r.items).toEqual([{ kind: 'slideNode', noteIndex: 0, connIndex: 0 }]);
  });

  it('拖动吸附至同拍同轨：碰撞回弹（策略 A）', () => {
    const notes = [issueSlide()];
    // 将结点 0 (4, 2) 拖至 beat 6, lane 0（撞结点 1）
    const r = planDragMove(notes, [nodeItem(0)], { dBeat: 2, dLane: -2 }, B);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('collision');
  });

  describe('SP 绿条跨越（对标 Bestdori 行为，永不丢弃 hidden 点，保持 SP 绿条）', () => {
    const bestdoriInitialSlide = (): ChartNote => ({
      type: 'Slide',
      connections: [
        { beat: 12, lane: 2 },
        { beat: 12.046875, lane: 2.9528668647301797, hidden: true },
        { beat: 12.09375, lane: 3.789213562373095, hidden: true },
        { beat: 12.140625, lane: 4.410259065022574, hidden: true },
        { beat: 12.1875, lane: 4.75, hidden: true },
        { beat: 12.234375, lane: 4.785259065022574, hidden: true },
        { beat: 12.28125, lane: 4.539213562373095, hidden: true },
        { beat: 12.328125, lane: 4.077866864730179, hidden: true },
        { beat: 12.375, lane: 3.5, hidden: true },
        { beat: 12.421875, lane: 2.9221331352698208, hidden: true },
        { beat: 12.46875, lane: 2.460786437626905, hidden: true },
        { beat: 12.515625, lane: 2.214740934977427, hidden: true },
        { beat: 12.5625, lane: 2.25, hidden: true },
        { beat: 12.609375, lane: 2.589740934977427, hidden: true },
        { beat: 12.65625, lane: 3.210786437626904, hidden: true },
        { beat: 12.703125, lane: 4.047133135269819, hidden: true },
        { beat: 12.75, lane: 5 }, // B
        { beat: 13, lane: 5 },    // C
      ],
    });

    const B16 = { chartEndBeat: 16, beatDisplay: 64 };

    it('Bestdori 分支 1（B > C）：中间点 B(12.75, 5) 拖至 13.25, lane 3（越过 C(13, 5)）', () => {
      const notes = [bestdoriInitialSlide()];
      // B 是 index 16，位移 dBeat: +0.5, dLane: -2 -> (13.25, 3)
      const r = planDragMove(notes, [nodeItem(16)], { dBeat: 0.5, dLane: -2 }, B16);
      expect(r.ok).toBe(true);
      const s = r.notes[0] as SlideNote;

      // 18 个点完整保留（15 个 hidden 点全部都在，不丢弃）
      expect(s.connections.length).toBe(18);
      // 端点 C(13, 5) 穿插进入第 13 位
      expect(s.connections[13]).toMatchObject({ beat: 13, lane: 5 });
      // 尾端点 B(13.25, 3) 移至最末位
      expect(s.connections[17]).toMatchObject({ beat: 13.25, lane: 3 });

      // 采样点坐标与 Bestdori 产出逐点一致（浮点精度 1e-9）
      expect(s.connections[1].beat).toBeCloseTo(12.078125, 9);
      expect(s.connections[1].lane).toBeCloseTo(2.8278668647301797, 9);
      expect(s.connections[6].beat).toBeCloseTo(12.46875, 9);
      expect(s.connections[6].lane).toBeCloseTo(3.789213562373095, 9);
      expect(s.connections[12].beat).toBeCloseTo(12.9375, 9);
      expect(s.connections[12].lane).toBeCloseTo(0.75, 9);
      expect(s.connections[14].beat).toBeCloseTo(13.015625, 9);
      expect(s.connections[14].lane).toBeCloseTo(0.964740934977427, 9);
      expect(s.connections[16].beat).toBeCloseTo(13.171875, 9);
      expect(s.connections[16].lane).toBeCloseTo(2.172133135269819, 9);

      // 选区条目跟踪至新下标 17
      expect(r.items).toEqual([{ kind: 'slideNode', noteIndex: 0, connIndex: 17 }]);
    });

    it('Bestdori 分支 2（C < B）：端点 C(13, 5) 拖至 12.25, lane 6（穿插进 A 与 B 之间）', () => {
      const notes = [bestdoriInitialSlide()];
      // C 是 index 17，位移 dBeat: -0.75, dLane: +1 -> (12.25, 6)
      const r = planDragMove(notes, [nodeItem(17)], { dBeat: -0.75, dLane: 1 }, B16);
      expect(r.ok).toBe(true);
      const s = r.notes[0] as SlideNote;

      expect(s.connections.length).toBe(18);
      // C(12.25, 6) 排序在第 6 位（插在 12.234375 与 12.28125 之间）
      expect(s.connections[6]).toMatchObject({ beat: 12.25, lane: 6 });
      expect(s.connections[17]).toMatchObject({ beat: 12.75, lane: 5 });
      // 其余 hidden 点完全不变
      expect(s.connections[1].beat).toBeCloseTo(12.046875, 9);
      expect(s.connections[5].beat).toBeCloseTo(12.234375, 9);
      expect(s.connections[7].beat).toBeCloseTo(12.28125, 9);

      // 选区条目跟踪至新下标 6
      expect(r.items).toEqual([{ kind: 'slideNode', noteIndex: 0, connIndex: 6 }]);
    });

    it('Bestdori 分支 3（C < A）：端点 C(13, 5) 拖至 11.75, lane 5（拖到 A 之前）', () => {
      const notes = [bestdoriInitialSlide()];
      // C 是 index 17，位移 dBeat: -1.25, dLane: 0 -> (11.75, 5)
      const r = planDragMove(notes, [nodeItem(17)], { dBeat: -1.25, dLane: 0 }, B16);
      expect(r.ok).toBe(true);
      const s = r.notes[0] as SlideNote;

      expect(s.connections.length).toBe(18);
      // C 成为首端点
      expect(s.connections[0]).toMatchObject({ beat: 11.75, lane: 5 });
      expect(s.connections[1]).toMatchObject({ beat: 12, lane: 2 });
      expect(s.connections[17]).toMatchObject({ beat: 12.75, lane: 5 });

      // 选区条目跟踪至新下标 0
      expect(r.items).toEqual([{ kind: 'slideNode', noteIndex: 0, connIndex: 0 }]);
    });

    it('场景 1（两端点 SP 曲线反向拖拽）：终点拖到起点之前，hidden 曲线点完整保留并反向拉伸', () => {
      const conns: ConnectionNote[] = [
        { beat: 1, lane: 2, subBeat: 0 },
      ];
      for (let p = 1; p < 16; p++) {
        conns.push({ beat: 1 + p / 16, lane: 2, subBeat: 0, hidden: true });
      }
      conns.push({ beat: 2, lane: 2, subBeat: 0 });

      const curveSlide: ChartNote = {
        type: 'Slide',
        connections: conns,
      };

      // 拖动尾端点 (connIndex 16) 向下跨越至 0.5（跨越首端点 beat 1）
      const rCross = planDragMove([curveSlide], [nodeItem(16)], { dBeat: -1.5, dLane: 0 }, B);
      expect(rCross.ok).toBe(true);
      const s = rCross.notes[0] as SlideNote;

      // 15 个 hidden 采样点全部保留，总点数 17
      expect(s.connections.length).toBe(17);
      // 重排后 0.5 成为新起点，1.0 成为新终点
      expect(s.connections[0].beat).toBe(0.5);
      expect(s.connections[16].beat).toBe(1);
      // 中间所有 hidden 点均介于 0.5 与 1 之间
      for (let i = 1; i < 16; i++) {
        expect(s.connections[i].hidden).toBe(true);
        expect(s.connections[i].beat).toBeGreaterThan(0.5);
        expect(s.connections[i].beat).toBeLessThan(1);
      }
      // 选区条目跟踪至新下标 0
      expect(rCross.items).toEqual([{ kind: 'slideNode', noteIndex: 0, connIndex: 0 }]);
    });
  });

  it('超出谱面起止时间：out-of-bounds 回弹', () => {
    const notes = [issueSlide()];
    // 拖至负拍位
    const rNeg = planDragMove(notes, [nodeItem(0)], { dBeat: -5, dLane: 0 }, B);
    expect(rNeg.ok).toBe(false);
    expect(rNeg.reason).toBe('out-of-bounds');

    // 拖至超出 chartEndBeat (16)
    const rOver = planDragMove(notes, [nodeItem(2)], { dBeat: 11, dLane: 0 }, B);
    expect(rOver.ok).toBe(false);
    expect(rOver.reason).toBe('out-of-bounds');
  });
});

describe('planDragMove · 框选预存重叠音符整组拖拽（issue 224）', () => {
  it('框选两个预存重叠单键，平移到空位 → ok: true，不发生 collision 回弹', () => {
    const notes: ChartNote[] = [
      { type: 'Single', beat: 1, lane: 2, subBeat: 0 },
      { type: 'Single', beat: 1, lane: 2, subBeat: 0, flick: true },
    ];
    const items: SelectionItem[] = [
      { kind: 'note', noteIndex: 0 },
      { kind: 'note', noteIndex: 1 },
    ];
    const r = planDragMove(notes, items, { dBeat: 1, dLane: 1 }, B);
    expect(r.ok).toBe(true);
    expect(r.notes).toHaveLength(2);
    expect(r.notes[0]).toMatchObject({ beat: 2, lane: 3 });
    expect(r.notes[0].flick).toBeUndefined();
    expect(r.notes[1]).toMatchObject({ beat: 2, lane: 3, flick: true });
    expect(r.items).toHaveLength(2);
  });

  it('框选两个预存重叠单键，平移到既有单键位置 → 既有单键被覆盖替换', () => {
    const notes: ChartNote[] = [
      { type: 'Single', beat: 1, lane: 2, subBeat: 0 },
      { type: 'Single', beat: 1, lane: 2, subBeat: 0, flick: true },
      { type: 'Single', beat: 2, lane: 3, subBeat: 0 }, // 目标位置既有单键
    ];
    const items: SelectionItem[] = [
      { kind: 'note', noteIndex: 0 },
      { kind: 'note', noteIndex: 1 },
    ];
    const r = planDragMove(notes, items, { dBeat: 1, dLane: 1 }, B);
    expect(r.ok).toBe(true);
    // 既有单键被替换，只保留拖拽过来的 2 个重叠单键
    expect(r.notes).toHaveLength(2);
    expect(r.notes[0]).toMatchObject({ beat: 2, lane: 3 });
    expect(r.notes[1]).toMatchObject({ beat: 2, lane: 3, flick: true });
  });
  it('框选两个预存重叠单键，平移到既有滑条端点 → 滑条拆条，拖拽重叠单键落子', () => {
    const notes: ChartNote[] = [
      { type: 'Single', beat: 1, lane: 2, subBeat: 0 },
      { type: 'Single', beat: 1, lane: 2, subBeat: 0, flick: true },
      {
        type: 'Slide',
        connections: [
          { beat: 2, lane: 3, subBeat: 0 },
          { beat: 3, lane: 3, subBeat: 0 },
        ],
      },
    ];
    const items: SelectionItem[] = [
      { kind: 'note', noteIndex: 0 },
      { kind: 'note', noteIndex: 1 },
    ];
    const r = planDragMove(notes, items, { dBeat: 1, dLane: 1 }, B);
    expect(r.ok).toBe(true);
    // 滑条端点被拆，剩下一个退化单键 (3, 3)，以及落地的两个重叠单键 (2, 3)
    expect(r.notes).toHaveLength(3);
    const at23 = r.notes.filter(n => (n as any).beat === 2 && (n as any).lane === 3);
    expect(at23).toHaveLength(2);
    const at33 = r.notes.filter(n => (n as any).beat === 3 && (n as any).lane === 3);
    expect(at33).toHaveLength(1);
    expect(at33[0].type).toBe('Single');
  });

  it('框选两个预存重叠单键，平移到既有滑条中间结点 → 滑条拆为两段', () => {
    const notes: ChartNote[] = [
      { type: 'Single', beat: 1, lane: 2, subBeat: 0 },
      { type: 'Single', beat: 1, lane: 2, subBeat: 0, flick: true },
      {
        type: 'Slide',
        connections: [
          { beat: 1.5, lane: 3, subBeat: 0 },
          { beat: 2, lane: 3, subBeat: 0 },
          { beat: 3, lane: 3, subBeat: 0 },
        ],
      },
    ];
    const items: SelectionItem[] = [
      { kind: 'note', noteIndex: 0 },
      { kind: 'note', noteIndex: 1 },
    ];
    const r = planDragMove(notes, items, { dBeat: 1, dLane: 1 }, B);
    expect(r.ok).toBe(true);
    // 中间结点被拆，首尾两端各退化为单键 (1.5, 3) 和 (3, 3)，以及落地的两个重叠单键 (2, 3)
    expect(r.notes).toHaveLength(4);
    const at23 = r.notes.filter(n => (n as any).beat === 2 && (n as any).lane === 3);
    expect(at23).toHaveLength(2);
  });

  it('拖拽单个单键到既有多重重叠音符（单键+滑条端点）位置 → 完全替换既有重叠组', () => {
    const notes: ChartNote[] = [
      { type: 'Single', beat: 1, lane: 2, subBeat: 0 },
      { type: 'Single', beat: 2, lane: 3, subBeat: 0 },
      {
        type: 'Slide',
        connections: [
          { beat: 2, lane: 3, subBeat: 0 },
          { beat: 4, lane: 3, subBeat: 0 },
        ],
      },
    ];
    const items: SelectionItem[] = [{ kind: 'note', noteIndex: 0 }];
    const r = planDragMove(notes, items, { dBeat: 1, dLane: 1 }, B);
    expect(r.ok).toBe(true);
    // (2, 3) 的既有单键被移除，滑条端点被拆（剩余 (4, 3) 退化为单键），落地的单个单键占据 (2, 3)
    expect(r.notes).toHaveLength(2);
    const at23 = r.notes.filter(n => (n as any).beat === 2 && (n as any).lane === 3);
    expect(at23).toHaveLength(1);
    expect(at23[0]).toMatchObject({ beat: 2, lane: 3, type: 'Single' });
    const at43 = r.notes.filter(n => (n as any).beat === 4 && (n as any).lane === 3);
    expect(at43).toHaveLength(1);
    expect(at43[0]).toMatchObject({ beat: 4, lane: 3, type: 'Single' });
  });

});

describe('issue 225 · planDragMove 拖动镜像后的模板滑条端点保持镜像侧', () => {
  it('镜像模板滑条（arc）后拖动端点：planDragMove 重新烘焙的采样点保持在镜像侧', () => {
    // 初始 arc 模板（弧线向右拱起，lane > 1）
    const slideNote = buildChainedSlide(
      [{ beat: 1, lane: 1 }, { beat: 3, lane: 1 }],
      { 0: { kind: 'template', templateId: 'arc', precision: 16 } },
      4,
    );
    // 镜像：lane 1 -> 5，弧线向左拱起（lane < 5）
    const mirrored = mirrorNote(slideNote) as SlideNote;
    const notes = [mirrored];
    // 拖动终点（nodeIndex: 0, connIndex: mirrored.connections.length - 1），位移 dBeat: +1, dLane: 0
    const endConnIndex = mirrored.connections.length - 1;
    const r = planDragMove(
      notes,
      [{ kind: 'slideNode', noteIndex: 0, connIndex: endConnIndex }],
      { dBeat: 1, dLane: 0 },
      B,
    );
    expect(r.ok).toBe(true);
    const resultSlide = r.notes[0] as SlideNote;
    // 终点移至 beat 4
    expect(resultSlide.connections[resultSlide.connections.length - 1].beat).toBe(4);
    // 重投影后的内部采样点（如中点 beat 2.5）依然向左拱起（lane < 5），不能反弹
    const mid = resultSlide.connections.find((c) => c.hidden && Math.abs(c.beat - 2.5) < 1e-5)!;
    expect(mid).toBeDefined();
    expect(mid.lane).toBeLessThan(5);
    expect(resultSlide.spanParams?.bySpan[0]).toEqual({
      kind: 'template',
      templateId: 'arc',
      precision: 16,
      mirrored: true,
    });
  });
});
