// @vitest-environment jsdom
// issue 36 锁测 1：relTime 定时刷新靠单一共享 ticker（NowProvider + useNow）。
//
// 症状（票 31 验收现场）：「N 分钟前」渲染时求值一次，不随时间走，切走再切回来才变。
// 修法是一个 timer 服务全部消费方。本文件锁两条硬事实（撤对应实现形态应立刻红）：
//   1. 到 tick 重渲染：30s 一跳，消费方拿到的 now 跟着走；没到 tick 不乱跳。
//   2. 多消费方共享同一 timer：N 个消费方只跑一个 setInterval —— 谁把 ticker 收回
//      调用点（一处一个 setInterval）或给每个消费方各套一个 Provider，这条会红。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { NOW_TICK_MS, NowProvider, useNow } from '@/src/app/providers/NowProvider';

const T0 = new Date('2026-10-14T10:00:00.000Z').getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('issue 36 · 共享 ticker（NowProvider + useNow）', () => {
  it('到 tick 重渲染：30s 一跳 now 跟着走，没到 tick 不乱跳', () => {
    const { result } = renderHook(() => useNow(), { wrapper: NowProvider });

    expect(result.current).toBe(T0);

    act(() => { vi.advanceTimersByTime(NOW_TICK_MS - 1); });
    expect(result.current).toBe(T0); // 差 1ms 都不提前跳

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(T0 + NOW_TICK_MS);
  });

  it('多消费方共享同一 timer：三个消费方只跑一个 setInterval（撤共享应红）', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const seen: number[] = [];
    function Consumer() {
      seen.push(useNow());
      return null;
    }

    render(
      <NowProvider>
        <Consumer />
        <Consumer />
        <Consumer />
      </NowProvider>,
    );

    // 一个 timer、且间隔就是 30s（悄悄改成秒级会让整页高频重渲）
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.any(Function), NOW_TICK_MS);
    spy.mockRestore();

    // 首帧：全部消费方拿到同一个 now
    expect(seen).toEqual([T0, T0, T0]);

    // 一跳之后：全部消费方一起重渲染，且拿到同一个新 now
    act(() => { vi.advanceTimersByTime(NOW_TICK_MS); });
    expect(seen).toEqual([T0, T0, T0, T0 + NOW_TICK_MS, T0 + NOW_TICK_MS, T0 + NOW_TICK_MS]);
  });

  it('Provider 卸载即停表：不留孤儿 timer', () => {
    function Consumer() {
      useNow();
      return null;
    }
    const { unmount } = render(<NowProvider><Consumer /></NowProvider>);
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
