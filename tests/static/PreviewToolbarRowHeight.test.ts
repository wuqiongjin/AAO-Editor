// 票 15 · 预览页工具栏行高的不变量锁。
//
// 不变量：工具栏两簇（左 = 作用域条 + 谱面切换器，右 = 静态态专属的显示控件）**必须等高**。
// 那一行是 `align-items: center`，行高 = 较高那一簇；右簇 `{mode === 'static' && …}`
// **只在静态态存在**——它一高过左簇，就把左簇压低 (右−左)/2，切静态 / 动态时看着就是
// "作用域条和谱面切换器上下浮动"（用户实测 Δtop 0.4px；本机以拉丁谱面名复现 Δtop 0.5px）。
//
// 两簇的高都是 `max(固定图标/徽标高, 文本行盒) + 12`，而**文本行盒跟字体走**：拉丁命中
// Geist Variable、中文回落 Microsoft YaHei，同字号差 0.8~1px。左簇由谱面名撑（拉丁名 → 矮）、
// 右簇由三个 IconButton 的中文标签（显示 / 导出 / 全屏）撑（永远走中文那一档）→ 必然分叉。
// 钉 **unitless** 行高 = 行盒只跟字号走（照 ProjectsPage.css `.pc-chart__title` 的既有口径；
// 写 px 会被字号档钉死），两簇于是必然等高，与谱面名的语言、字号档都无关。
//
// **为什么只能静态断言**：jsdom 没有布局引擎，`getBoundingClientRect()` 恒为 0、行盒根本不存在，
// "两簇等高"这件事在 jsdom 里测不出来（与票 11 #3「滚动条弹跳」同因）。真实几何由 Playwright
// 实测把关（修前 / 修后数值记在票 15 的 Comments）；本文件只锁住"这条声明还在、没被写成 px、
// 两簇没写歪、也没被降到已验证的下限以下"。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const CSS = 'src/pages/preview/PreviewPage.css';

/** 已验证的下限：低于它，行盒就可能压不住固定高度的徽标 / 图标，两簇重新分叉 */
const FLOOR = 1.3;

/** 取出某个选择器规则块的声明体（注释已由 readStripped 去掉） */
function block(selector: string): string {
  const css = readStripped(CSS);
  const start = css.indexOf(`${selector} {`);
  expect(start, `${CSS} 里应有 ${selector} 规则块`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

/** 块里的 line-height 声明值；没有则 null */
function lineHeightOf(selector: string): string | null {
  const m = /(?:^|[;\s])line-height:\s*([^;]+);/.exec(block(selector));
  return m ? m[1].trim() : null;
}

describe('chart-preview 15 · 预览页工具栏两簇必须等高（行盒只跟字号走）', () => {
  it('两簇都钉了 unitless 行高，且取值相同', () => {
    const left = lineHeightOf('.preview-toolbar__left');
    const right = lineHeightOf('.preview-controls');
    expect(left, '左簇必须钉行高，否则它会被右簇挤下去').not.toBeNull();
    expect(right, '右簇必须钉行高，否则它只在静态态出现时会把左簇挤下去').not.toBeNull();
    // unitless：随 --ui-type-scale 缩放；写成 px 会在字号档被钉死
    expect(left).toMatch(/^\d*\.?\d+$/);
    expect(right).toMatch(/^\d*\.?\d+$/);
    expect(Number(right)).toBe(Number(left));
  });

  it('取值不低于已验证的下限（低于它行盒压不住固定高度的徽标 / 图标）', () => {
    const left = Number(lineHeightOf('.preview-toolbar__left'));
    expect(Number.isFinite(left)).toBe(true);
    expect(left).toBeGreaterThanOrEqual(FLOOR);
  });
});
