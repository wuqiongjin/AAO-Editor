// perf 用例的计时口径：**进程 CPU 时间 + 多次取最小**，不用单样本墙钟。
//
// 为什么（test-infra 02 / basic-editor 173）：全量跑默认 `pool: 'forks'`、
// `maxWorkers = availableParallelism() - 1`，perf 用例要和 6 个邻居抢 CPU。
// `performance.now()` 差值把「进程被调度出去」「GC 停顿」「cgroup 配额掐断」
// 都算成被测函数的成本 —— 实测 `convertNotesToChartCode`（5000 音符）空载中位数 0.5ms，
// 8× 抢占下单样本最大 78.7ms（约 160×），于是 60ms 预算的断言随机红。
//
// 为什么取 min：抢占只会让样本变长、不会变短，最小值最接近「这段同步 JS 独占 CPU 的成本」。
// 单次 `process.cpuUsage()` 还会带上 V8 并发标记线程的 CPU，取 min 一并滤掉这类噪声。
//
// 前提：`pool: 'forks'`（vitest 4 默认）。`process.cpuUsage()` 是**整进程**口径；
// 若改成 threads / vmThreads，会把所有 worker 线程的 CPU 累加进来，断言随即失真。
// 参考实现：`tests/perf/RendererPerf.test.ts` 的缩放手势帧（issue 173）。

/** 读一次本进程累计 CPU 时间（ms，user + system，含各线程） */
export function processCpuMs(): number {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
}

/**
 * 预热 2 次后连续采样 `samples` 次，返回每次调用的进程 CPU 时间（ms）。
 * `clock` 只给单测注入假时钟，生产调用不传。
 */
export function sampleCpuMs(
  fn: () => unknown,
  samples = 7,
  clock: () => number = processCpuMs,
): number[] {
  fn();
  fn();
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    const c0 = clock();
    fn();
    out.push(Math.max(0, clock() - c0));
  }
  return out;
}

/** 同步片段的最优成本估计：N 次采样取最小值（ms） */
export function minCpuMs(fn: () => unknown, samples = 7, clock?: () => number): number {
  return Math.min(...sampleCpuMs(fn, samples, clock));
}
