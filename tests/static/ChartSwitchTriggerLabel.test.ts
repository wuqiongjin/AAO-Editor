// issue 176：工作台 / 预览切换器当前钮 = 色块「短码 等级」+ 独立谱面名，不再写 Easy、等级不跟在标题后。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

describe('issue 176 · 切换器当前钮拼法', () => {
  it('预览触发钮走 diffPillLabel / chartSwitchLabel，标题后无独立等级', () => {
    const tsx = readStripped('src/pages/preview/PreviewChartSwitcher.tsx');
    expect(tsx).toMatch(/diffPillLabel\(/);
    expect(tsx).toMatch(/chartSwitchLabel\(/);
    expect(tsx).not.toMatch(/pp-muted">\{cur\.level/);
    expect(tsx).not.toMatch(/chartEffectiveTitle\(project\.name, cur\.title/);
    expect(tsx).toMatch(/preview\.chart\.triggerAria',\s*\{\s*title: switchLabel/);
  });

  it('色块允许「EZ 1」不换行', () => {
    const css = readStripped('src/pages/projects/ProjectsPage.css');
    const start = css.indexOf('.pp-pill__diff {');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toMatch(/white-space:\s*nowrap/);
  });
});
