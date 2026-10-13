// 票 26 · 预览页页头锚点在切模式时必须不动（模式按钮位移）的锁。
//
// 不变量：`.preview-page` 的 padding-top / padding-left 同时是页头（「静态预览 / 动态预览」
// 两枚模式按钮）的起始锚点。动态形态挂 `.is-video` 时若把整条 padding 收一档（票 19 原写法
// `padding: 12px 12px 8px`），页头就跟着整体上移 + 左移 12px —— 实测 Δx = Δy = −12，
// 与票 19 §3「页头（模式切换行）不动」的定案直接冲突。
//
// 定案（用户 2026-10-09 拍板 A「页头优先」）：动态形态**只收底部** `padding-bottom: 8px`，
// top / left 与静态态同源保持 24px。左右那 12px 也不收：contain 是**高度受限**（画面两侧本就
// 各余约 94px），收了让不出任何场地尺寸（实测 `24 24 8 24` 与 `24 12 8 24` 场地尺寸完全相同）。
//
// **#2（同日用户复验）**：只钉住页头还不够 —— `.preview-modes` 的 padding / margin 与
// `.preview-toolbar` 的 padding-bottom 同在"页头 → 工具栏 → 舞台"这条竖链上，动态态收一档就把
// 下方整条链抬起来（实测工具栏 −6px、舞台 −8px）。故本文件一并锁住"这两条覆盖不存在"。
//
// **#3（同日用户复验，谱面工程为空）**：留着的那条底部 `padding-bottom: 8px` 也在推动内容 ——
// 收它 = 舞台盒子变高 8px ⇒ **盒子里的居中内容下移 4px**。空态（没有工程 / 谱面没有音符、
// 舞台走待机文案）没有画面可喂，于是切模式时看着就是"预览区的内容上下移动"（实测空态块
// `.preview-empty > .empty-state` 整体 Δy = +4px）。修法 = 把这一条挂在"舞台有画面"上
// （`:has(.preview-stage.is-filled)`）：空态的舞台盒子与静态态逐像素一致。
//
// **为什么只能静态断言**：jsdom 没有布局引擎，`getBoundingClientRect()` 恒为 0，按钮的 x / y
// 在 jsdom 里量不出来（与票 15 同源）。真实几何由 Playwright 实测把关（修前 / 修后数值记在
// 票 26 的 Answer）；本文件只锁住"简写没被写回去、锚点那两条没被覆盖、竖链上没有收缩覆盖、
// 底部那条带着'有画面'的条件"。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const CSS = 'src/pages/preview/PreviewPage.css';

/** 动态形态那条"底部让高度"的规则选择器（票 26 #3 起带"舞台有画面"的条件） */
const VIDEO_PAD_SELECTOR = '.preview-page.is-video:has(.preview-stage.is-filled)';

/** 取出某个选择器规则块的声明体（注释已由 readStripped 去掉）—— 与票 15 那份同形 */
function block(selector: string): string {
  const css = readStripped(CSS);
  const start = css.indexOf(`${selector} {`);
  expect(start, `${CSS} 里应有 ${selector} 规则块`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

describe('chart-preview 26 · 切模式时页头模式按钮不得位移（页头锚点）', () => {
  it('动态形态只收底部 padding，不用简写把 top / left 一起收掉', () => {
    const body = block(VIDEO_PAD_SELECTOR);
    expect(body).toMatch(/padding-bottom:\s*8px/);
    expect(body).not.toMatch(/padding-top/);
    expect(body).not.toMatch(/padding-left/);
    // 简写 `padding:` 会同时覆盖四条 ⇒ 页头锚点跟着动（票 19 的原写法）
    expect(body).not.toMatch(/(?:^|[;\s])padding:/);
  });

  it('底部那 8px 只在"舞台有画面"时才收：空态不许收（票 26 #3）', () => {
    const css = readStripped(CSS);
    // 无条件写法 = 空态跟着长高 8px ⇒ 盒子里的居中内容下移 4px（实测空态块 Δy = +4px）
    expect(css).not.toMatch(/\.preview-page\.is-video\s*\{/);
    expect(css).toContain(`${VIDEO_PAD_SELECTOR} {`);
  });

  it('页头锚点那两条（padding-top / padding-left）仍是 24px，两态同源', () => {
    // 只钉锚点那两条：底部（16px）归票 19 的取舍，不该由本票锁死。
    // 窄屏（720 断点）改的是基线值本身、两态仍同源，故不受本条约束。
    expect(block('.preview-page')).toMatch(/padding:\s*24px 24px/);
  });

  it('页头 → 工具栏 → 舞台这条竖链上，不留 .is-video 的间距收缩覆盖', () => {
    const css = readStripped(CSS);
    // 这两条一收就把下方整条链抬起来（实测工具栏 −6px、舞台 −8px）
    expect(css).not.toMatch(/\.preview-page\.is-video \.preview-modes\s*\{/);
    expect(css).not.toMatch(/\.preview-page\.is-video \.preview-toolbar\s*\{/);
    // 舞台内部与页面底部仍可省 —— 它们不影响上方元素的位置（底部那条另带"有画面"条件，见上一条）
    expect(css).toMatch(/\.preview-page\.is-video \.pv-stage\s*\{[^}]*gap:\s*8px/);
    expect(block(VIDEO_PAD_SELECTOR)).toMatch(/padding-bottom:\s*8px/);
  });
});
