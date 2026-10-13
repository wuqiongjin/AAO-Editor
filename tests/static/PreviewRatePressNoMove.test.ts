// 票 28 · 倍速触钮**按压时不许位移**（图标与读数都得钉在原地）的锁。
//
// 现象（用户 2026-10-09 描述，本机实测复现）：**mousedown 时图标"往斜上跳一下"，mouseup 回原位**。
// 根因 = 全站那记按压反馈 `src/ui/ui.css` 的 `.action-btn:active, .icon-btn:active { transform: scale(0.98) }`
// —— 它是"整块钮连着内容一起缩"，而触钮里那点内容（15px 的仪表图标 + 11px 的读数）本来就贴着钮的
// 左边与中线，2% 缩放全落在**重采样**上：实测图标墨迹质心按住时偏 (0.47, −0.05) 设备px（DPR 1）、
// (0.92, −0.19)（DPR 2），松开复位 —— 看着就是"往斜上移动一下"。
//
// 定案（本轮实现口径，待验收）：**这个钮的按压反馈不吃几何** —— `transform: none` + 一档更深的按压色
// （深浅与 `--bg-active` 同档，色值 `color-mix` 自 `--bg-hover` / `--text` 两个当前态 token，
// 于是全屏台上态跟着一起换、不落硬编码色值）。全站那记 `scale(0.98)` **保留**：它是全站的按压语言，
// 本票只摘这一个"要盯着读数看"的钮，不动别人的观感。
//
// **为什么只能静态断言**：jsdom 没有布局引擎，也没有 scale 的重采样（`getBoundingClientRect()` 恒 0）
// —— 这条现象**只在真渲染里存在**（亚像素重采样），故由 Playwright 逐帧实测 + 墨迹质心把关，
// 数值记在票 28 的 Answer；本文件只锁住"这个钮的按压不许吃 transform、且反馈还在"。
import { describe, expect, it } from 'vitest';
import { cssRuleBody, readStripped } from '@/tests/support/source';

const CSS = 'src/pages/preview/PreviewPage.css';
const UI_CSS = 'src/ui/ui.css';
/** 触钮的按压态规则（`:not(:disabled)` 只为压过 `.icon-btn:hover:not(:disabled)` 的按压底色） */
const PRESS_SELECTOR = '.pv-rate .icon-btn:active';

describe('chart-preview 28 · 倍速触钮按压时图标不许位移', () => {
  it('按压态把 transform 钉成 none（不吃全站那记 scale(0.98)）', () => {
    const body = cssRuleBody(readStripped(CSS), PRESS_SELECTOR);
    expect(body, `${CSS} 里应有 ${PRESS_SELECTOR} 规则`).toBeTruthy();
    expect(body).toMatch(/transform:\s*none/);
  });

  it('几何反馈摘掉了，但按压反馈还在（同一档更深底色）', () => {
    const body = cssRuleBody(readStripped(CSS), PRESS_SELECTOR) ?? '';
    expect(body).toMatch(/background-color:/);
    // 色值必须来自当前态的 token（`color-mix` 混 `--bg-hover` / `--text`）：全屏台上态才跟着换，
    // 也不能落硬编码色值（PreviewPage.css 的口径）
    expect(body).toMatch(/color-mix\([^)]*var\(--bg-hover\)[^)]*var\(--text\)/);
  });

  it('全站按压语言不动：其它钮仍是 scale(0.98)', () => {
    expect(readStripped(UI_CSS)).toMatch(/\.icon-btn:active[^{]*\{[^}]*transform:\s*scale\(0\.98\)/);
  });
});
