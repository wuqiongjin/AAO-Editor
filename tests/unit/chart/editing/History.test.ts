import { describe, it, expect } from 'vitest';
import {
  createHistory, pushHistory, undoHistory, redoHistory, canUndo, canRedo, currentHistory,
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
