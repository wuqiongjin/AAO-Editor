// 全部工程卡片网格的方向键导航（chart-projects 14）：纯函数，二维位移不藏在组件里，可单测。
//
// 口径（定案 2 / 用户 2026-09-27 拍板）：
//   - 顺序即传入顺序（调用方用 sortProjectsByLastOpened 排好），不新增排序字段；
//   - ←/→ 只在同一视觉行内 ±1 列：到行首/行尾停住，不跨行绕接；
//   - ↑/↓ 跨行同列上下：线性索引 ±列数，天然保持同列；末行残列下方无卡片即停；
//   - 到边界停在原地，不循环；
//   - 0 个工程无事可做（返回 null）；1 个工程不移动（任何方向都越界）；
//   - currentId 为空 / 不在列表（越界或已删除）→ 回退第一个卡片，不额外位移。
export type GridNavKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

export function moveGridSelection<T extends { id: string }>(
  ordered: readonly T[],
  currentId: string | null | undefined,
  key: GridNavKey,
  columns: number,
): string | null {
  if (ordered.length === 0) return null;
  const cols = Math.max(1, Math.floor(columns) || 1);
  const index = ordered.findIndex((item) => item.id === currentId);
  if (index < 0) return ordered[0].id;
  const row = Math.floor(index / cols);
  let target: number;
  switch (key) {
    case 'ArrowLeft': target = index - 1; break;
    case 'ArrowRight': target = index + 1; break;
    case 'ArrowUp': target = index - cols; break;
    case 'ArrowDown': target = index + cols; break;
  }
  if (target < 0 || target >= ordered.length) return ordered[index].id;
  if ((key === 'ArrowLeft' || key === 'ArrowRight') && Math.floor(target / cols) !== row) {
    return ordered[index].id;
  }
  return ordered[target].id;
}
