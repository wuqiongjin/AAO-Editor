// chart-preview 52：结尾画面设置（`settings.export.ending`）的默认值 / 归一化 / 段内写回。
//
// 为什么单测：这一段的两个字段决定"导出物末尾多不多 7.5s、章是哪一档"。老数据没有这个段
// （additive，不 bump schemaVersion）⇒ 缺字段必须回落"开 + ALL PERFECT"，不能被静默关掉；
// 脏值（拼错的 stamp / 字符串当布尔）必须回落默认，不能把 undefined 带进绘制。
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENDING,
  DEFAULT_EXPORT_FIELDS,
  ENDING_STAMP_IDS,
  defaultSettings,
  loadSettings,
  normalizeEnding,
  updateSettings,
} from '@/src/settings/AppSettings';
import { settingsStorageOf } from '@/tests/support/storage';

describe('chart-preview 52 · 结尾画面默认档', () => {
  it('默认**开** + ALL PERFECT（Auto 永远 PERFECT，票 52 Q8）', () => {
    expect(DEFAULT_ENDING).toEqual({ enabled: true, stamp: 'ap' });
    expect(DEFAULT_EXPORT_FIELDS.ending).toEqual(DEFAULT_ENDING);
    expect(defaultSettings().export.ending).toEqual(DEFAULT_ENDING);
  });

  it('三档形态 = AP / FC / 普通 Clear（顺序即下拉顺序）', () => {
    expect(ENDING_STAMP_IDS).toEqual(['ap', 'fc', 'clear']);
  });
});

describe('chart-preview 52 · 归一化（缺字段回落、脏值不混进来）', () => {
  it('整段缺失 / 不是对象 ⇒ 开 + ap', () => {
    expect(normalizeEnding(undefined)).toEqual({ enabled: true, stamp: 'ap' });
    expect(normalizeEnding(null)).toEqual({ enabled: true, stamp: 'ap' });
    expect(normalizeEnding('nope')).toEqual({ enabled: true, stamp: 'ap' });
  });

  it('只认三档白名单 + 布尔：脏 stamp / 脏 enabled 各自回落', () => {
    expect(normalizeEnding({ stamp: 'ss' })).toEqual({ enabled: true, stamp: 'ap' });
    expect(normalizeEnding({ stamp: 42 })).toEqual({ enabled: true, stamp: 'ap' });
    expect(normalizeEnding({ enabled: 'off' })).toEqual({ enabled: true, stamp: 'ap' });
    expect(normalizeEnding({ enabled: false, stamp: 'fc' })).toEqual({ enabled: false, stamp: 'fc' });
  });

  it('归一化不写脏 `DEFAULT_EXPORT_FIELDS.ending`（浅拷贝那口井）', () => {
    const before = JSON.stringify(DEFAULT_EXPORT_FIELDS.ending);
    normalizeEnding({ enabled: false, stamp: 'clear' });
    expect(JSON.stringify(DEFAULT_EXPORT_FIELDS.ending)).toBe(before);
  });

  it('CLEAR 是正式档位：归一化、段内写回、存档往返都不回落 ap（2026-11-09 验收）', () => {
    expect(normalizeEnding({ stamp: 'clear' })).toEqual({ enabled: true, stamp: 'clear' });
    expect(updateSettings(defaultSettings(), {
      export: { ending: { ...DEFAULT_ENDING, stamp: 'clear' } },
    }).export.ending).toEqual({ enabled: true, stamp: 'clear' });
    expect(loadSettings(settingsStorageOf({ export: { ending: { enabled: false, stamp: 'clear' } } }))
      .export.ending).toEqual({ enabled: false, stamp: 'clear' });
  });
});

describe('chart-preview 52 · 段内写回（改一项不抹掉另一项）', () => {
  it('段内浅合并：传整段（UI 就是这么传的）时两个字段都落到位，不互相抹掉', () => {
    const off = updateSettings(defaultSettings(), {
      export: { ending: { ...DEFAULT_ENDING, enabled: false } },
    });
    expect(off.export.ending).toEqual({ enabled: false, stamp: 'ap' });

    const fc = updateSettings(defaultSettings(), {
      export: { ending: { ...DEFAULT_ENDING, stamp: 'fc' } },
    });
    expect(fc.export.ending).toEqual({ enabled: true, stamp: 'fc' });

    // 段内还有一层兜底：patch 里缺字段时按 prev 补齐（不是按默认值）
    const prev = { ...DEFAULT_ENDING, stamp: 'clear' as const };
    expect(normalizeEnding({ enabled: false }, prev)).toEqual({ enabled: false, stamp: 'clear' });
  });

  it('旧数据（没有 ending）读回来 = 默认开 + ap，且不影响开场 / 信息区', () => {
    const loaded = loadSettings(
      settingsStorageOf({ export: { chartTitle: true, bpm: true, opening: { enabled: false } } }),
    );
    expect(loaded.export.ending).toEqual({ enabled: true, stamp: 'ap' });
    expect(loaded.export.opening.enabled).toBe(false);
    expect(loaded.export.chartTitle).toBe(true);
  });
});
