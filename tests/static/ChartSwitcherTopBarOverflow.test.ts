// issue 174：工作台顶栏长歌名不得盖住 BPM / 缩放。
// jsdom 没有 flex 真排版；几何靠 CSS 让宽（current 可缩 + 标题 ellipsis），真机验收。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const CSS = 'src/pages/workspace/ChartSwitcher.css';
const TSX = 'src/pages/workspace/ChartSwitcher.tsx';

function block(src: string, selector: string): string {
  const start = src.indexOf(`${selector} {`);
  expect(start, `${CSS} 里应有 ${selector} 规则块`).toBeGreaterThanOrEqual(0);
  const open = src.indexOf('{', start);
  const close = src.indexOf('}', open);
  return src.slice(open + 1, close);
}

describe('issue 174 · 工作台顶栏切换器让宽', () => {
  it('当前谱面钮可缩、不拉满、标题走 ellipsis', () => {
    const css = readStripped(CSS);
    const current = block(css, '.chart-switcher__current');
    expect(current).not.toMatch(/flex-shrink:\s*0/);
    expect(current).toMatch(/min-width:\s*0/);
    expect(current).toMatch(/overflow:\s*hidden/);
    expect(current).not.toMatch(/flex-grow:\s*1/);
    expect(current).not.toMatch(/flex:\s*1\b/);

    const name = block(css, '.chart-switcher__current-name');
    expect(name).toMatch(/min-width:\s*0/);
    expect(name).toMatch(/overflow:\s*hidden/);
    expect(name).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('ChartSwitcher 把谱面名包进 current-name，满名留给 title', () => {
    const tsx = readStripped(TSX);
    expect(tsx).toMatch(/className="chart-switcher__current-name"/);
    expect(tsx).toMatch(/title=\{currentTitle\}/);
    expect(tsx).toMatch(/chartSwitchLabel\(/);
    expect(tsx).not.toMatch(/pillLabel.*join/);
  });
});

describe('issue 175 · 顶栏只读态收成锁图标', () => {
  it('不再挂只读芯片或顶栏复制键；锁进当前谱面钮；菜单复制仍在', () => {
    const tsx = readStripped(TSX);
    const css = readStripped(CSS);
    expect(tsx).not.toMatch(/chart-switcher__readonly/);
    expect(tsx).not.toMatch(/copyToEdit/);
    expect(css).not.toMatch(/chart-switcher__readonly/);
    expect(tsx).toMatch(/className="chart-switcher__lock"/);
    expect(tsx).toMatch(/workspace\.switcher\.copyCurrent/);
    expect(css).toMatch(/\.chart-switcher__lock\s*\{/);
  });
});

describe('issue 176 · 当前谱面钮色块带等级、标题不再写 Easy', () => {
  it('色块走 diffPillLabel，标题后不再跟等级', () => {
    const tsx = readStripped(TSX);
    expect(tsx).toMatch(/diffPillLabel\(/);
    expect(tsx).not.toMatch(/pp-muted">\{cur\.level/);
    expect(tsx).not.toMatch(/DIFF_NAMES\[cur\.diff\]/);
  });
});

