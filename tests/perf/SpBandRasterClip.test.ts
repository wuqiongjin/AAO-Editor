// issue 138 性能锁：倒流 SP 带按 clip/瓦片行光栅，像素不得按整条 bbox 膨胀。
// 几何等价 150030 在 5s 视口：8 个 fold run、布局高约 8s×440px，裁到一块 TILE_PX 瓦片。
import { describe, it, expect } from 'vitest';
import { rasterBandRuns, splitBandAtFolds } from '@/src/visual/slideBandGeometry';
import { TILE_PX } from '@/src/visual/noteLayerCache';

const PROFILE = [0.38, 0.38, 0.39, 0.40, 0.41, 0.43, 0.45, 0.48, 0.52, 0.56, 0.61, 0.67, 0.74, 0.82, 0.89, 0.62, 0.25];
const RGB = [0x4b, 0xe3, 0x71] as const;
const TILE_DPR = 1.5;
const SURFACE_W = 750;
const HALF = 15;

/** 8 臂来回（issue 116 形态），Y 跨 5462 CSS px（诊断环实测 maxBh 量级） */
function backflowPts() {
  const y0 = 0, y1 = 5462;
  const xs = [180, 140, 100, 60];
  const pts: { x: number; y: number }[] = [];
  for (const x of xs) {
    if (pts.length) pts.push({ x, y: y0 }); // 横跳
    pts.push({ x, y: y0 }, { x, y: y1 }, { x, y: y0 });
  }
  return pts;
}

describe('issue 138 · 倒流 SP 带光栅像素预算', () => {
  it('裁到瓦片行后像素 ≤ 瓦片面积 × 2（修前整条 bbox ≈ 2.6M）', () => {
    const runs = splitBandAtFolds(backflowPts());
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
