// issue 138：播放路径必须把画布可见矩形交给 SP 扫描线，不能只在单测里传 clipCss。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const renderSrc = readStripped('src/rendering/render.ts');

describe('renderSpBandStrip · issue 138 clip 接线', () => {
  it('rasterBandRuns 调用带 clipCss（来自当前画布变换）', () => {
    expect(renderSrc).toMatch(/rasterBandRuns\(\{[^}]*clipCss/);
  });
});
