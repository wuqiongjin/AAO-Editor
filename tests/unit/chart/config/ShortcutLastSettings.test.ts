// issue 178 锁测：屏蔽前的键位落在 `settings.shortcutLast`
// （additive 字段、不 bump schemaVersion；缺段 / 脏值回落空记录）。
import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  loadSettings,
  normalizeShortcutMasks,
  saveSettings,
  updateSettings,
} from '@/src/chart/config/AppSettings';
import { settingsMemStorage as memStorage, settingsStorageOf } from '@/tests/support/storage';

describe('issue 178 · settings.shortcutLast', () => {
  it('出厂默认 = 空记录（没有屏蔽过任何功能）', () => {
    expect(defaultSettings().shortcutLast).toEqual({});
  });

  it('字段级写回：不 bump schemaVersion，shortcuts 与相邻字段不受影响', () => {
    const base = defaultSettings();
    const next = updateSettings(base, { shortcutLast: { switchSingle: 'h' } });
    expect(next.schemaVersion).toBe(base.schemaVersion);
    expect(next.shortcutLast).toEqual({ switchSingle: 'h' });
    expect(next.shortcuts).toEqual(base.shortcuts);
    expect(next.display).toEqual(base.display);
    expect(base.shortcutLast).toEqual({}); // 不改旧对象
  });

  it('save → load 往返保留记录（跨会话沿用）', () => {
    const st = memStorage();
    saveSettings(updateSettings(defaultSettings(), { shortcutLast: { switchSingle: 'h' } }), st);
    expect(loadSettings(st).shortcutLast).toEqual({ switchSingle: 'h' });
  });

  it('老设置没有这段 → 空；脏值逐条丢弃、大小写归一', () => {
    const read = (raw: unknown) =>
      loadSettings(settingsStorageOf({ schemaVersion: 1, shortcutLast: raw })).shortcutLast;
    expect(read(undefined)).toEqual({});
    expect(read('nope')).toEqual({});
    expect(read(null)).toEqual({});
    expect(read({})).toEqual({});
    expect(read({ switchSingle: 'H' })).toEqual({ switchSingle: 'h' });
    expect(read({ switchSingle: 42 })).toEqual({});
    expect(read({ notAFunction: 'h' })).toEqual({});
    expect(read({ switchSingle: '   ' })).toEqual({});
  });

  it('写入与读取同一把尺：未知功能 / 空串 / 非字符串一律不落盘', () => {
    expect(normalizeShortcutMasks({ switchSingle: 'H', notAFunction: 'x', pageAssets: '  ' } as unknown)).toEqual({
      switchSingle: 'h',
    });
  });
});
