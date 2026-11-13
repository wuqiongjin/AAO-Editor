import { rasterBandRunsSteps, type BandRaster, type BandRasterInput } from '../slideBandGeometry';

interface RasterSchedule {
  budgetMs?: number;
  isCancelled?: () => boolean;
  now?: () => number;
  yieldTask?: () => Promise<void>;
}

/**
 * 一块瓦片的带体共享时间预算；每段工作后让浏览器处理播放帧。
 * 返回 null 表示整项取消；数组中的 null 表示对应带体没有可见像素。
 */
export async function rasterizeBandsCooperatively(
  inputs: readonly BandRasterInput[],
  schedule: RasterSchedule = {},
): Promise<(BandRaster | null)[] | null> {
  const now = schedule.now ?? (() => performance.now());
  const yieldTask = schedule.yieldTask ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  const isCancelled = schedule.isCancelled ?? (() => false);
  const budgetMs = schedule.budgetMs ?? 2;
  const results: (BandRaster | null)[] = [];
  let deadline = now() + budgetMs;
  for (const input of inputs) {
    const job = rasterBandRunsSteps(input);
    for (;;) {
      if (isCancelled()) return null;
      const step = job.next();
      if (step.done) { results.push(step.value); break; }
      if (now() >= deadline) {
        await yieldTask();
        deadline = now() + budgetMs;
      }
    }
    // 很多短带体也必须共同受预算约束。
    if (now() >= deadline) {
      await yieldTask();
      deadline = now() + budgetMs;
    }
  }
  return isCancelled() ? null : results;
}
