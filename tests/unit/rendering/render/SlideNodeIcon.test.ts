// issue 145 #3：Slide/Long **中间结点**的 flick/skill 不渲染（数据允许带、导出原样，只是画布不表现）。
// 端点承载标记的现状（issue 81）不变 —— 这里两条都要锁住。
import { describe, it, expect } from 'vitest';
import { slideNodeIconConfig } from '@/src/rendering/render';
import type { RenderCtx } from '@/src/rendering/types';

/**
 * 最小替身：只提供选款函数用到的四个取图入口，返回可辨认同源的标记对象。
 * `slideNodeIconConfig` 只读 `rc.noteIcons`，故无需构造完整 RenderCtx。
 */
const icons = {
  slideEndpointFor: (lane: number) => ({ tag: `endpoint:${lane}` }),
  slideAmongFor: (lane: number) => ({ tag: `among:${lane}` }),
  flickFor: (lane: number) => ({ tag: `flick:${lane}` }),
  skillFor: (lane: number) => ({ tag: `skill:${lane}` }),
};
const rc = { noteIcons: icons } as unknown as RenderCtx;

describe('slideNodeIconConfig · 中间结点不渲染 flick/skill', () => {
  it('中间结点带 flick → 仍是普通中间结点款', () => {
    expect(slideNodeIconConfig(rc, { lane: 3, flick: true }, false, false)).toEqual({ tag: 'among:3' });
  });

  it('中间结点带 skill → 仍是普通中间结点款', () => {
    expect(slideNodeIconConfig(rc, { lane: 3, skill: true }, false, false)).toEqual({ tag: 'among:3' });
  });

  it('首端点带 flick → 换 flick 款（回归，不放松）', () => {
    expect(slideNodeIconConfig(rc, { lane: 3, flick: true }, true, false)).toEqual({ tag: 'flick:3' });
  });

  it('尾端点带 skill → 换 skill 款（回归，不放松）', () => {
    expect(slideNodeIconConfig(rc, { lane: 3, skill: true }, false, true)).toEqual({ tag: 'skill:3' });
  });

  it('端点无标记 → 端点基底款', () => {
    expect(slideNodeIconConfig(rc, { lane: 4 }, true, false)).toEqual({ tag: 'endpoint:4' });
    expect(slideNodeIconConfig(rc, { lane: 4 }, false, true)).toEqual({ tag: 'endpoint:4' });
  });
});
