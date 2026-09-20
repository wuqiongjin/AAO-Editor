// DebouncedTask（issue 102）：谱面代码「输入校验」的时间语义（打字停手后才校验）。
// 用注入的假计时器，**不依赖 vi.useFakeTimers** —— 假的 set/clear 直接录句柄，
// 断言读的就是真实调用序列。
import { describe, it, expect } from 'vitest';
import { createDebouncedTask, type TaskTimers } from '@/src/chart/editing/DebouncedTask';

/** 手工时钟的假计时器：advance 按时间推进，到点即跑 */
function fakeTimers() {
  let seq = 0;
  let now = 0;
  const pending = new Map<number, { task: () => void; runAt: number }>();
  const cleared: number[] = [];
  const timers: TaskTimers & {
    advance(ms: number): void;
    readonly clearedHandles: number[];
    readonly size: number;
  } = {
    set(task, delayMs) {
      const handle = ++seq;
      pending.set(handle, { task, runAt: now + delayMs });
      return handle;
    },
    clear(handle) {
      cleared.push(handle as number);
      pending.delete(handle as number);
    },
    advance(ms) {
      now += ms;
      for (const [handle, entry] of [...pending]) {
        if (entry.runAt <= now) {
          pending.delete(handle);
          entry.task();
        }
      }
    },
    get clearedHandles() { return cleared; },
    get size() { return pending.size; },
  };
  return timers;
}

describe('DebouncedTask · 连发只结算最后一次', () => {
  it('schedule 后任务不会同步执行，到点才跑', () => {
    const timers = fakeTimers();
    const task = createDebouncedTask(250, timers);
    const ran: string[] = [];
    task.schedule(() => ran.push('run'));
    expect(ran).toEqual([]);
    expect(timers.size).toBe(1);
    timers.advance(249);
    expect(ran).toEqual([]);
    timers.advance(1);
    expect(ran).toEqual(['run']);
    expect(timers.size).toBe(0);
  });

  it('连发折叠：中间几次都被取消，只有最后一次落地', () => {
    const timers = fakeTimers();
    const task = createDebouncedTask(250, timers);
    const ran: number[] = [];
    for (const i of [1, 2, 3, 4]) task.schedule(() => ran.push(i));
    timers.advance(250);
    expect(ran).toEqual([4]);
    // 前三次各自的计时器都必须被收掉，否则会各自到点跑一遍（= 每键都全量校验）
    expect(timers.clearedHandles.length).toBe(3);
    expect(timers.size).toBe(0);
  });

  it('cancel 彻底作废待跑任务，且不与后续 schedule 串味', () => {
    const timers = fakeTimers();
    const task = createDebouncedTask(250, timers);
    const ran: number[] = [];
    task.schedule(() => ran.push(1));
    task.cancel();
    timers.advance(1000);
    expect(ran).toEqual([]);
    expect(timers.size).toBe(0);

    task.schedule(() => ran.push(2));
    timers.advance(250);
    expect(ran).toEqual([2]);
  });

  it('任务里再 schedule 不会自噬（重 schedule 前状态已摘干净）', () => {
    const timers = fakeTimers();
    const task = createDebouncedTask(250, timers);
    let n = 0;
    const again = () => { n++; if (n < 3) task.schedule(again); };
    task.schedule(again);
    timers.advance(250);
    timers.advance(250);
    timers.advance(250);
    expect(n).toBe(3);
    expect(timers.size).toBe(0);
  });
});
