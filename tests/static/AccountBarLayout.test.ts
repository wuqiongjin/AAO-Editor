// 票 39 回修锁测（用户 2026-10-14 真机验收）：账号行**必须满宽**，且行宽只由左栏宽度决定。
//
// 为什么是静态断言：这是纯排版事实 —— jsdom 没有布局引擎，`width: 100%` 有没有生效它看不见
// （真机就是这么漏的：「已登录」那行外面裹着 inline-flex 的菜单壳，行宽变成内容宽，
// 于是行宽跟着昵称长短走，比「未登录」那行窄一截）。按本仓惯例（ProjectDetailHeadLayout /
// EditInfoDialogNoRawInput）用源码断言锁死这条 CSS 事实。
import { describe, expect, it } from 'vitest';
import { readSource, readStripped } from '@/tests/support/source';

const PAGE_CSS = readStripped('src/pages/projects/ProjectsPage.css');
const PAGE_CSS_RAW = readSource('src/pages/projects/ProjectsPage.css');
const BITS = readStripped('src/pages/projects/components/ProjectBits.tsx');
const BAR = readStripped('src/pages/projects/components/AccountBar.tsx');
const DETAIL = readStripped('src/pages/projects/components/ProjectDetail.tsx');
const HUB = readStripped('src/pages/projects/components/ProjectHub.tsx');

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

describe('票 53 · 账号区钉在视口底，不跟工程列表一起滚', () => {
  it('左栏外层自己不滚：flex 列铺满、overflow hidden（不是 overflow-y:auto 把账号行卷走）', () => {
    const list = rule('.pc-list');
    expect(list).toMatch(/display:\s*flex/);
    expect(list).toMatch(/flex-direction:\s*column/);
    expect(list).toMatch(/height:\s*100%/);
    expect(list).toMatch(/overflow:\s*hidden/);
    expect(list).not.toMatch(/overflow-y:\s*auto/);
  });

  it('工程列表自己滚：独立滚动盒 flex:1 + min-height:0 + overflow-y:auto', () => {
    const items = rule('.pc-list__items');
    expect(items).toMatch(/flex:\s*1/);
    expect(items).toMatch(/min-height:\s*0/);
    expect(items).toMatch(/overflow-y:\s*auto/);
  });

  it('账号行是左栏底栏：flex-shrink:0，不用 position:fixed（会跟分栏拖拽打架）', () => {
    const account = rule('.pc-account');
    expect(account).toMatch(/flex-shrink:\s*0/);
    expect(account).not.toMatch(/position:\s*fixed/);
    expect(account).not.toMatch(/margin-top:\s*auto/);
  });

  it('头仍 sticky；票 39「长时跟在末尾」那句口径作废', () => {
    expect(rule('.pc-list__head')).toMatch(/position:\s*sticky/);
    expect(PAGE_CSS_RAW).not.toMatch(/长时跟在末尾/);
  });

  it('账号行是滚动盒的兄弟，不进 `.pc-list__items`', () => {
    const itemsAt = DETAIL.indexOf('className="pc-list__items"');
    const accountAt = DETAIL.indexOf('<AccountBar');
    expect(itemsAt).toBeGreaterThan(-1);
    expect(accountAt).toBeGreaterThan(itemsAt);
    const between = DETAIL.slice(itemsAt, accountAt);
    expect(between).toMatch(/list\.map/);
    const closeAt = between.search(/<\/div>/);
    expect(closeAt).toBeGreaterThan(-1);
    expect(accountAt).toBeGreaterThan(itemsAt + closeAt);
  });

  it('详情左栏仍挂账号区；启动台没有', () => {
    expect(DETAIL).toMatch(/<AccountBar\s*\/>/);
    expect(HUB).not.toMatch(/AccountBar|pc-account/);
  });

  it('菜单仍向上弹（票 39 Q29）', () => {
    expect(BAR).toMatch(/<Menu[\s\S]*?placement="up"/);
  });
});
