import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  loadSettings,
  updateSettings,
} from '@/src/chart/config/AppSettings';
import { settingsStorageOf } from '@/tests/support/storage';

describe('ADR-0021 · 自动检查写入设置对象', () => {
  it('默认开；缺字段回落 true；false 保留；脏值回落 true', () => {
    expect(defaultSettings().autoCheck).toBe(true);
    expect(loadSettings(settingsStorageOf({ schemaVersion: 1 })).autoCheck).toBe(true);
    expect(loadSettings(settingsStorageOf({ schemaVersion: 1, autoCheck: false })).autoCheck).toBe(false);
    expect(loadSettings(settingsStorageOf({ schemaVersion: 1, autoCheck: 'no' })).autoCheck).toBe(true);
  });

  it('updateSettings 改自动检查不丢其它字段；改主题不抹掉自动检查', () => {
    const off = updateSettings(defaultSettings(), { autoCheck: false });
    expect(off.autoCheck).toBe(false);
    expect(updateSettings(off, { theme: 'dark' }).autoCheck).toBe(false);
  });

  it('导入 JSON 不含也不能改 updateSource', () => {
    const loaded = loadSettings(settingsStorageOf({
      schemaVersion: 1,
      autoCheck: false,
      updateSource: 'cnb',
    }));
    expect(loaded.autoCheck).toBe(false);
    expect(loaded).not.toHaveProperty('updateSource');
    expect(JSON.stringify(loaded)).not.toContain('updateSource');
    expect(JSON.stringify(defaultSettings())).not.toContain('updateSource');
  });
});
