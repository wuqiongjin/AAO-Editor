import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HOLD_REPEAT_DELAY_MS,
  HOLD_REPEAT_INTERVAL_MS,
  createHoldRepeatSession,
} from '@/src/settings/shortcutHoldRepeat';
import type { FunctionId } from '@/src/settings/ShortcutConfig';

describe('issue 251 · 自管连发节拍器', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('空窗 300ms、间隔 50ms（快过连点，仍低于系统 ~30Hz）', () => {
    expect(HOLD_REPEAT_DELAY_MS).toBe(300);
    expect(HOLD_REPEAT_INTERVAL_MS).toBe(50);
  });

  const setup = () => {
    const dispatch = vi.fn<(fn: FunctionId) => void>();
    const session = createHoldRepeatSession({ dispatch });
    return { dispatch, session };
  };

  it('第一次 keydown 立刻派发；随后 e.repeat 的 keydown 0 次派发', () => {
    const { dispatch, session } = setup();
    session.onKeyDown('seekForward', false);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenLastCalledWith('seekForward');
    session.onKeyDown('seekForward', true);
    session.onKeyDown('seekForward', true);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('空窗结束后立刻再跳一步，之后按间隔由计时器派发', () => {
    const { dispatch, session } = setup();
    session.onKeyDown('seekForward', false);
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS - 1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(dispatch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(HOLD_REPEAT_INTERVAL_MS);
    expect(dispatch).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(HOLD_REPEAT_INTERVAL_MS);
    expect(dispatch).toHaveBeenCalledTimes(4);
  });

  it('keyup 停止；再过时间不再派发', () => {
    const { dispatch, session } = setup();
    session.onKeyDown('seekForward', false);
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS);
    expect(dispatch).toHaveBeenCalledTimes(2);
    session.onKeyUp('seekForward');
    vi.advanceTimersByTime(1000);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('stop（blur / active:false 同路）立刻停', () => {
    const { dispatch, session } = setup();
    session.onKeyDown('seekBack', false);
    session.stop();
    vi.advanceTimersByTime(1000);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('两键同时按住：后按下的方向覆盖前一个', () => {
    const { dispatch, session } = setup();
    session.onKeyDown('seekBack', false);
    session.onKeyDown('seekForward', false);
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual(['seekBack', 'seekForward']);
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS);
    expect(dispatch.mock.calls.slice(2).every((c) => c[0] === 'seekForward')).toBe(true);
    session.onKeyUp('seekBack');
    vi.advanceTimersByTime(HOLD_REPEAT_INTERVAL_MS);
    expect(dispatch.mock.calls.at(-1)?.[0]).toBe('seekForward');
    session.onKeyUp('seekForward');
    const n = dispatch.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(dispatch).toHaveBeenCalledTimes(n);
  });
});
