// CanvasSpriteIcon 关键路径测试（用户 2026-08-25 反馈：flick 实际放置时无装饰箭头，
//  根因是旧第二层渲染路径错误；新增的 renderDecorator 走"主精灵已画、补一个挂件"的最小路径）。
import { describe, it, expect, beforeAll } from 'vitest';
import CanvasSpriteIcon, { type SpriteIconConfig } from '@/src/ui/CanvasSpriteIcon';
import { mipLevelFor, mipDims } from '@/src/ui/canvasSpriteMips';

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
    // issue 98：绘制位置不做整像素对齐，dx = canvasX - dW/2 = 200 - 50 = 150
    expect(call.dx).toBe(150);
    // canvasY + offsetY*scale = 200 + (-10)*2 = 180
    // dy = canvasY + offsetY*scale - dH/2 = 180 - 30 = 150
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
// ══════════ issue 96 · mip 采样策略（画布缩放 <100% 发糊整改） ══════════
describe('issue 96 · mipLevelFor 采样策略（canvasSpriteMips 纯函数）', () => {
    it('放大 / 轻微缩小（ratio ≤ 2）= 用原图（级 0）', () => {
        expect(mipLevelFor(200, 100, 200, 100)).toBe(0); // 1:1
        expect(mipLevelFor(200, 100, 400, 200)).toBe(0); // 放大
        expect(mipLevelFor(200, 100, 100, 50)).toBe(0);  // 2× 缩小（单步可接受）
    });

    it('大幅缩小 → 级位图后再一次 ≤2× 平滑缩放（ratio/2^L ∈ (1, 2]）', () => {
        expect(mipLevelFor(200, 100, 25, 12.5)).toBe(2);  // ratio 8 → 级 2（8/4=2）
        expect(mipLevelFor(2048, 1024, 36, 18)).toBe(5);  // ratio ~45.5 → 级 5（45.5/32≈1.42）
        expect(mipLevelFor(200, 200, 17, 17)).toBe(3);    // ratio ≈11.8 → 级 3（11.8/8≈1.47）
    });

    it('非法/退化输入 → 级 0（直绘兜底）', () => {
        expect(mipLevelFor(0, 100, 50, 50)).toBe(0);
        expect(mipLevelFor(200, 100, 0, 0)).toBe(0);
    });

    it('mipDims：逐级减半、最小钳 1', () => {
        expect(mipDims(200, 100, 0)).toEqual({ w: 200, h: 100 });
        expect(mipDims(200, 100, 1)).toEqual({ w: 100, h: 50 });
        expect(mipDims(3, 3, 5)).toEqual({ w: 1, h: 1 });
    });
});

describe('issue 96 · drawSingle 走 mip 源（node 环境无 DOM canvas → 直绘降级不炸）', () => {
    it('大幅缩小时 drawImage 仍被调用一次（mip 构建失败 → 原图兜底，目标矩形不变）', () => {
        const { ctx, drawCalls } = makeCtx();
        const sprite = new CanvasSpriteIcon();
        sprite.render(ctx, {
            src: 'atlas', x: 0, y: 0, w: 200, h: 200,
            canvasX: 100, canvasY: 100, canvasSize: 36, scale: 0.5, // 目标 18px，ratio ~11 → 本应走 mip
        });
        expect(drawCalls).toHaveLength(1);
        expect(drawCalls[0].dW).toBeCloseTo(18, 6);
    });
});
