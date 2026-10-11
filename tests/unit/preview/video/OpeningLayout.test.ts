// chart-preview 30：视频开场的**版式**（票「锁测」明列的那条）——
//
//   原型的常量按**帧高比例**：1080p 与 720p 的比例换算必须**等比一致**，
//   封面边长 / 条高 / 字号落值也钉在这里（改比例会同时改掉导出物的观感，不许悄悄漂）。
//
// 为什么单测：`openingStackMetrics` / 各比例常量都是纯函数与常量，落值能直接断言；
// **光栅观感**（装饰像不像官方、过渡好不好看）不归这里，归原型目视验收 + 用户导一条真视频看。
import { describe, expect, it } from 'vitest';
import {
  OPENING_ARTIST_FONT,
  OPENING_BADGE_FONT,
  OPENING_BAND_H,
  OPENING_COVER_RATIO,
  OPENING_CREDIT_FONT,
  OPENING_CREDIT_LINE_FACTOR,
  OPENING_FRAME_LINE,
  OPENING_GAP_ARTIST_CREDIT,
  OPENING_GAP_BAND_ARTIST,
  OPENING_STACK_INSET,
  OPENING_STACK_T,
  OPENING_TITLE_FONT,
  openingStackMetrics,
} from '@/src/preview/video/opening';
import type { OpeningItemId } from '@/src/preview/video/opening';

const ALL: OpeningItemId[] = ['difficulty', 'title', 'artist'];

/** 两个档位的画布（1080p 与 720p，都是 16:9） */
const TIERS: Array<{ name: string; w: number; h: number }> = [
  { name: '1080p', w: 1920, h: 1080 },
  { name: '720p', w: 1280, h: 720 },
];

const RATIOS = [
  ['cover', OPENING_COVER_RATIO],
  ['stackT', OPENING_STACK_T],
  ['stackInset', OPENING_STACK_INSET],
  ['badgeFont', OPENING_BADGE_FONT],
  ['bandH', OPENING_BAND_H],
  ['titleFont', OPENING_TITLE_FONT],
  ['artistFont', OPENING_ARTIST_FONT],
  ['creditFont', OPENING_CREDIT_FONT],
  ['frameLine', OPENING_FRAME_LINE],
] as const;

describe('chart-preview 30 · 版式按帧高比例（1080p / 720p 等比一致）', () => {
  it('两档下各项几何的**帧高比例**完全一致', () => {
    const at = (w: number, h: number) => {
      const m = openingStackMetrics(w, h, ALL);
      return {
        cover: m.cover / h,
        stackD: m.stackD / h,
        stackInset: m.stackInset / h,
        badgeH: m.badgeH / h,
        bandH: m.bandH / h,
        badgeFont: m.badgeFont / h,
        artistFont: m.artistFont / h,
        // 水平居中：封面左缘 = (宽 − 边长) / 2
        coverX: m.coverX / w,
        // 垂直居中：整块上留白 = 下留白
        topFrac: m.top / h,
        bottomFrac: (h - m.bottom) / h,
      };
    };
    const a = at(1920, 1080);
    const b = at(1280, 720);
    // 比例口径 ⇒ 两档只差取整（相对 1e-2 内）
    expect(b.cover).toBeCloseTo(a.cover, 2);
    expect(b.stackD).toBeCloseTo(a.stackD, 2);
    expect(b.stackInset).toBeCloseTo(a.stackInset, 2);
    expect(b.badgeH).toBeCloseTo(a.badgeH, 2);
    expect(b.bandH).toBeCloseTo(a.bandH, 2);
    expect(b.badgeFont).toBeCloseTo(a.badgeFont, 2);
    expect(b.artistFont).toBeCloseTo(a.artistFont, 2);
    expect(b.coverX).toBeCloseTo(a.coverX, 2);
    // 整块垂直居中：上留白 = 下留白（两档都成立）
    expect(a.topFrac).toBeCloseTo(a.bottomFrac, 2);
    expect(b.topFrac).toBeCloseTo(b.bottomFrac, 2);
  });

  it('两档下"各段间距 / 帧高"也一致（徽章 / 标题条 / 艺人行三段）', () => {
    const gaps = (w: number, h: number) => {
      const m = openingStackMetrics(w, h, ALL);
      return {
        coverToBadge: (m.badgeTop - (m.top + m.cover)) / h,
        badgeToBand: (m.bandY - (m.badgeTop + m.badgeH)) / h,
        bandToArtist: (m.artistCy - m.artistFont * 0.8 - (m.bandY + m.bandH)) / h,
      };
    };
    const a = gaps(1920, 1080);
    const b = gaps(1280, 720);
    expect(b.coverToBadge).toBeCloseTo(a.coverToBadge, 2);
    expect(b.badgeToBand).toBeCloseTo(a.badgeToBand, 2);
    expect(b.bandToArtist).toBeCloseTo(a.bandToArtist, 2);
  });
});

describe('chart-preview 30 · 比例常量落值（照游戏内参考图实测）', () => {
  it.each(RATIOS)('%s 是钉死的实测比例', (_name, value) => {
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
  });

  it('方案 B 落值：艺人 0.030 H / 子字段 0.022 H / 行高倍率 1.4', () => {
    expect(OPENING_COVER_RATIO).toBe(0.48);
    expect(OPENING_BAND_H).toBe(0.11);
    expect(OPENING_BADGE_FONT).toBe(0.024);
    expect(OPENING_TITLE_FONT).toBe(0.05);
    expect(OPENING_ARTIST_FONT).toBe(0.030);
    expect(OPENING_CREDIT_FONT).toBe(0.022);
    expect(OPENING_GAP_BAND_ARTIST).toBe(0.022);
    expect(OPENING_GAP_ARTIST_CREDIT).toBe(0.016);
    expect(OPENING_CREDIT_LINE_FACTOR).toBe(1.4);
    // 堆叠垫层：露出 t 比内缩 i 大 ⇒ 顶条 / 右条露得出来（i > t 时只剩顶条）
    expect(OPENING_STACK_T).toBeGreaterThan(OPENING_STACK_INSET - 0.002);
  });

  it('1080p 落值：封面 518 / 条高 119 / 徽章高 48', () => {
    const m = openingStackMetrics(1920, 1080, ALL);
    expect(m.cover).toBe(518);
    expect(m.bandH).toBe(119);
    expect(m.badgeH).toBe(48);
    expect(m.coverX).toBe((1920 - 518) >> 1);
  });
});

describe('chart-preview 39 · 可选附加字段兼容性（0~4项自由组合且空项不占位）', () => {
  it('0 个字段时：不画 credits，creditsTop 为 NaN，与基线高度完全一致', () => {
    const baseline = openingStackMetrics(1920, 1080, ALL);
    const withZero = openingStackMetrics(1920, 1080, ALL, 0);
    expect(Number.isNaN(withZero.creditsTop)).toBe(true);
    expect(withZero.top).toBe(baseline.top);
    expect(withZero.bottom).toBe(baseline.bottom);
  });

  it.each([1, 2, 3, 4])('包含 %i 个可选字段时：上下留白严格相等，整栈保持垂直居中', (count) => {
    const m = openingStackMetrics(1920, 1080, ALL, count);
    expect(Number.isNaN(m.creditsTop)).toBe(false);
    expect(m.creditsTop).toBeGreaterThan(m.artistCy);
    // 垂直居中不变量：上留白 = 下留白
    const topGap = m.top;
    const bottomGap = 1080 - m.bottom;
    expect(Math.abs(topGap - bottomGap)).toBeLessThanOrEqual(1);
  });

  it('逐项追加字段时，栈高按 creditLineH 严格单调增加', () => {
    const m0 = openingStackMetrics(1920, 1080, ALL, 0);
    const m1 = openingStackMetrics(1920, 1080, ALL, 1);
    const m2 = openingStackMetrics(1920, 1080, ALL, 2);
    const m3 = openingStackMetrics(1920, 1080, ALL, 3);
    const m4 = openingStackMetrics(1920, 1080, ALL, 4);

    expect(m1.bottom - m1.top).toBeGreaterThan(m0.bottom - m0.top);
    expect((m2.bottom - m2.top) - (m1.bottom - m1.top)).toBe(m1.creditLineH);
    expect((m3.bottom - m3.top) - (m2.bottom - m2.top)).toBe(m1.creditLineH);
    expect((m4.bottom - m4.top) - (m3.bottom - m3.top)).toBe(m1.creditLineH);
  });
});

describe('chart-preview 30 · 关掉的项不留空位（两档一致）', () => {
  it.each(TIERS)('$name：只留封面时整块变矮且仍居中', ({ w, h }) => {
    const all = openingStackMetrics(w, h, ALL);
    const only = openingStackMetrics(w, h, []);
    expect(only.bottom - only.top).toBeLessThan(all.bottom - all.top);
    expect(only.top).toBe(Math.round((h - (only.bottom - only.top)) / 2));
  });

  it.each(TIERS)('$name：关标题条 ⇒ 白条不画、其余照旧', ({ w, h }) => {
    const m = openingStackMetrics(w, h, ['difficulty', 'artist']);
    expect(Number.isNaN(m.bandY)).toBe(true);
    expect(Number.isNaN(m.badgeTop)).toBe(false);
    expect(Number.isNaN(m.artistCy)).toBe(false);
  });
});
