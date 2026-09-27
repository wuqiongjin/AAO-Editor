// issue 16：弹窗（以及整个 src/ui）的样式不许写死色值 ——
// ADR-0003「tokens.css 是全站唯一色值出处」的机器可执行版本。
// 13 票我就在 ConfirmDialog 的遮罩上写死了 rgba(0,0,0,0.45)；这条锁的是"犯过的错不许再犯"，
// 也是将来第二个弹窗壳接进来时的同款护栏。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const uiCss = readStripped('src/ui/ui.css');
const dialog = readStripped('src/ui/ConfirmDialog.tsx');

/** hex 色值或 rgb/rgba() —— 组件样式里出现任何一个都说明色值绕过 token 了 */
const HARD_CODED_COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;

describe('issue 16 · 弹窗样式一律走 token', () => {
  it('src/ui/ui.css 里没有一个硬编码色值', () => {
    expect(uiCss).not.toMatch(HARD_CODED_COLOR);
  });

  it('确认弹窗组件自己不带色值（颜色归 CSS，组件只管结构与行为）', () => {
    expect(dialog).not.toMatch(HARD_CODED_COLOR);
  });

  it('遮罩用 --overlay-bg，不是自己调的半透明黑', () => {
    expect(uiCss).toMatch(/\.confirm-dialog__scrim\s*\{[^}]*var\(--overlay-bg\)/);
  });

  it('不可逆确认键走 --danger-btn 一组（--danger 本体白字压不住，不能拿来顶）', () => {
    expect(uiCss).toMatch(/\.action-btn--danger-solid\s*\{[^}]*var\(--danger-btn\)/);
  });

  it('弹窗有入场动效，且给 reduce-motion 留了退路', () => {
    expect(uiCss).toMatch(/animation:\s*confirm-dialog-in/);
    expect(uiCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});
