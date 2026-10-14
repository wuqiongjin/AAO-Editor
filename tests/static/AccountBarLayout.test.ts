// 票 39 回修锁测（用户 2026-10-14 真机验收）：账号行**必须满宽**，且行宽只由左栏宽度决定。
//
// 为什么是静态断言：这是纯排版事实 —— jsdom 没有布局引擎，`width: 100%` 有没有生效它看不见
// （真机就是这么漏的：「已登录」那行外面裹着 inline-flex 的菜单壳，行宽变成内容宽，
// 于是行宽跟着昵称长短走，比「未登录」那行窄一截）。按本仓惯例（ProjectDetailHeadLayout /
// EditInfoDialogNoRawInput）用源码断言锁死这条 CSS 事实。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const PAGE_CSS = readStripped('src/pages/projects/ProjectsPage.css');
const BITS = readStripped('src/pages/projects/components/ProjectBits.tsx');
const BAR = readStripped('src/pages/projects/components/AccountBar.tsx');

/** 取 CSS 里最后一条匹配的规则体（同一选择器可能被后面覆盖，取生效的那条口径） */
function rule(selector: string): string {
  const matches = [...PAGE_CSS.matchAll(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`, 'g'))];
  expect(matches.length, `ProjectsPage.css 里找不到规则 ${selector}`).toBeGreaterThan(0);
  return matches[matches.length - 1][1];
}

describe('票 39 回修 · 账号行满宽（Q35）', () => {
  it('账号行自身满宽（与兄弟 `.pc-item` 同款的列表行）', () => {
    expect(rule('.pc-account__row')).toMatch(/width:\s*100%/);
  });

  it('菜单壳与触发层都要铺开：「已登录」那行裹在 inline-flex 的壳里，不铺开就按内容量宽', () => {
    expect(rule('.pc-account .pp-menu')).toMatch(/display:\s*flex/);
    expect(rule('.pc-account .pp-menu')).toMatch(/width:\s*100%/);
    expect(rule('.pc-account .pp-menu__trigger')).toMatch(/flex:\s*1 1 auto/);
  });

  it('触发层有稳定类名（CSS 要靠它选中，不能靠 :first-child 猜）', () => {
    expect(BITS).toMatch(/className="pp-menu__trigger"/);
  });
});

describe('票 39 回修 · 账号菜单贴左缘（Q29 / 用户 2026-10-14）', () => {
  it('账号区的菜单显式声明左对齐：右对齐会让收缩宽度的面板朝左长出去、压住导航条', () => {
    expect(BAR).toMatch(/<Menu[\s\S]*?align="start"/);
  });
});
