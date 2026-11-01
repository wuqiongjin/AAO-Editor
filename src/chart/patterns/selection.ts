// 片段库多选纯逻辑（issue 193）：
// 选择集合增删、全选当前结果、选中统计、批量删除。
// 不散在 JSX，抽屉组件与单元测试共用一份纯函数。
import { removePatternsFromLibrary } from './library';
import type { Pattern } from './types';

export { removePatternsFromLibrary };

/**
 * 切换单个片段的选中状态（不可变）：已选则删，未选则加。
 */
export function togglePatternSelection(
  selectedIds: ReadonlySet<string>,
  id: string,
): Set<string> {
  const next = new Set(selectedIds);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/**
 * 全选当前搜索结果（不可变）：
 * 把所有可见片段的 id 并入当前选中集合；不在当前结果中的已选项原样保留。
 */
export function selectAllVisiblePatterns(
  selectedIds: ReadonlySet<string>,
  visiblePatterns: readonly Pattern[],
): Set<string> {
  const next = new Set(selectedIds);
  for (const pattern of visiblePatterns) {
    next.add(pattern.id);
  }
  return next;
}

export interface PatternSelectionStats {
  /** 总已选条数 */
  total: number;
  /** 已选中但不在当前搜索结果中的条数 */
  hidden: number;
}

/**
 * 计算选中条数与隐藏条数：
 * 搜索 / 过滤变化时不丢弃已选，工具条如实提示「其中 X 条不在当前结果」。
 */
export function getPatternSelectionStats(
  selectedIds: ReadonlySet<string>,
  visiblePatterns: readonly Pattern[],
): PatternSelectionStats {
  const total = selectedIds.size;
  if (total === 0) {
    return { total: 0, hidden: 0 };
  }
  const visibleIdSet = new Set(visiblePatterns.map((p) => p.id));
  let visibleCount = 0;
  for (const id of selectedIds) {
    if (visibleIdSet.has(id)) {
      visibleCount += 1;
    }
  }
  return {
    total,
    hidden: total - visibleCount,
  };
}
