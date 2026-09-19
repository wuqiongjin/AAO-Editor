import { describe, it, expect } from 'vitest';
import {
  clamp,
  clampRect,
  computeInkInsets,
  formatRegistryEntry,
  hitTestHandle,
  isInside,
  moveRect,
  normalizeRect,
  pickGridSteps,
  pointInRect,
  resizeRect,
  roundRect,
  unionInside,
  type PixelRect,
} from '@/tools/sprite-locator/locator';

describe('normalizeRect', () => {
  it('与拖拽方向无关：从右下到左上也能归一化为左上角起点 + 宽高', () => {
    expect(normalizeRect(300, 200, 100, 50)).toEqual({ x: 100, y: 50, w: 200, h: 150 });
    expect(normalizeRect(100, 50, 300, 200)).toEqual({ x: 100, y: 50, w: 200, h: 150 });
  });
});

describe('clampRect', () => {
  it('越界矩形被钳制进图片范围', () => {
    const r = clampRect({ x: -20, y: 10, w: 500, h: 300 }, 2048, 1024);
    expect(r).toEqual({ x: 0, y: 10, w: 500, h: 300 });
  });

  it('超出图片右/下边缘时收缩宽高', () => {
    const r = clampRect({ x: 2000, y: 1000, w: 200, h: 200 }, 2048, 1024);
    expect(r).toEqual({ x: 2000, y: 1000, w: 48, h: 24 });
  });

  it('0 尺寸选区提升为最小 1×1（不产生空条目）', () => {
    const r = clampRect({ x: 100, y: 100, w: 0, h: 0 }, 2048, 1024);
    expect(r).toEqual({ x: 100, y: 100, w: 1, h: 1 });
  });
});

describe('roundRect', () => {
  it('坐标与宽高四舍五入到整数像素', () => {
    expect(roundRect({ x: 10.4, y: 10.6, w: 30.5, h: 40.4 })).toEqual({ x: 10, y: 11, w: 31, h: 40 });
  });
});

describe('isInside', () => {
  const frame: PixelRect = { x: 100, y: 200, w: 300, h: 120 };

  it('完全在内为 true', () => {
    expect(isInside({ x: 120, y: 220, w: 250, h: 80 }, frame)).toBe(true);
  });

  it('边界相切放行（方向滑键墨迹常占满框架高度、仅水平缩进）', () => {
    expect(isInside({ x: 124, y: 200, w: 250, h: 120 }, frame)).toBe(true);
    expect(isInside({ x: 100, y: 224, w: 250, h: 80 }, frame)).toBe(true);
  });

  it('与框架完全重合不算（无真实缩进）', () => {
    expect(isInside({ x: 100, y: 200, w: 300, h: 120 }, frame)).toBe(false);
  });

  it('超出或不相交为 false', () => {
    expect(isInside({ x: 50, y: 220, w: 100, h: 80 }, frame)).toBe(false);
    expect(isInside({ x: 400, y: 220, w: 100, h: 80 }, frame)).toBe(false);
    expect(isInside({ x: 120, y: 220, w: 300, h: 80 }, frame)).toBe(false);
  });
});

describe('unionInside', () => {
  const frame: PixelRect = { x: 0, y: 0, w: 320, h: 120 };

  it('无有效墨迹返回 null（含墨迹不在 frame 内的情况）', () => {
    expect(unionInside(frame, [])).toBeNull();
    expect(unionInside(frame, [{ x: 330, y: 10, w: 20, h: 20 }])).toBeNull();
  });

  it('多个墨迹取并集边界', () => {
    const union = unionInside(frame, [
      { x: 10, y: 20, w: 40, h: 30 },
      { x: 30, y: 40, w: 50, h: 60 },
    ]);
    expect(union).toEqual({ x: 10, y: 20, w: 70, h: 80 });
  });
});

describe('computeInkInsets', () => {
  it('墨迹相对框架左右边的源像素缩进（方向滑键留白场景）', () => {
    // DirectionalFlickSprites.png 320px 框内：rightFlick 左 24 / 右 21px
    const frame: PixelRect = { x: 0, y: 782, w: 320, h: 120 };
    const ink: PixelRect = { x: 24, y: 782, w: 275, h: 120 };
    expect(computeInkInsets(frame, ink)).toEqual({ inkLeft: 24, inkRight: 21 });
  });

  it('墨迹不在框架内返回 null', () => {
    expect(computeInkInsets({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50, w: 100, h: 100 })).toBeNull();
  });
});

describe('moveRect（键盘微调 / 拖拽移动）', () => {
  const imgW = 2048;
  const imgH = 1024;

  it('按增量平移并保持尺寸', () => {
    expect(moveRect({ x: 100, y: 200, w: 300, h: 120 }, 5, -3, imgW, imgH)).toEqual({ x: 105, y: 197, w: 300, h: 120 });
  });

  it('移出图片边缘时被钳制（贴边停住，不越界）', () => {
    expect(moveRect({ x: 0, y: 500, w: 300, h: 120 }, -10, 0, imgW, imgH)).toEqual({ x: 0, y: 500, w: 300, h: 120 });
    expect(moveRect({ x: imgW - 300, y: 0, w: 300, h: 120 }, 10, 0, imgW, imgH))
      .toEqual({ x: imgW - 300, y: 0, w: 300, h: 120 });
    expect(moveRect({ x: 100, y: imgH - 120, w: 300, h: 120 }, 0, 10, imgW, imgH))
      .toEqual({ x: 100, y: imgH - 120, w: 300, h: 120 });
  });
});

describe('resizeRect（手柄拖拽缩放）', () => {
  const imgW = 640;
  const imgH = 480;

  it('拖 se 手柄：宽高随增量增长，起点不变', () => {
    expect(resizeRect({ x: 100, y: 100, w: 200, h: 150 }, 'se', 30, 20, imgW, imgH))
      .toEqual({ x: 100, y: 100, w: 230, h: 170 });
  });

  it('拖 nw 手柄：左上角移动、右下角锚定', () => {
    expect(resizeRect({ x: 100, y: 100, w: 200, h: 150 }, 'nw', -25, -15, imgW, imgH))
      .toEqual({ x: 75, y: 85, w: 225, h: 165 });
  });

  it('拖 e / w 边：只改宽度', () => {
    expect(resizeRect({ x: 100, y: 100, w: 200, h: 150 }, 'e', 40, 999, imgW, imgH))
      .toEqual({ x: 100, y: 100, w: 240, h: 150 });
    expect(resizeRect({ x: 100, y: 100, w: 200, h: 150 }, 'w', 40, 999, imgW, imgH))
      .toEqual({ x: 140, y: 100, w: 160, h: 150 });
  });

  it('拖到图片边界外时钳制在范围内', () => {
    expect(resizeRect({ x: 500, y: 100, w: 100, h: 150 }, 'e', 999, 0, imgW, imgH))
      .toEqual({ x: 500, y: 100, w: 140, h: 150 });
    expect(resizeRect({ x: 100, y: 100, w: 100, h: 150 }, 'n', 0, -999, imgW, imgH))
      .toEqual({ x: 100, y: 0, w: 100, h: 250 });
  });

  it('拖过对面边时保住最小尺寸（minSize=2）', () => {
    const r = resizeRect({ x: 100, y: 100, w: 200, h: 150 }, 'e', 9999, 0, imgW, imgH, 2);
    expect(r.w).toBe(imgW - 100);
    const r2 = resizeRect({ x: 100, y: 100, w: 200, h: 150 }, 'e', -9999, 0, imgW, imgH, 2);
    expect(r2.w).toBe(2);
    expect(r2.x).toBe(100); // 左边锚定
  });

  it('nw 拖过右下角时同样保住最小尺寸且右边不动', () => {
    const r = resizeRect({ x: 100, y: 100, w: 200, h: 150 }, 'nw', 9999, 9999, imgW, imgH, 2);
    expect(r.x).toBe(298);
    expect(r.y).toBe(248);
    expect(r.w).toBe(2);
    expect(r.h).toBe(2);
  });
});

describe('hitTestHandle / pointInRect', () => {
  const rect: PixelRect = { x: 100, y: 100, w: 200, h: 150 };

  it('命中角点与边中点', () => {
    expect(hitTestHandle(rect, 100, 100, 8)).toBe('nw');
    expect(hitTestHandle(rect, 300, 250, 8)).toBe('se');
    expect(hitTestHandle(rect, 200, 100, 8)).toBe('n');
    expect(hitTestHandle(rect, 100, 175, 8)).toBe('w');
  });

  it('半径外返回 null', () => {
    expect(hitTestHandle(rect, 160, 160, 8)).toBeNull();
    expect(hitTestHandle(rect, 115, 100, 8)).toBeNull();
  });

  it('pointInRect 含边界判定', () => {
    expect(pointInRect(rect, 150, 150)).toBe(true);
    expect(pointInRect(rect, 100, 100)).toBe(true);
    expect(pointInRect(rect, 301, 200)).toBe(false);
  });
});

describe('pickGridSteps', () => {
  it('zoom 越小网格步长越大（保证视觉间距稳定 ≥ minPx）', () => {
    const small = pickGridSteps(0.1);
    const large = pickGridSteps(2);
    expect(small.minor).toBeGreaterThanOrEqual(large.minor);
    expect(small.minor * 0.1).toBeGreaterThanOrEqual(24);
    expect(large.minor * 2).toBeGreaterThanOrEqual(24);
  });

  it('1× 缩放下 24px 以上才画线：step×zoom ≥ 24', () => {
    const { minor } = pickGridSteps(1);
    expect(minor * 1).toBeGreaterThanOrEqual(24);
    const { minor: prevMinor } = pickGridSteps(1, 24);
    // 序列中比 minor 小一档的 step 间距不足 24
    const series = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    const idx = series.indexOf(prevMinor);
    if (idx > 0) expect(series[idx - 1] * 1).toBeLessThan(24);
  });

  it('major 是 minor 的整数倍且更大', () => {
    const { minor, major } = pickGridSteps(0.5);
    expect(major % minor).toBe(0);
    expect(major).toBeGreaterThan(minor);
  });
});

describe('formatRegistryEntry', () => {
  it('生成与 BaseSpriteIcons 一致的框架条目', () => {
    const entry = formatRegistryEntry('tapVirtual', './assets/skins/RhythmGameSprites.png', { x: 1553, y: 912, w: 302, h: 103 });
    expect(entry).toBe(
      "tapVirtual: {\n" +
      "    src: './assets/skins/RhythmGameSprites.png',\n" +
      "    x: 1553, y: 912, w: 302, h: 103,\n" +
      "},",
    );
  });

  it('带墨迹缩进时追加 inkLeft/inkRight（注册表书写风格：行尾无逗号）', () => {
    const entry = formatRegistryEntry('leftFlick', './assets/skins/DirectionalFlickSprites.png', { x: 0, y: 782, w: 320, h: 120 }, { inkLeft: 42, inkRight: 67 });
    expect(entry).toContain('    x: 0, y: 782, w: 320, h: 120,');
    expect(entry).toContain('    inkLeft: 42, inkRight: 67');
  });

  it('ink 为 null 时与不传等价', () => {
    const rect: PixelRect = { x: 1, y: 2, w: 3, h: 4 };
    expect(formatRegistryEntry('a', 's', rect, null)).toBe(formatRegistryEntry('a', 's', rect));
  });
});

describe('clamp', () => {
  it('边界钳制', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});
