// 2026-08-25 切片 3（Q13=A）：音符皮肤预览改 6 列 2 行布局。
// 第 1 行：6 个真实精灵预览画布；第 2 行：6 个对应包选择器。
// 这里只测单列的几何纯函数 computeSlideColLayout（slide 列特殊：竖向连接带 + 上下端点 + 中间结点）。
// 不变量：竖向、端点上下、bandH > bandW。
import { describe, it, expect } from 'vitest';
import { computeSlideColLayout, PREVIEW_CELL_W, PREVIEW_CELL_H } from '@/src/rendering/skin/noteSkinPreviewLayout';

describe('音符皮肤预览：Slide 列布局（切片 3，2026-08-25 Q13=A）', () => {
  it('Slide 列应当竖向：连接带高 > 宽，端点在 y 方向分离', () => {
    const l = computeSlideColLayout(PREVIEW_CELL_W, PREVIEW_CELL_H);
    expect(l.bandH, '连接带应当竖向拉伸（高>宽）').toBeGreaterThan(l.bandW);
    expect(l.topY).toBeLessThan(l.midY);
    expect(l.midY).toBeLessThan(l.bottomY);
  });

  it('Slide 列中线 = 端点中点（中间结点 y = 上下端点 y 的中点）', () => {
    const l = computeSlideColLayout(PREVIEW_CELL_W, PREVIEW_CELL_H);
    const midFromEndpoints = (l.topY + l.bottomY) / 2;
    expect(midFromEndpoints).toBeCloseTo(l.midY, 6);
  });

  it('不同列宽下"竖向布局"不变量仍成立', () => {
    for (const [W, H] of [[120, 80], [140, 88], [180, 100]] as const) {
      const l = computeSlideColLayout(W, H);
      expect(l.bandH).toBeGreaterThan(l.bandW);
      expect(l.topY).toBeLessThan(l.midY);
      expect(l.midY).toBeLessThan(l.bottomY);
    }
  });

  it('cx 居中（= W/2）', () => {
    const l = computeSlideColLayout(PREVIEW_CELL_W, PREVIEW_CELL_H);
    expect(l.cx).toBeCloseTo(PREVIEW_CELL_W / 2, 6);
  });
});