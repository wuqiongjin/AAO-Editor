// issue 242 锁测：曲线选项胶囊的展开态存 settings.layout.curveCapsuleOpen
// （跨工具切换与跨会话持久化，出厂默认折叠；additive，不 bump schemaVersion）。
import { describe, it, expect } from 'vitest';
import { defaultSettings, loadSettings, saveSettings, updateSettings } from '@/src/settings/AppSettings';
import { settingsMemStorage as memStorage } from '@/tests/support/storage';

describe('issue 242 · settings.layout.curveCapsuleOpen', () => {
  it('出厂默认折叠', () => {
    expect(defaultSettings().layout.curveCapsuleOpen).toBe(false);
  });

  it('缺字段 / 脏值回落折叠，布尔值原样保留', () => {
    const load = (layout: unknown) => loadSettings(memStorage(JSON.stringify({ schemaVersion: 1, layout })));
    expect(load({}).layout.curveCapsuleOpen).toBe(false);
    expect(load({ curveCapsuleOpen: 'yes' }).layout.curveCapsuleOpen).toBe(false);
    expect(load({ curveCapsuleOpen: 1 }).layout.curveCapsuleOpen).toBe(false);
    expect(load({ curveCapsuleOpen: true }).layout.curveCapsuleOpen).toBe(true);
    expect(load({ curveCapsuleOpen: false }).layout.curveCapsuleOpen).toBe(false);
  });

  it('设置导出 → 导入（loadSettings 校验）保持展开态', () => {
    const base = defaultSettings();
    const exported = JSON.stringify({ ...base, layout: { ...base.layout, curveCapsuleOpen: true } });
    // 导入与 SettingsPage.handleImport 同路径：整份 JSON 经 loadSettings 字段合并
    expect(loadSettings({ getItem: () => exported }).layout.curveCapsuleOpen).toBe(true);
  });

  it('往返保真；改它不动抽屉与工程列表宽度', () => {
    const base = defaultSettings();
    const st = memStorage();
    const next = { ...base, layout: { ...base.layout, curveCapsuleOpen: true } };
    saveSettings(next, st);
    expect(loadSettings(st).layout).toEqual({
      patternDrawer: base.layout.patternDrawer,
      projectList: base.layout.projectList,
      curveCapsuleOpen: true,
    });

    const toggled = updateSettings(next, { layout: { ...next.layout, curveCapsuleOpen: false } });
    expect(toggled.layout.curveCapsuleOpen).toBe(false);
    expect(toggled.layout.patternDrawer).toEqual(base.layout.patternDrawer);
    expect(toggled.layout.projectList).toEqual(base.layout.projectList);
    expect(toggled.schemaVersion).toBe(1);
  });
});
