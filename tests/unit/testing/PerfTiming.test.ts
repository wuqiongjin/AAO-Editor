// test-infra 02：perf 用例的计时口径必须「CPU 时间 + 多次取最小」，不能退回单样本墙钟。
// 假时钟锁采样语义（取的是最小值，不是首个/平均值），静态断言锁时钟来源（不得用 performance.now）。
import { describe, it, expect } from 'vitest';
import { minCpuMs, sampleCpuMs } from '@/tests/support/perfTiming';
import { readStripped } from '@/tests/support/source';

/** 依次吐出给定读数；sampleCpuMs 每次采样读两次表（取差值） */
function clockOf(reads: number[]): () => number {
  let i = 0;
  return () => reads[i++] ?? reads[reads.length - 1]!;
}

describe('test-infra 02 · perf 计时口径', () => {
  it('每次采样 = 调用前后的读数差；三次 = [10, 100, 2]', () => {
    const clock = clockOf([0, 10, 10, 110, 110, 112]);
    expect(sampleCpuMs(() => undefined, 3, clock)).toEqual([10, 100, 2]);
  });

  it('取最小值：噪声样本（被抢占的长样本）不会污染预算判据', () => {
    const clock = clockOf([0, 10, 10, 110, 110, 112]);
    expect(minCpuMs(() => undefined, 3, clock)).toBe(2);
  });

  it('时钟倒退（跨线程口径变化）夹到 0，不产生负耗时', () => {
    const clock = clockOf([100, 90]);
    expect(sampleCpuMs(() => undefined, 1, clock)).toEqual([0]);
  });

  it('生产时钟必须是进程 CPU 时间（forks pool 口径），不得用墙钟', () => {
    const src = readStripped('tests/support/perfTiming.ts');
    expect(src).toMatch(/process\.cpuUsage\(\)/);
    expect(src).not.toMatch(/performance\.now/);
  });
});
