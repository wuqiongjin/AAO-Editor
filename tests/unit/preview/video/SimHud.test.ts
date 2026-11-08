// chart-preview 51：判定字的**纯函数**（什么时候出字、窗口多长）。
//
// 决定"实机像不像"：位置 / 字高 / 停留都是 2026-10-27 在预览台逐项调的定值（不跟轨道走）。
// 光栅观感（字压得准不准、弹得好不好看）归目视验收；AP combo 的样式在 `SimHudWiring` 里锁。
import { describe, expect, it } from 'vitest';
import {
  HUD_SPRITES,
  JUDGE_BOXES,
  LETTER_TEXTS,
  SCORE_DIGITS,
  SCORE_MAX,
  SCORE_RANKS,
  SCORE_RANK_THRESHOLDS,
  SCORE_TIERS,
  SCORE_TIER_THRESHOLDS,
  SIM_HUD,
  SIM_JUDGE,
  comboApActive,
  formatScore,
  judgeAt,
  judgeSprite,
  judgeStateAt,
  plusAgesAt,
  scoreAt,
  scoreForHits,
  scoreIncrement,
  scoreRankAt,
  scoreTierAt,
} from '@/src/preview/video/sim/simHud';
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

  it('切图只有两档：PERFECT / AUTO（其余 GREAT / GOOD / BAD / MISS / FAST / SLOW 不接）', () => {
    expect(judgeSprite()).toEqual({ x: 0, y: 177, w: 287, h: 79 });
    expect(judgeSprite(false)).toEqual(JUDGE_BOXES.perfect);
    expect(judgeSprite(true)).toEqual({ x: 289, y: 177, w: 205, h: 79 });
    expect(Object.keys(JUDGE_BOXES)).toEqual(['perfect', 'auto']);
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

describe('chart-preview 62 · AUTO 模式只改判定字 / AUTO LIVE / AP 辉光', () => {
  it('AUTO 下不存在「全 PERFECT」⇒ combo 保持素白；关掉 AUTO 才认 apCombo', () => {
    expect(comboApActive(true, true)).toBe(false);
    expect(comboApActive(false, true)).toBe(false);
    expect(comboApActive(true, false)).toBe(true);
    expect(comboApActive(false, false)).toBe(false);
  });
});

describe('chart-preview 63 · 归一分（1,000,000 / 7 位定宽）', () => {
  it('满分与位数是定值，格式化夹在 [0, 满分]', () => {
    expect(SCORE_MAX).toBe(1_000_000);
    expect(SCORE_DIGITS).toBe(7);
    expect(formatScore(2571)).toBe('0002571');
    expect(formatScore(0)).toBe('0000000');
    expect(formatScore(SCORE_MAX)).toBe('1000000');
    expect(formatScore(-3)).toBe('0000000');
    expect(formatScore(SCORE_MAX + 1)).toBe('1000000');
  });

  it('单音符增量 = floor(满分 / 可击打物总数)，最后一音补齐到满分', () => {
    expect(scoreIncrement(680)).toBe(1470);
    expect(scoreIncrement(3)).toBe(333333);
    expect(scoreIncrement(0)).toBe(0);
    expect(scoreForHits(0, 680)).toBe(0);
    expect(scoreForHits(1, 3)).toBe(333333);
    expect(scoreForHits(2, 3)).toBe(666666);
    expect(scoreForHits(3, 3)).toBe(SCORE_MAX);
    expect(scoreForHits(4, 3)).toBe(SCORE_MAX);
    expect(scoreForHits(2, 0)).toBe(0);
  });

  it('scoreAt 按**已命中数**累计，不按时间线性（负 beat 命中也算）', () => {
    const c = chart([1, 2, 3]);
    expect(scoreAt(c, 0.9)).toBe(0);
    expect(scoreAt(c, 1)).toBe(333333);
    expect(scoreAt(c, 2.5)).toBe(666666);
    expect(scoreAt(c, 3)).toBe(SCORE_MAX);
    expect(scoreAt(c, 99)).toBe(SCORE_MAX);
    expect(scoreAt(chart([]), 5)).toBe(0);
    expect(scoreAt(chart([-2, 1]), -1.8)).toBe(500000);
  });

  it('6 档分数条：阈值兼作灰带上的字母位置，全部取官方渐变条 A 的窗口', () => {
    expect(SCORE_TIER_THRESHOLDS).toEqual([0.06, 0.27, 0.48, 0.69, 0.9]);
    expect(SIM_HUD.thresholds).toEqual(SCORE_TIER_THRESHOLDS);
    expect(LETTER_TEXTS).toEqual(['C', 'B', 'A', 'S', 'SS']);
    expect(SCORE_TIERS.map((t) => t.id)).toEqual(['C-', 'C-B', 'B-A', 'A-S', 'S-SS', 'SS+']);
    expect(SCORE_TIERS.map((t) => [t.from, t.to])).toEqual([
      [0, 0.16], [0.02, 0.3], [0.55, 1], [0.3, 0.8], [0.08, 0.92], [0, 1],
    ]);
    expect(HUD_SPRITES.barA).toEqual([1, 393, 661, 22]);
    expect(scoreTierAt(0)).toBe(0);
    expect(scoreTierAt(60_000)).toBe(1);
    expect(scoreTierAt(480_000)).toBe(3);
    expect(scoreTierAt(950_000)).toBe(5);
  });

  it('结算 11 档 score-rank 与打歌 6 档**不是同一套**，按归一分映射', () => {
    expect(SCORE_RANKS).toEqual(['D', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S', 'S+', 'SS', 'SS+']);
    expect(SCORE_RANK_THRESHOLDS).toHaveLength(SCORE_RANKS.length);
    expect(scoreRankAt(0)).toBe('D');
    expect(scoreRankAt(150_000)).toBe('C');
    expect(scoreRankAt(550_000)).toBe('A');
    expect(scoreRankAt(999_999)).toBe('SS');
    expect(scoreRankAt(SCORE_MAX)).toBe('SS+');
  });

  it('`+增量` 多条并存：各算各的年龄，超出时长就退场', () => {
    const c = chart([1, 1.3, 1.6]);
    const rounded = (v: number[]) => v.map((n) => Number(n.toFixed(3)));
    expect(rounded(plusAgesAt(c, 1.7, 0.85))).toEqual([0.7, 0.4, 0.1]);
    expect(rounded(plusAgesAt(c, 2.0, 0.85))).toEqual([0.7, 0.4]);
    expect(plusAgesAt(c, 1.0, 0.85)).toEqual([0]);
    expect(plusAgesAt(c, 0.9, 0.85)).toEqual([]);
  });
});
