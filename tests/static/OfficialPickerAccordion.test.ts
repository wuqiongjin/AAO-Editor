// 票 21：预览栏手风琴的防回潮网（重点 = 展开动画期间**不叠到列表上**）。
//
// 为什么是静态源码断言：列宽动画期间预览栏是否被裁住，是 CSS 事实 —— jsdom 不加载外部 CSS、
// 也没有布局引擎。像素结论（展开过程里预览栏是否叠在列表上）走票内的人工验收。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const css = readStripped('src/pages/projects/ProjectsPage.css');

describe('票 21 · 手风琴的裁切结构', () => {
  it('裁切窗口是 .off-preview 自己（宽度 = 轨道宽），最终宽度只写一处', () => {
    // 裁切必须发生在「宽度跟着轨道走」的那一层，而不是 .off-split（容器级裁切裁不到轨道边界，
    // 过渡期预览栏会溢出轨道叠到列表上 —— 真机截图实锤过一次）
    expect(css).toMatch(/\.off-preview\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.off-preview__inner\s*\{[^}]*width:\s*var\(--off-preview-w\)/);
    expect(css).toMatch(/\.off-split\s*\{[^}]*--off-preview-w:\s*240px/);
    expect(css).toMatch(/grid-template-columns:\s*var\(--off-preview-w\)\s*minmax\(0,\s*1fr\)/);
  });

  it('裁切层是纵向 flex + 交叉轴不拉伸（否则 flex-basis:0% 会覆盖内层的 width → 内容跟着轨道重排）', () => {
    expect(css).toMatch(/\.off-preview\s*\{[^}]*flex-direction:\s*column/);
    expect(css).toMatch(/\.off-preview\s*\{[^}]*align-items:\s*flex-start/);
    expect(css).toMatch(/\.off-preview__inner\s*\{[^}]*width:\s*var\(--off-preview-w\)/);
  });

  it('列宽过渡保留；收起态是首列归零（保持两轨才插值得到）', () => {
    expect(css).toMatch(/\.off-split\s*\{[^}]*transition:[^}]*grid-template-columns/);
    expect(css).toMatch(/\.off-split\.is-collapsed\s*\{[^}]*grid-template-columns:\s*0\s*minmax\(0,\s*1fr\)/);
  });

  it('收起用延迟 visibility 收尾，不用 opacity（opacity < 1 会建层叠上下文，把预览栏盖到列表上面）', () => {
    expect(css).toMatch(/\.off-preview\.is-collapsed\s*\{[^}]*visibility:\s*hidden/);
    expect(css).not.toMatch(/\.off-preview\s*\{[^}]*transition:[^}]*opacity/);
  });

  it('窄屏单列下内层跟着列宽走，不钉 240px', () => {
    expect(css).toMatch(/\.off-preview__inner\s*\{\s*width:\s*100%/);
  });
});
