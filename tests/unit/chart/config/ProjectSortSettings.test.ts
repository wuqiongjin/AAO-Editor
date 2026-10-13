// issue 19 #4 锁测：启动台排序偏好持久化于 `settings.projects.sort`
// （additive 字段、随配置导入导出走、缺段/脏值回落默认）。
import { describe, expect, it } from 'vitest';
import { defaultSettings, loadSettings, saveSettings, updateSettings } from '@/src/chart/config/AppSettings';
import { settingsMemStorage as memStorage, settingsStorageOf } from '@/tests/support/storage';

describe('issue 19 #4 · settings.projects.sort', () => {
  it('出厂默认「最近打开」，同步导入默认开启，选曲排序默认发布时间降序', () => {
    expect(defaultSettings().projects).toEqual({
      sort: 'lastOpened',
      importWithChart: true,
      songSort: { key: 'publishedAt', dir: 'desc' },
    });
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

describe('票 28 · settings.projects.importWithChart', () => {
  it('出厂默认开启（true）', () => {
    expect(defaultSettings().projects.importWithChart).toBe(true);
  });

  it('additive：更新 importWithChart 不 bump schemaVersion，其余字段不动', () => {
    const base = defaultSettings();
    const next = updateSettings(base, { projects: { importWithChart: false } });
    expect(next.schemaVersion).toBe(base.schemaVersion);
    expect(next.projects.importWithChart).toBe(false);
    expect(next.projects.sort).toBe(base.projects.sort);
    expect(base.projects.importWithChart).toBe(true);
  });

  it('save → load 往返保留所选状态', () => {
    const st = memStorage();
    saveSettings(updateSettings(defaultSettings(), { projects: { importWithChart: false } }), st);
    expect(loadSettings(st).projects.importWithChart).toBe(false);
  });

  it('老设置文件没有 importWithChart 或为非布尔 → 回落默认 true', () => {
    expect(loadSettings(memStorage(JSON.stringify({ schemaVersion: 1, theme: 'dark' }))).projects.importWithChart).toBe(true);
    expect(loadSettings(settingsStorageOf({ schemaVersion: 1, projects: { importWithChart: 'invalid' } })).projects.importWithChart).toBe(true);
    expect(loadSettings(settingsStorageOf({ schemaVersion: 1, projects: { sort: 'name' } })).projects.importWithChart).toBe(true);
  });
});

// 票 31 验收回修（用户 2026-10-13）：「排序的设置肯定要保存」——选曲面板的排序落 settings.projects.songSort
describe('票 31 · settings.projects.songSort', () => {
  it('出厂默认发布时间降序（键与方向一起）', () => {
    expect(defaultSettings().projects.songSort).toEqual({ key: 'publishedAt', dir: 'desc' });
  });

  it('additive：更新 songSort 不 bump schemaVersion，其余字段不动', () => {
    const base = defaultSettings();
    const next = updateSettings(base, { projects: { songSort: { key: 'title', dir: 'asc' } } });
    expect(next.schemaVersion).toBe(base.schemaVersion);
    expect(next.projects.songSort).toEqual({ key: 'title', dir: 'asc' });
    expect(next.projects.sort).toBe(base.projects.sort);
    expect(next.projects.importWithChart).toBe(base.projects.importWithChart);
    expect(base.projects.songSort).toEqual({ key: 'publishedAt', dir: 'desc' }); // 不改旧对象
  });

  it('save → load 往返保留键与方向（跨会话沿用的机制）', () => {
    const st = memStorage();
    saveSettings(updateSettings(defaultSettings(), { projects: { songSort: { key: 'artist', dir: 'desc' } } }), st);
    expect(loadSettings(st).projects.songSort).toEqual({ key: 'artist', dir: 'desc' });
  });

  it('缺段 / 脏值 / 半脏值：两个轴各自白名单，坏的那一轴回落默认', () => {
    // 老设置文件整段都没有
    expect(loadSettings(memStorage(JSON.stringify({ schemaVersion: 1, theme: 'dark' }))).projects.songSort)
      .toEqual({ key: 'publishedAt', dir: 'desc' });
    // 段不是对象 / 是 null
    expect(loadSettings(settingsStorageOf({ schemaVersion: 1, projects: { songSort: 'nope' } })).projects.songSort)
      .toEqual({ key: 'publishedAt', dir: 'desc' });
    expect(loadSettings(settingsStorageOf({ schemaVersion: 1, projects: { songSort: null } })).projects.songSort)
      .toEqual({ key: 'publishedAt', dir: 'desc' });
    // 键在白名单外 / 方向不在白名单 → 各自回落，另一轴保留
    expect(loadSettings(settingsStorageOf({ schemaVersion: 1, projects: { songSort: { key: 'sideways', dir: 'asc' } } })).projects.songSort)
      .toEqual({ key: 'publishedAt', dir: 'asc' });
    expect(loadSettings(settingsStorageOf({ schemaVersion: 1, projects: { songSort: { key: 'id', dir: 'sideways' } } })).projects.songSort)
      .toEqual({ key: 'id', dir: 'desc' });
  });
});
