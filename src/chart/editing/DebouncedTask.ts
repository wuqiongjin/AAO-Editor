// DebouncedTask（issue 102）：**连发只结算最后一次**的纯逻辑，脱离组件也能单测。
//
// 用途：谱面代码弹窗的输入校验 —— 每敲一个字都全量 JSON.parse + 逐条校验是重复劳动，
// 校验因此落到「打字停手」之后的静默窗口里跑一次。
//
// 为什么抽出模块而不是在组件里写 setTimeout：这是**行为**（连发折叠、可取消），值得有时间语义的
// 单测；留在组件里就只能靠静态源码断言（tests/static 那套是本仓的过渡手段，能写成真单测的不该放那儿）。
export interface TaskTimers {
  /** 起一个计时器；句柄原样交回 clear */
  set(task: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface DebouncedTask {
  /** 排一次执行：取消上一次尚未跑的，只让最后一次到点。**永不同步执行**。 */
  schedule(task: () => void): void;
  /** 取消待跑的那次（下次 schedule 重新计时） */
  cancel(): void;
}

const defaultTimers: TaskTimers = {
  set: (task, delayMs) => setTimeout(task, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createDebouncedTask(delayMs: number, timers: TaskTimers = defaultTimers): DebouncedTask {
  let handle: unknown = null;
  let queued: (() => void) | null = null;

  /** 到点出口：先摘干净计时状态再跑，任务里再 schedule 也不会自噬 */
  const fire = () => {
    const task = queued;
    handle = null;
    queued = null;
    task?.();
  };

  return {
    schedule(task) {
      queued = task;
      if (handle !== null) timers.clear(handle);
      handle = timers.set(fire, delayMs);
    },
    cancel() {
      if (handle !== null) {
        timers.clear(handle);
        handle = null;
      }
      queued = null;
    },
  };
}
