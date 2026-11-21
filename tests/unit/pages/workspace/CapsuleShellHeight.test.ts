// 票 246 · 胶囊高度上限的取值口径（纯函数，无需 DOM）。
//
// 上限 = 画布区可视高 − 上缘偏移 − 下缘留白，且不低于最小可用高（顶栏 + 一行配置）。
// 真实几何由 headless Edge 实测把关；这里锁的是「画布区越矮、上限越小，但永远留得下可用的面板」。
import { describe, expect, it } from 'vitest';
import {
  CAPSULE_BOTTOM_GAP,
  CAPSULE_MIN_HEIGHT,
  capsuleMaxHeight,
} from '@/src/pages/workspace/useCapsuleMaxHeight';

describe('basic-editor 246 · capsuleMaxHeight', () => {
  it('扣掉上缘偏移与下缘留白（画布区多高，胶囊就最多到「高 − 20」）', () => {
    expect(capsuleMaxHeight(506, 10)).toBe(486);
    expect(capsuleMaxHeight(466, 10)).toBe(446);
    // 票里报障的那一档：可视 393 → 面板最多 373，落在画布区内
    expect(capsuleMaxHeight(393, 10)).toBe(373);
  });

  it('上缘偏移按实测值让位（胶囊换位置也就换上限），负数按 0 算', () => {
    expect(capsuleMaxHeight(400, 40)).toBe(400 - 40 - CAPSULE_BOTTOM_GAP);
    expect(capsuleMaxHeight(400, -5)).toBe(400 - CAPSULE_BOTTOM_GAP);
  });

  it('画布区再矮也留一条可用高度，不缩成零（否则面板连顶栏 + 一行都放不下）', () => {
    expect(capsuleMaxHeight(60, 10)).toBe(CAPSULE_MIN_HEIGHT);
    expect(capsuleMaxHeight(0, 10)).toBe(CAPSULE_MIN_HEIGHT);
  });

  it('量不到画布区（NaN）时退到最小可用高，而不是把 NaN 写进 CSS', () => {
    expect(capsuleMaxHeight(Number.NaN, 10)).toBe(CAPSULE_MIN_HEIGHT);
  });
});
