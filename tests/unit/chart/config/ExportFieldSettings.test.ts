// chart-preview 14：导出信息字段开关（`settings.export`）的默认值 / 归一化 / 段内写回。
//
// 为什么单测：这一组决定「导出图里写什么」，七项都是布尔 —— 脏值必须静默回落、缺段（旧数据）
// 必须补默认（否则导出头带拿到 undefined 当 false 用，用户开了的项会莫名消失）。
// 与 `settings.preview` 同款 additive 段：不 bump schemaVersion。
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_FIELDS,
  EXPORT_FIELD_KEYS,
  defaultSettings,
  loadSettings,
  saveSettings,
  updateSettings,
} from '@/src/chart/config/AppSettings';
import { stripComments, readSource } from '@/tests/support/source';
import { settingsMemStorage, settingsStorageOf } from '@/tests/support/storage';

describe('chart-preview 14 · 导出信息默认档', () => {
  it('默认开 = 谱面标题 + 难度等级 + BPM，其余关（用户 2026-10-06 拍板）', () => {
    expect(DEFAULT_EXPORT_FIELDS).toEqual({
      projectName: false,
      chartTitle: true,
      difficulty: true,
      duration: false,
      noteCount: false,
      bpm: true,
      exportedAt: false,
    });
    expect(defaultSettings().export).toEqual(DEFAULT_EXPORT_FIELDS);
  });

  it('候选全列与字段一一对应（UI 组与归一化共用同一份，加字段只改一处）', () => {
    expect([...EXPORT_FIELD_KEYS].sort()).toEqual(Object.keys(DEFAULT_EXPORT_FIELDS).sort());
    expect(EXPORT_FIELD_KEYS).toEqual([
      'projectName', 'chartTitle', 'difficulty', 'duration', 'noteCount', 'bpm', 'exportedAt',
    ]);
  });
});

describe('chart-preview 14 · mergeSettings 归一化', () => {
  it('缺段（旧数据）补默认；部分给值 → 逐字段合并', () => {
    expect(loadSettings(settingsStorageOf({ display: { noteSize: 1 } })).export).toEqual(DEFAULT_EXPORT_FIELDS);
    expect(loadSettings(settingsStorageOf({
      export: { projectName: true, exportedAt: true },
    })).export).toEqual({ ...DEFAULT_EXPORT_FIELDS, projectName: true, exportedAt: true });
  });

  it('脏值逐字段回落（只认布尔；字符串 / 数字 / null / 段本身不是对象都不许混进来）', () => {
    const dirty = loadSettings(settingsStorageOf({
      export: {
        projectName: 'yes', chartTitle: 1, difficulty: null, duration: 'true',
        noteCount: 0, bpm: false, exportedAt: true,
      },
    }));
    expect(dirty.export).toEqual({ ...DEFAULT_EXPORT_FIELDS, bpm: false, exportedAt: true });
    expect(loadSettings(settingsStorageOf({ export: 'nope' })).export).toEqual(DEFAULT_EXPORT_FIELDS);
    expect(loadSettings(settingsStorageOf({ export: 42 })).export).toEqual(DEFAULT_EXPORT_FIELDS);
  });

  it('additive 段：不 bump schemaVersion', () => {
    expect(defaultSettings().schemaVersion).toBe(1);
    expect(stripComments(readSource('src/chart/config/AppSettings.ts'))).not.toMatch(/schemaVersion:\s*[2-9]/);
  });

  it('saveSettings → loadSettings 往返带上 export（配置导入导出同源）', () => {
    const st = settingsMemStorage();
    const next = updateSettings(defaultSettings(), { export: { projectName: true, duration: true, bpm: false } });
    saveSettings(next, st);
    expect(loadSettings(st).export).toEqual({ ...DEFAULT_EXPORT_FIELDS, projectName: true, duration: true, bpm: false });
  });
});

describe('chart-preview 14 · updateSettings 段内浅合并', () => {
  it('只改一个开关不会清掉另外几个，也不动其它段', () => {
    const prev = defaultSettings();
    const next = updateSettings(prev, { export: { exportedAt: true } });
    expect(next.export).toEqual({ ...DEFAULT_EXPORT_FIELDS, exportedAt: true });
    expect(updateSettings(prev, { export: { bpm: false } }).export.chartTitle).toBe(true);
    expect(next.preview).toEqual(prev.preview);
    expect(next.display).toEqual(prev.display);
  });
});