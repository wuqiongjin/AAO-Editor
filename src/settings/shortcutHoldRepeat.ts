// 自管按住节拍器（issue 251）：第一次立刻派发，约 400ms 后再按 250ms 连发。
// 系统 `e.repeat` 大约 30Hz，不能叠在这上面——调用方遇到 repeat 的 keydown 必须丢掉。
import type { FunctionId } from './ShortcutConfig';

export const HOLD_REPEAT_DELAY_MS = 400;
export const HOLD_REPEAT_INTERVAL_MS = 250;

export interface HoldRepeatSession {
  /** 首次（`isRepeat === false`）立刻派发并开节拍；repeat 丢弃且不重开计时器。后按下的功能覆盖前一个。 */
  onKeyDown: (fn: FunctionId, isRepeat: boolean) => void;
  /** 松的是当前按住的功能才停；另一键的 keyup 不影响。 */
  onKeyUp: (fn: FunctionId) => void;
  stop: () => void;
}

export function createHoldRepeatSession(opts: {
  dispatch: (fn: FunctionId) => void;
  delayMs?: number;
  intervalMs?: number;
}): HoldRepeatSession {
  const delayMs = opts.delayMs ?? HOLD_REPEAT_DELAY_MS;
  const intervalMs = opts.intervalMs ?? HOLD_REPEAT_INTERVAL_MS;
  let held: FunctionId | null = null;
  let delayId: ReturnType<typeof setTimeout> | undefined;
  let intervalId: ReturnType<typeof setInterval> | undefined;

  const clearTimers = (): void => {
    if (delayId !== undefined) clearTimeout(delayId);
    if (intervalId !== undefined) clearInterval(intervalId);
    delayId = undefined;
    intervalId = undefined;
  };

  const stop = (): void => {
    held = null;
    clearTimers();
  };

  const arm = (fn: FunctionId): void => {
    stop();
    held = fn;
    opts.dispatch(fn);
    delayId = setTimeout(() => {
      delayId = undefined;
      opts.dispatch(fn);
      intervalId = setInterval(() => opts.dispatch(fn), intervalMs);
    }, delayMs);
  };

  return {
    onKeyDown(fn, isRepeat) {
      if (isRepeat) return;
      if (held === fn) return;
      arm(fn);
    },
    onKeyUp(fn) {
      if (held === fn) stop();
    },
    stop,
  };
}
