// issue 19 #4 锁测：启动台排序偏好持久化于 `settings.projects.sort`
// （additive 字段、随配置导入导出走、缺段/脏值回落默认）。
import { describe, expect, it } from 'vitest';
import { defaultSettings, loadSettings, saveSettings, updateSettings } from '@/src/chart/config/AppSettings';
import { settingsMemStorage as memStorage, settingsStorageOf } from '@/tests/support/storage';

describe('issue 19 #4 · settings.projects.sort', () => {
  it('出厂默认「最近打开」', () => {
    expect(defaultSettings().projects).toEqual({ sort: 'lastOpened' });
  });

  it('additive：写 sort 不 bump schemaVersion，其余字段不动', () => {
    const base = defaultSettings();
    const next = updateSettings(base, { projects: { sort: 'chartCount' } });
    expect(next.schemaVersion).toBe(base.schemaVersion);
    expect(next.projects.sort).toBe('chartCount');
    expect(next.layout).toEqual(base.layout);
    expect(next.display).toEqual(base.display);
    expect(base.projects.sort).toBe('lastOpened'); // 不改旧对象
  });

  it('save → load 往返保留所选键（跨会话沿用的机制）', () => {
    const st = memStorage();
    saveSettings(updateSettings(defaultSettings(), { projects: { sort: 'name' } }), st);
    expect(loadSettings(st).projects.sort).toBe('name');
  });

  it('老设置文件没有 projects 段 → 回落默认；白名单外 / 结构脏 → 也回落', () => {
    expect(loadSettings(memStorage(JSON.stringify({ schemaVersion: 1, theme: 'dark' }))).projects.sort).toBe('lastOpened');
    expect(loadSettings(settingsStorageOf({ schemaVersion: 1, projects: { sort: 'sideways' } })).projects.sort).toBe('lastOpened');
    expect(loadSettings(settingsStorageOf({ schemaVersion: 1, projects: 'nope' })).projects.sort).toBe('lastOpened');
    expect(loadSettings(settingsStorageOf({ schemaVersion: 1, projects: null })).projects.sort).toBe('lastOpened');
    expect(loadSettings(settingsStorageOf({ schemaVersion: 1, projects: { sort: 'lastModified' } })).projects.sort).toBe('lastModified');
  });
});
