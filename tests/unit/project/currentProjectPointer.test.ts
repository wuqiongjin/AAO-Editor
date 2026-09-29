// chart-projects 20：当前工程指针的读写与容错。
// 口径：指针是"上次去过哪"的提示 —— 任何读失败都必须静默回 null，让启动回落既有规则。
import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROJECT_POINTER_KEY,
  clearCurrentProjectPointer,
  loadCurrentProjectPointer,
  saveCurrentProjectPointer,
  type PointerStorage,
} from '@/src/project/currentProjectPointer';

function memStorage(seed?: string): PointerStorage & { raw: () => string | null } {
  let data: string | null = seed ?? null;
  return {
    raw: () => data,
    getItem: (k) => (k === CURRENT_PROJECT_POINTER_KEY ? data : null),
    setItem: (k, v) => { if (k === CURRENT_PROJECT_POINTER_KEY) data = v; },
    removeItem: (k) => { if (k === CURRENT_PROJECT_POINTER_KEY) data = null; },
  };
}

describe('chart-projects 20 · 当前工程指针', () => {
  it('save → load 往返：projectId 必填、chartId 可空', () => {
    const st = memStorage();
    saveCurrentProjectPointer({ projectId: 'p1', chartId: 'c1' }, st);
    expect(loadCurrentProjectPointer(st)).toEqual({ projectId: 'p1', chartId: 'c1' });

    saveCurrentProjectPointer({ projectId: 'p2', chartId: null }, st);
    expect(loadCurrentProjectPointer(st)).toEqual({ projectId: 'p2', chartId: null });
  });

  it('无存储 / 无值 / 坏 JSON / 缺字段 / 空串 → 全回 null（不抛）', () => {
    expect(loadCurrentProjectPointer(null)).toBeNull();
    expect(loadCurrentProjectPointer(memStorage())).toBeNull();
    expect(loadCurrentProjectPointer(memStorage('{oops'))).toBeNull();
    expect(loadCurrentProjectPointer(memStorage('null'))).toBeNull();
    expect(loadCurrentProjectPointer(memStorage('[]'))).toBeNull();
    expect(loadCurrentProjectPointer(memStorage('{}'))).toBeNull();
    expect(loadCurrentProjectPointer(memStorage(JSON.stringify({ projectId: '' })))).toBeNull();
    expect(loadCurrentProjectPointer(memStorage(JSON.stringify({ projectId: 3 })))).toBeNull();
    // chartId 非字符串 → 当没有（不清掉工程本身）
    expect(loadCurrentProjectPointer(memStorage(JSON.stringify({ projectId: 'p1', chartId: 7 }))))
      .toEqual({ projectId: 'p1', chartId: null });
  });

  it('clear 后读回 null', () => {
    const st = memStorage();
    saveCurrentProjectPointer({ projectId: 'p1', chartId: 'c1' }, st);
    clearCurrentProjectPointer(st);
    expect(loadCurrentProjectPointer(st)).toBeNull();
  });

  it('存储本身抛错时静默：读回 null、写 / 清不炸', () => {
    const broken: PointerStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(loadCurrentProjectPointer(broken)).toBeNull();
    expect(() => saveCurrentProjectPointer({ projectId: 'p1', chartId: null }, broken)).not.toThrow();
    expect(() => clearCurrentProjectPointer(broken)).not.toThrow();
  });
});
