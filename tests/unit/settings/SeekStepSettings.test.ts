import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEEK_STEP_SECONDS,
  defaultSettings, loadSettings, saveSettings, updateSettings,
  normalizeSeekStepSeconds, type AppSettings,
} from '@/src/settings/AppSettings';
import { restoreDefaultsInFilter } from '@/src/settings/shortcutIndexFilter';
import { getDefaultConfig } from '@/src/settings/ShortcutConfig';
import { settingsMemStorage as memStorage } from '@/tests/support/storage';

describe('issue 251 · 键盘 seek 步长归一化', () => {
  it('缺 / 非数 / 0 / 负数 → 1；10.04 → 10；0.09 → 0.1；再量化到 0.1', () => {
    expect(normalizeSeekStepSeconds(undefined)).toBe(1);
    expect(normalizeSeekStepSeconds('1')).toBe(1);
    expect(normalizeSeekStepSeconds(Number.NaN)).toBe(1);
    expect(normalizeSeekStepSeconds(0)).toBe(1);
    expect(normalizeSeekStepSeconds(-2)).toBe(1);
    expect(normalizeSeekStepSeconds(10.04)).toBe(10);
    expect(normalizeSeekStepSeconds(0.09)).toBe(0.1);
    expect(normalizeSeekStepSeconds(1.24)).toBe(1.2);
    expect(normalizeSeekStepSeconds(1.25)).toBe(1.3);
  });
});

describe('issue 251 · settings.seekStep*', () => {
  it('出厂默认两边都是 1 秒', () => {
    const d = defaultSettings();
    expect(d.seekStepBackSeconds).toBe(DEFAULT_SEEK_STEP_SECONDS);
    expect(d.seekStepForwardSeconds).toBe(DEFAULT_SEEK_STEP_SECONDS);
  });

  it('老设置没有这两字段 → 回落 1', () => {
    const st = memStorage(JSON.stringify({ schemaVersion: 1, theme: 'dark' }));
    const loaded = loadSettings(st);
    expect(loaded.seekStepBackSeconds).toBe(1);
    expect(loaded.seekStepForwardSeconds).toBe(1);
  });

  it('脏值回落 1，合法值量化保真', () => {
    const dirty = memStorage(JSON.stringify({
      schemaVersion: 1,
      seekStepBackSeconds: 0,
      seekStepForwardSeconds: 'nope',
    }));
    expect(loadSettings(dirty).seekStepBackSeconds).toBe(1);
    expect(loadSettings(dirty).seekStepForwardSeconds).toBe(1);

    const ok = memStorage();
    const next: AppSettings = {
      ...defaultSettings(),
      seekStepBackSeconds: 2.5,
      seekStepForwardSeconds: 0.3,
    };
    saveSettings(next, ok);
    expect(loadSettings(ok).seekStepBackSeconds).toBe(2.5);
    expect(loadSettings(ok).seekStepForwardSeconds).toBe(0.3);
  });

  it('updateSettings 两格独立，不碰 shortcuts / playbar', () => {
    const merged = updateSettings(defaultSettings(), { seekStepBackSeconds: 3 });
    expect(merged.seekStepBackSeconds).toBe(3);
    expect(merged.seekStepForwardSeconds).toBe(1);
    expect(merged.shortcuts).toEqual(defaultSettings().shortcuts);
    expect(merged.playbar).toEqual(defaultSettings().playbar);
  });

  it('快捷键恢复默认不清步长', () => {
    const settings = defaultSettings();
    settings.seekStepBackSeconds = 4;
    settings.seekStepForwardSeconds = 2;
    const custom = { ...settings.shortcuts, seekBack: 'z' as const };
    const restored = restoreDefaultsInFilter(custom, 'all');
    expect(restored.seekBack).toBe('arrowleft');
    expect(restored).toEqual(getDefaultConfig());
    expect(settings.seekStepBackSeconds).toBe(4);
    expect(settings.seekStepForwardSeconds).toBe(2);
  });
});
