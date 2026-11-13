// issue 178 锁测：节拍吸附持久化于 settings.beatSnap（177 Q6：全局一份、跨会话沿用上次值）
import { describe, it, expect } from 'vitest';
import {
  defaultSettings, loadSettings, saveSettings, updateSettings, type AppSettings,
} from '@/src/settings/AppSettings';
import { settingsMemStorage as memStorage } from '@/tests/support/storage';

describe('issue 178 · settings.beatSnap', () => {
  it('出厂默认 1/4', () => {
    expect(defaultSettings().beatSnap).toBe(4);
  });

  it('老设置文件没有 beatSnap → 回落 4', () => {
    const st = memStorage(JSON.stringify({ schemaVersion: 1, theme: 'dark' }));
    expect(loadSettings(st).beatSnap).toBe(4);
  });

  it('脏值回落 4；区间内的自定义值保留', () => {
    expect(loadSettings(memStorage(JSON.stringify({ schemaVersion: 1, beatSnap: 500 }))).beatSnap).toBe(4);
    expect(loadSettings(memStorage(JSON.stringify({ schemaVersion: 1, beatSnap: '16' }))).beatSnap).toBe(4);
    expect(loadSettings(memStorage(JSON.stringify({ schemaVersion: 1, beatSnap: 7 }))).beatSnap).toBe(7);
  });

  it('saveSettings → loadSettings 往返保真', () => {
    const st = memStorage();
    const next: AppSettings = { ...defaultSettings(), beatSnap: 48 };
    saveSettings(next, st);
    expect(loadSettings(st).beatSnap).toBe(48);
  });

  it('updateSettings 写入不 bump schemaVersion，脏值不落进运行时', () => {
    const merged = updateSettings(defaultSettings(), { beatSnap: 12 });
    expect(merged.schemaVersion).toBe(1);
    expect(merged.beatSnap).toBe(12);
    expect(updateSettings(merged, { beatSnap: 0 }).beatSnap).toBe(4);
    expect(updateSettings(merged, { theme: 'dark' }).beatSnap).toBe(12);
  });
});
