// 票 41 防回潮总闸：状态操作的唯一入口 = 工程详情页谱面行的徽标菜单。
//
// 行为侧（点开菜单 / 选中提交 / 上传态 inert / 点当前态 no-op）由
// tests/dom/pages/ChartStatusBadgeMenu.test.tsx 看守；这里只钉**接线事实**：
// 独立文字按钮与工作台菜单项不得回潮、i18n key 不得残留、徽标默认只读。
import { describe, expect, it } from 'vitest';
import { readSource, readStripped } from '@/tests/support/source';

const DETAIL = 'src/pages/projects/components/ProjectDetail.tsx';
const SWITCHER = 'src/pages/workspace/ChartSwitcher.tsx';
const BITS = 'src/pages/projects/components/ProjectBits.tsx';
const LOCALES = ['src/i18n/messages/zh-CN.json', 'src/i18n/messages/en.json'];

describe('票 41 · 状态入口唯一化接线', () => {
  it('详情页谱面行没有独立「标为完成」文字按钮，徽标接了 interactive', () => {
    const detail = readStripped(DETAIL);
    expect(detail).not.toMatch(/projects\.markComplete/);
    expect(detail).not.toMatch(/projects\.unmarkComplete/);
    expect(detail).toMatch(/<StatusBadge[\s\S]*?interactive/);
  });

  it('工作台切换器没有「标为完成」菜单项，也不再引用 toggleChartCompleted', () => {
    const switcher = readStripped(SWITCHER);
    expect(switcher).not.toMatch(/switcher\.markComplete/);
    expect(switcher).not.toMatch(/switcher\.unmarkComplete/);
    expect(switcher).not.toMatch(/toggleChartCompleted/);
  });

  it('四组 markComplete i18n key 全清、statusEdit 双语俱全', () => {
    for (const locale of LOCALES) {
      const json = readSource(locale);
      expect(json, locale).not.toMatch(/"projects\.markComplete"/);
      expect(json, locale).not.toMatch(/"projects\.unmarkComplete"/);
      expect(json, locale).not.toMatch(/"workspace\.switcher\.markComplete"/);
      expect(json, locale).not.toMatch(/"workspace\.switcher\.unmarkComplete"/);
      expect(json, locale).toMatch(/"projects\.statusEdit"/);
    }
  });

  it('StatusBadge 默认只读；已上传态 interactive 也不挂菜单', () => {
    const bits = readStripped(BITS);
    expect(bits).toMatch(/interactive = false/);
    expect(bits).toMatch(/s === 'uploaded'/);
  });

  it('hub / 切换器 / 预览页的徽标不挂 interactive（定案 4：一律只读）', () => {
    for (const file of [
      'src/pages/projects/components/ProjectHub.tsx',
      'src/pages/workspace/ChartSwitcher.tsx',
      'src/pages/preview/PreviewChartSwitcher.tsx',
    ]) {
      expect(readStripped(file), file).not.toMatch(/interactive/);
    }
  });
});
