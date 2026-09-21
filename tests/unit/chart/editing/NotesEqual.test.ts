// issue 57 bug4：谱面快照语义相等 + 条件压栈——无变化的重复放置不再占用撤销栈。
import { describe, it, expect } from 'vitest';
import type { ChartNote } from '@/src/chart/types';
import { noteEqual, notesEqual } from '@/src/chart/editing/NotesEqual';
import {
  createHistory, pushHistory, pushHistoryIfChanged, currentHistory, canRedo, undoHistory, redoHistory,
} from '@/src/chart/editing/History';
import { handleNoteReplacement } from '@/src/chart/editing/NoteReplacementRules';

const bpm0: ChartNote = { beat: 0, type: 'BPM', bpm: 120 };
const single = (beat: number, lane: number, extra: Partial<ChartNote> = {}): ChartNote =>
  ({ beat, lane, type: 'Single', ...extra } as ChartNote);

describe('noteEqual（语义相等，键缺省 === 假值）', () => {
  it('subBeat 缺省 ≡ 0；键序不同也相等', () => {
    expect(noteEqual(single(4, 2), { type: 'Single', subBeat: 0, lane: 2, beat: 4 } as ChartNote)).toBe(true);
  });
  it('skill 缺省 ≡ false（重复放置 flick 判定为无变化）', () => {
    const a = single(4, 2, { flick: true }) as ChartNote;
    const b = { beat: 4, lane: 2, type: 'Single', flick: true, skill: false } as ChartNote;
    expect(noteEqual(a, b)).toBe(true);
  });
  it('标记/坐标/类型差异 → 不等', () => {
    expect(noteEqual(single(4, 2), single(4, 3))).toBe(false);
    expect(noteEqual(single(4, 2, { flick: true }), single(4, 2))).toBe(false);
    expect(noteEqual(single(4, 2, { skill: true }), single(4, 2, { flick: true }))).toBe(false);
    expect(noteEqual(single(4, 2), { beat: 4, lane: 2, type: 'LDirectional', length: 1 } as ChartNote)).toBe(false);
  });
  it('方向键 length 差异 → 不等（length+1 是真实改动，不能被去重吞掉）', () => {
    expect(noteEqual(
      { beat: 4, lane: 2, type: 'LDirectional', length: 1 },
      { beat: 4, lane: 2, type: 'LDirectional', length: 2 },
    )).toBe(false);
  });
  it('滑条：结点顺序是连接语义，逐下标比较；Slide ≠ Long', () => {
    const c1 = { beat: 1, lane: 0 }, c2 = { beat: 2, lane: 3 };
    expect(noteEqual(
      { type: 'Slide', connections: [c1, c2] },
      { type: 'Slide', connections: [c1, c2] },
    )).toBe(true);
    expect(noteEqual(
      { type: 'Slide', connections: [c1, c2] },
      { type: 'Slide', connections: [c2, c1] },
    )).toBe(false);
    expect(noteEqual(
      { type: 'Slide', connections: [c1, c2] },
      { type: 'Long', connections: [c1, c2] },
    )).toBe(false);
    // 结点标记同口径：hidden 缺省 ≡ false
    expect(noteEqual(
      { type: 'Slide', connections: [{ ...c1, flick: true }, c2] },
      { type: 'Slide', connections: [{ ...c1, flick: true, hidden: false }, { ...c2, subBeat: 0 }] },
    )).toBe(true);
  });
  it('BPM/System 字段比较', () => {
    expect(noteEqual(bpm0, { beat: 0, type: 'BPM', bpm: 120 })).toBe(true);
    expect(noteEqual(bpm0, { beat: 0, type: 'BPM', bpm: 180 })).toBe(false);
    expect(noteEqual(
      { beat: 0, type: 'System', data: 'a' },
      { beat: 0, type: 'System', data: 'a' },
    )).toBe(true);
  });
});

describe('notesEqual + pushHistoryIfChanged（历史去重）', () => {
  it('引用相同数组恒等；长度不同不等', () => {
    const a = [bpm0, single(4, 2)];
    expect(notesEqual(a, a)).toBe(true);
    expect(notesEqual(a, [bpm0])).toBe(false);
  });

  it('与当前快照语义相等 → 不压栈且原样返回（不截断 redo 分支）', () => {
    let h = createHistory<ChartNote[]>([bpm0]);
    h = pushHistory(h, [bpm0, single(4, 2)]);
    const undone = undoHistory(h)!; // 回到 [bpm0]，redo 分支存在
    expect(canRedo(undone)).toBe(true);
    // 无操作：与当前快照（undo 后的 [bpm0]）内容一致但对象重建的新数组
    const noChange = currentHistory(undone).map(n => ({ ...n }));
    const after = pushHistoryIfChanged(undone, noChange, notesEqual);
    expect(after).toBe(undone); // 同一状态对象：栈与 index 均未动
    expect(canRedo(after)).toBe(true); // redo 分支保留
  });

  it('真实改动照常压栈', () => {
    let h = createHistory<ChartNote[]>([bpm0]);
    h = pushHistoryIfChanged(h, [bpm0, single(4, 2)], notesEqual);
    h = pushHistoryIfChanged(h, [bpm0, single(4, 2), single(8, 3)], notesEqual);
    expect(currentHistory(h)).toHaveLength(3);
  });

  it('场景回归：同位置重复放置同一单键 → 一次 Ctrl+Z 即退掉该音符', () => {
    // 模拟放置链路：handleNoteReplacement（重复放置返回"内容相同的新数组"）→ pushHistoryIfChanged
    let h = createHistory<ChartNote[]>([bpm0]);
    let notes = currentHistory(h);
    for (let i = 0; i < 3; i++) {
      const r = handleNoteReplacement(notes, 4, 2, 0, 'single');
      expect(r.shouldReplace).toBe(true); // 规则本身仍走替换
      notes = r.newNotes;
      h = pushHistoryIfChanged(h, notes, notesEqual);
    }
    // 3 次点击只占 1 个历史位
    expect(h.stack).toHaveLength(2);
    // 撤销 1 次 → 该音符真正消失
    const undone = undoHistory(h)!;
    expect(currentHistory(undone)).toEqual([bpm0]);
  });

  it('超出 cap 后撤销/重做仍对齐，去重不被 cap 破坏', () => {
    const cap = 3;
    let h = createHistory<ChartNote[]>([bpm0]);
    h = pushHistoryIfChanged(h, [bpm0, single(1, 0)], notesEqual, cap);
    h = pushHistoryIfChanged(h, [bpm0, single(1, 0)], notesEqual, cap);
    h = pushHistoryIfChanged(h, [bpm0, single(2, 0)], notesEqual, cap);
    h = pushHistoryIfChanged(h, [bpm0, single(3, 0)], notesEqual, cap);
    expect(h.stack).toHaveLength(3);
    const u1 = undoHistory(h)!;
    const u2 = undoHistory(u1)!;
    expect(currentHistory(u1)).toEqual([bpm0, single(2, 0)]);
    expect(currentHistory(u2)).toEqual([bpm0, single(1, 0)]);
    expect(undoHistory(u2)).toBeNull();
    const r1 = redoHistory(u2)!;
    const r2 = redoHistory(r1)!;
    expect(currentHistory(r1)).toEqual([bpm0, single(2, 0)]);
    expect(currentHistory(r2)).toEqual([bpm0, single(3, 0)]);
    expect(canRedo(r2)).toBe(false);
  });
});
