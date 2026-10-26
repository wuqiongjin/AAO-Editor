// chart-preview 51：判定字 / AP combo 态的**纯函数**（什么时候出字、什么颜色）。
//
// 这两块决定"实机像不像"：判定字位置是实机逐帧量测的定值（不跟轨道走）、AP 变色是
// v6.2.0「コンボ状態表示」的同款行为。光栅观感（字压得准不准、紫得好不好看）归目视验收。
import { describe, expect, it } from 'vitest';
import { SIM_AP_COMBO, SIM_JUDGE, apColorAt, judgeAt, judgeSprite } from '@/src/preview/video/sim/simHud';
import { tintedImage } from '@/src/preview/video/sim/simSprites';
import type { SimChart } from '@/src/preview/video/sim/simField';

const chart = (hitTimes: number[]): SimChart => ({
  approachS: 1,
  elements: [],
  bands: [],
  simultaneous: [],
  hitTimes,
});

describe('chart-preview 51 · 判定字（每音一条、位置固定）', () => {
  it('实机量测：字心 0.497W / 离判定线 0.092H / 高 0.042H', () => {
    expect(SIM_JUDGE.cx).toBe(0.497);
    expect(SIM_JUDGE.dy).toBe(0.092);
    expect(SIM_JUDGE.h).toBe(0.042);
    expect(SIM_JUDGE.life).toBeGreaterThan(0);
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

  it('负 beat 的命中也在表里（开播即已过线，ADR-0014），按同一条窗口取年龄', () => {
    expect(judgeAt(chart([-2, 1]), -1.8)).toBeCloseTo(0.2, 6);
    expect(judgeAt(chart([-2]), -1.5)).toBeNull(); // 0.5s > life
  });
});

describe('chart-preview 51 · AP combo 变色', () => {
  it('三档配色：数字恒紫、命中瞬间闪白 → 转紫、窗口外不叠', () => {
    expect(SIM_AP_COMBO.tint).toBe('#c17cff');
    expect(SIM_AP_COMBO.halo).toBe('#a06bff');
    expect(SIM_AP_COMBO.flash).toBe('#ffffff');
    expect(SIM_AP_COMBO.glow).toBe(1.05);

    expect(apColorAt(null)).toBeNull();
    expect(apColorAt(-1)).toBeNull();
    expect(apColorAt(0)).toBe('#ffffff');
    expect(apColorAt(SIM_AP_COMBO.flashWindow)).toBe('#ffffff');
    expect(apColorAt(SIM_AP_COMBO.flashWindow + 0.01)).toBe('#a06bff');
    expect(apColorAt(SIM_AP_COMBO.glow)).toBe('#a06bff');
    expect(apColorAt(SIM_AP_COMBO.glow + 0.01)).toBeNull();
  });

  it('无 DOM（node 单测）时染色退回原图 —— 不抛错、不返回 null', () => {
    const img = { naturalWidth: 720, naturalHeight: 96 } as unknown as HTMLImageElement;
    expect(tintedImage(img, '#c17cff')).toBe(img);
  });
});
