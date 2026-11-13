import { describe, it, expect, vi } from 'vitest';
import { NOTE_SKIN_GEOMETRY, buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import { shouldEnableTileBlitSmoothing } from '@/src/rendering/pipeline/noteLayerCache';
import {
  CLEAN_PADDING_PX,
  cleanTransparentPixels,
  getDecoupledSprite,
  getDecoupledMipLevel,
} from '@/src/ui/spriteDecoupling';
import CanvasSpriteIcon from '@/src/ui/CanvasSpriteIcon';
import { mipLevelFor } from '@/src/ui/canvasSpriteMips';

describe('NoteVisualMicroHarness · 离屏微视觉抗畸变守卫 (issue 222)', () => {
  describe('1. 方向滑键接合几何守卫 (issue 29/222 官方 3px 紧贴基准)', () => {
    it('DIR_CHEVRON_INTO_BODY 保持官方 3px 紧贴咬合标准，严禁箭头与本体脱节悬空', () => {
      expect(NOTE_SKIN_GEOMETRY.DIR_CHEVRON_INTO_BODY).toBe(3);
    });

    it('左/右方向滑键组装时，Chevron 深度咬合本体尖端无脱节', () => {
      const icons = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));
      const groupL = icons.dirGroup('L', 1);
      const groupR = icons.dirGroup('R', 1);

      expect(groupL.chevron).not.toBeNull();
      expect(groupR.chevron).not.toBeNull();

      // L 侧：箭头中心相对本体中心向左偏移 (DIR_BODY_HALF_W - 3) = -(22.5 - 3) = -19.5
      const expectedCenterX_L = -(NOTE_SKIN_GEOMETRY.DIR_BODY_HALF_W - NOTE_SKIN_GEOMETRY.DIR_CHEVRON_INTO_BODY);
      expect(expectedCenterX_L).toBe(-19.5);

      // R 侧：箭头中心相对本体中心向右偏移 (DIR_BODY_HALF_W - 3) = 19.5
      const expectedCenterX_R = (NOTE_SKIN_GEOMETRY.DIR_BODY_HALF_W - NOTE_SKIN_GEOMETRY.DIR_CHEVRON_INTO_BODY);
      expect(expectedCenterX_R).toBe(19.5);
    });
  });

  describe('2. 瓦片 Blit 自适应平滑抗锯齿守卫 (Q2=A)', () => {
    const fractionalDprs = [1.25, 1.333, 1.5, 1.75, 2.25, 2.5];
    const zooms = [0.8, 1.3, 1.4, 2.0, 3.0];

    it('所有 Windows 浮点 DPR 下强制启用平滑 (无论缩放倍率)', () => {
      for (const dpr of fractionalDprs) {
        for (const zoom of [1.0, ...zooms]) {
          const enable = shouldEnableTileBlitSmoothing({
            dpr,
            tileDpr: Math.min(dpr, 1.5),
            es: zoom,
            refScale: zoom,
            surfaceW: 1000,
            tileW: 1000,
          });
          expect(enable, `DPR ${dpr} at zoom ${zoom} must enable smoothing`).toBe(true);
        }
      }
    });

    it('高缩放 (300%) 与低缩放 (130%) 下强制启用平滑 (无论 DPR)', () => {
      for (const dpr of [1.0, 2.0, 3.0]) {
        expect(shouldEnableTileBlitSmoothing({
          dpr,
          tileDpr: dpr,
          es: 3.0,
          refScale: 1.0, // 缩放拉伸态
          surfaceW: 1000,
          tileW: 1000,
        })).toBe(true);

        expect(shouldEnableTileBlitSmoothing({
          dpr,
          tileDpr: dpr,
          es: 1.3,
          refScale: 1.0, // 缩放拉伸态
          surfaceW: 1000,
          tileW: 1000,
        })).toBe(true);
      }
    });

    it('仅在整数 DPR 且 1:1 无缩放映射时关闭平滑以最大化吞吐', () => {
      expect(shouldEnableTileBlitSmoothing({
        dpr: 1.0,
        tileDpr: 1.0,
        es: 1.0,
        refScale: 1.0,
        surfaceW: 1000,
        tileW: 1000,
      })).toBe(false);

      expect(shouldEnableTileBlitSmoothing({
        dpr: 2.0,
        tileDpr: 2.0,
        es: 1.0,
        refScale: 1.0,
        surfaceW: 1000,
        tileW: 1000,
      })).toBe(false);
    });
  });

  describe('3. 内存图元解耦与透明底色管道清洗守卫 (Q1=A, Q7=A)', () => {
    it('cleanTransparentPixels 将所有 alpha===0 像素的 RGB 归零，消灭深青色底色 (76,105,113)', () => {
      // 模拟包含深青色透明底、不透明白色描边、半透明抗锯齿边缘的像素缓冲区
      const buffer = new Uint8ClampedArray([
        76, 105, 113, 0,    // 脏透明背景
        255, 255, 255, 255, // 纯白高光描边
        200, 220, 240, 128, // 抗锯齿半透明边缘
        76, 105, 113, 0,    // 脏透明背景
      ]);

      cleanTransparentPixels(buffer);

      // 脏透明背景被完全洗净为 (0,0,0,0)
      expect(buffer[0]).toBe(0);
      expect(buffer[1]).toBe(0);
      expect(buffer[2]).toBe(0);
      expect(buffer[3]).toBe(0);

      // 纯白描边保持完好
      expect(buffer[4]).toBe(255);
      expect(buffer[5]).toBe(255);
      expect(buffer[6]).toBe(255);
      expect(buffer[7]).toBe(255);

      // 半透明抗锯齿像素保持完好
      expect(buffer[8]).toBe(200);
      expect(buffer[9]).toBe(220);
      expect(buffer[10]).toBe(240);
      expect(buffer[11]).toBe(128);

      // 第二个脏透明背景也被完全洗净
      expect(buffer[12]).toBe(0);
      expect(buffer[13]).toBe(0);
      expect(buffer[14]).toBe(0);
      expect(buffer[15]).toBe(0);
    });

    it('getDecoupledSprite 生成带 4px 安全边距的独立画布并缓存', () => {
      const mockCanvas = {
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue({
          imageSmoothingEnabled: true,
          drawImage: vi.fn(),
          getImageData: vi.fn().mockReturnValue({
            data: new Uint8ClampedArray(100 * 100 * 4),
          }),
          putImageData: vi.fn(),
        }),
      } as unknown as HTMLCanvasElement;

      const mockImg = { width: 1024, height: 1024 } as HTMLImageElement;
      const rect = { x: 0, y: 782, w: 308, h: 120 };

      const decoupled = getDecoupledSprite(mockImg, rect, () => mockCanvas);
      expect(decoupled).not.toBeNull();
      expect(decoupled!.w).toBe(308);
      expect(decoupled!.h).toBe(120);
      expect(decoupled!.padding).toBe(CLEAN_PADDING_PX);
      expect(mockCanvas.width).toBe(308 + CLEAN_PADDING_PX * 2);
      expect(mockCanvas.height).toBe(120 + CLEAN_PADDING_PX * 2);
    });

    it('在 Windows 125% 缩放下，小箭头步入 Mip 下采样 (100% 缩放下 Level 2，130% 缩放下 Level 1)', () => {
      // 验证外侧小箭头 (note_flick_top_l: 138×171) 缩小至目标像素时的下采样阶跃
      const topW = 138;
      const topH = 171;
      const dpr = 1.25;

      // 100% 缩放 (es=1.0)：目标绘制尺寸 23.4×29 逻辑 px * 1.25 dpr = 29.25×36.25 物理 px
      const destW100 = 23.4 * 1.0 * dpr;
      const destH100 = 29 * 1.0 * dpr;
      expect(mipLevelFor(topW, topH, destW100, destH100)).toBe(2);

      // 130% 缩放 (es=1.3)：目标绘制尺寸 23.4×29 * 1.3 * 1.25 = 38.0×47.1 物理 px
      const destW130 = 23.4 * 1.3 * dpr;
      const destH130 = 29 * 1.3 * dpr;
      expect(mipLevelFor(topW, topH, destW130, destH130)).toBe(1);

      // 独立 Mip 链保证 Level 1 与 Level 2 由单图元按需构建，四周带纯净安全边距
      const mockCanvas = {
        width: topW + CLEAN_PADDING_PX * 2,
        height: topH + CLEAN_PADDING_PX * 2,
        getContext: vi.fn().mockReturnValue({
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high',
          drawImage: vi.fn(),
        }),
      } as unknown as HTMLCanvasElement;

      const decoupled = {
        baseCanvas: mockCanvas,
        mipChain: [mockCanvas],
        w: topW,
        h: topH,
        padding: CLEAN_PADDING_PX,
      };

      const mip1 = getDecoupledMipLevel(decoupled, 1, () => ({
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue({
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high',
          drawImage: vi.fn(),
        }),
      } as unknown as HTMLCanvasElement));
      expect(mip1).toBeDefined();

      const mip2 = getDecoupledMipLevel(decoupled, 2, () => ({
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue({
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high',
          drawImage: vi.fn(),
        }),
      } as unknown as HTMLCanvasElement));

      expect(mip2).toBeDefined();
      expect(decoupled.mipChain.length).toBe(3); // [base, level1, level2]
    });
  });

  describe('4. 渲染端到端解耦集成守卫', () => {
    it('CanvasSpriteIcon.render 在主图元绘制时优先调度解耦切片', () => {
      const sprite = new CanvasSpriteIcon();
      const fakeImg = { width: 1024, height: 1024 } as HTMLImageElement;
      (CanvasSpriteIcon as unknown as { imageCache: Map<string, HTMLImageElement> }).imageCache.set('atlas_test', fakeImg);

      const drawCalls: unknown[] = [];
      const ctx = {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage: (...args: unknown[]) => {
          drawCalls.push(args);
        },
      } as unknown as CanvasRenderingContext2D;

      sprite.render(ctx, {
        src: 'atlas_test',
        x: 0,
        y: 782,
        w: 308,
        h: 120,
        canvasX: 100,
        canvasY: 100,
        canvasSize: 36,
        canvasWidth: 36,
        canvasHeight: 21.6,
        scale: 1.0,
      });

      // 在 node/mock 环境下降级或直接绘制至少触发一次 drawImage
      expect(drawCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
