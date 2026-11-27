// 票 242 收尾 · 顶栏「档位 | 自由」与面板内控件字号的**层叠特异性**锁。
//
// 现象：两个词把 88px 的分段撑满、滑块边缘贴字（用户 2026-11-22 报「有点丑」）。根因不是色值也不是间距，
// 是 `.app-shell button, .app-shell input, .app-shell select { font: inherit }`（0,1,1）比组件里的
// 单类选择器（0,1,0）高一级：写在单类上的 font-size / font-weight 全被它顶掉，11–12.5px 的字
// 按父级 14px 渲染。这类失效不会报错、也不改变几何断言（盒子还是那么大），只能靠人眼或计算样式发现。
//
// **为什么只能静态断言**：jsdom 不做层叠运算，computed font-size 量不出来；真实字号由 headless Edge
// 读计算样式核对（数值记在票 242 Comments）。本文件锁的是结构事实：字号声明必须挂在
// 「祖先类 + 控件类」上——下次谁把前缀摘掉，机制就无声复发（写得再对也不生效）。
import { describe, expect, it } from 'vitest';
import { cssRuleBodyExact, readStripped } from '@/tests/support/source';

const CAPSULE_CSS = 'src/pages/workspace/CurveOptionsCapsule.css';
const PANEL_CSS = 'src/pages/workspace/CurveConfigPanel.css';
const SHELL_CSS = 'src/layouts/AppShell.css';

interface Rule {
  selector: string;
  body: string;
}

/** 展平后的 `选择器 → 声明块`（这几个文件没有嵌套 at-rule，够用） */
function rules(css: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim(),
    body: m[2]!,
  }));
}

const px = (body: string, prop: string): number | undefined => {
  const raw = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([\\d.]+)px`))?.[1];
  return raw == null ? undefined : Number(raw);
};

describe('basic-editor 242 · 顶栏档位/自由与面板控件字号压得住全局 reset', () => {
  it('前提还在：那条让字号失效的全局 reset 仍是单类 + 元素（0,1,1）', () => {
    // 双类前缀的修法只为压过这条；若哪天它被降级/移除，下面的注释与写法都该重看一遍
    expect(readStripped(SHELL_CSS)).toMatch(
      /\.app-shell button,\s*\.app-shell input,\s*\.app-shell select\s*\{\s*font:\s*inherit;?\s*\}/,
    );
  });

  it('顶栏分段：字号挂在 `.coc .coc__mode-btn` 上，11px 装得下两个词', () => {
    const sized = rules(readStripped(CAPSULE_CSS)).filter(
      (r) => /\.coc__mode-btn\b/.test(r.selector) && /font-size/.test(r.body),
    );
    expect(sized).toHaveLength(1);
    expect(sized[0]!.selector).toBe('.coc .coc__mode-btn');
    expect(px(sized[0]!.body, 'font-size')).toBe(11);
  });

  it('顶栏分段：无外框的浅槽 + 滑块，激活块在暗色下抬一档（胶囊底本身就是 --bg-elevated）', () => {
    const seg = cssRuleBodyExact(readStripped(CAPSULE_CSS), '.coc__mode-seg') ?? '';
    expect(seg).toMatch(/display:\s*grid/);
    expect(seg).toMatch(/background:\s*var\(--bg-inset\)/);
    // 有框就会在 30px 顶栏里显成第二个盒子，与胶囊自己的描边打架
    expect(seg).not.toMatch(/border:/);

    const active = rules(readStripped(CAPSULE_CSS)).find(
      (r) => r.selector === '.coc .coc__mode-btn.is-active',
    );
    expect(active?.body).toMatch(/background:\s*var\(--bg-elevated\)/);
    expect(active?.body).toMatch(/font-weight:\s*600/);

    const dark = cssRuleBodyExact(
      readStripped(CAPSULE_CSS),
      '[data-theme="dark"] .coc .coc__mode-btn.is-active',
    ) ?? '';
    expect(dark).toMatch(/background:\s*var\(--bg-active\)/);
  });

  it('面板内同源控件（分段 / 分类 Tab / 胶囊 / 数值框）的字号同样是双类', () => {
    const panel = rules(readStripped(PANEL_CSS));
    for (const cls of ['.ccp__seg-btn', '.ccp__tab', '.ccp__pill-btn', '.ccp__num-input']) {
      const sized = panel.filter((r) => r.selector.includes(cls) && /font-size/.test(r.body));
      expect(sized.length, `${cls} 没有字号声明`).toBeGreaterThan(0);
      for (const r of sized) {
        // 单类写在这里等于没写：`.app-shell button` 会把它顶回 14px
        expect(r.selector, `${cls} 的字号挂在单类上`).toContain(`.ccp ${cls}`);
      }
    }
  });

  it('面板字阶：导航 12.5 / 取值 12 / 卡片名 11.5 / 副名 10.5', () => {
    // 上限由分类 Tab 决定：面板固定 348px、四格各 77px，去掉内边距可用 73px；12.5px 下最长的
    // 「节奏/震动」实测 56.2px（余量 16.8px）。改这些数字前先在 headless Edge 里量一遍 Tab 与
    // 卡片名的文字宽度，别凭手感往上加——中文贴边和英文省略都是在这里先发生的。
    const panel = rules(readStripped(PANEL_CSS));
    // 卡名与副名共用一条截断分组规则，`cssRuleBodyExact` 会先命中的那条没有字号，这里按选择器全等筛
    const declared = (selector: string): number | undefined => {
      const hit = panel.filter((r) => r.selector === selector && /font-size/.test(r.body));
      expect(hit, `${selector} 没有字号声明`).toHaveLength(1);
      return px(hit[0]!.body, 'font-size');
    };
    expect(declared('.ccp .ccp__seg-btn')).toBe(12.5);
    expect(declared('.ccp .ccp__tab')).toBe(12.5);
    expect(declared('.ccp .ccp__pill-btn')).toBe(12);
    expect(declared('.ccp .ccp__num-input')).toBe(12);
    expect(declared('.ccp__card-name')).toBe(11.5);
    expect(declared('.ccp__card-sub')).toBe(10.5);
  });

  it('英文分类名装不进等宽格：`[lang="en"]` 下 Tab 按内容分配宽度', () => {
    // 实测「Gluten / Chain」12.5px 宽 84.7px，等宽格可用 73px（会被截成 `Gluten / C…`）；
    // 放开后四格 45 / 74.8 / 74.4 / 113.9，最长那格拿到 110px。中文四个词长度相近，仍走等宽。
    const tabs = rules(readStripped(PANEL_CSS)).filter((r) => r.selector.includes('.ccp__tab'));
    expect(tabs.find((r) => r.selector === '.ccp__tab')?.body).toMatch(/flex:\s*1 1 0/);
    expect(tabs.find((r) => r.selector === "[lang='en'] .ccp__tab")?.body).toMatch(/flex:\s*1 1 auto/);
  });

  it('激活态的加粗不被字号块（同为 0,2,0）盖掉', () => {
    const panel = rules(readStripped(PANEL_CSS));
    for (const cls of ['.ccp__seg-btn', '.ccp__tab', '.ccp__pill-btn']) {
      const active = panel.find((r) => r.selector === `.ccp ${cls}.is-active`);
      expect(active?.body, `${cls}.is-active 丢了 .ccp 前缀或 600`).toMatch(/font-weight:\s*600/);
    }
  });
});
