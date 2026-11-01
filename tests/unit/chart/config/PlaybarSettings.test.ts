// issue 179 锁测：播放条起点按钮的显隐开关 settings.playbar.markerButton（177 Q25：默认开）
import { describe, it, expect } from 'vitest';
import {
  defaultSettings, loadSettings, saveSettings, updateSettings, type AppSettings,
} from '@/src/chart/config/AppSettings';
import { settingsMemStorage as memStorage } from '@/tests/support/storage';

describe('issue 179 · settings.playbar', () => {
  it('出厂默认：显示播放起点按钮', () => {
    expect(defaultSettings().playbar).toEqual({ markerButton: true });
  });

  it('老设置文件没有 playbar 段 → 回落默认开', () => {
    const st = memStorage(JSON.stringify({ schemaVersion: 1, theme: 'dark' }));
    expect(loadSettings(st).playbar.markerButton).toBe(true);
  });

  it('非布尔脏值回落默认开', () => {
    const st = memStorage(JSON.stringify({ schemaVersion: 1, playbar: { markerButton: 'no' } }));
    expect(loadSettings(st).playbar.markerButton).toBe(true);
  });

  it('关掉后往返保真', () => {
    const st = memStorage();
    const next: AppSettings = { ...defaultSettings(), playbar: { markerButton: false } };
    saveSettings(next, st);
    expect(loadSettings(st).playbar.markerButton).toBe(false);
  });

  it('updateSettings 段内合并，不碰其它段', () => {
    const merged = updateSettings(defaultSettings(), { playbar: { markerButton: false } });
    expect(merged.playbar.markerButton).toBe(false);
    expect(merged.display).toEqual(defaultSettings().display);
    expect(updateSettings(merged, { theme: 'dark' }).playbar.markerButton).toBe(false);
  });
});
