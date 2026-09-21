import { describe, it, expect } from 'vitest';
import {
  createHistory, pushHistory, pushHistoryIfChanged, undoHistory, redoHistory,
  canUndo, canRedo, currentHistory,
} from '@/src/chart/editing/History';

describe('History 纯模块（候选 D）', () => {
  it('初始快照：canUndo=false、canRedo=false', () => {
    const h = createHistory([1]);
    expect(currentHistory(h)).toEqual([1]);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it('push 后前进到新快照，可撤销', () => {
    const h = createHistory<number[]>([1]);
    const h2 = pushHistory(h, [1, 2]);
    expect(currentHistory(h2)).toEqual([1, 2]);
    expect(canUndo(h2)).toBe(true);
    expect(canRedo(h2)).toBe(false);
  });

  it('undo/redo 往返恢复正确快照', () => {
    let h = createHistory<number[]>([1]);
    h = pushHistory(h, [1, 2]);
    h = pushHistory(h, [1, 2, 3]);
    const afterUndo = undoHistory(h)!;
    expect(currentHistory(afterUndo)).toEqual([1, 2]);
    expect(canRedo(afterUndo)).toBe(true);
    const afterRedo = redoHistory(afterUndo)!;
    expect(currentHistory(afterRedo)).toEqual([1, 2, 3]);
  });

  it('push 截断 redo 分支', () => {
    let h = createHistory<number[]>([1]);
    h = pushHistory(h, [1, 2]);
    h = pushHistory(h, [1, 2, 3]);
    const undone = undoHistory(h)!;
    const branched = pushHistory(undone, [1, 2, 9]);
    expect(currentHistory(branched)).toEqual([1, 2, 9]);
    expect(canRedo(branched)).toBe(false); // 旧 redo 分支被截断
  });

  it('undo 到边界返回 null / redo 到边界返回 null', () => {
    const h = createHistory<number[]>([1]);
    expect(undoHistory(h)).toBeNull();
    expect(redoHistory(h)).toBeNull();
  });

  it('结构共享：push 不就地变异原状态，未改动项共享引用', () => {
    const shared = { x: 1 };
    const h = createHistory<{ a: number; shared: { x: number } }[]>([{ a: 1, shared }]);
    const h2 = pushHistory(h, [{ a: 2, shared }]);
    // 原状态未被就地变异
    expect(currentHistory(h).length).toBe(1);
    expect(currentHistory(h)[0].a).toBe(1);
    // 两快照共享未改动对象引用（结构共享，非深拷贝）
    expect(currentHistory(h)[0].shared).toBe(currentHistory(h2)[0].shared);
    expect(currentHistory(h2)[0].shared).toBe(shared);
  });
});

describe('History 容量上限（issue 132）', () => {
  it('上限内语义与不设 cap 相同', () => {
    let h = createHistory('a');
    h = pushHistory(h, 'b', 3);
    h = pushHistory(h, 'c', 3);
    expect(h.stack).toEqual(['a', 'b', 'c']);
    expect(currentHistory(h)).toBe('c');
    expect(canUndo(h)).toBe(true);
    const undone = undoHistory(h)!;
    expect(currentHistory(undone)).toBe('b');
  });

  it('超出上限丢最旧，栈长不超过 cap', () => {
    let h = createHistory('s0');
    h = pushHistory(h, 's1', 3);
    h = pushHistory(h, 's2', 3);
    h = pushHistory(h, 's3', 3);
    expect(h.stack).toEqual(['s1', 's2', 's3']);
    expect(h.stack.length).toBe(3);
    expect(currentHistory(h)).toBe('s3');
  });

  it('连续压入 cap+1 次后仍能撤销到最近 cap-1 步，不能回到被丢掉的最旧快照', () => {
    const cap = 3;
    let h = createHistory('s0');
    h = pushHistory(h, 's1', cap);
    h = pushHistory(h, 's2', cap);
    h = pushHistory(h, 's3', cap);
    const step1 = undoHistory(h)!;
    const step2 = undoHistory(step1)!;
    expect(currentHistory(step1)).toBe('s2');
    expect(currentHistory(step2)).toBe('s1');
    expect(undoHistory(step2)).toBeNull();
  });

  it('省略 cap 时仍不截最旧', () => {
    let h = createHistory('s0');
    h = pushHistory(h, 's1');
    h = pushHistory(h, 's2');
    h = pushHistory(h, 's3');
    expect(h.stack).toEqual(['s0', 's1', 's2', 's3']);
  });
});

describe('pushHistoryIfChanged + 容量上限', () => {
  it('内容相同不占栈位、不截 redo', () => {
    let h = createHistory('a');
    h = pushHistory(h, 'b');
    const undone = undoHistory(h)!;
    const after = pushHistoryIfChanged(undone, 'a');
    expect(after).toBe(undone);
    expect(canRedo(after)).toBe(true);
  });

  it('内容变化才压栈，且遵守 cap', () => {
    let h = createHistory('s0');
    h = pushHistoryIfChanged(h, 's1', Object.is, 3);
    h = pushHistoryIfChanged(h, 's1', Object.is, 3);
    h = pushHistoryIfChanged(h, 's2', Object.is, 3);
    h = pushHistoryIfChanged(h, 's3', Object.is, 3);
    expect(h.stack).toEqual(['s1', 's2', 's3']);
    expect(currentHistory(h)).toBe('s3');
  });
});
