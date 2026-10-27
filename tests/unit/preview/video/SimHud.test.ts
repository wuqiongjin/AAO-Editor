// chart-preview 51：判定字的**纯函数**（什么时候出字、窗口多长）。
//
// 决定"实机像不像"：位置 / 字高 / 停留都是 2026-10-27 在预览台逐项调的定值（不跟轨道走）。
// 光栅观感（字压得准不准、弹得好不好看）归目视验收；AP combo 的样式在 `SimHudWiring` 里锁。
import { describe, expect, it } from 'vitest';
import { SIM_JUDGE, judgeAt, judgeSprite, judgeStateAt } from '@/src/preview/video/sim/simHud';
import type { SimChart } from '@/src/preview/video/sim/simField';

const chart = (hitTimes: number[]): SimChart => ({
  approachS: 1,
  elements: [],
  bands: [],
  simultaneous: [],
  hitTimes,
});

describe('chart-preview 51 · 判定字（每音一条、位置固定）', () => {
  it('原型定稿（2026-10-27 预览台调）：字心 0.497W / 离判定线 0.10H / 高 0.08H / 停留 1s', () => {
    expect(SIM_JUDGE.cx).toBe(0.497);
    expect(SIM_JUDGE.dy).toBe(0.1);
    expect(SIM_JUDGE.h).toBe(0.08);
    expect(SIM_JUDGE.life).toBe(1);
    expect(SIM_JUDGE.pop).toBe(0.2);
  });

  it('切图坐标 = `judge_perfect`（其余四档 / AUTO / FAST / SLOW 本期不用）', () => {
    expect(judgeSprite()).toEqual({ x: 0, y: 177, w: 287, h: 79 });
  });

  it('取**最近一次**命中的年龄；没命中过 / 超出停留时长 ⇒ null', () => {
    const c = chart([1, 2, 3]);
    expect(judgeAt(c, 0.9)).toBeNull(); // 还没到第一音
    expect(judgeAt(c, 1.2)).toBeCloseTo(0.2, 6);
    expect(judgeAt(c, 2.05)).toBeCloseTo(0.05, 6); // 取最近的（2.0），不是 1.0
    expect(judgeAt(c, 3 + SIM_JUDGE.life + 0.01)).toBeNull();
    expect(judgeAt(chart([]), 1)).toBeNull();
  });

  it('高密度叠字：上一个还没消失就再打中 ⇒ `stacked`（不许再淡入）', () => {
    // 间隔 0.5s < life(1s) ⇒ 第二次命中时上一个还在屏幕上
    const st = (hits: number[], at: number) => judgeStateAt(chart(hits), at, 1);
    const close = (v: ReturnType<typeof st>) => ({ age: Number(v?.age.toFixed(6)), stacked: v?.stacked });
    expect(close(st([0, 0.5], 0.6))).toEqual({ age: 0.1, stacked: true });
    // 间隔 2s > life ⇒ 上一次早没了，正常淡入
    expect(close(st([0, 2], 2.1))).toEqual({ age: 0.1, stacked: false });
    // 第一个音没有"上一个"
    expect(close(st([1], 1.2))).toEqual({ age: 0.2, stacked: false });
    // 窗口外
    expect(judgeStateAt(chart([0]), 1.5, 1)).toBeNull();
  });

  it('负 beat 的命中也在表里（开播即已过线，ADR-0014），按同一条窗口取年龄', () => {
    expect(judgeAt(chart([-2, 1]), -1.8)).toBeCloseTo(0.2, 6);
    expect(judgeAt(chart([-2]), -0.5)).toBeNull(); // 1.5s > life(1s)
  });
});
