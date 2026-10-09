// 票 29 · 「设置」面板定位按**盒宽**对齐（`left = 触发钮右缘 − PANEL_BOX_W`）的锁。
//
// 现象：`.pdp__panel` 是 content-box（`width: 320px` + padding 6×2，再加菜单壳 `.pp-menu__panel`
// 的 border 1×2）⇒ 实测盒宽 334；而定位式拿**内容宽 320** 当盒宽 ⇒ 面板右缘恒比触发钮右缘多出
// 14px（实测：面板 right 1432 / 触发钮 right 1418）。修法 = 定位改吃盒宽（320 + 14 = 334）。
//
// **为什么只能静态断言**：盒子宽横跨三处（两个 CSS 文件的声明 + TS 常量），而真实渲染宽度 jsdom
// 量不出来（没有布局引擎，`getBoundingClientRect()` 恒 0）。故本文件把三处钉在一起：宽度 / 内边距 /
// 边框 / 常量任一改动、或定位式没吃 `PANEL_BOX_W`，本文件红。真机几何由 Playwright 实测把关
// （修前 / 修后数值记在票 29 的 Comments）。
import { describe, expect, it } from 'vitest';
import { cssRuleBody, readStripped } from '@/tests/support/source';

const PANEL_CSS = 'src/pages/preview/PreviewPage.css';
const SHELL_CSS = 'src/pages/projects/ProjectsPage.css';
const APP_SHELL_CSS = 'src/layouts/AppShell.css';
const SRC = 'src/pages/preview/PreviewDisplayPanel.tsx';

/** 取声明块里某条声明的值（找不到即抛 —— 静态锁宁可炸也不静默放过） */
function declared(body: string | undefined, prop: string): string {
  const value = body?.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))?.[1];
  if (value == null) throw new Error(`声明块里找不到 ${prop}`);
  return value.trim();
}

/** 单值 px → 数字（多值 / 变量 / 其它单位一律抛：这几处只许写一个固定长度） */
function px(value: string): number {
  const m = /^(\d+(?:\.\d+)?)px$/.exec(value);
  if (!m) throw new Error(`不是单个 px 值：${value}`);
  return Number(m[1]);
}

/** TS 源码里某个数值常量的读数（`const NAME = 320;`） */
function constant(name: string): number {
  const m = new RegExp(`const ${name} = (\\d+(?:\\.\\d+)?);`).exec(readStripped(SRC));
  if (!m) throw new Error(`${SRC} 里找不到常量 ${name}`);
  return Number(m[1]);
}

describe('chart-preview 29 · 「设置」面板按盒宽贴右缘（不偏 14px）', () => {
  it('盒宽 = CSS 内容宽 + 壳（`.pdp__panel` padding + `.pp-menu__panel` border），且与 TS 常量逐位一致', () => {
    const panelBody = cssRuleBody(readStripped(PANEL_CSS), '.pdp__panel');
    const contentW = px(declared(panelBody, 'width'));
    const padX = px(declared(panelBody, 'padding'));
    const borderW = px(declared(cssRuleBody(readStripped(SHELL_CSS), '.pp-menu__panel'), 'border').split(/\s+/)[0]);

    expect(constant('PANEL_W')).toBe(contentW);
    expect(constant('PANEL_CHROME_W')).toBe(2 * (padX + borderW));
    // 盒宽是**加和**出来的（不是第二个 334 字面量）：改内容宽或壳宽都会当场红
    expect(readStripped(SRC)).toMatch(/const PANEL_BOX_W = PANEL_W \+ PANEL_CHROME_W;/);
  });

  it('定位式吃盒宽（拿内容宽当盒宽 = 右缘恒偏 14px）', () => {
    expect(readStripped(SRC)).toMatch(/rect\.right\s*-\s*PANEL_BOX_W/);
  });

  // 上面那条加和的成立还依赖两个**隐含前提**（评审提的）：盒子真的是 content-box、且 6px 真的赢。
  // 两个前提都不写在加和式里，破了也只偏 4 / 14px（肉眼不易察觉），故一并锁住。
  it('前提一：panel 是 content-box —— 它 portal 到 body，吃不到 `.app-shell *` 那条 border-box', () => {
    // 面板挂 body 下（createPortal 第二参），全局 border-box 规则挂在 `.app-shell *` 下 ⇒ 够不到它。
    // 若哪天把这条规则放成全站 `*`、或面板不再 portal，真实盒宽就变 320，加和式白算 14px。
    expect(readStripped(SRC)).toMatch(/createPortal\([\s\S]*document\.body/);
    expect(readStripped(APP_SHELL_CSS)).toMatch(/\.app-shell \*[\s\S]{0,80}box-sizing:\s*border-box/);
    // 浮层自己也不许冒出一条 box-sizing（有的话按 border-box 算，加和式立刻失真）
    expect(cssRuleBody(readStripped(SHELL_CSS), '.pp-menu__panel')).not.toMatch(/box-sizing/);
    expect(cssRuleBody(readStripped(PANEL_CSS), '.pdp__panel')).not.toMatch(/box-sizing/);
  });

  it('前提二：`.pdp__panel` 的 6px 压得过菜单壳的 4px（同特异性 ⇒ 后 import 的那份赢）', () => {
    // 壳自带 `padding: 4px`；`.pdp__panel` 是单类选择器、同特异性 ⇒ 谁后进样式表谁赢。
    // 顺序一翻，真实 padding 变 4px、盒宽变 330（加和式读的是 CSS 文本，不会自己发现）。
    const shellPad = px(declared(cssRuleBody(readStripped(SHELL_CSS), '.pp-menu__panel'), 'padding'));
    expect(px(declared(cssRuleBody(readStripped(PANEL_CSS), '.pdp__panel'), 'padding'))).not.toBe(shellPad);

    const src = readStripped(SRC);
    const shellImport = src.indexOf("import '../projects/ProjectsPage.css';");
    const panelImport = src.indexOf("import './PreviewPage.css';");
    expect(shellImport).toBeGreaterThanOrEqual(0);
    expect(panelImport).toBeGreaterThan(shellImport);
  });
});
