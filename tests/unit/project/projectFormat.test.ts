// issue 31：relTime 五档边界锁测。
// 「刚刚」收缩到 <1 分钟；1–59 分钟走「N 分钟前」；小时/天/月三档边界不动。
// 每档边界各锁一条：新增/调整档位不许悄悄改旧档边界（撤掉任一边界断言应立刻红）。
// 默认语言 zh-CN；now 可注入（relTime 第二参）。
import { describe, expect, it } from 'vitest';
import { relTime } from '@/src/pages/projects/projectFormat';

const NOW = 1_700_000_000_000;
const M = 60_000;
const H = 3600_000;
const D = 24 * H;

describe('relTime · 刚刚档（delta < 1 分钟）', () => {
  it('0s → 刚刚', () => {
    expect(relTime(NOW, NOW)).toBe('刚刚');
  });

  it('59s → 刚刚', () => {
    expect(relTime(NOW - 59_000, NOW)).toBe('刚刚');
  });

  it('60s → 不再「刚刚」，进分钟档（边界：刚刚/分钟）', () => {
    expect(relTime(NOW - M, NOW)).toBe('1 分钟前');
  });
});

describe('relTime · 分钟档（1 分钟 ≤ delta < 1 小时）', () => {
  it('59min → 59 分钟前', () => {
    expect(relTime(NOW - 59 * M, NOW)).toBe('59 分钟前');
  });

  it('60min → 不再分钟档，进小时档（边界：分钟/小时）', () => {
    expect(relTime(NOW - H, NOW)).toBe('1 小时前');
  });
});

describe('relTime · 小时档（1 小时 ≤ delta < 24 小时）', () => {
  it('23h → 23 小时前', () => {
    expect(relTime(NOW - 23 * H, NOW)).toBe('23 小时前');
  });

  it('24h → 不再小时档，进天档（边界：小时/天）', () => {
    expect(relTime(NOW - D, NOW)).toBe('1 天前');
  });
});

describe('relTime · 天档（1 天 ≤ delta < 30 天）', () => {
  it('29d → 29 天前', () => {
    expect(relTime(NOW - 29 * D, NOW)).toBe('29 天前');
  });

  it('30d → 不再天档，进月档（边界：天/月）', () => {
    expect(relTime(NOW - 30 * D, NOW)).toBe('1 个月前');
  });
});

describe('relTime · 月档（delta ≥ 30 天）', () => {
  it('60d → 2 个月前', () => {
    expect(relTime(NOW - 60 * D, NOW)).toBe('2 个月前');
  });
});
