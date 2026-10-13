// 票 18 锁测：社区素材缓存的**回收策略**落在 `settings.cachePolicy`
// （additive 字段、随配置导入导出走、缺段 / 脏值 / 越界回落默认 30 天 / 1GB）。
import { describe, expect, it } from 'vitest';
import {
  CACHE_POLICY_RANGE,
  DEFAULT_CACHE_POLICY,
  defaultSettings,
  loadSettings,
  normalizeCachePolicy,
  saveSettings,
  updateSettings,
} from '@/src/chart/config/AppSettings';
import { settingsMemStorage as memStorage, settingsStorageOf } from '@/tests/support/storage';

describe('票 18 · settings.cachePolicy', () => {
  it('出厂默认 = 票 14 定案的那两个数（30 天 / 1GB）', () => {
    expect(DEFAULT_CACHE_POLICY).toEqual({ maxIdleDays: 30, maxMegabytes: 1024 });
    expect(defaultSettings().cachePolicy).toEqual(DEFAULT_CACHE_POLICY);
  });

  it('additive：写策略不 bump schemaVersion，其余字段不动', () => {
    const base = defaultSettings();
    const next = updateSettings(base, { cachePolicy: { maxIdleDays: 7 } });
    expect(next.schemaVersion).toBe(base.schemaVersion);
    expect(next.cachePolicy).toEqual({ maxIdleDays: 7, maxMegabytes: 1024 });
    expect(next.display).toEqual(base.display);
    expect(base.cachePolicy.maxIdleDays).toBe(30); // 不改旧对象
  });

  it('save → load 往返保留策略（跨会话沿用）', () => {
    const st = memStorage();
    saveSettings(updateSettings(defaultSettings(), { cachePolicy: { maxIdleDays: 90, maxMegabytes: 512 } }), st);
    expect(loadSettings(st).cachePolicy).toEqual({ maxIdleDays: 90, maxMegabytes: 512 });
  });

  it('老设置文件没有这段 → 回落默认；脏值 / 越界 → 夹进区间', () => {
    const read = (raw: unknown) => loadSettings(settingsStorageOf({ schemaVersion: 1, cachePolicy: raw })).cachePolicy;
    expect(read(undefined)).toEqual(DEFAULT_CACHE_POLICY);
    expect(read('nope')).toEqual(DEFAULT_CACHE_POLICY);
    expect(read(null)).toEqual(DEFAULT_CACHE_POLICY);
    expect(read({})).toEqual(DEFAULT_CACHE_POLICY);
    expect(read({ maxIdleDays: '30' })).toEqual(DEFAULT_CACHE_POLICY);
    expect(read({ maxIdleDays: 0 }).maxIdleDays).toBe(CACHE_POLICY_RANGE.idleDays.min);
    expect(read({ maxIdleDays: 9999 }).maxIdleDays).toBe(CACHE_POLICY_RANGE.idleDays.max);
    expect(read({ maxMegabytes: 1 }).maxMegabytes).toBe(CACHE_POLICY_RANGE.megabytes.min);
    expect(read({ maxMegabytes: 999999 }).maxMegabytes).toBe(CACHE_POLICY_RANGE.megabytes.max);
    expect(read({ maxIdleDays: 7.6 }).maxIdleDays).toBe(8); // 取整
    expect(read({ maxIdleDays: 14, maxMegabytes: 2048 })).toEqual({ maxIdleDays: 14, maxMegabytes: 2048 });
  });

  it('normalizeCachePolicy 与 updateSettings 同一把尺（界面输入 / 导入共用）', () => {
    expect(normalizeCachePolicy({ maxIdleDays: -5, maxMegabytes: Number.NaN })).toEqual({
      maxIdleDays: CACHE_POLICY_RANGE.idleDays.min,
      maxMegabytes: DEFAULT_CACHE_POLICY.maxMegabytes,
    });
  });
});
