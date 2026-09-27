// chart-projects 14：全部工程卡片网格的方向键导航——纯函数二维位移锁测。
// 口径（定案 2 / 用户 2026-09-27 拍板）：
//   - ←/→ 只在同一视觉行内 ±1 列，到行首/行尾停住，不跨行绕接；
//   - ↑/↓ 跨行同列上下，到网格边界停住（末行残列下方无卡片即停）；
//   - 不循环；0 个工程无事可做；1 个工程不移动；
//   - currentId 为空 / 不在列表（越界或已删除）→ 回退第一个卡片。
import { describe, expect, it } from 'vitest';
import { moveGridSelection } from '@/src/pages/projectGridSelection';

function grid(n: number): { id: string }[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}` }));
}

describe('chart-projects 14: moveGridSelection 二维位移', () => {
  it('→ 行内 +1 列，← 行内 -1 列', () => {
    const items = grid(6); // 3 列两行：p1 p2 p3 / p4 p5 p6
    expect(moveGridSelection(items, 'p1', 'ArrowRight', 3)).toBe('p2');
    expect(moveGridSelection(items, 'p2', 'ArrowRight', 3)).toBe('p3');
    expect(moveGridSelection(items, 'p2', 'ArrowLeft', 3)).toBe('p1');
    expect(moveGridSelection(items, 'p5', 'ArrowLeft', 3)).toBe('p4');
  });

  it('←/→ 到行首/行尾停住，不跨行绕接', () => {
    const items = grid(6);
    expect(moveGridSelection(items, 'p1', 'ArrowLeft', 3)).toBe('p1'); // 第一行行首
    expect(moveGridSelection(items, 'p3', 'ArrowRight', 3)).toBe('p3'); // 第一行行尾
    expect(moveGridSelection(items, 'p4', 'ArrowLeft', 3)).toBe('p4'); // 第二行行首
    expect(moveGridSelection(items, 'p6', 'ArrowRight', 3)).toBe('p6'); // 网格末尾
  });

  it('↑/↓ 跨行同列上下', () => {
    const items = grid(7); // 3 列：p1 p2 p3 / p4 p5 p6 / p7
    expect(moveGridSelection(items, 'p1', 'ArrowDown', 3)).toBe('p4');
    expect(moveGridSelection(items, 'p4', 'ArrowDown', 3)).toBe('p7');
    expect(moveGridSelection(items, 'p2', 'ArrowDown', 3)).toBe('p5');
    expect(moveGridSelection(items, 'p3', 'ArrowDown', 3)).toBe('p6');
    expect(moveGridSelection(items, 'p4', 'ArrowUp', 3)).toBe('p1');
    expect(moveGridSelection(items, 'p7', 'ArrowUp', 3)).toBe('p4');
    expect(moveGridSelection(items, 'p5', 'ArrowUp', 3)).toBe('p2');
  });

  it('↑/↓ 到网格边界停住（末行残列下方无卡片即停）', () => {
    const items = grid(7);
    expect(moveGridSelection(items, 'p7', 'ArrowDown', 3)).toBe('p7'); // 末行
    expect(moveGridSelection(items, 'p5', 'ArrowDown', 3)).toBe('p5'); // 第二列下方空
    expect(moveGridSelection(items, 'p6', 'ArrowDown', 3)).toBe('p6'); // 第三列下方空
    expect(moveGridSelection(items, 'p1', 'ArrowUp', 3)).toBe('p1'); // 首行
    expect(moveGridSelection(items, 'p2', 'ArrowUp', 3)).toBe('p2');
  });

  it('单元素：任何方向键都不移动', () => {
    const items = grid(1);
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const) {
      expect(moveGridSelection(items, 'p1', key, 3)).toBe('p1');
    }
  });

  it('空列表：返回 null（无事可做）', () => {
    expect(moveGridSelection([], 'p1', 'ArrowRight', 3)).toBeNull();
    expect(moveGridSelection([], null, 'ArrowDown', 3)).toBeNull();
  });

  it('越界 / 未知 currentId 回退第一个卡片（不位移）', () => {
    const items = grid(3);
    expect(moveGridSelection(items, 'ghost', 'ArrowRight', 3)).toBe('p1');
    expect(moveGridSelection(items, 'ghost', 'ArrowLeft', 3)).toBe('p1');
    expect(moveGridSelection(items, null, 'ArrowDown', 3)).toBe('p1');
    expect(moveGridSelection(items, undefined, 'ArrowUp', 3)).toBe('p1');
  });

  it('columns 非法值（0 / NaN / 负数）按 1 列处理', () => {
    const items = grid(3);
    expect(moveGridSelection(items, 'p1', 'ArrowDown', 0)).toBe('p2');
    expect(moveGridSelection(items, 'p1', 'ArrowDown', Number.NaN)).toBe('p2');
    expect(moveGridSelection(items, 'p1', 'ArrowDown', -2)).toBe('p2');
  });
});
