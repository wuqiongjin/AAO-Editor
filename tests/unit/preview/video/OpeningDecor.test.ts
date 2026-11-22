// chart-preview 81 · 装饰 C 落默认：布点常量与默认口径的锁测。
// 纯函数 `decorPairAt` 是绘制与锁测共用的 seam；A/B 仅作原型对照。
import { describe, expect, it } from 'vitest';
import { decorPairAt } from '@/src/preview/video/opening';
import { readStripped } from '@/tests/support/source';

describe('chart-preview 81 · 装饰 C 落默认', () => {
  it('缺省口径 = C：中间两对用落定布点，左右两簇保持票 30 实测表', () => {
    expect([decorPairAt(4).x, decorPairAt(4).y]).toEqual([0.425067, 0.0242]);
    expect([decorPairAt(5).x, decorPairAt(5).y]).toEqual([0.569533, 0.035]);
    expect(decorPairAt(3)).toMatchObject({ x: 0.2806, y: -0.0066 });
    expect(decorPairAt(6)).toMatchObject({ x: 0.714, y: 0.0858 });
  });

  it('C 第二对撞到 0.035H 上限：整对留在白条后', () => {
    const from = decorPairAt(3, 'current');
    const to = decorPairAt(6, 'current');
    const uncapped = from.y + ((to.y - from.y) * 2) / 3;
    expect(uncapped).toBeGreaterThan(0.035);
    expect(decorPairAt(5).y).toBe(0.035);
  });

  it('A/B 对照仍在：current 用票 30 原表，even 全线性均分', () => {
    expect(decorPairAt(4, 'current')).toMatchObject({ x: 0.4, y: 0.0233 });
    expect(decorPairAt(5, 'current')).toMatchObject({ x: 0.5, y: 0.0436 });
    const first = decorPairAt(0, 'current');
    const last = decorPairAt(9, 'current');
    const even = decorPairAt(4, 'even');
    expect(even.x).toBeCloseTo(first.x + ((last.x - first.x) * 4) / 9, 6);
    expect(even.y).toBeCloseTo(first.y + ((last.y - first.y) * 4) / 9, 6);
  });

  it('生产帧 / 绘制层 / 原型默认都是 middle（无 decor 参数 = C）', () => {
    expect(readStripped('src/preview/video/opening/openingFrame.ts')).toMatch(
      /decorSpacing: DecorSpacing = 'middle'/,
    );
    expect(readStripped('src/preview/video/opening/openingDecor.ts')).toMatch(
      /spacing: DecorSpacing = 'middle'/,
    );
    expect(readStripped('public/proto/scenes.html')).toMatch(/let decorSpacing = 'middle'/);
  });
});
