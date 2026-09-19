// ADR-0008 §6：指针态拖拽移动（planDragMove/draggableFromItems）。Issue 55。
import { describe, it, expect } from 'vitest';
import type { ChartNote, SelectionItem, SlideNote } from '@/src/chart/types';
import { planDragMove, draggableFromItems, dragDeltaBeat, itemTrueBeat } from '@/src/chart/editing/NoteDragging';

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

  it('组拖两件落**同一个**落点 → 回弹（claimed 互撞，与单规则无关）', () => {
    const notes: ChartNote[] = [skill(1, 1), skill(1, 1 + 0), slide(3, 1, 5, 1)];
    const r = planDragMove(notes, noteSel(0, 1), { dBeat: 2, dLane: 0 }, B);
    expect(r.ok).toBe(false);
  });

  it('覆盖落点也有**幽灵**：ghost = 被拖音符的落点形态（issue 76 二轮）', () => {
    const notes: ChartNote[] = [skill(1, 1), slide(3, 2, 5, 2)];
    const r = planDragMove(notes, noteSel(0), { dBeat: 2, dLane: 1 }, B);
    expect(r.ok).toBe(true);
    expect(r.ghost).toHaveLength(1);
    expect(r.ghost![0]).toMatchObject({ type: 'Single', beat: 3, lane: 2, skill: true });
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

  it('右方向键：根轨本身出界才回弹（组尾不是判据）', () => {
    const notes: ChartNote[] = [dir('RDirectional', 1, 3, 3)];
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: 4 }, B).reason).toBe('out-of-bounds'); // 根 7 出界
  });

  it('左方向键 length=3：同理，向 -1 溢出合法，根轨出界才非法', () => {
    const notes: ChartNote[] = [dir('LDirectional', 1, 3, 3)]; // 占 3/2/1
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: -1 }, B).ok).toBe(true);  // 根 2 → 占 2/1/0
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: -2 }, B).ok).toBe(true);  // 根 1 → 组尾 -1 溢出，仍合法
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: -3 }, B).ok).toBe(true);  // 根 0 → 组尾 -2 溢出，仍合法
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: -4 }, B).reason).toBe('out-of-bounds'); // 根 -1 出界
  });

  it('单键仍是"自身轨道出界即非法"（只有方向键有组尾豁免）', () => {
    const notes: ChartNote[] = [single(1, 6)];
    expect(planDragMove(notes, noteSel(0), { dBeat: 0, dLane: 1 }, B).reason).toBe('out-of-bounds'); // lane 7
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
