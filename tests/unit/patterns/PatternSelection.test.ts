// issue 193 · 片段多选纯逻辑测试
import { describe, expect, it } from 'vitest';
import {
  getPatternSelectionStats,
  removePatternsFromLibrary,
  selectAllVisiblePatterns,
  togglePatternSelection,
} from '@/src/patterns/selection';
import { makePattern } from '@/tests/support/patterns';

describe('片段多选纯逻辑 · togglePatternSelection', () => {
  it('勾选未选中的片段', () => {
    const selected = new Set<string>();
    const next = togglePatternSelection(selected, 'p1');
    expect(next.has('p1')).toBe(true);
    expect(next.size).toBe(1);
    expect(selected.size).toBe(0); // 原 Set 不被修改
  });

  it('取消已勾选的片段', () => {
    const selected = new Set<string>(['p1', 'p2']);
    const next = togglePatternSelection(selected, 'p1');
    expect(next.has('p1')).toBe(false);
    expect(next.has('p2')).toBe(true);
    expect(next.size).toBe(1);
  });
});

describe('片段多选纯逻辑 · selectAllVisiblePatterns', () => {
  const visible = [
    makePattern({ id: 'p1' }),
    makePattern({ id: 'p2' }),
    makePattern({ id: 'p3' }),
  ];

  it('全选当前搜索结果（初始为空）', () => {
    const selected = new Set<string>();
    const next = selectAllVisiblePatterns(selected, visible);
    expect(Array.from(next).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('全选当前结果时合并已选中的其他项（非当前结果保留）', () => {
    const selected = new Set<string>(['p0', 'p1']);
    const next = selectAllVisiblePatterns(selected, visible);
    expect(Array.from(next).sort()).toEqual(['p0', 'p1', 'p2', 'p3']);
  });

  it('空可见结果时返回原集合', () => {
    const selected = new Set<string>(['p1']);
    const next = selectAllVisiblePatterns(selected, []);
    expect(Array.from(next)).toEqual(['p1']);
  });
});

describe('片段多选纯逻辑 · getPatternSelectionStats', () => {
  const visible = [
    makePattern({ id: 'p1' }),
    makePattern({ id: 'p2' }),
  ];

  it('全部选中项都在当前可见结果中', () => {
    const selected = new Set<string>(['p1', 'p2']);
    const stats = getPatternSelectionStats(selected, visible);
    expect(stats).toEqual({ total: 2, hidden: 0 });
  });

  it('部分选中项不在当前可见结果中（搜索变化保留选择）', () => {
    const selected = new Set<string>(['p1', 'p3', 'p4']);
    const stats = getPatternSelectionStats(selected, visible);
    expect(stats).toEqual({ total: 3, hidden: 2 });
  });

  it('空选择', () => {
    const selected = new Set<string>();
    const stats = getPatternSelectionStats(selected, visible);
    expect(stats).toEqual({ total: 0, hidden: 0 });
  });
});

describe('片段多选纯逻辑 · removePatternsFromLibrary 批量删除', () => {
  const p1 = makePattern({ id: 'p1', name: '片段 1' });
  const p2 = makePattern({ id: 'p2', name: '片段 2' });
  const p3 = makePattern({ id: 'p3', name: '片段 3' });
  const library = [p1, p2, p3];

  it('批量删除选中的多条片段（产出新数组）', () => {
    const next = removePatternsFromLibrary(library, new Set(['p1', 'p3']));
    expect(next).toEqual([p2]);
    expect(library).toHaveLength(3); // 原数组不变
  });

  it('批量删除接受数组格式的 id 清单', () => {
    const next = removePatternsFromLibrary(library, ['p2']);
    expect(next).toEqual([p1, p3]);
  });

  it('没有匹配的 id 时返回 null（调用方据此不产生整库落盘）', () => {
    const next = removePatternsFromLibrary(library, new Set(['p999']));
    expect(next).toBeNull();
  });

  it('空待删集合返回 null', () => {
    expect(removePatternsFromLibrary(library, new Set())).toBeNull();
    expect(removePatternsFromLibrary(library, [])).toBeNull();
  });

  it('空库返回 null', () => {
    expect(removePatternsFromLibrary([], new Set(['p1']))).toBeNull();
  });
});
