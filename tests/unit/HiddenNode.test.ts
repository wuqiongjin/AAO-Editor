// issue 77：Hidden 结点的两处缺陷（跨模块，集中在一处锁）
//   #8 拖拽占位：`planDragMove` 的占位表没跳过 hidden → 拖任何音符到 hidden 所在位置都回弹
//   #9 拆条：hidden 被当成"段"的分界 → 一条 [A, hidden, B] 被切成两截，
//       且切完 hidden 会留在新段的首/尾（ADR-0001 §1.2：首尾结点不得 hidden → 产出非法谱面）
import { describe, it, expect } from 'vitest';
import type { ChartNote, SlideNote } from '../../src/chart/types';
import { planDragMove } from '../../src/chart/editing/NoteDragging';
import { deleteSelection, copySelection, mirrorSelection } from '../../src/chart/editing/SelectionEditing';
import { findNoteIndexAt, handleNoteReplacement } from '../../src/chart/editing/NoteReplacementRules';
import { convertNotesToChartCode, validateChartCode } from '../../src/chart/editing/ChartConverter';

interface C { beat: number; lane: number; hidden?: boolean }

const single = (beat: number, lane: number): ChartNote =>
  ({ type: 'Single', beat, lane, subBeat: 0 } as ChartNote);

const slideOf = (...cs: C[]): ChartNote => ({
  type: 'Slide',
  connections: cs.map(c => ({ beat: c.beat, lane: c.lane, subBeat: 0, ...(c.hidden ? { hidden: true } : {}) })),
});

const BOUNDS = { chartEndBeat: 16, beatDisplay: 4 };
const noteSel = (noteIndex: number) => [{ kind: 'note' as const, noteIndex }];

/** 谱面合法性闸门（含 beat0 BPM，与 ChartCodeValidation 同口径） */
const validChart = (notes: readonly ChartNote[]) =>
  validateChartCode(convertNotesToChartCode([{ type: 'BPM', beat: 0, bpm: 120 } as ChartNote, ...notes]));

describe('issue 77 #8 · hidden 结点不占位（拖拽）', () => {
  it('拖单键到 hidden 中间结点所在位置 → 允许落点，hidden 本身不受影响', () => {
    const notes = [single(1, 2), slideOf({ beat: 3, lane: 2 }, { beat: 4, lane: 2, hidden: true }, { beat: 5, lane: 2 })];
    // 修复前：占位表把 hidden 算作占用 → collision 回弹
    const r = planDragMove(notes, noteSel(0), { dBeat: 3, dLane: 0 }, BOUNDS);
    expect(r.ok).toBe(true);

    const moved = r.notes.find(n => n.type === 'Single') as { beat: number; lane: number };
    expect([moved.beat, moved.lane]).toEqual([4, 2]); // 正落在 hidden 结点处

    const s = r.notes.find(n => n.type === 'Slide') as SlideNote;
    expect(s.connections.map(c => c.hidden === true)).toEqual([false, true, false]); // hidden 仍在原位
  });

  it('回归：拖到**可见**滑条结点上仍然回弹（§6 裁决表不变）', () => {
    const notes = [single(1, 2), slideOf({ beat: 3, lane: 2 }, { beat: 4, lane: 2 })];
    const r = planDragMove(notes, noteSel(0), { dBeat: 3, dLane: 0 }, BOUNDS);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('collision');
  });
});

describe('issue 77 #9 · hidden 不参与拆条（删除 / 放置）', () => {
  // issue 80 定案：**段内含 hidden → 只清掉段内的 hidden**，段本身保留、两端点直连
  // （取代 77 #9 的"可见结点 ≤ 2 时删整条"那条口径）
  it('删除 [A, hidden, B] 的任一段 → 只删 hidden，变成 A→B 普通 Slide', () => {
    const notes = [slideOf({ beat: 1, lane: 1 }, { beat: 2, lane: 1, hidden: true }, { beat: 3, lane: 1 })];
    for (const connIndex of [0, 1]) { // 两个 region（A→H / H→B）都归到同一条可见段
      const out = deleteSelection(notes, [{ kind: 'slideRegion', noteIndex: 0, connIndex }]);
      expect(out).toHaveLength(1);
      const s = out[0] as SlideNote;
      expect(s.type).toBe('Slide');
      expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[1, 1], [3, 1]]); // A→B 直连，H 已删
      expect(s.connections.some(c => c.hidden)).toBe(false);
      expect(validChart(out).valid).toBe(true);
    }
  });

  it('删除 [A, hidden1, hidden2, B] 的任一段 → 两个 hidden 一起删，剩下 A→B', () => {
    const notes = [
      slideOf({ beat: 1, lane: 1 }, { beat: 2, lane: 2, hidden: true }, { beat: 3, lane: 3, hidden: true }, { beat: 4, lane: 4 }),
    ];
    for (const connIndex of [0, 1, 2]) {
      const out = deleteSelection(notes, [{ kind: 'slideRegion', noteIndex: 0, connIndex }]);
      expect(out).toHaveLength(1);
      expect(((out[0] as SlideNote).connections).map(c => [c.beat, c.lane])).toEqual([[1, 1], [4, 4]]);
      expect(validChart(out).valid).toBe(true);
    }
  });

  it('删除 [A, hidden, B, C] 的 A→H→B 段 → 只删 H，变成 [A, B, C]（段保留）', () => {
    const notes = [
      slideOf({ beat: 1, lane: 1 }, { beat: 2, lane: 2, hidden: true }, { beat: 3, lane: 3 }, { beat: 4, lane: 4 }),
    ];
    const out = deleteSelection(notes, [{ kind: 'slideRegion', noteIndex: 0, connIndex: 1 }]);
    expect(out).toHaveLength(1);
    const s = out[0] as SlideNote;
    expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[1, 1], [3, 3], [4, 4]]);
    expect(validChart(out).valid).toBe(true);
  });

  it('回归：段上**无** hidden 时仍按原拆条语义（[A, H, B, C] 删 B→C → [A,H,B] + [C]）', () => {
    const notes = [
      slideOf({ beat: 1, lane: 1 }, { beat: 2, lane: 2, hidden: true }, { beat: 3, lane: 3 }, { beat: 4, lane: 4 }),
    ];
    const out = deleteSelection(notes, [{ kind: 'slideRegion', noteIndex: 0, connIndex: 2 }]); // B→C（无 hidden）
    expect(out).toHaveLength(2);
    const left = out[0] as SlideNote;
    expect(left.connections.map(c => [c.beat, c.lane])).toEqual([[1, 1], [2, 2], [3, 3]]); // H 仍留在左段内部
    expect(left.connections[1].hidden).toBe(true);
    expect(out[1].type).toBe('Single');
    expect(validChart(out).valid).toBe(true);
  });

  it('回归：[A, B]（无 hidden）删段 → A、B 各自退化为单键', () => {
    const notes = [slideOf({ beat: 1, lane: 1 }, { beat: 3, lane: 3 })];
    const out = deleteSelection(notes, [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }]);
    expect(out).toHaveLength(2);
    expect(out.map(n => n.type)).toEqual(['Single', 'Single']);
  });

  // issue 80 定案：**删结点**三例与当前一致 —— 端点 + 相连段（含段内 hidden）一起走，另一端点退化
  it('删端点：A→H→B 删 A → B 退化为单键（H 随段消失）', () => {
    const notes = [slideOf({ beat: 1, lane: 1 }, { beat: 2, lane: 2, hidden: true }, { beat: 3, lane: 3 })];
    const out = deleteSelection(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 0 }]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('Single');
    expect((out[0] as { beat: number }).beat).toBe(3);
    expect(validChart(out).valid).toBe(true);
  });

  it('删端点：A→H→B→C 删 A → 滑条 [B, C]（H 不作段首）', () => {
    const notes = [
      slideOf({ beat: 1, lane: 1 }, { beat: 2, lane: 2, hidden: true }, { beat: 3, lane: 3 }, { beat: 4, lane: 4 }),
    ];
    const out = deleteSelection(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 0 }]);
    expect(out).toHaveLength(1);
    expect(((out[0] as SlideNote).connections).map(c => [c.beat, c.lane])).toEqual([[3, 3], [4, 4]]);
    expect(validChart(out).valid).toBe(true);
  });

  it('删中间**可见**结点 → 原位转 hidden（issue 92 定案；既有 hidden 不误删）', () => {
    const notes = [
      slideOf({ beat: 1, lane: 1 }, { beat: 2, lane: 2, hidden: true }, { beat: 3, lane: 3 }, { beat: 4, lane: 4 }),
    ];
    const out = deleteSelection(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 2 }]); // 删 B
    expect(out).toHaveLength(1);
    const s = out[0] as SlideNote;
    expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4]]); // 结点一个不少
    expect(s.connections.map(c => c.hidden === true)).toEqual([false, true, true, false]); // A 可见，旧 H 保留，B 原位转 hidden，C 可见
    expect(validChart(out).valid).toBe(true);
  });

  it('移除 hidden 结点本身 → 段保持连接，产物合法', () => {
    const notes = [slideOf({ beat: 1, lane: 1 }, { beat: 2, lane: 2, hidden: true }, { beat: 3, lane: 3 })];
    const out = deleteSelection(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }]);
    expect(out).toHaveLength(1);
    expect((out[0] as SlideNote).connections.map(c => c.beat)).toEqual([1, 3]);
    expect(validChart(out).valid).toBe(true);
  });

  it('findNoteIndexAt 跳过 hidden：hidden 所在位置 = 空位', () => {
    const notes = [slideOf({ beat: 1, lane: 1 }, { beat: 2, lane: 2, hidden: true }, { beat: 3, lane: 3 })];
    expect(findNoteIndexAt(notes, 2, 2, 0)).toBe(-1); // hidden 结点
    expect(findNoteIndexAt(notes, 1, 1, 0)).toBe(0);  // 可见端点照常命中
  });

  it('方向键放到 hidden 结点位置 → 视为空位新增，不再以 hidden 为支点拆条', () => {
    const notes = [slideOf({ beat: 1, lane: 1 }, { beat: 2, lane: 2, hidden: true }, { beat: 3, lane: 3 })];
    const r = handleNoteReplacement(notes, 2, 2, 0, 'rdirectional');
    expect(r.shouldReplace).toBe(true);
    expect(r.newNotes.filter(n => n.type === 'Slide')).toHaveLength(1); // 原滑条完整保留
    expect(r.newNotes.some(n => n.type === 'RDirectional')).toBe(true);
    expect(validChart(r.newNotes).valid).toBe(true);
  });

  // issue 77 二轮：段 = 逻辑段（跨过 hidden 的整段）→ 复制 / 镜像都按整段处理
  it('#9 二轮：复制「段」= 整段（含段内 hidden）；镜像「段」= 整段一起翻', () => {
    const notes = [slideOf({ beat: 1, lane: 1 }, { beat: 2, lane: 2, hidden: true }, { beat: 3, lane: 3 })];
    const items = [{ kind: 'slideRegion' as const, noteIndex: 0, connIndex: 0 }];

    const clip = copySelection(notes, items);
    expect(clip).toHaveLength(1);
    const clipSlide = clip[0] as SlideNote;
    expect(clipSlide.connections.map(c => [c.beat, c.lane])).toEqual([[1, 1], [2, 2], [3, 3]]); // 整段含 hidden
    expect(clipSlide.connections[1].hidden).toBe(true);

    const mirrored = mirrorSelection(notes, items) as SlideNote[];
    expect(mirrored[0].connections.map(c => c.lane)).toEqual([5, 4, 3]); // 整段一起镜像
  });

  it('回归：无 hidden 的滑条拆条语义不变（4 结点删中间段 → 两段各 2 结点）', () => {
    const notes = [slideOf({ beat: 1, lane: 1 }, { beat: 2, lane: 2 }, { beat: 3, lane: 3 }, { beat: 4, lane: 4 })];
    const out = deleteSelection(notes, [{ kind: 'slideRegion', noteIndex: 0, connIndex: 1 }]);
    expect(out).toHaveLength(2);
    expect((out[0] as SlideNote).connections.map(c => c.beat)).toEqual([1, 2]);
    expect((out[1] as SlideNote).connections.map(c => c.beat)).toEqual([3, 4]);
  });
});

// issue 92（用户 2026-09-12 拍板，bestdori 口径）：删 Slide **中间可见**结点 = 原位转 hidden
// （两段式删除的第一步；第二步"删含 hidden 的段 → 清 hidden"是 issue 80 半边，已锁在上方）。
describe('issue 92 · 删中间结点 → 原位转 hidden（bestdori 口径两段式删除）', () => {
  it('[A,B,C] 删中间 B → [A,H(B),C]：位置保留、仅设 hidden', () => {
    const notes = [slideOf({ beat: 1, lane: 1 }, { beat: 2, lane: 2 }, { beat: 3, lane: 3 })];
    const out = deleteSelection(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }]);
    expect(out).toHaveLength(1);
    const s = out[0] as SlideNote;
    expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[1, 1], [2, 2], [3, 3]]);
    expect(s.connections[1].hidden).toBe(true);
    expect(validChart(out).valid).toBe(true);
  });

  it('[A,B,C,D] 批量删中间 B、C → 两个 hidden（框选批量同口径）', () => {
    const notes = [
      slideOf({ beat: 1, lane: 1 }, { beat: 2, lane: 2 }, { beat: 3, lane: 3 }, { beat: 4, lane: 4 }),
    ];
    const out = deleteSelection(notes, [
      { kind: 'slideNode', noteIndex: 0, connIndex: 1 },
      { kind: 'slideNode', noteIndex: 0, connIndex: 2 },
    ]);
    expect(out).toHaveLength(1);
    const s = out[0] as SlideNote;
    expect(s.connections.map(c => c.hidden === true)).toEqual([false, true, true, false]);
    expect(validChart(out).valid).toBe(true);
  });

  it('两段式全流程：先删中间结点（→hidden），再删该段 → hidden 真正被清掉、两端直连', () => {
    const notes = [slideOf({ beat: 1, lane: 1 }, { beat: 2, lane: 2 }, { beat: 3, lane: 3 })];
    const step1 = deleteSelection(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }]);
    expect((step1[0] as SlideNote).connections[1].hidden).toBe(true);
    const step2 = deleteSelection(step1, [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }]);
    expect(step2).toHaveLength(1);
    const s = step2[0] as SlideNote;
    expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[1, 1], [3, 3]]);
    expect(s.connections.some(c => c.hidden)).toBe(false);
    expect(validChart(step2).valid).toBe(true);
  });

  it('[A,B] 无中间结点：删任一端仍走端点路径（退化单键，不变）', () => {
    const notes = [slideOf({ beat: 1, lane: 1 }, { beat: 2, lane: 2 })];
    const out = deleteSelection(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 0 }]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('Single');
    expect((out[0] as { beat: number }).beat).toBe(2);
    expect(validChart(out).valid).toBe(true);
  });

  it('undo 友好：hidden 化产物与原滑条逐字段可比（flick/skill 标记原样保留）', () => {
    // slideOf 助手只映射 beat/lane/hidden，带标记的用例直接内联构造
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 1, lane: 1, subBeat: 0, flick: true },
        { beat: 2, lane: 2, subBeat: 0, skill: true },
        { beat: 3, lane: 3, subBeat: 0 },
      ],
    }];
    const out = deleteSelection(notes, [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }]);
    const s = out[0] as SlideNote;
    expect(s.connections[1]).toMatchObject({ beat: 2, lane: 2, skill: true, hidden: true });
  });
});
