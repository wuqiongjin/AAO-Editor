// IdleSchedule（issue 102）：空闲调度的时间语义 —— 不同步跑、可取消、兜底 timeout 传得下去。
// node 环境没有 requestIdleCallback，本文件默认覆盖退化路径；浏览器那条由注入 runtime 覆盖。
import { describe, it, expect } from 'vitest';
import { scheduleIdle, type IdleRuntime } from '@/src/chart/editing/IdleSchedule';

/** 手工 runtime：记录 request/clear，手动 fire */
function fakeRuntime() {
  let seq = 0;
  const requested: { id: number; timeoutMs: number }[] = [];
  const cleared: number[] = [];
  const runtime: IdleRuntime & {
    readonly requested: { id: number; timeoutMs: number }[];
    readonly cleared: number[];
  } = {
    request(_task, timeoutMs) {
      const id = ++seq;
      requested.push({ id, timeoutMs });
      return id;
    },
    clear(handle) {
      cleared.push(handle as number);
    },
    get requested() { return requested; },
    get cleared() { return cleared; },
  };
  return runtime;
}

describe('IdleSchedule · 退化路径（node 无 requestIdleCallback）', () => {
  it('不同步跑：排完立即返回时任务还没执行', async () => {
    let ran = false;
    scheduleIdle(() => { ran = true; });
    expect(ran).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(ran).toBe(true);
  });

  it('cancel 后任务不再执行', async () => {
    let ran = false;
    const cancel = scheduleIdle(() => { ran = true; });
    cancel();
    await new Promise((r) => setTimeout(r, 5));
    expect(ran).toBe(false);
  });
});

describe('IdleSchedule · 注入 runtime（浏览器那条也能验）', () => {
  it('requestIdleCallback 走 request + 带兜底 timeout；cancel 交回同一个句柄', () => {
    const runtime = fakeRuntime();
    let ran = false;
    const cancel = scheduleIdle(() => { ran = true; }, 300, runtime);
    expect(runtime.requested.length).toBe(1);
    expect(runtime.requested[0]!.timeoutMs).toBe(300);
    expect(ran).toBe(false);

    cancel();
    expect(runtime.cleared).toEqual([runtime.requested[0]!.id]);
  });

  it('timeout 默认值 300（主线程持续繁忙时的兜底）', () => {
    const runtime = fakeRuntime();
    scheduleIdle(() => undefined, undefined, runtime);
    expect(runtime.requested[0]!.timeoutMs).toBe(300);
  });
});
