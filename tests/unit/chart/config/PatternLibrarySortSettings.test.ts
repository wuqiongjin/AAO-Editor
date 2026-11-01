import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  loadSettings,
  updateSettings,
} from '@/src/chart/config/AppSettings';
import { settingsStorageOf } from '@/tests/support/storage';

describe('issue 192 · 片段库排序设置（settings.patternLibrary.sort）', () => {
  it('默认值：createdAt 降序（最新收藏在前）', () => {
    expect(defaultSettings().patternLibrary.sort).toEqual({
      key: 'createdAt',
      direction: 'desc',
    });
  });

  it('老设置无 patternLibrary 字段：回落默认值', () => {
    const loaded = loadSettings(settingsStorageOf({ schemaVersion: 1 }));
    expect(loaded.patternLibrary.sort).toEqual({
      key: 'createdAt',
      direction: 'desc',
    });
  });

  it('有效值正常读写与 round-trip', () => {
    const loaded = loadSettings(settingsStorageOf({
      schemaVersion: 1,
      patternLibrary: {
        sort: { key: 'name', direction: 'asc' },
      },
    }));
    expect(loaded.patternLibrary.sort).toEqual({
      key: 'name',
      direction: 'asc',
    });
  });

  it('脏数据与非法枚举回落默认值', () => {
    // 非对象
    expect(loadSettings(settingsStorageOf({
      schemaVersion: 1,
      patternLibrary: 'invalid',
    })).patternLibrary.sort).toEqual({ key: 'createdAt', direction: 'desc' });

    // 未知 key 回落 createdAt
    expect(loadSettings(settingsStorageOf({
      schemaVersion: 1,
      patternLibrary: { sort: { key: 'unknownKey', direction: 'asc' } },
    })).patternLibrary.sort).toEqual({ key: 'createdAt', direction: 'asc' });

    // 非法 direction 回落 desc
    expect(loadSettings(settingsStorageOf({
      schemaVersion: 1,
      patternLibrary: { sort: { key: 'noteCount', direction: 'random' } },
    })).patternLibrary.sort).toEqual({ key: 'noteCount', direction: 'desc' });

    // 缺少 direction 回落 desc
    expect(loadSettings(settingsStorageOf({
      schemaVersion: 1,
      patternLibrary: { sort: { key: 'beatSpan' } },
    })).patternLibrary.sort).toEqual({ key: 'beatSpan', direction: 'desc' });
  });

  it('updateSettings 段内合并：改 sort 不丢其它设置，改其它设置不丢 sort', () => {
    const updated = updateSettings(defaultSettings(), {
      patternLibrary: {
        sort: { key: 'noteCount', direction: 'asc' },
      },
    });
    expect(updated.patternLibrary.sort).toEqual({ key: 'noteCount', direction: 'asc' });

    const updatedOther = updateSettings(updated, { theme: 'dark' });
    expect(updatedOther.patternLibrary.sort).toEqual({ key: 'noteCount', direction: 'asc' });
    expect(updatedOther.theme).toBe('dark');
  });

  it('保持 schemaVersion: 1（additive 字段，不 bump 版本号）', () => {
    expect(defaultSettings().schemaVersion).toBe(1);
    const updated = updateSettings(defaultSettings(), {
      patternLibrary: { sort: { key: 'name', direction: 'desc' } },
    });
    expect(updated.schemaVersion).toBe(1);
  });
});
