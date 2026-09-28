// issue 23 #2 锁测：工程详情页左栏宽度存于 `settings.layout.projectList.width`。
//
// 形状照 PanelWidth.test.ts（工作台面板默认宽那条）：归一化公式 + 出厂默认 + 落盘往返
// 一起锁。这里多一层理由——详情页的夹取是**绝对区间**（220..420），不是工作台那种随视口
// 伸缩（min(300,20vw)），所以边界必须钉死，免得哪天有人把它改成 vw 口径。
import { describe, expect, it } from 'vitest';
import {
  clampProjectListWidth, defaultSettings, loadSettings, saveSettings, updateSettings, PROJECT_LIST_WIDTH,
} from '@/src/chart/config/AppSettings';
import { settingsMemStorage as memStorage, settingsStorageOf } from '@/tests/support/storage';

describe('issue 23 #2 · clampProjectListWidth 归一化', () => {
  it('区间定义：220..420，默认 300', () => {
    expect(PROJECT_LIST_WIDTH).toEqual({ min: 220, max: 420, default: 300 });
  });

  it('缺字段 / 非数值 / 非有限数 → 回落默认', () => {
    expect(clampProjectListWidth(undefined)).toBe(300);
    expect(clampProjectListWidth(null)).toBe(300);
    expect(clampProjectListWidth('320')).toBe(300); // 字符串不认：拖拽给的是数字
    expect(clampProjectListWidth(NaN)).toBe(300);
    expect(clampProjectListWidth(Infinity)).toBe(300);
    expect(clampProjectListWidth({})).toBe(300);
  });

  it('越界夹到区间端点（不回落默认）', () => {
    expect(clampProjectListWidth(0)).toBe(220);
    expect(clampProjectListWidth(-100)).toBe(220);
    expect(clampProjectListWidth(9999)).toBe(420);
    expect(clampProjectListWidth(220)).toBe(220);
    expect(clampProjectListWidth(420)).toBe(420);
  });

  it('区间内的值原样通过，小数取整（像素无意义）', () => {
    expect(clampProjectListWidth(300)).toBe(300);
    expect(clampProjectListWidth(357)).toBe(357);
    expect(clampProjectListWidth(357.4)).toBe(357);
    expect(clampProjectListWidth(357.6)).toBe(358);
  });
});

describe('issue 23 #2 · 出厂默认与持久化', () => {
  it('defaultSettings().layout.projectList.width = 300', () => {
    expect(defaultSettings().layout.projectList.width).toBe(300);
  });

  it('additive：写 projectList 不 bump schemaVersion，工作台两栏不动', () => {
    const base = defaultSettings();
    const next = updateSettings(base, {
      layout: { ...base.layout, projectList: { width: 380 } },
    });
    expect(next.schemaVersion).toBe(base.schemaVersion);
    expect(next.layout.projectList.width).toBe(380);
    expect(next.layout.leftPanel).toEqual(base.layout.leftPanel);
    expect(next.layout.rightPanel).toEqual(base.layout.rightPanel);
  });

  it('save → load 往返保留拖出来的宽度（跨会话沿用的机制）', () => {
    const st = memStorage();
    const base = defaultSettings();
    saveSettings(updateSettings(base, { layout: { ...base.layout, projectList: { width: 396 } } }), st);
    expect(loadSettings(st).layout.projectList.width).toBe(396);
  });

  it('老设置文件没有 projectList 段 / 结构脏 / 值越界 → 归一化', () => {
    const base = { schemaVersion: 1, theme: 'dark' };
    expect(loadSettings(settingsStorageOf(base)).layout.projectList.width).toBe(300);
    expect(loadSettings(settingsStorageOf({ ...base, layout: { projectList: 'nope' } })).layout.projectList.width).toBe(300);
    expect(loadSettings(settingsStorageOf({ ...base, layout: { projectList: null } })).layout.projectList.width).toBe(300);
    expect(loadSettings(settingsStorageOf({ ...base, layout: { projectList: { width: 10 } } })).layout.projectList.width).toBe(220);
    expect(loadSettings(settingsStorageOf({ ...base, layout: { projectList: { width: 800 } } })).layout.projectList.width).toBe(420);
    expect(loadSettings(settingsStorageOf({ ...base, layout: { projectList: { width: 340 } } })).layout.projectList.width).toBe(340);
  });

  it('工作台两栏的读取不受 projectList 段影响（同一 layout 下的两套尺子）', () => {
    const loaded = loadSettings(settingsStorageOf({
      schemaVersion: 1,
      layout: {
        leftPanel: { width: 999, collapsed: true },
        rightPanel: { width: 123, collapsed: false },
        projectList: { width: 250 },
      },
    }));
    expect(loaded.layout.leftPanel).toEqual({ width: 999, collapsed: true });
    expect(loaded.layout.rightPanel).toEqual({ width: 123, collapsed: false });
    expect(loaded.layout.projectList.width).toBe(250);
  });
});
