// 票 56 · 素材包选择器的**布局与滚动**（网格不再自带滚动 / 等宽轨道 / 返回钮版式 / 设置视图结构）
//
// 现象（2026-10-29 用户）：设置弹窗里指针落在「轨道」网格上滚轮时，滚的是网格而不是面板；
// 到网格边界又因为 `overscroll-behavior: contain` 不把滚动传给面板 ⇒ "滚不动了"。
// 根因 = **嵌套滚动容器**（面板 + 网格各自 `overflow-y: auto`），不是某个值写错。
// 二轮又报「列宽不等 + 横向滚动条」：`1fr` 的最小尺寸是 `auto`，图片固有宽度把三条轨道撑成
// 135 / 82 / 132 —— 等宽轨道必须 `minmax(0, 1fr)` + 子项 `min-width: 0`。
//
// 为什么只能静态断言：jsdom 没有滚动布局 / wheel 默认行为（`scrollHeight` 恒 0、
// wheel 不触发滚动），"谁吃了滚轮"与"轨道多宽"在单测里量不出来。真实观感由 Playwright 验收；
// 这里锁住的是结构与声明前提。
import { describe, expect, it } from 'vitest';
import { cssRuleBody, readStripped } from '@/tests/support/source';

const PANEL_CSS = 'src/pages/preview/PreviewPage.css';
const SRC = 'src/pages/preview/PreviewDisplayPanel.tsx';

describe('票 56 · 素材包选择器的布局与滚动', () => {
  it('`.pdp__pack-grid` 不再有 max-height / overflow / overscroll-behavior', () => {
    const body = cssRuleBody(readStripped(PANEL_CSS), '.pdp__pack-grid');
    expect(body).toBeTruthy();
    expect(body).not.toMatch(/max-height/);
    expect(body).not.toMatch(/overflow/);
    expect(body).not.toMatch(/overscroll-behavior/);
  });

  it('面板 CSS 里不再出现 `overscroll-behavior`（"到边界卡住"的来源）', () => {
    expect(readStripped(PANEL_CSS)).not.toMatch(/overscroll-behavior/);
  });

  it('缩略图按素材比例完整缩小（含 contain + 固定深色底），不再固定 26px + cover', () => {
    const img = cssRuleBody(readStripped(PANEL_CSS), '.pdp__pack-item img');
    expect(img).toBeTruthy();
    expect(img).toMatch(/aspect-ratio:\s*1160\s*\/\s*610/);
    expect(img).toMatch(/object-fit:\s*contain/);
    expect(img).toMatch(/background:\s*var\(--canvas-bg\)/);
    expect(img).not.toMatch(/height:\s*26px/);
  });

  it('等宽轨道：repeat(N, minmax(0, 1fr)) + 子项 min-width: 0（治不等宽 / 横向滚动条）', () => {
    // 票 56 二轮 #2 / #3：`1fr` 的最小尺寸是 `auto`，图片固有宽度会把三条轨道撑成
    // 135 / 82 / 132 且总宽溢出面板 —— minmax(0, 1fr) + min-width: 0 才是等宽硬保证。
    const css = readStripped(PANEL_CSS);
    expect(cssRuleBody(css, '.pdp__pack-grid--field')).toMatch(/repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
    expect(cssRuleBody(css, '.pdp__pack-grid--background')).toMatch(/repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(cssRuleBody(css, '.pdp__pack-item')).toMatch(/min-width:\s*0/);
  });

  it('返回钮有版式（不是浏览器默认按钮框）：22px 高 + 透明底 + 文字标签', () => {
    const back = cssRuleBody(readStripped(PANEL_CSS), '.pdp__back');
    expect(back).toBeTruthy();
    expect(back).toMatch(/height:\s*22px/);
    expect(back).toMatch(/background:\s*none/);
    expect(readStripped(SRC)).toMatch(/pdp__back[\s\S]{0,400}preview\.display\.pack\.back/);
  });

  it('设置视图只留「当前选择」行，网格只出现在二级选择器视图', () => {
    const src = readStripped(SRC);
    expect(src).toMatch(/function SimPackRow\(/);
    expect(src).toMatch(/function SimPackGrid\(/);
    // 调用点数（比 `[\s\S]*` 的全文匹配硬）：两行 Row（背景 / 轨道）+ 一个 Grid（选择器视图）
    expect(src.match(/<SimPackRow/g) ?? []).toHaveLength(2);
    expect(src.match(/<SimPackGrid/g) ?? []).toHaveLength(1);
    expect(src).toMatch(/<SimPackRow\s+kind="background"/);
    expect(src).toMatch(/<SimPackRow\s+kind="field"/);
  });
});
