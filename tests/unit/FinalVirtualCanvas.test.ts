// issue 212 锁测：FinalVirtualCanvas 盒模型与清晰度直通保护
// 确保 <canvas> 不再因 border 挤压产生 0.998x 双线性模糊，且 backing store 与 CSS 盒比例严格等于 dpr。
import { describe, it, expect } from 'vitest';
import { readSource, stripComments } from '@/tests/support/source';
import { bufferSizeFor } from '@/src/rendering/rasterScale';

const canvasSrc = stripComments(readSource('src/chart/components/canvas/FinalVirtualCanvas.tsx'));

describe('issue 212 · FinalVirtualCanvas 几何盒模型与像素对齐', () => {
  it('<canvas> 样式移除 border 改用 outline，防止 border-box 挤压内容盒', () => {
    // 提取 <canvas> 的 style 对象内容
    const canvasMatch = canvasSrc.match(/<canvas[\s\S]*?style=\{\{([\s\S]*?)\}\}/);
    expect(canvasMatch, 'FinalVirtualCanvas 必须包含 <canvas style={{...}}>').toBeTruthy();
    const styleBlock = canvasMatch![1];

    // 1. 不得在 canvas 上声明 border（会导致内容盒比 surf 小 2px）
    expect(styleBlock).not.toMatch(/border\s*:\s*['"][^'"]*['"]/);

    // 2. 必须声明 outline: '1px solid #333'（不占盒模型空间且保留视觉边界）
    expect(styleBlock).toMatch(/outline\s*:\s*['"]1px solid #333['"]/);

    // 3. width 与 height 必须严格绑定 surf.w 与 surf.h
    expect(styleBlock).toMatch(/width\s*:\s*surf\.w/);
    expect(styleBlock).toMatch(/height\s*:\s*surf\.h/);
  });

  it('backing store 物理像素与 CSS 显示空间尺寸比严格等于 dpr（各 DPI 缩放下无小数重采样）', () => {
    const testSurfaces = [
      { w: 750, h: 900 },
      { w: 1200, h: 800 },
      { w: 1550, h: 906 },
    ];
    // 测试各常见平台 DPI 缩放：100%, 125%, 150%, 175%, 200%
    const dprs = [1.0, 1.25, 1.5, 1.75, 2.0];

    for (const surf of testSurfaces) {
      for (const dpr of dprs) {
        const { w: bw, h: bh } = bufferSizeFor(surf, dpr);
        // backing store 分辨率 / CSS 尺寸 必须严格等于 dpr（整数舍入误差严格在 0.5px 以内）
        expect(Math.abs(bw - surf.w * dpr)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(bh - surf.h * dpr)).toBeLessThanOrEqual(0.5);

        // 对照组：如果是旧实现的 (surf.w - 2)，比例必然产生显著的 2px 挤压非整数偏差
        const oldEffectiveScaleW = bw / (surf.w - 2);
        expect(Math.abs(oldEffectiveScaleW - dpr)).toBeGreaterThan(0.001);
      }
    }
  });
});
