// 自管按住节拍器（issue 251）：keydown 立刻派发第一下（此时还分不出单击/按住）；
// 仍按住则约 300ms 后再按 50ms 连发。系统 `e.repeat` 大约 30Hz，不能叠在这上面。
import type { FunctionId } from './ShortcutConfig';

export const HOLD_REPEAT_DELAY_MS = 300;
export const HOLD_REPEAT_INTERVAL_MS = 50;

export interface HoldRepeatSession {
  /** 首次（`isRepeat === false`）立刻派发并开节拍；repeat 丢弃且不重开计时器。后按下的功能覆盖前一个。 */
  onKeyDown: (fn: FunctionId, isRepeat: boolean) => void;
  /** 松的是当前按住的功能才停；另一键的 keyup 不影响。 */
  onKeyUp: (fn: FunctionId) => void;
  stop: () => void;
}

export function createHoldRepeatSession(opts: {
  dispatch: (fn: FunctionId) => void;
}): HoldRepeatSession {
  const delayMs = HOLD_REPEAT_DELAY_MS;
  const intervalMs = HOLD_REPEAT_INTERVAL_MS;
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
