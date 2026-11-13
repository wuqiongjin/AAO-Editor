// issue 222: 瓦片 Blit 浮点 DPI 与缩放自适应平滑策略锁测
import { describe, it, expect } from 'vitest';
import { shouldEnableTileBlitSmoothing } from '@/src/rendering/pipeline/noteLayerCache';

describe('shouldEnableTileBlitSmoothing（issue 222：自适应平滑判定）', () => {
  it('Windows 125% / 150% / 175% 浮点 DPI 下必须开启平滑，防亚像素锯齿与黑块', () => {
    // 即使 es === refScale === 1.0，浮点 DPR 也会在设备像素上网格量化，必须平滑
    expect(shouldEnableTileBlitSmoothing({ dpr: 1.25, tileDpr: 1.25, es: 1.0, refScale: 1.0, surfaceW: 800, tileW: 800 })).toBe(true);
    expect(shouldEnableTileBlitSmoothing({ dpr: 1.5, tileDpr: 1.5, es: 1.0, refScale: 1.0, surfaceW: 800, tileW: 800 })).toBe(true);
    expect(shouldEnableTileBlitSmoothing({ dpr: 1.75, tileDpr: 1.75, es: 1.0, refScale: 1.0, surfaceW: 800, tileW: 800 })).toBe(true);
  });

  it('缩放拉伸态（es !== refScale）下必须开启平滑，防最近邻拉伸走样', () => {
    // 即使整数 DPR 2.0，缩放手势期间旧瓦片拉伸也必须平滑
    expect(shouldEnableTileBlitSmoothing({ dpr: 2.0, tileDpr: 2.0, es: 1.3, refScale: 1.0, surfaceW: 800, tileW: 800 })).toBe(true);
    expect(shouldEnableTileBlitSmoothing({ dpr: 1.0, tileDpr: 1.0, es: 3.0, refScale: 2.5, surfaceW: 800, tileW: 800 })).toBe(true);
  });

  it('tileDpr !== dpr（如超高分屏 3x/4x 封顶 2x 时）必须开启平滑', () => {
    expect(shouldEnableTileBlitSmoothing({ dpr: 3.0, tileDpr: 2.0, es: 1.0, refScale: 1.0, surfaceW: 800, tileW: 800 })).toBe(true);
  });

  it('仅当整数 DPR（1.0 或 2.0）且 1:1 严格对齐无缩放无拉伸时，才安全关闭平滑以节省填充', () => {
    expect(shouldEnableTileBlitSmoothing({ dpr: 1.0, tileDpr: 1.0, es: 1.0, refScale: 1.0, surfaceW: 800, tileW: 800 })).toBe(false);
    expect(shouldEnableTileBlitSmoothing({ dpr: 2.0, tileDpr: 2.0, es: 1.0, refScale: 1.0, surfaceW: 800, tileW: 800 })).toBe(false);
    expect(shouldEnableTileBlitSmoothing({ dpr: 2.0, tileDpr: 2.0, es: 2.0, refScale: 2.0, surfaceW: 800, tileW: 800 })).toBe(false);
  });
  it('目标坐标含有浮点小数（子像素偏移）时，即使整数 DPR 1.0 也必须启用平滑', () => {
    expect(shouldEnableTileBlitSmoothing({ dpr: 1.0, tileDpr: 1.0, es: 1.0, refScale: 1.0, surfaceW: 800, tileW: 800, dy: 100.5 })).toBe(true);
    expect(shouldEnableTileBlitSmoothing({ dpr: 1.0, tileDpr: 1.0, es: 1.0, refScale: 1.0, surfaceW: 800, tileW: 800, dx: 0.33 })).toBe(true);
    expect(shouldEnableTileBlitSmoothing({ dpr: 1.0, tileDpr: 1.0, es: 1.0, refScale: 1.0, surfaceW: 800, tileW: 800, dx: 0, dy: 100 })).toBe(false);
  });

  it('裁剪后源矩形含有浮点小数（如视口边缘裁剪产生的 sy/sh 浮点）时，必须启用平滑', () => {
    expect(shouldEnableTileBlitSmoothing({ dpr: 1.0, tileDpr: 1.0, es: 1.0, refScale: 1.0, surfaceW: 800, tileW: 800, dx: 0, dy: 0, sy: 123.456 })).toBe(true);
    expect(shouldEnableTileBlitSmoothing({ dpr: 1.0, tileDpr: 1.0, es: 1.0, refScale: 1.0, surfaceW: 800, tileW: 800, dx: 0, dy: 0, sh: 50.25 })).toBe(true);
    expect(shouldEnableTileBlitSmoothing({ dpr: 1.0, tileDpr: 1.0, es: 1.0, refScale: 1.0, surfaceW: 800, tileW: 800, dx: 0, dy: 0, sx: 0, sy: 100, sw: 800, sh: 600 })).toBe(false);
  });
});
