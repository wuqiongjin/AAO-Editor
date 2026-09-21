// issue 147：flick / skill 标记并存时的选款优先级。
//
// 用户定案（2026-09-22）：**只有不带 flick 的普通单键**带 `skill: true` 才变成技能键款式；
// 滑键（flick）自身带 skill 仍是滑键。滑条端点同口径计入。
// 中间结点不渲染标记（issue 145 #3）、端点承载标记（issue 81）—— 这两条在这里同时当回归锁。
import { describe, it, expect } from 'vitest';
import { slideNodeIconConfig, singleIconConfig } from '@/src/visual/render';
import type { RenderCtx } from '@/src/visual/types';

/** 最小替身：各取图入口返回可辨认同源的标记对象（照 `SlideNodeIcon.test.ts` 的惯例） */
const icons = {
  tapFor: (lane: number) => ({ tag: `tap:${lane}` }),
  flickFor: (lane: number) => ({ tag: `flick:${lane}` }),
  skillFor: (lane: number) => ({ tag: `skill:${lane}` }),
  tapVirtualFor: (lane: number) => ({ tag: `tapVirtual:${lane}` }),
  slideEndpointFor: (lane: number) => ({ tag: `endpoint:${lane}` }),
  slideAmongFor: (lane: number) => ({ tag: `among:${lane}` }),
};
const rc = { noteIcons: icons } as unknown as RenderCtx;
const colorAssistRc = {
  noteIcons: icons, beatDisplay: 4, display: { colorAssist: true },
} as unknown as RenderCtx;

describe('singleIconConfig · 单键标记优先级', () => {
  it('无标记 → 普通单键款', () => {
    expect(singleIconConfig(rc, { lane: 3, beat: 4 })).toEqual({ tag: 'tap:3' });
  });

  it('只带 skill → 技能键款（用户定案：普通单键带 skill 才变样）', () => {
    expect(singleIconConfig(rc, { lane: 3, beat: 4, skill: true })).toEqual({ tag: 'skill:3' });
  });

  it('只带 flick → 滑键款', () => {
    expect(singleIconConfig(rc, { lane: 3, beat: 4, flick: true })).toEqual({ tag: 'flick:3' });
  });

  it('同时带 flick + skill → 仍是滑键款（不是技能键款）', () => {
    expect(singleIconConfig(rc, { lane: 3, beat: 4, flick: true, skill: true })).toEqual({ tag: 'flick:3' });
  });

  it('色觉辅助下的虚拍款优先级不变（issue 39 #4 回归）', () => {
    // 0.25 拍不在半拍整数倍上 → 虚拍款
    expect(singleIconConfig(colorAssistRc, { lane: 3, beat: 0, subBeat: 1 })).toEqual({ tag: 'tapVirtual:3' });
    // 反过来：带标记优先于虚拍款
    expect(singleIconConfig(colorAssistRc, { lane: 3, beat: 0, subBeat: 1, skill: true })).toEqual({ tag: 'skill:3' });
  });
});

describe('slideNodeIconConfig · 滑条结点与单键同优先级', () => {
  it('端点同时带 flick + skill → 换滑键款（修复点：此前会被 skill 盖住）', () => {
    expect(slideNodeIconConfig(rc, { lane: 3, flick: true, skill: true }, true, false)).toEqual({ tag: 'flick:3' });
    expect(slideNodeIconConfig(rc, { lane: 3, flick: true, skill: true }, false, true)).toEqual({ tag: 'flick:3' });
  });

  it('端点只带 skill → 换技能键款（issue 81 回归，不放松）', () => {
    expect(slideNodeIconConfig(rc, { lane: 3, skill: true }, true, false)).toEqual({ tag: 'skill:3' });
  });

  it('端点只带 flick → 换滑键款（issue 145 #3 回归，不放松）', () => {
    expect(slideNodeIconConfig(rc, { lane: 3, flick: true }, false, true)).toEqual({ tag: 'flick:3' });
  });

  it('中间结点带两个标记 → 仍是普通中间结点款（issue 145 #3 回归）', () => {
    expect(slideNodeIconConfig(rc, { lane: 3, flick: true, skill: true }, false, false)).toEqual({ tag: 'among:3' });
  });
});
