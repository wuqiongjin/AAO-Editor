import { describe, it, expect } from 'vitest';
import {
  CTRL_WHEEL_ZOOM_IN,
  CTRL_WHEEL_ZOOM_OUT,
  MAX_WHEEL_SCROLL_BOOST,
  ctrlWheelZoomFactor,
  wheelDeltaPx,
  wheelScrollBoost,
} from '@/src/chart/components/canvas/wheelScroll';

describe('画布滚轮滚动补偿', () => {
  it('缩放 ≥ 1 时不加速，缩小时按 1/scale 补偿并封顶 4 倍', () => {
    expect(wheelScrollBoost(2)).toBe(1);
    expect(wheelScrollBoost(1)).toBe(1);
    expect(wheelScrollBoost(0.5)).toBe(2);
    expect(wheelScrollBoost(0.25)).toBe(4);
    expect(wheelScrollBoost(0.1)).toBe(MAX_WHEEL_SCROLL_BOOST);
  });

  it('非法或零缩放退化为不加速，避免除零', () => {
    expect(wheelScrollBoost(0)).toBe(1);
    expect(wheelScrollBoost(-1)).toBe(1);
    expect(wheelScrollBoost(Number.NaN)).toBe(1);
  });

  it('把行/页模式的滚轮 delta 折算成像素', () => {
    expect(wheelDeltaPx(3, 0, 800)).toBe(3);
    expect(wheelDeltaPx(3, 1, 800)).toBe(48);
    expect(wheelDeltaPx(2, 2, 800)).toBe(1600);
    expect(wheelDeltaPx(Number.NaN, 0, 800)).toBe(0);
  });
});

describe('issue 255 · Ctrl+滚轮缩放倍率', () => {
  it('放大 1.15，缩小取其倒数，往返回到原点', () => {
    expect(ctrlWheelZoomFactor(-100)).toBe(CTRL_WHEEL_ZOOM_IN);
    expect(ctrlWheelZoomFactor(100)).toBe(CTRL_WHEEL_ZOOM_OUT);
    expect(CTRL_WHEEL_ZOOM_IN).toBe(1.15);
    expect(CTRL_WHEEL_ZOOM_IN * CTRL_WHEEL_ZOOM_OUT).toBe(1);
  });

  it('从 100% 放大 5 格到约 201%', () => {
    expect(CTRL_WHEEL_ZOOM_IN ** 5).toBeCloseTo(2.011, 3);
  });
});
