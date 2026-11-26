// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decoupledMipLevelFor,
  getDecoupledDrawSource,
  getDecoupledMipLevel,
  getDecoupledSprite,
  packDecoupledSprites,
} from '@/src/ui/spriteDecoupling';
import CanvasSpriteIcon from '@/src/ui/CanvasSpriteIcon';
import {
  particleTile,
  SIM_WARMUP_TILE_SPECS,
  warmupSimSprites,
} from '@/src/preview/video/sim/simSprites';
import {
  buildSimChart,
  drawSimFrameAt,
  prepareSimComboSprites,
  prepareSimLifeGauge,
} from '@/src/preview/video/sim/simField';
import { emptySimAssets } from '@/src/preview/video/sim/simAssets';
import { fieldMetrics } from '@/src/preview/video/sim/simGeometry';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';

function makeMockCtx2d() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    arc: vi.fn(),
    arcTo: vi.fn(),
    ellipse: vi.fn(),
    setLineDash: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    transform: vi.fn(),
    setTransform: vi.fn(),
    getTransform: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 12 })),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
    })),
    putImageData: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low' as ImageSmoothingQuality,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '12px sans-serif',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
}

function installMockOffscreenCanvas() {
  const createdBitmaps: Array<{
    width: number;
    height: number;
    drawCount: number;
    close: ReturnType<typeof vi.fn>;
  }> = [];
  const origOffscreen = (globalThis as Record<string, unknown>).OffscreenCanvas;

  class FakeOffscreenCanvas {
    width: number;
    height: number;
    private ctx = makeMockCtx2d();

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }

    getContext(type: string) {
      return type === '2d' ? this.ctx : null;
    }

    transferToImageBitmap() {
      const bmp = {
        width: this.width,
        height: this.height,
        drawCount: this.ctx.drawImage.mock.calls.length,
        close: vi.fn(),
      };
      createdBitmaps.push(bmp);
      return bmp as unknown as ImageBitmap;
    }
  }

  (globalThis as Record<string, unknown>).OffscreenCanvas = FakeOffscreenCanvas;
  return {
    createdBitmaps,
    restore() {
      if (origOffscreen === undefined) {
        delete (globalThis as Record<string, unknown>).OffscreenCanvas;
      } else {
        (globalThis as Record<string, unknown>).OffscreenCanvas = origOffscreen;
      }
    },
  };
}

function installMockCanvas2d() {
  const spy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(((type: string) => {
      if (type === '2d') return makeMockCtx2d() as unknown as CanvasRenderingContext2D;
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext);
  return () => spy.mockRestore();
}

describe('issue 89 · GPU 图集整合与零分配热路径锁', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('decoupledMipLevelFor 按标量缩放比精确分级且不越界', () => {
    expect(decoupledMipLevelFor(1024, 1024, 0, 64)).toBe(0);
    expect(decoupledMipLevelFor(1024, 1024, 1024, -10)).toBe(0);
    expect(decoupledMipLevelFor(1024, 1024, 2048, 2048)).toBe(0);
    expect(decoupledMipLevelFor(1024, 1024, 1024, 1024)).toBe(0);

    const lv5x = decoupledMipLevelFor(1024, 1024, 200, 200);
    const lv12x = decoupledMipLevelFor(1024, 1024, 80, 80);
    const lv25x = decoupledMipLevelFor(1024, 1024, 40, 40);
    expect(lv5x).toBeGreaterThanOrEqual(1);
    expect(lv12x).toBeGreaterThan(lv5x);
    expect(lv25x).toBeGreaterThan(lv12x);
  });

  it('packDecoupledSprites 将多级 mip 合并为单张 ImageBitmap 并释放临时 1x1 画布', () => {
    const restore2d = installMockCanvas2d();
    const offscreen = installMockOffscreenCanvas();
    try {
      const fakeImg = {
        naturalWidth: 2048,
        naturalHeight: 2048,
        width: 2048,
        height: 2048,
      } as HTMLImageElement;
      const d1 = getDecoupledSprite(fakeImg, { x: 4, y: 4, w: 512, h: 512 });
      const d2 = getDecoupledSprite(fakeImg, { x: 600, y: 4, w: 512, h: 256 });
      expect(d1).not.toBeNull();
      expect(d2).not.toBeNull();
      if (!d1 || !d2) return;

      getDecoupledMipLevel(d1, 4);
      getDecoupledMipLevel(d2, 4);
      packDecoupledSprites([d1, d2]);
      expect(offscreen.createdBitmaps.length).toBe(1);
      const atlas = offscreen.createdBitmaps[0];

      // 临时 mipChain HTMLCanvasElement 已被收缩为 1x1 释放独立 GPU 纹理
      for (const mip of d1.mipChain) {
        expect(mip.width).toBe(1);
        expect(mip.height).toBe(1);
      }

      const srcBase = getDecoupledDrawSource(d1, 0);
      const srcMip = getDecoupledDrawSource(d1, 2);
      const srcOther = getDecoupledDrawSource(d2, 0);
      expect(srcBase.source).toBe(atlas);
      expect(srcMip.source).toBe(atlas);
      expect(srcOther.source).toBe(atlas);
      expect(srcBase.sw).toBe(512);
      expect(srcBase.sh).toBe(512);
      expect(srcMip.sw).toBeLessThan(srcBase.sw);
    } finally {
      offscreen.restore();
      restore2d();
    }
  });

  it('warmupSimSprites 将环形光晕与粒子贴图合并为单张图集并在命中渲染时直接采样该 ImageBitmap', () => {
    const restore2d = installMockCanvas2d();
    const offscreen = installMockOffscreenCanvas();
    try {
      const fakeParticles = { naturalWidth: 1024, naturalHeight: 1024, width: 1024, height: 1024 } as HTMLImageElement;
      const fakeDigits = { naturalWidth: 720, naturalHeight: 96, width: 720, height: 96 } as HTMLImageElement;
      const fakeCombo = { naturalWidth: 150, naturalHeight: 41, width: 150, height: 41 } as HTMLImageElement;
      const sprites = { digits: fakeDigits, combo: fakeCombo, particles: fakeParticles };

      warmupSimSprites(sprites);
      expect(offscreen.createdBitmaps.length).toBeGreaterThanOrEqual(2);
      const particlesAtlas = offscreen.createdBitmaps[offscreen.createdBitmaps.length - 1]!;
      expect(particlesAtlas.width).toBeGreaterThanOrEqual(1024);
      // 15 张粒子色片（外推后每张 9 次 drawImage）写入独立粒子图集
      expect(particlesAtlas.drawCount).toBeGreaterThanOrEqual(15);

      // 模拟离线导出另建一套 sprites2 预热：不得 close 仍在实时舞台使用的 particlesAtlas
      const sprites2 = {
        digits: fakeDigits,
        combo: fakeCombo,
        particles: { naturalWidth: 1024, naturalHeight: 1024, width: 1024, height: 1024 } as HTMLImageElement,
      };
      warmupSimSprites(sprites2);
      expect(particlesAtlas.close).not.toHaveBeenCalled();
      const [[col, row], color] = SIM_WARMUP_TILE_SPECS[0]!;
      expect(particleTile(sprites, col, row, color).source).toBe(particlesAtlas);

      const icons = buildActiveNoteIcons(normalizeNoteSkinSelection({}));
      const simScene = {
        notes: [
          { type: 'BPM' as const, beat: 0, bpm: 120 },
          { type: 'Single' as const, beat: 1, lane: 3 },
        ],
        beatDisplay: 4,
        noteSpeed: 9.5,
        noteSize: 1,
        slideOpacity: 0.8,
        simultaneousClickLines: true,
        colorAssist: false,
        mirror: false,
      };
      const chart = buildSimChart(simScene, icons);
      const ctx = makeMockCtx2d() as unknown as CanvasRenderingContext2D;
      const spriteIcon = {
        render: vi.fn(),
        renderDecorator: vi.fn(),
      } as unknown as CanvasSpriteIcon;
      drawSimFrameAt(
        ctx,
        {
          scene: simScene,
          chart,
          metrics: fieldMetrics(1334, 750),
          assets: {
            ...emptySimAssets(),
            sprites,
          },
          noteIcons: icons,
          spriteIcon,
        },
        0.55, // beat 1 @ 120 BPM = 0.50s，0.55s 处于命中光环 + 粒子爆发期
      );

      const usedPackedAtlas = (ctx.drawImage as ReturnType<typeof vi.fn>).mock.calls.some(
        (args) => args[0] === particlesAtlas,
      );
      expect(usedPackedAtlas).toBe(true);
    } finally {
      offscreen.restore();
      restore2d();
    }
  });

  it('prepareSimComboSprites 将同字号 AP/辉光字形与阴影打包为单张 ImageBitmap，且超出环上限淘汰时同步清理缓存不留悬空引用', () => {
    const restore2d = installMockCanvas2d();
    const offscreen = installMockOffscreenCanvas();
    try {
      const fakeDigits = { naturalWidth: 512, naturalHeight: 64, width: 512, height: 64 } as HTMLImageElement;
      const fakeCombo = { naturalWidth: 256, naturalHeight: 48, width: 256, height: 48 } as HTMLImageElement;
      const fakeParticles = { naturalWidth: 1024, naturalHeight: 1024, width: 1024, height: 1024 } as HTMLImageElement;
      const sprites = { digits: fakeDigits, combo: fakeCombo, particles: fakeParticles };

      const firstMetrics = fieldMetrics(800, 450);
      const firstShadows = prepareSimComboSprites(firstMetrics, sprites, 1);
      expect(offscreen.createdBitmaps.length).toBe(1);
      const firstBitmap = offscreen.createdBitmaps[0]!;
      expect(firstBitmap.width).toBeGreaterThan(64);
      expect(firstShadows?.normal?.canvas).toBe(firstBitmap);

      // 连续烘焙超过环上限（8）的不同尺寸，触发最老图集淘汰关闭
      for (let i = 1; i <= 9; i++) {
        prepareSimComboSprites(fieldMetrics(800 + i * 80, 450 + i * 45), sprites, 1 + i * 0.1);
      }
      expect(firstBitmap.close).toHaveBeenCalledTimes(1);

      // 回访最初尺寸时缓存已同步失效重烘，返回的新阴影不得指向已 close 的旧位图
      const rebaked = prepareSimComboSprites(firstMetrics, sprites, 1);
      expect(rebaked?.normal?.canvas).not.toBe(firstBitmap);
      expect((rebaked?.normal?.canvas as unknown as { close: ReturnType<typeof vi.fn> }).close).not.toHaveBeenCalled();
    } finally {
      offscreen.restore();
      restore2d();
    }
  });

  it('CanvasSpriteIcon.prototype.renderSim 支持跳过逐次 imageSmoothingQuality 恢复并在默认模式下还原', async () => {
    const restore2d = installMockCanvas2d();
    const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    const nwDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
    const nhDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalHeight');
    const wDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'width');
    const hDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'height');
    const compDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 256 });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { configurable: true, get: () => 256 });
    Object.defineProperty(HTMLImageElement.prototype, 'width', { configurable: true, get: () => 256 });
    Object.defineProperty(HTMLImageElement.prototype, 'height', { configurable: true, get: () => 256 });
    Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true });
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      get() {
        return 'test://sim-sprite-4.png';
      },
      set(this: HTMLImageElement) {
        queueMicrotask(() => {
          this.onload?.(new Event('load'));
          this.dispatchEvent(new Event('load'));
        });
      },
    });
    try {
      const srcUrl = 'test://sim-sprite-4.png';
      const cfg = {
        src: srcUrl,
        x: 0,
        y: 0,
        w: 64,
        h: 64,
      };
      await CanvasSpriteIcon.ensureImagesLoaded([srcUrl]);
      const icon = new CanvasSpriteIcon();
      const rawCtx = makeMockCtx2d();
      let qualityVal: ImageSmoothingQuality = 'low';
      const qualityWrites: ImageSmoothingQuality[] = [];
      Object.defineProperty(rawCtx, 'imageSmoothingQuality', {
        configurable: true,
        get: () => qualityVal,
        set: (v: ImageSmoothingQuality) => {
          qualityVal = v;
          qualityWrites.push(v);
        },
      });
      const ctx = rawCtx as unknown as CanvasRenderingContext2D;

      icon.renderSim(ctx, cfg, 100, 200, 48, 48, 1, 1, true);
      expect(ctx.drawImage).toHaveBeenCalledTimes(1);
      const firstArgs = (ctx.drawImage as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(firstArgs.slice(1).every((n) => typeof n === 'number' && Number.isFinite(n))).toBe(true);
      expect(qualityWrites).toEqual([]);

      icon.renderSim(ctx, cfg, 100, 200, 48, 48, 1, 1, false);
      expect(ctx.drawImage).toHaveBeenCalledTimes(2);
      expect(qualityWrites).toEqual(['high', 'low']);
    } finally {
      if (srcDesc) Object.defineProperty(HTMLImageElement.prototype, 'src', srcDesc);
      if (nwDesc) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', nwDesc);
      if (nhDesc) Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', nhDesc);
      if (wDesc) Object.defineProperty(HTMLImageElement.prototype, 'width', wDesc);
      if (hDesc) Object.defineProperty(HTMLImageElement.prototype, 'height', hDesc);
      if (compDesc) Object.defineProperty(HTMLImageElement.prototype, 'complete', compDesc);
      restore2d();
    }
  });

  it('prepareSimLifeGauge 预烘焙顶栏静态图层且保持 scoreFill 夹在底框与段位字母之间', () => {
    const restore2d = installMockCanvas2d();
    const offscreen = installMockOffscreenCanvas();
    try {
      const metrics = fieldMetrics(1334, 750);
      const mkImg = (tag: string) =>
        ({ tag, naturalWidth: 128, naturalHeight: 64, width: 128, height: 64 } as unknown as HTMLImageElement);
      const scoreFillImg = mkImg('scoreFill');
      const hud = {
        star: mkImg('star'),
        scoreFill: scoreFillImg,
        lifeHeart: mkImg('lifeHeart'),
        pause: mkImg('pause'),
        autoPlay: mkImg('autoPlay'),
        digits: mkImg('digits'),
        combo: mkImg('combo'),
        judgements: {
          perfect: mkImg('perfect'),
          great: mkImg('great'),
          good: mkImg('good'),
          bad: mkImg('bad'),
          miss: mkImg('miss'),
        },
      };

      const lifeGauge = prepareSimLifeGauge(metrics, 1, hud as never, false);
      // 生命槽 + 顶栏底框层 (hudChromeUnder) + 顶栏段位字母层 (hudLetters)
      expect(offscreen.createdBitmaps.length).toBeGreaterThanOrEqual(3);

      const icons = buildActiveNoteIcons(normalizeNoteSkinSelection({}));
      const simScene = {
        notes: [
          { type: 'BPM' as const, beat: 0, bpm: 120 },
          { type: 'Single' as const, beat: 1, lane: 3 },
        ],
        beatDisplay: 4,
        noteSpeed: 9.5,
        noteSize: 1,
        slideOpacity: 0.8,
        simultaneousClickLines: true,
        colorAssist: false,
        mirror: false,
        showGameUi: true,
        autoMode: false,
      };
      const chart = buildSimChart(simScene, icons);
      const ctx = makeMockCtx2d() as unknown as CanvasRenderingContext2D;
      const assets = { ...emptySimAssets(), hud: hud as never };

      drawSimFrameAt(
        ctx,
        {
          scene: simScene,
          chart,
          metrics,
          assets,
          noteIcons: icons,
          spriteIcon: { render: vi.fn(), renderDecorator: vi.fn() } as unknown as CanvasSpriteIcon,
        },
        1.0, // beat 1 已命中，score > 0，scoreFill 会被绘制
        { lifeGauge },
      );

      const drawnSources = (ctx.drawImage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      const scoreFillIdx = drawnSources.indexOf(scoreFillImg);
      expect(scoreFillIdx).toBeGreaterThan(0);

      // 至少有一张预烘焙顶栏位图在 scoreFill 之前（底框），且有一张在 scoreFill 之后（段位字母 C/B/A/S/SS）
      const bitmapSet = new Set<unknown>(offscreen.createdBitmaps);
      const hasUnderBefore = drawnSources.slice(0, scoreFillIdx).some((s) => bitmapSet.has(s));
      const hasLettersAfter = drawnSources.slice(scoreFillIdx + 1).some((s) => bitmapSet.has(s));
      expect(hasUnderBefore).toBe(true);
      expect(hasLettersAfter).toBe(true);
    } finally {
      offscreen.restore();
      restore2d();
    }
  });
});
