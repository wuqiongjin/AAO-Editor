// CanvasSpriteIcon 关键路径测试（用户 2026-08-25 反馈：flick 实际放置时无装饰箭头，
//  根因是旧第二层渲染路径错误；新增的 renderDecorator 走"主精灵已画、补一个挂件"的最小路径）。
import { describe, it, expect, beforeAll } from 'vitest';
import CanvasSpriteIcon, { type SpriteIconConfig } from '../../src/ui/CanvasSpriteIcon';

function makeCtx(): { ctx: CanvasRenderingContext2D; drawCalls: Array<{ dx: number; dy: number; dW: number; dH: number; sx: number; sy: number; sw: number; sh: number }> } {
  const drawCalls: Array<{ dx: number; dy: number; dW: number; dH: number; sx: number; sy: number; sw: number; sh: number }> = [];
  const ctx: Partial<CanvasRenderingContext2D> = {
    drawImage: ((...args: unknown[]) => {
      const [img, sx, sy, sw, sh, dx, dy, dW, dH] = args as [HTMLImageElement, number, number, number, number, number, number, number, number];
      drawCalls.push({ sx, sy, sw, sh, dx, dy, dW, dH });
      void img;
    }) as CanvasRenderingContext2D['drawImage'],
  };
  return { ctx: ctx as CanvasRenderingContext2D, drawCalls };
}

const FLICK_DEC: SpriteIconConfig = {
  src: 'atlas',
  x: 0, y: 0, w: 100, h: 100,
  offsetX: 0,
  offsetY: -10,
  scaleX: 0.5,
  scaleY: 0.5,
  zIndex: 10,
};

beforeAll(() => {
  // 注入一张 200×200 的假图像到静态缓存，免去真实图片加载
  const fakeImg = { width: 200, height: 200 } as HTMLImageElement;
  // 静态属性 imageCache 是 private，但 ts 类型上不可见；用 as unknown as 走旁路
  (CanvasSpriteIcon as unknown as { imageCache: Map<string, HTMLImageElement> }).imageCache.set(FLICK_DEC.src, fakeImg);
});

describe('CanvasSpriteIcon.renderDecorator（用户 2026-08-25 反馈：flick 实际放置无装饰箭头）', () => {
  it('按 anchor 位置 + 挂件 offsetX/offsetY 设计 px 计算 drawImage 目标矩形', () => {
    const { ctx, drawCalls } = makeCtx();
    const sprite = new CanvasSpriteIcon();
    const anchor = { canvasX: 200, canvasY: 200, drawW: 100, drawH: 60 };
    sprite.renderDecorator(ctx, anchor, FLICK_DEC, /* spriteScale */ 2);
    expect(drawCalls).toHaveLength(1);
    const call = drawCalls[0];
    // 源矩形 = dec.x..x+w × dec.y..y+h（0..100）
    expect(call).toMatchObject({ sx: 0, sy: 0, sw: 100, sh: 100 });
    // 目标宽高 = drawW * scaleX * scale = 100 * 0.5 * 2 = 100；高 = 60 * 0.5 * 2 = 60
    expect(call.dW).toBeCloseTo(100, 6);
    expect(call.dH).toBeCloseTo(60, 6);
    // canvasX + offsetX*scale = 200 + 0*2 = 200
    // drawImage 是 dx = Math.round(canvasX - dW/2) = Math.round(200 - 50) = 150
    expect(call.dx).toBe(150);
    // canvasY + offsetY*scale = 200 + (-10)*2 = 180
    // dy = Math.round(180 - dH/2) = Math.round(180 - 30) = 150
    expect(call.dy).toBe(150);
  });

  it('offsetX/offsetY 真的会平移到锚点之外（核心回归钉）', () => {
    const { ctx, drawCalls } = makeCtx();
    const sprite = new CanvasSpriteIcon();
    const anchor = { canvasX: 200, canvasY: 200, drawW: 100, drawH: 60 };
    const dec: SpriteIconConfig = { ...FLICK_DEC, offsetX: 25, offsetY: -30 };
    sprite.renderDecorator(ctx, anchor, dec, 1);
    // dW = 100 * 0.5 * 1 = 50；dx = 200 + 25*1 - 50/2 = 200
    // dH = 60 * 0.5 * 1 = 30；dy = 200 + (-30)*1 - 30/2 = 155
    expect(drawCalls[0].dx).toBe(200);
    expect(drawCalls[0].dy).toBe(155);
  });
});