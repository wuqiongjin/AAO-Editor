import { describe, expect, it } from 'vitest';
import { rasterBandRuns, type BandRasterInput } from '@/src/rendering/slideBandGeometry';
import { rasterizeBandsCooperatively } from '@/src/rendering/pipeline/bandRasterScheduler';

function input(): BandRasterInput {
  return {
    runs: [
      [{ x: 30.25, y: -20 }, { x: 80.5, y: 90 }, { x: 40.75, y: 180 }],
      [{ x: 40.75, y: 180 }, { x: 90.25, y: 90 }, { x: 50, y: -20 }],
    ],
    half: 15.3, profile: [0.15, 0.4, 0.85, 0.6, 0], rgb: [80, 250, 120],
    sx: 1.25, sy: 1.25, baseAlpha: 0.8,
    clipCss: { minX: 0, minY: 0, maxX: 130, maxY: 150 },
  };
}

describe('issue 234 · 带体分片保持像素与释放主线程', () => {
  it('计算跨多个任务，所有自叠/裁剪/透明度像素与同步输出逐字节相同', async () => {
    const source = input();
    let yields = 0;
    let clock = 0;
    const result = await rasterizeBandsCooperatively([source, { ...source, runs: [] }, source], {
      budgetMs: 2,
      now: () => ++clock,
      yieldTask: async () => { yields++; },
    });
    expect(yields).toBeGreaterThan(2);
    expect(result).toEqual([rasterBandRuns(source), null, rasterBandRuns(source)]);
  });

  it('任务取消后停止计算，不返回可提交的像素', async () => {
    let cancelled = false;
    let yields = 0;
    let clock = 0;
    const result = await rasterizeBandsCooperatively([input(), input()], {
      budgetMs: 1,
      now: () => ++clock,
      isCancelled: () => cancelled,
      yieldTask: async () => { yields++; cancelled = true; },
    });
    expect(result).toBeNull();
    expect(yields).toBe(1);
  });
});
