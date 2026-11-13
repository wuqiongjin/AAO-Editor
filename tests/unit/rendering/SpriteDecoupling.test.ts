// issue 222: 内存图元切片解耦（Sprite Decoupling with Clean Padding）
import { describe, it, expect, vi } from 'vitest';
import {
  getDecoupledSprite,
  getDecoupledMipLevel,
  decoupledMipLevelFor,
  CLEAN_PADDING_PX,
  cleanTransparentPixels,
} from '@/src/ui/spriteDecoupling';

describe('cleanTransparentPixels（issue 222：管道清洗残留杂色）', () => {
  it('将所有 alpha===0 但 RGB 残留有值的脏像素强制重置为纯净 rgba(0,0,0,0)', () => {
    // 模拟一段包含脏底 (76, 105, 113, 0) 和有效像素 (255, 255, 255, 255) 的 ImageData
    const data = new Uint8ClampedArray([
      76, 105, 113, 0,    // 脏透明底
      255, 255, 255, 255, // 正常墨迹
      9, 5, 4, 1,         // 低 alpha 墨迹边缘（保留）
      76, 105, 113, 0,    // 脏透明底
    ]);
    cleanTransparentPixels(data);
    // 脏像素变为纯净 0,0,0,0
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(0);
    expect(data[3]).toBe(0);
    // 正常墨迹与低 alpha 不变
    expect(data[4]).toBe(255);
    expect(data[7]).toBe(255);
    expect(data[11]).toBe(1);
    // 最后一个脏像素同样被洗净
    expect(data[12]).toBe(0);
    expect(data[15]).toBe(0);
  });
});

describe('getDecoupledSprite（issue 222：内存按需图元切片解耦）', () => {
  it('安全边距 CLEAN_PADDING_PX 应为 4px（防双三次插值越界）', () => {
    expect(CLEAN_PADDING_PX).toBe(4);
  });

  it('在无 DOM 环境下安全返回 null，调用方原图直绘兜底', () => {
    const fakeImg = { width: 1024, height: 1024 } as unknown as HTMLImageElement;
    const res = getDecoupledSprite(fakeImg, { x: 0, y: 904, w: 308, h: 120 }, () => null);
    expect(res).toBeNull();
  });

  it('模拟 DOM 环境：正确创建带有 4px Padding 的独立离屏位图与缓存复用', () => {
    const fakeImg = { width: 1024, height: 1024 } as unknown as HTMLImageElement;
    const drawnCalls: unknown[][] = [];
    const mockCtx = {
      imageSmoothingEnabled: false,
      drawImage: vi.fn((...args: unknown[]) => { drawnCalls.push(args); }),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(100 * 4) })),
      putImageData: vi.fn(),
    };
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockCtx),
    } as unknown as HTMLCanvasElement;

    const decoupled = getDecoupledSprite(
      fakeImg,
      { x: 10, y: 20, w: 100, h: 50 },
      () => mockCanvas,
    );

    expect(decoupled).not.toBeNull();
    expect(decoupled!.w).toBe(100);
    expect(decoupled!.h).toBe(50);
    expect(decoupled!.padding).toBe(4);
    // 总尺寸 = 原始尺寸 + 2 * padding
    expect(mockCanvas.width).toBe(108);
    expect(mockCanvas.height).toBe(58);
    // drawImage 应把切片画在 (padding, padding) 处
    expect(mockCtx.drawImage).toHaveBeenCalledWith(fakeImg, 10, 20, 100, 50, 4, 4, 100, 50);

    // 缓存复用测试：相同 key 不重复创建
    const cached = getDecoupledSprite(
      fakeImg,
      { x: 10, y: 20, w: 100, h: 50 },
      () => mockCanvas,
    );
    expect(cached).toBe(decoupled);
  });

  it('getDecoupledMipLevel：独立图元自身 Mip 链增量生成', () => {
    const mockCanvas = { width: 108, height: 58 } as HTMLCanvasElement;
    const mockMip1 = { width: 54, height: 29 } as HTMLCanvasElement;
    const decoupled = {
      baseCanvas: mockCanvas,
      mipChain: [mockCanvas],
      w: 100,
      h: 50,
      padding: 4,
    };

    const mockCtx = {
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      drawImage: vi.fn(),
    };
    (mockMip1 as { getContext?: unknown }).getContext = vi.fn(() => mockCtx);

    const level0 = getDecoupledMipLevel(decoupled, 0);
    expect(level0).toBe(mockCanvas);

    const level1 = getDecoupledMipLevel(decoupled, 1, () => mockMip1);
    expect(level1).toBe(mockMip1);
    expect(decoupled.mipChain).toHaveLength(2);
    expect(mockCtx.drawImage).toHaveBeenCalledWith(mockCanvas, 0, 0, 108, 58, 0, 0, 54, 29);
  });

  describe('decoupledMipLevelFor（解耦图元专属 Mip 级数选择器，防 100% 缩放下过度减半）', () => {
    it('放宽单步减半门槛至 4.5x：在 100% 缩放下保持 Level 1（黄金甜点区），防高频边缘抹平', () => {
      // 100% 缩放下，方向滑键在 Windows 125% DPI (45*1.25 x 14.85*1.25) 下下采样比约 6.46x -> 属于 (4.5, 9] 区间 -> 锁定 Level 1
      expect(decoupledMipLevelFor(308, 120, 45 * 1.25, 14.85 * 1.25)).toBe(1);
      // 100% 缩放下，Tap 音符在 Windows 125% DPI 下下采样比约 6.8x -> 锁定 Level 1
      expect(decoupledMipLevelFor(308, 120, 36 * 1.25, 21.6 * 1.25)).toBe(1);
      // 100% 缩放 1.0 DPI 下，下采样比约 8.08x -> 依然稳定落在 Level 1，不跌入 Level 2
      expect(decoupledMipLevelFor(308, 120, 45, 14.85)).toBe(1);
    });

    it('缩放下采样比 <= 4.5x 时保持 Level 0 原图直出，最锐利最饱满', () => {
      // 200% 放大或轻微缩小 -> Level 0
      expect(decoupledMipLevelFor(308, 120, 45 * 2, 14.85 * 2)).toBe(0);
      expect(decoupledMipLevelFor(308, 120, 100, 50)).toBe(0);
    });

    it('超远景深度或超大幅缩小（> 9x / > 18x）时平滑进入 Level 2 及以上', () => {
      // 缩小 12x -> Level 2
      expect(decoupledMipLevelFor(308, 120, 25, 10)).toBe(2);
      // 缩小 25x -> Level 3
      expect(decoupledMipLevelFor(308, 120, 12, 5)).toBe(3);
    });
  });
});
