// chart-preview 30 / 79：视频开场设置（`settings.export.opening`）的默认值 / 归一化 / 段内写回。
//
// 为什么单测：`opening` 是**嵌套对象**（`{ enabled, items }`），而 `updateSettings({export})`
// 是浅合并 —— 改 `enabled` 却把 `items` 整个抹掉这类 bug，肉眼在 UI 上要开合好几轮才发现。
// 与 `ExportFieldSettings` 同款 additive 段：不 bump schemaVersion。
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_FIELDS,
  DEFAULT_OPENING_ITEMS,
  OPENING_ITEM_IDS,
  defaultSettings,
  loadSettings,
  mergeOpening,
  normalizeOpening,
  updateSettings,
  type OpeningItemId,
} from '@/src/settings/AppSettings';
import { settingsMemStorage, settingsStorageOf } from '@/tests/support/storage';

const ALL_ON: Record<OpeningItemId, boolean> = {
  difficulty: true, title: true, artist: true,
  lyricist: true, composer: true, arranger: true, charter: true,
};

describe('chart-preview 30 · 开场默认档', () => {
  it('默认**全开**（定案 5）：整段开 + 七项信息项全开', () => {
    expect(DEFAULT_EXPORT_FIELDS.opening).toEqual({ enabled: true, items: ALL_ON });
    expect(defaultSettings().export.opening).toEqual(DEFAULT_EXPORT_FIELDS.opening);
  });

  it('票 79 · 候选全列 = 难度 / 歌曲标题 / 乐队 + 作词 / 作曲 / 编曲 / 谱师，默认全开', () => {
    expect(OPENING_ITEM_IDS).toEqual([
      'difficulty', 'title', 'artist', 'lyricist', 'composer', 'arranger', 'charter',
    ]);
    expect(DEFAULT_OPENING_ITEMS).toEqual(ALL_ON);
  });
});

describe('chart-preview 30 · 归一化（缺字段回落 true）', () => {
  it('整段缺失 / 段不是对象 ⇒ 全开', () => {
    expect(normalizeOpening(undefined)).toEqual({ enabled: true, items: ALL_ON });
    expect(normalizeOpening(null)).toEqual({ enabled: true, items: ALL_ON });
    expect(normalizeOpening('nope')).toEqual({ enabled: true, items: ALL_ON });
  });

  it('缺 items ⇒ 七项全开；缺单项 ⇒ 该项开（老数据升级后不得被默默关掉）', () => {
    expect(normalizeOpening({ enabled: true }).items).toEqual(ALL_ON);
    expect(normalizeOpening({ items: { difficulty: false } }).items).toEqual({
      ...ALL_ON, difficulty: false,
    });
    // 票 79：旧配置里只有前三项，新增 4 项回落到 true
    expect(normalizeOpening({ items: { difficulty: false, title: false, artist: false } }).items).toEqual({
      ...ALL_ON, difficulty: false, title: false, artist: false,
    });
  });

  it('脏值不混进来（只认布尔）；未知键忽略', () => {
    const raw = { enabled: 'yes', items: { title: 1, artist: false, charter: 0, nope: true } };
    expect(normalizeOpening(raw)).toEqual({
      enabled: true, // 'yes' 不是布尔 ⇒ 回落
      items: { ...ALL_ON, artist: false }, // title=1 / charter=0 回落 true
    });
  });

  it('归一化不写脏 `DEFAULT_EXPORT_FIELDS.opening`（浅拷贝那口井）', () => {
    const before = JSON.stringify(DEFAULT_EXPORT_FIELDS.opening);
    normalizeOpening({ enabled: false, items: { title: false } });
    expect(JSON.stringify(DEFAULT_EXPORT_FIELDS.opening)).toBe(before);
  });
});

describe('chart-preview 30 · 段内写回（两层合并）', () => {
  it('改 enabled 不抹掉 items', () => {
    const next = updateSettings(defaultSettings(), {
      export: { opening: { enabled: false, items: { ...ALL_ON } } },
    });
    expect(next.export.opening.enabled).toBe(false);
    expect(next.export.opening.items).toEqual(ALL_ON);
  });

  it('改一项不抹掉其它项（含票 79 新增 4 项）', () => {
    const next = updateSettings(defaultSettings(), {
      export: { opening: { enabled: true, items: { ...ALL_ON, artist: false } } },
    });
    expect(next.export.opening.items).toEqual({ ...ALL_ON, artist: false });
  });

  it('mergeOpening 未提的项保持原值；段不存在时从默认起', () => {
    expect(mergeOpening(undefined, { items: { difficulty: false } as Record<OpeningItemId, boolean> }).items).toEqual({
      ...ALL_ON, difficulty: false,
    });
    const prev = { enabled: true, items: { ...ALL_ON, title: false } };
    expect(mergeOpening(prev, { enabled: false }).items).toEqual(prev.items);
  });
});

describe('chart-preview 30 · 落盘回读（不 bump schemaVersion）', () => {
  it('旧数据（没有 opening）读回来 = 默认全开，且不影响信息区那 8 项', () => {
    const loaded = loadSettings(settingsStorageOf({ export: { chartTitle: true, bpm: true } }));
    expect(loaded.export.opening).toEqual({ enabled: true, items: ALL_ON });
    expect(loaded.export.chartTitle).toBe(true);
    expect(loaded.export.bpm).toBe(true);
    expect(loaded.export.charter).toBe(false);
  });

  it('关掉整段能落盘、也能读回（再开时原样回来）', () => {
    const st = settingsMemStorage();
    const next = updateSettings(defaultSettings(), {
      export: { opening: { enabled: false, items: { ...ALL_ON, title: false } } },
    });
    loadSettings(st); // 走一遍默认（保证 storage 形状合法）
    expect(next.export.opening).toEqual({
      enabled: false,
      items: { ...ALL_ON, title: false },
    });
  });
});
