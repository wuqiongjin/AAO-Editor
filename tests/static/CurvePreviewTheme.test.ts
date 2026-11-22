// 票 242 亮色补齐 · 曲线预览砖（模板卡 / 缓动族卡 / 折叠胶囊图标）的明暗两套口径。
//
// 为什么只能静态断言：jsdom 不算 CSS 变量、也不解析 SVG 呈现属性，颜色到底换没换量不出来；
// 但「有没有写死色值」「明暗变量是否成对」「浅底墨色对比度够不够」都是源码事实。
// 实际观感由 headless Edge 在 light / dark 两套主题下实拍验收。
import { describe, expect, it } from 'vitest';
import { cssRuleBody, cssRuleBodyExact, readStripped } from '@/tests/support/source';

const CAPSULE_CSS = 'src/pages/workspace/CurveOptionsCapsule.css';
const PANEL_CSS = 'src/pages/workspace/CurveConfigPanel.css';
const MINI_TSX = 'src/pages/workspace/CurveMiniSvg.tsx';

function rule(css: string, selector: string): string {
  const body = cssRuleBodyExact(readStripped(css), selector);
  if (body == null) throw new Error(`${css} 里找不到 ${selector} 规则`);
  return body;
}

/** 相对亮度（WCAG 2.1），只处理本文件用到的 6 位 hex */
function luminance(hex: string): number {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function hexOf(body: string, name: string): string {
  const value = body.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  if (!value) throw new Error(`缺少 ${name} 的 hex 值`);
  return value;
}

describe('basic-editor 242 · 曲线预览砖跟随主题', () => {
  it('迷你 SVG 不写死墨色，形状 / 缓动只差一个变体类', () => {
    const src = readStripped(MINI_TSX);
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/rgba?\(/);
    expect(src).toMatch(/ccp-svg ccp-svg--\$\{variant\}/);
    for (const cls of ['ccp-svg__chord', 'ccp-svg__band', 'ccp-svg__line', 'ccp-svg__dot']) {
      expect(src).toContain(cls);
    }
  });

  it('预览砖底 / 文字走主题 token，不再写死深砖与浅字', () => {
    const card = cssRuleBody(readStripped(PANEL_CSS), '.ccp__card,');
    if (card == null) throw new Error('找不到模板卡 / 族卡共用规则');
    expect(card).toMatch(/background:\s*var\(--curve-stage-bg\)/);
    expect(card).toMatch(/color:\s*var\(--text\)/);
    expect(card).not.toMatch(/#0d131f/);

    const easing = readStripped(PANEL_CSS);
    // 族卡的覆盖声明只此一处，直接锁值；不用 cssRuleBodyExact 是因为族卡与模板卡共用同一条
    // 分组选择器，exact 会先命中分组规则里的同名行
    expect(easing).toContain('--ccp-card-accent: 3 105 161');
    expect(easing).toContain('--ccp-card-active-bg: var(--curve-active-easing)');

    // 副名与卡名共用同一条截断分组规则，exact 会先命中那条；用字号锚定真正的副名规则
    // （字号本身由 CurveModeSegTypography 锁，这里只借它定位，写法别再复制一份数值）
    const panel = readStripped(PANEL_CSS);
    const sub = panel.match(/\.ccp__card-sub \{\n\s*font-size: [\d.]+px;([^}]*)\}/)?.[1];
    if (sub == null) throw new Error('找不到副名颜色规则');
    expect(sub).toMatch(/color:\s*var\(--text-muted\)/);
    expect(sub).not.toMatch(/rgba\(226, 232, 240/);
  });

  it('SVG 四条元素的颜色全部来自变量', () => {
    expect(rule(PANEL_CSS, '.ccp-svg__chord')).toMatch(/stroke:\s*var\(--curve-chord\)/);
    expect(rule(PANEL_CSS, '.ccp-svg__band')).toMatch(/fill:\s*var\(--curve-band\)/);
    expect(rule(PANEL_CSS, '.ccp-svg__line')).toMatch(/stroke:\s*var\(--curve-ink\)/);
    const dot = rule(PANEL_CSS, '.ccp-svg__dot');
    expect(dot).toMatch(/fill:\s*var\(--curve-dot\)/);
    expect(dot).toMatch(/stroke:\s*var\(--curve-dot-ring\)/);
    expect(rule(PANEL_CSS, '.ccp-svg--shape')).toMatch(/--curve-ink:\s*var\(--curve-ink-shape\)/);
    expect(rule(PANEL_CSS, '.ccp-svg--easing')).toMatch(/--curve-ink:\s*var\(--curve-ink-easing\)/);
    // 缓动弦线单独一档：形状 .18、缓动 .16，统一成同一档会让缓动图那层参考线变亮
    expect(rule(PANEL_CSS, '.ccp-svg--easing')).toMatch(/--curve-chord:\s*var\(--curve-chord-easing\)/);
  });

  it('胶囊图标砖也走同一套变量（亮色不再是深色贴纸）', () => {
    const glyph = rule(CAPSULE_CSS, '.coc__glyph');
    expect(glyph).toMatch(/background:\s*var\(--curve-glyph-bg\)/);
    expect(glyph).toMatch(/border:\s*1px solid var\(--curve-glyph-border\)/);
    expect(glyph).not.toMatch(/rgba\(15, 23, 42/);
  });

  it('明暗两套变量成对定义，暗色保留 242 原值', () => {
    const light = rule(CAPSULE_CSS, '.coc');
    const dark = rule(CAPSULE_CSS, '[data-theme="dark"] .coc');
    const names = [...light.matchAll(/(--curve-[a-z-]+):/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThanOrEqual(14);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(dark, `${name} 缺暗色覆盖`).toContain(`${name}:`);

    expect(dark).toMatch(/--curve-stage-bg:\s*#0d131f/);
    expect(dark).toMatch(/--curve-ink-shape:\s*#4ade80/);
    expect(dark).toMatch(/--curve-ink-easing:\s*#38bdf8/);
    expect(dark).toMatch(/--curve-chord:\s*rgba\(255, 255, 255, 0\.18\)/);
    expect(dark).toMatch(/--curve-chord-easing:\s*rgba\(255, 255, 255, 0\.16\)/);
    expect(dark).toMatch(/--curve-dot-ring-easing:\s*transparent/);
  });

  it('亮色墨色对预览砖底的对比度 ≥ 4.5:1（图形元素 3:1 的余量）', () => {
    const light = rule(CAPSULE_CSS, '.coc');
    const stage = hexOf(light, '--curve-stage-bg');
    expect(contrast(hexOf(light, '--curve-ink-shape'), stage)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hexOf(light, '--curve-ink-easing'), stage)).toBeGreaterThanOrEqual(4.5);
  });
});
