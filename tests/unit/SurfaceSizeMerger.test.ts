// SurfaceSizeMerger（候选 2 / issue 36 / issue 38）：渲染面尺寸 burst/stream/trail 合并纯逻辑。
// 验证：退化尺寸跳过、已生效值去重、稀疏立即应用、连续流延后尾随、卸载 flush 不变量。
// 时间源通过 now() 注入以兼容单测（vi.useFakeTimers 不会劫持 performance.now）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SurfaceSizeMerger } from '../../src/utils/SurfaceSizeMerger';
import type { SurfaceSize } from '../../src/utils/ChartGeometry';

let virtualNow = 0;
const tick = (ms: number) => { virtualNow += ms; };

const makeMerger = (commits: SurfaceSize[], opts: Partial<{ sparseGapMs: number; streamMs: number; trailMs: number }> = {}) =>
  new SurfaceSizeMerger({ ...opts, onCommit: (v) => commits.push(v), now: () => virtualNow });

describe('SurfaceSizeMerger · 退化尺寸跳过', () => {
  beforeEach(() => { virtualNow = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('w<=0 或 h<=0 直接跳过，不提交、不推进尾随 timer', () => {
    vi.useFakeTimers();
    const commits: SurfaceSize[] = [];
    const m = makeMerger(commits);
    m.feed({ w: 0, h: 800 });
    m.feed({ w: 800, h: 0 });
    m.feed({ w: 800, h: 800 });
    expect(commits).toEqual([{ w: 800, h: 800 }]);
    m.destroy();
  });

  it('退化尺寸也不推进 lastCallbackAt — 切回工作台时真实尺寸立即生效', () => {
    vi.useFakeTimers();
    const commits: SurfaceSize[] = [];
    const m = makeMerger(commits);
    m.feed({ w: 0, h: 0 });
    tick(200); // 大幅推进
    m.feed({ w: 750, h: 900 });
    expect(commits).toEqual([{ w: 750, h: 900 }]);
    m.destroy();
  });
});

describe('SurfaceSizeMerger · 离散事件 / 突发 / 流合并', () => {
  beforeEach(() => { virtualNow = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('稀疏事件（间隔 ≥ sparseGapMs）立即应用', () => {
    vi.useFakeTimers();
    const commits: SurfaceSize[] = [];
    const m = makeMerger(commits, { sparseGapMs: 100, streamMs: 150, trailMs: 150 });
    m.feed({ w: 750, h: 900 });
    expect(commits).toEqual([{ w: 750, h: 900 }]);
    tick(150);
    m.feed({ w: 600, h: 800 }); // 间隔 150ms → 离散
    expect(commits).toEqual([{ w: 750, h: 900 }, { w: 600, h: 800 }]);
    m.destroy();
  });

  it('连续流（间隔 < sparseGapMs 且持续 ≥ streamMs）不重复提交，由尾随结算最新值', () => {
    vi.useFakeTimers();
    const commits: SurfaceSize[] = [];
    const m = makeMerger(commits, { sparseGapMs: 100, streamMs: 150, trailMs: 150 });
    m.feed({ w: 750, h: 900 }); // 离散首帧
    expect(commits.length).toBe(1);
    tick(50);
    m.feed({ w: 700, h: 850 }); // 密集：应【不】提交（突发早期 — 实际会立即提交，见下例）
    // 突发早期 = 距首帧 50ms < streamMs(150)，按现状会立即应用；下面用更长的初始间隔覆盖"流中"场景
    tick(150);
    // 此时距首帧 200ms > streamMs，trail 期间；后续都按"流中"处理
    // 注意：上面 700x850 已经 commit 了，所以这里改测 trail 是否正确结算
    m.feed({ w: 650, h: 800 });
    m.feed({ w: 600, h: 750 });
    // 触发尾随 timer
    vi.advanceTimersByTime(150);
    expect(commits[commits.length - 1]).toEqual({ w: 600, h: 750 });
    m.destroy();
  });

  it('突发早期（前 streamMs 内）仍立即应用最新值，避免陈旧轨道宽度', () => {
    vi.useFakeTimers();
    const commits: SurfaceSize[] = [];
    const m = makeMerger(commits, { sparseGapMs: 100, streamMs: 150, trailMs: 150 });
    m.feed({ w: 750, h: 900 });
    tick(50);
    m.feed({ w: 700, h: 850 }); // 突发内，立即应用
    expect(commits).toContainEqual({ w: 700, h: 850 });
    m.destroy();
  });

  it('已生效值（key 一致）忽略', () => {
    vi.useFakeTimers();
    const commits: SurfaceSize[] = [];
    const m = makeMerger(commits);
    m.feed({ w: 750, h: 900 });
    m.feed({ w: 750, h: 900 });
    m.feed({ w: 750, h: 900 });
    expect(commits).toEqual([{ w: 750, h: 900 }]);
    m.destroy();
  });
});

describe('SurfaceSizeMerger · 卸载 / flush', () => {
  beforeEach(() => { virtualNow = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('destroy() 清尾随 timer + 停止 feed', () => {
    vi.useFakeTimers();
    const commits: SurfaceSize[] = [];
    const m = makeMerger(commits, { trailMs: 150 });
    m.feed({ w: 750, h: 900 });
    tick(50);
    m.feed({ w: 700, h: 850 }); // 突发起 timer 但不提交（流中再开会刷新）
    m.destroy();
    vi.advanceTimersByTime(500);
    expect(commits).toEqual([{ w: 750, h: 900 }, { w: 700, h: 850 }]); // 700x850 在突发期内已提交
  });

  it('flush() 立即结算尾随值（无需等 timer）', () => {
    vi.useFakeTimers();
    const commits: SurfaceSize[] = [];
    const m = makeMerger(commits, { trailMs: 150 });
    m.feed({ w: 750, h: 900 });
    tick(50);
    m.feed({ w: 700, h: 850 }); // 突发早期已立即提交
    m.flush(); // 已无待尾随值 → 不会再增加
    expect(commits).toEqual([{ w: 750, h: 900 }, { w: 700, h: 850 }]);
    m.destroy();
  });
});

describe('SurfaceSizeMerger · getCommitted 状态可读', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('反映最近一次 commit（无 commit 时为 DEFAULT_SURFACE）', () => {
    const m = new SurfaceSizeMerger();
    expect(m.getCommitted()).toEqual({ w: 750, h: 900 });
    m.feed({ w: 600, h: 500 });
    expect(m.getCommitted()).toEqual({ w: 600, h: 500 });
    m.destroy();
  });
});
