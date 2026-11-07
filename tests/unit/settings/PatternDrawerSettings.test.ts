// issue 180 锁测：片段库抽屉的开合态与宽度存 settings.layout.patternDrawer（177 Q14：跨会话、默认收起）
import { describe, it, expect } from 'vitest';
import {
  PATTERN_DRAWER_WIDTH, defaultSettings, loadSettings, saveSettings, updateSettings, type AppSettings,
} from '@/src/settings/AppSettings';
import { settingsMemStorage as memStorage } from '@/tests/support/storage';

describe('issue 180 · settings.layout.patternDrawer', () => {
  it('出厂默认：收起、300px', () => {
    expect(defaultSettings().layout.patternDrawer).toEqual({ open: false, width: 300 });
    expect(PATTERN_DRAWER_WIDTH.default).toBe(300);
  });

  it('老设置的 leftPanel / rightPanel 不再带出，也不被当成抽屉状态', () => {
    const st = memStorage(JSON.stringify({
      schemaVersion: 1,
      layout: { leftPanel: { width: 999, collapsed: true }, rightPanel: { width: 280, collapsed: false } },
    }));
    const layout = loadSettings(st).layout as Record<string, unknown>;
    expect(layout.leftPanel).toBeUndefined();
    expect(layout.rightPanel).toBeUndefined();
    expect(layout.patternDrawer).toEqual({ open: false, width: 300 });
  });

  it('脏值回落；宽度低于下限夹到 220', () => {
    const dirty = memStorage(JSON.stringify({ schemaVersion: 1, layout: { patternDrawer: { open: 'yes', width: 'wide' } } }));
    expect(loadSettings(dirty).layout.patternDrawer).toEqual({ open: false, width: 300 });
    const narrow = memStorage(JSON.stringify({ schemaVersion: 1, layout: { patternDrawer: { open: true, width: 50 } } }));
    expect(loadSettings(narrow).layout.patternDrawer).toEqual({ open: true, width: 220 });
  });

  it('往返保真', () => {
    const st = memStorage();
    const base = defaultSettings();
    const next: AppSettings = { ...base, layout: { ...base.layout, patternDrawer: { open: true, width: 360 } } };
    saveSettings(next, st);
    expect(loadSettings(st).layout.patternDrawer).toEqual({ open: true, width: 360 });
  });

  it('updateSettings 改抽屉不动工程列表宽度', () => {
    const base = defaultSettings();
    const next = updateSettings(base, { layout: { ...base.layout, patternDrawer: { open: true, width: 320 } } });
    expect(next.layout.projectList).toEqual(base.layout.projectList);
  });
});
