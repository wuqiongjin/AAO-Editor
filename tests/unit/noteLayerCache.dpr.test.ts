// issue 212 锁测：Retina 2.0x 高分屏离屏瓦片 DPR 整数对齐与直绘
// 验证 DPR=2.0 下瓦片生成与屏幕绘制比例为 1:1，彻底消除 1.333x 放大模糊与非整数重采样。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createNoteLayerCache,
  getEffectiveDpr,
  TILE_DPR_CAP,
  TILE_PX,
  tileBytesFor,
  maxTilesForBudget,
  type NoteLayerCache,
} from '@/src/rendering/pipeline/noteLayerCache';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import type { RenderCtx } from '@/src/rendering/types';
import type { ChartNote } from '@/src/chart/types';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import { makeNoopCtx } from '@/tests/support/canvas';

const SURFACE = { w: 800, h: 900 };
const ES = 1.0;
const NOTES: ChartNote[] = [
  { beat: 0, type: 'BPM', bpm: 120 },
  { type: 'Single', lane: 3, beat: 4, subBeat: 0 },
];

function makeRc(g: ChartGeometry, scrollY: number, dpr: number): RenderCtx {
  return {
    geometry: g,
    viewport: { scrollX: 0, scrollY, scale: ES, virtualWidth: 0, virtualHeight: 0 },
    surface: SURFACE,
    dpr,
    beatDisplay: 4,
    chartEndBeat: g.chartEndBeat,
    notes: NOTES,
    selectedItems: [],
    selectionBox: null,
    slideBuffer: null,
    hoverPos: null,
    clipboard: [],
    markerSeconds: null,
    armedTool: null,
    spriteIcon: { render: () => undefined, renderDecorator: () => undefined } as unknown as RenderCtx['spriteIcon'],
    noteIcons: buildActiveNoteIcons(normalizeNoteSkinSelection(undefined)),
    playing: false,
  };
}

describe('issue 212 · noteLayerCache DPR 与 Retina 2.0x 像素对齐', () => {
  it('TILE_DPR_CAP 为 2.0，对齐标准 Retina 屏幕', () => {
    expect(TILE_DPR_CAP).toBe(2.0);
  });

  it('getEffectiveDpr 算法：Retina 2.0x 及 Windows 各缩放档位开放 1:1 直通，超高分屏安全封顶 2.0', () => {
    // Windows 100% ~ 200% 与 Retina 2.0x
    expect(getEffectiveDpr(1.0)).toBe(1.0);
    expect(getEffectiveDpr(1.25)).toBe(1.25);
    expect(getEffectiveDpr(1.5)).toBe(1.5);
    expect(getEffectiveDpr(1.75)).toBe(1.75);
    expect(getEffectiveDpr(2.0)).toBe(2.0);

    // 超高分屏（如 3.0x / 4.0x）封顶为 2.0x，防范超大视口爆显存
    expect(getEffectiveDpr(3.0)).toBe(2.0);
    expect(getEffectiveDpr(4.0)).toBe(2.0);
  });

  describe('DPR=2.0 下瓦片位图生成与物理直绘 1:1 验证', () => {
    let cache: NoteLayerCache;
    let createdCanvases: Array<{ width: number; height: number }> = [];

    beforeEach(() => {
      cache = createNoteLayerCache();
      createdCanvases = [];
      cache.__setCanvasFactoryForTests(() => {
        const c = { width: 0, height: 0, getContext: () => makeNoopCtx() };
        createdCanvases.push(c);
        return c;
      });
    });

    it('DPR=2.0 时，离屏瓦片按 2.0x 光栅化，位图物理尺寸是 CSS 尺寸的严格 2.0 倍', () => {
      const g = new ChartGeometry([{ beat: 0, bpm: 120 }], { endBeat: 20 }, SURFACE);
      const y0 = g.beatToVirtualY(4, ES) - SURFACE.h / (2 * ES);
      const rc = makeRc(g, y0, 2.0);
      const ctx = makeNoopCtx();

      cache.draw(ctx, rc);

      // 应有包含音符的非空瓦片被创建
      expect(createdCanvases.length).toBeGreaterThan(0);
      const tileCanvas = createdCanvases[0];

      // 宽 = surface.w * 2.0 = 1600
      expect(tileCanvas.width).toBe(SURFACE.w * 2.0);
      // 高 = (TILE_PX * es) * 2.0 = 512 * 1 * 2 = 1024
      expect(tileCanvas.height).toBe(TILE_PX * ES * 2.0);

      // 瓦片像素比 / 主画布 DPR 严格为 1.0（无 1.333x 放大插值）
      const tileDpr = tileCanvas.width / SURFACE.w;
      expect(tileDpr).toBe(2.0);
      const screenDrawScale = rc.dpr / tileDpr;
      expect(screenDrawScale).toBe(1.0);
    });

    it('DPR=2.0 下显存预算与容量规划安全可控（64MiB 预算正常容纳）', () => {
      // 800 宽 × (512·1.0) CSS × 2.0 DPR = 1600 × 1024 × 4B = 6,553,600 B (6.25 MiB)
      const bytes = tileBytesFor(SURFACE.w, ES, 2.0);
      expect(bytes).toBe(1600 * 1024 * 4);
      // 64 MiB 预算能容纳 10 块，远超视口所需的 2~4 块
      const maxTiles = maxTilesForBudget(SURFACE.w, ES, 2.0);
      expect(maxTiles).toBe(10);
      expect(maxTiles).toBeGreaterThanOrEqual(4);
    });
  });
});
