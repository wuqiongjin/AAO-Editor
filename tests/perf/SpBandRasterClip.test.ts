// issue 138 性能锁：倒流 SP 带按 clip/瓦片行光栅，像素不得按整条 bbox 膨胀。
// 几何：8 个 fold run、布局高约 8s×440px 量级，裁到一块 TILE_PX 瓦片（见 perfBackflowPlayback）。
import { describe, it, expect } from 'vitest';
import { rasterBandRuns, splitBandAtFolds } from '@/src/visual/slideBandGeometry';
import { TILE_PX } from '@/src/visual/noteLayerCache';
import {
  BACKFLOW_RASTER_PROFILE, BACKFLOW_RASTER_RGB, backflowFoldCanvasPoints,
} from '@/tests/support/perfBackflowPlayback';

const PROFILE = BACKFLOW_RASTER_PROFILE;
const RGB = BACKFLOW_RASTER_RGB;
const TILE_DPR = 1.5;
const SURFACE_W = 750;
const HALF = 15;

describe('issue 138 · 倒流 SP 带光栅像素预算', () => {
  it('裁到瓦片行后像素 ≤ 瓦片面积 × 2（修前整条 bbox ≈ 2.6M）', () => {
    const runs = splitBandAtFolds(backflowFoldCanvasPoints());
    expect(runs.length).toBeGreaterThanOrEqual(8);
    const clipH = TILE_PX;
    const r = rasterBandRuns({
      runs, half: HALF, profile: PROFILE, rgb: RGB,
      sx: TILE_DPR, sy: TILE_DPR, baseAlpha: 1,
      clipCss: { minX: 0, minY: 0, maxX: SURFACE_W, maxY: clipH },
    });
    expect(r).not.toBeNull();
    const tilePx = Math.ceil(SURFACE_W * TILE_DPR) * Math.ceil(clipH * TILE_DPR);
    expect(r!.bw * r!.bh).toBeLessThanOrEqual(tilePx * 2);
    expect(r!.bh).toBeLessThanOrEqual(Math.ceil((clipH + 4) * TILE_DPR) + 2);
  });
});
