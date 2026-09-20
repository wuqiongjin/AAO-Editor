// IdleSchedule（issue 102）：把一段重活推到**浏览器空闲**再跑。
//
// 用途：谱面代码弹窗打开时，`convertNotesToChartCode` + `JSON.stringify(_, null, 4)` 对大谱面是
// 几百毫秒级的一次性开销；把它排进空闲时段，弹窗骨架就能先上屏，不让用户对着空白按钮等。
//
// 为什么和 `DebouncedTask` 一样抽成模块：这是**有时间语义的行为**（必须晚于本帧、可被取消），
// 抽出来能在 node 里直接单测；留在组件里就只剩静态源码断言可守（本仓口径见 DebouncedTask.ts 头注）。
export interface IdleRuntime {
  /** 起一个空闲回调；返回句柄（交给 clear 取消）。默认实现优先 requestIdleCallback，退化 setTimeout(0) */
  request(task: () => void, timeoutMs: number): unknown;
  clear(handle: unknown): void;
}

/** 浏览器空闲调度；没有 requestIdleCallback 时退化为下一个宏任务 */
const defaultRuntime: IdleRuntime = {
  request(task, timeoutMs) {
    const idle = globalThis as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (typeof idle.requestIdleCallback === 'function') {
      return idle.requestIdleCallback(task, { timeout: timeoutMs });
    }
    return setTimeout(task, 0);
  },
  clear(handle) {
    const idle = globalThis as { cancelIdleCallback?: (handle: number) => void };
    if (typeof idle.cancelIdleCallback === 'function') {
      idle.cancelIdleCallback(handle as number);
      return;
    }
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/**
 * 排一次空闲任务，返回**取消函数**（取消后任务保证不会再跑）。
 * `timeoutMs` 是 `requestIdleCallback` 的兜底：主线程持续繁忙时最多等这么久也一定要把它做掉。
 */
export function scheduleIdle(
  task: () => void,
  timeoutMs = 300,
  runtime: IdleRuntime = defaultRuntime,
): () => void {
  const handle = runtime.request(task, timeoutMs);
  return () => runtime.clear(handle);
}
