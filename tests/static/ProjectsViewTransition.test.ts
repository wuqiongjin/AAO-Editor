// issue 19 #1：主页 ↔ 详情切换动效的防回潮网。
//
// 为什么是静态源码断言：CSS animation 的观感 jsdom 验不了（无布局、无动画引擎），
// 但「两个方向各有一条 keyframes、末帧落 transform: none、包裹层按视图身份换 key」都是结构事实。
// 观感（滑入方向、时长、与工作台切换的边界）走票内人工门票。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const css = readStripped('src/pages/ProjectsPage.css');
const page = readStripped('src/pages/ProjectsPage.tsx');

describe('issue 19 #1 · 主页 ↔ 详情切换动效', () => {
  it('两个方向各有一条 170ms 进入动画，末帧落 transform: none（不留包含块）', () => {
    expect(css).toMatch(/\.pm-view--forward\s*\{[^}]*pm-view-in-forward 170ms var\(--ease\)/);
    expect(css).toMatch(/\.pm-view--back\s*\{[^}]*pm-view-in-back 170ms var\(--ease\)/);
    for (const name of ['pm-view-in-forward', 'pm-view-in-back']) {
      const frame = new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? '';
      expect(frame).toContain('transform: none');
      expect(frame).not.toMatch(/translateX\(0\)/);
    }
  });

  it('方向状态在页面上接线：进详情置 forward、回主页置 back', () => {
    expect(page).toMatch(/const goDetail = useCallback\(\(id: string\) => \{\s*setNavDir\('forward'\);/);
    expect(page).toMatch(/const goHome = useCallback\(\(\) => \{\s*setNavDir\('back'\);/);
    expect(page).toMatch(/onClick=\{goHome\}/);
  });

  it('视图包裹层 key 只按视图身份（hub / detail），详情内换工程不重放动画', () => {
    expect(page).toMatch(/key="hub" className=\{`pm-view pm-view--\$\{navDir\}`\}/);
    expect(page).toMatch(/key="detail" className=\{`pm-view pm-view--\$\{navDir\}`\}/);
    // 换工程只改 detailId，不换包裹层 key → 不重挂载
    expect(page).toMatch(/onClick=\{\(\) => goDetail\(p\.id\)\}/);
  });
});
