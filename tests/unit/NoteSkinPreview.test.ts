// 用户 2026-08-25 第 2 轮反馈：音符皮肤预览里 Slide 应当竖向（连接带竖直拉伸 + 端点上下堆叠），
// 与画布上"按住位置在轨道上、终点 beat 出现在下方"的阅读方向一致。
// 这里只测布局纯函数 computeSlidePreviewLayout，不引入 jsdom/canvas。
import { describe, it, expect } from 'vitest';
import { computeSlidePreviewLayout } from '../../src/components/NoteSkinPreview';

describe('音符皮肤预览：Slide 布局（用户 2026-08-25 第 2/3 轮）', () => {
  it('Slide 应当竖向：连接带高 > 宽，端点在 y 方向分离，共享 x', () => {
    const W = 660, H = 128;
    const l = computeSlidePreviewLayout(W, H);
    // 1) 连接带是竖条：bandH > bandW
    expect(l.bandH, '连接带应当竖向拉伸（高>宽）').toBeGreaterThan(l.bandW);
    // 2) 上端点 y < 中间结点 y < 下端点 y（时间从上往下读：起点在上、终点在下）
    expect(l.slideTop).toBeLessThan(l.cy);
    expect(l.cy).toBeLessThan(l.slideBottom);
    // 3) 端点与连接带共享 x（垂直排列）
    expect(l.slideX).toBe(l.cellX);
    // 4) 中间结点 y 是端点 y 的中点
    const midY = (l.slideTop + l.slideBottom) / 2;
    expect(midY).toBeCloseTo(l.cy, 6);
  });

  it('Slide 预览位于第 6 格（cellX = 5.5/6 × W）', () => {
    const W = 660;
    const l = computeSlidePreviewLayout(W, 128);
    expect(l.slideX).toBeCloseTo((5 + 0.5) * (W / 6), 6);
  });

  it('不同画布尺寸下"竖向布局"不变量仍成立', () => {
    for (const [W, H] of [[480, 96], [660, 128], [960, 160]] as const) {
      const l = computeSlidePreviewLayout(W, H);
      expect(l.bandH).toBeGreaterThan(l.bandW);
      expect(l.slideTop).toBeLessThan(l.cy);
      expect(l.cy).toBeLessThan(l.slideBottom);
    }
  });

  it('连接带宽度应明显比端点水平占位更宽（用户第 3 轮反馈：旧 bandW=18 太细，连接带与端点宽度持平反而像"瘦条"）', () => {
    // 端点水平占位 ≈ canvasWidth(36) × scale(1.3) = 46.8 设计 px
    // 连接带宽度应比端点水平占位明显更宽
    const l = computeSlidePreviewLayout(660, 128);
    const endpointVisualW = 36 * 1.3;
    expect(l.bandW, `连接带宽度 ${l.bandW} 应大于端点水平占位 ${endpointVisualW}`).toBeGreaterThan(endpointVisualW);
  });
});