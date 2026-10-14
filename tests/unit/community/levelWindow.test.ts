// 票 38 #2：等级窗口归一化（songs.ts / posts.ts 上收的共用纯函数）边界锁测。
// 这些组合是两份原实现都没直接覆盖的 —— 抽公共时新增，逐值锁住「与重构前一致」的现状
// （含 `??` 不拦 NaN / ±Infinity 的现状陷阱：一边 NaN 一边有效 ⇒ lo / hi 都是 NaN）。
import { describe, expect, it } from 'vitest';
import { normalizeLevelWindow } from '@/src/community/levelWindow';

describe('票 38 · normalizeLevelWindow（等级窗口归一化）', () => {
  it('两边都没填：窗口不生效（lo / hi 都是 null）', () => {
    expect(normalizeLevelWindow({})).toEqual({ lo: null, hi: null });
    expect(normalizeLevelWindow({ levelMin: undefined, levelMax: undefined })).toEqual({ lo: null, hi: null });
  });

  it('null 与 undefined 同样算「没填」（typeof null ≠ number，?? 也会放它穿到另一边）', () => {
    const nullish = { levelMin: null, levelMax: null } as { levelMin?: number; levelMax?: number };
    expect(normalizeLevelWindow(nullish)).toEqual({ lo: null, hi: null });
    const halfNull = { levelMin: null, levelMax: 30 } as { levelMin?: number; levelMax?: number };
    expect(normalizeLevelWindow(halfNull)).toEqual({ lo: 30, hi: 30 });
  });

  it('只填一边：另一边取同值', () => {
    expect(normalizeLevelWindow({ levelMin: 28 })).toEqual({ lo: 28, hi: 28 });
    expect(normalizeLevelWindow({ levelMax: 30 })).toEqual({ lo: 30, hi: 30 });
  });

  it('两边都填：按数值 min/max（填反也不硬夹）', () => {
    expect(normalizeLevelWindow({ levelMin: 28, levelMax: 30 })).toEqual({ lo: 28, hi: 30 });
    expect(normalizeLevelWindow({ levelMin: 30, levelMax: 28 })).toEqual({ lo: 28, hi: 30 });
  });

  it('NaN：算「没填」；只一边 NaN 时穿透 ?? 让 lo / hi 都成 NaN（现状陷阱，逐值锁住）', () => {
    expect(normalizeLevelWindow({ levelMin: NaN, levelMax: NaN })).toEqual({ lo: null, hi: null });
    expect(normalizeLevelWindow({ levelMin: NaN, levelMax: 20 })).toEqual({ lo: NaN, hi: NaN });
    expect(normalizeLevelWindow({ levelMin: 20, levelMax: NaN })).toEqual({ lo: NaN, hi: NaN });
  });

  it('非有限值（±Infinity）：算「没填」，但会以原值参与 ?? 后的 min/max', () => {
    // +Infinity 填任一边：有限的一边成 lo，Infinity 留在 hi
    expect(normalizeLevelWindow({ levelMin: Infinity, levelMax: 20 })).toEqual({ lo: 20, hi: Infinity });
    expect(normalizeLevelWindow({ levelMin: 20, levelMax: Infinity })).toEqual({ lo: 20, hi: Infinity });
    expect(normalizeLevelWindow({ levelMin: -Infinity, levelMax: 20 })).toEqual({ lo: -Infinity, hi: 20 });
  });
});
