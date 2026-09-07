// ADR-0008 阶段1/4 纯模块接缝：键型批量框选、批量后选区重映射、拖拽移动落点判定。
import { describe, it, expect } from 'vitest';
import type { ChartNote, SelectionItem, SlideNote } from '../../src/chart/types';
import { keyTargetsFromItems, batchApplyKeyType } from '../../src/chart/editing/NoteReplacementRules';
import { remapSelection } from '../../src/chart/editing/SelectionEditing';
import { planDragMove, draggableFromItems } from '../../src/chart/editing/NoteDragging';

const single = (beat: number, lane: number, extra: Partial<ChartNote> = {}): ChartNote =>
  ({ type: 'Single', beat, lane, subBeat: 0, ...extra } as ChartNote);
const flick = (beat: number, lane: number): ChartNote => single(beat, lane, { flick: true });
const skill = (beat: number, lane: number): ChartNote => single(beat, lane, { skill: true });
const dirL = (beat: number, lane: number, length = 1): ChartNote =>
  ({ type: 'LDirectional', beat, lane, subBeat: 0, length });
const slide = (...flat: number[]): ChartNote => {
  const connections = [];
  for (let i = 0; i < flat.length; i += 2) connections.push({ beat: flat[i], lane: flat[i + 1], subBeat: 0 });
  return { type: 'Slide', connections };
};
const noteSel = (...idxs: number[]): SelectionItem[] => idxs.map(i => ({ kind: 'note' as const, noteIndex: i }));

// ---------------- keyTargetsFromItems ----------------
describe('keyTargetsFromItems（键型框选落点提取）', () => {
  it('键型音符取自身位置；BPM/System/整条滑条/slideRegion 跳过；slideNode 取结点位置', () => {
    const notes: ChartNote[] = [
      single(1, 2),            // 0 键型 ✓
      { type: 'BPM', beat: 2, bpm: 120 },        // 1 跳过
      slide(3, 1, 4, 2),       // 2 整条滑条 kind:'note' 跳过
      dirL(5, 0),              // 3 键型 ✓
      { type: 'System', beat: 6, data: 'x' },    // 4 跳过
    ];
    const items: SelectionItem[] = [
      ...noteSel(0, 1, 2, 3, 4),
      { kind: 'slideNode', noteIndex: 2, connIndex: 1 },  // 滑条第2结点 ✓
      { kind: 'slideRegion', noteIndex: 2, connIndex: 0 },// 跳过
    ];
    expect(keyTargetsFromItems(notes, items)).toEqual([
      { beat: 1, lane: 2, subBeat: 0 },
      { beat: 5, lane: 0, subBeat: 0 },
      { beat: 4, lane: 2, subBeat: 0 },
    ]);
  });
});

// ---------------- batchApplyKeyType ----------------
describe('batchApplyKeyType（框内逐个应用 ADR-0001 替换规则）', () => {
  it('单键工具框选含空位+单键+方向键：空位新增、单键替换、方向键覆盖', () => {
    const notes: ChartNote[] = [single(1, 1), dirL(2, 2, 2)];
    const r = batchApplyKeyType(notes, [
      { beat: 0, lane: 0, subBeat: 0 },  // 空位 → 新增
      { beat: 1, lane: 1, subBeat: 0 },  // 单键 → 替换（同型仍替换）
      { beat: 2, lane: 2, subBeat: 0 },  // 方向键 → 替换为单键
    ], 'single');
    expect(r.shouldReplace).toBe(true);
    expect(r.newNotes.filter(n => n.type === 'Single').length).toBe(3);
    expect(r.newNotes.find(n => n.type === 'LDirectional')).toBeUndefined();
  });

  it('滑键框选滑条结点：尾部端点加 flick、中间/头部忽略（ADR-0001 §1.2 表）', () => {
    const notes: ChartNote[] = [single(0, 3), slide(1, 1, 2, 2, 3, 3)]; // 结点 1,1 / 2,2(中) / 3,3(尾)
    const r = batchApplyKeyType(notes, [
      { beat: 1, lane: 1, subBeat: 0 },
      { beat: 2, lane: 2, subBeat: 0 },
      { beat: 3, lane: 3, subBeat: 0 },
    ], 'flick');
    const s = r.newNotes.find(n => n.type === 'Slide') as SlideNote;
    expect(s.connections.map(c => !!c.flick)).toEqual([false, false, true]);
  });

  it('技能键框选：两端加 skill、中间忽略', () => {
    const notes: ChartNote[] = [slide(1, 1, 2, 2, 3, 3)];
    const r = batchApplyKeyType(notes, [
      { beat: 1, lane: 1, subBeat: 0 },
      { beat: 2, lane: 2, subBeat: 0 },
      { beat: 3, lane: 3, subBeat: 0 },
    ], 'skill');
    const s = r.newNotes.find(n => n.type === 'Slide') as SlideNote;
    expect(s.connections.map(c => !!c.skill)).toEqual([true, false, true]);
  });

  it('无可应用落点（如单键框选全是滑条结点）→ shouldReplace=false 且返回原数组引用', () => {
    const notes: ChartNote[] = [slide(1, 1, 2, 2)];
    const targets = [{ beat: 1, lane: 1, subBeat: 0 }, { beat: 2, lane: 2, subBeat: 0 }];
    const r = batchApplyKeyType(notes, targets, 'single');
    expect(r.shouldReplace).toBe(false);
    expect(r.newNotes).toBe(notes);
  });

  it('方向键框选中间结点 → 拆条生效：左右各 1 结点退化为独立音符 + 方向键本体', () => {
    const notes: ChartNote[] = [slide(1, 1, 2, 2, 3, 3)];
    const r = batchApplyKeyType(notes, [{ beat: 2, lane: 2, subBeat: 0 }], 'ldirectional');
    expect(r.shouldReplace).toBe(true);
    expect(r.newNotes.some(n => n.type === 'LDirectional')).toBe(true);
    expect(r.newNotes.filter(n => n.type === 'Slide').length).toBe(0);
    expect(r.newNotes.filter(n => n.type === 'Single').length).toBe(2); // 两侧退化
  });

  it('无就地变异：入参数组不被改动', () => {
    const notes: ChartNote[] = [single(1, 1)];
    const snap = [...notes];
    batchApplyKeyType(notes, [{ beat: 2, lane: 2, subBeat: 0 }], 'flick');
    expect(notes).toEqual(snap);
  });
});

// ---------------- remapSelection ----------------
describe('remapSelection（批量后选区按位置迁移）', () => {
  it('键型音符批量替换后下标不变 → 选择保留', () => {
    const old = [single(1, 1), single(2, 2)];
    const next = [flick(1, 1), flick(2, 2)];
    expect(remapSelection(old, noteSel(0, 1), next)).toEqual(noteSel(0, 1));
  });

  it('被消耗的音符（组合/删除）从选区丢弃', () => {
    const old = [single(1, 1), single(2, 2), single(3, 3)];
    const next = [slide(1, 1, 2, 2, 3, 3)]; // 三个键被组合消耗
    expect(remapSelection(old, noteSel(0, 1, 2), next)).toEqual([]);
  });

  it('整条滑条选择 → 起始结点仍在同一条滑条起点则保留', () => {
    const old: ChartNote[] = [single(0, 0), slide(1, 1, 2, 2)];
    const next: ChartNote[] = [flick(0, 0), slide(1, 1, 2, 2)];
    expect(remapSelection(old, noteSel(1), next)).toEqual(noteSel(1));
  });

  it('slideNode → 滑条拆条后迁移到新宿主滑条下标', () => {
    const old: ChartNote[] = [slide(1, 1, 2, 2, 3, 3)];
    const next: ChartNote[] = [slide(1, 1, 2, 2), dirL(2, 2), slide(3, 3, 4, 3)]; // 示意：中间结点独立化
    const items: SelectionItem[] = [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }];
    const remapped = remapSelection(old, items, next);
    expect(remapped).toEqual([{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }]);
  });

  it('slideRegion：两段结点仍同条相邻才保留', () => {
    const old: ChartNote[] = [slide(1, 1, 2, 2, 3, 3)];
    const items: SelectionItem[] = [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }];
    const kept = remapSelection(old, items, [slide(1, 1, 2, 2, 3, 3)]);
    expect(kept).toEqual(items);
    const dropped = remapSelection(old, items, [slide(1, 1), single(2, 2)]); // 拆散
    expect(dropped).toEqual([]);
  });

  it('BPM 选择按 type+beat 迁移（前面插入音符导致下标移动）', () => {
    const old: ChartNote[] = [{ type: 'BPM', beat: 0, bpm: 120 }, single(1, 1)];
    const next: ChartNote[] = [single(0, 5), { type: 'BPM', beat: 0, bpm: 120 }, single(1, 1)];
    expect(remapSelection(old, noteSel(0), next)).toEqual(noteSel(1));
  });
});

// ---------------- planDragMove / draggableFromItems ----------------
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

const B = { chartEndBeat: 16 };

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
