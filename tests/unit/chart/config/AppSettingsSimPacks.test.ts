// chart-preview 41 · 仿真场素材包设置（`settings.preview.bgPackId` / `fieldPackId`）：
// 应用级（ADR-0018 §3，"我的默认口味"）；读盘按取件侧包清单归一化 ——
// 清单里没有的 ID（脏值 / 快照缩水后残留的旧选择）静默回落默认 `skin00`。
// additive：老设置没有这两个字段 → 默认 skin00，不 bump schemaVersion。
import { describe, expect, it, vi } from 'vitest';

// 注入一份带第二个包的清单（"合法 ID 原样保留"要有一个非默认包可存）；
// 本机快照 / CI 桩只有 skin00 时不 mock 这条断言会退化成恒真。
vi.mock('@/src/preview/video/sim/gen/simAssetPacks.gen', () => ({
  SIM_ASSET_PACKS: {
    field: [
      { id: 'skin00', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png' },
      { id: 'skin_miku', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png' },
    ],
    background: [
      { id: 'skin00', background: 'liveBG_normal.png' },
      { id: 'skin_miku', background: 'liveBG.png' },
    ],
  },
}));

import { defaultSettings, loadSettings, updateSettings } from '@/src/chart/config/AppSettings';
import { settingsStorageOf } from '@/tests/support/storage';

describe('chart-preview 41 · 仿真场素材包设置', () => {
  it('默认两个包都是 skin00（ADR-0018 §1）', () => {
    expect(defaultSettings().preview.bgPackId).toBe('skin00');
    expect(defaultSettings().preview.fieldPackId).toBe('skin00');
  });

  it('合法包 ID 原样读回（两个选择器各自独立）', () => {
    const settings = loadSettings(settingsStorageOf({
      preview: { bgPackId: 'skin_miku', fieldPackId: 'skin_miku' },
    }));
    expect(settings.preview.bgPackId).toBe('skin_miku');
    expect(settings.preview.fieldPackId).toBe('skin_miku');
  });

  it('清单里没有的包 ID → 静默回落 skin00（列表即真相，不弹错）', () => {
    const settings = loadSettings(settingsStorageOf({
      preview: { bgPackId: 'skin_satan', fieldPackId: 'skin01' }, // skin01 只有轨道包、背景清单里没有
    }));
    expect(settings.preview.bgPackId).toBe('skin00');
    expect(settings.preview.fieldPackId).toBe('skin00');
  });

  it('脏值（非字符串）→ 回落 skin00', () => {
    const settings = loadSettings(settingsStorageOf({
      preview: { bgPackId: 7, fieldPackId: null },
    }));
    expect(settings.preview.bgPackId).toBe('skin00');
    expect(settings.preview.fieldPackId).toBe('skin00');
  });

  it('additive：老设置没有这两个字段 → 默认 skin00，schemaVersion 不动', () => {
    const settings = loadSettings(settingsStorageOf({ preview: { mirror: true } }));
    expect(settings.preview.bgPackId).toBe('skin00');
    expect(settings.preview.fieldPackId).toBe('skin00');
    expect(settings.schemaVersion).toBe(1);
  });

  it('写回：updateSettings 段内浅合并，改一个包不碰另一个包 / 别的档位', () => {
    const prev = defaultSettings();
    const next = updateSettings(prev, { preview: { bgPackId: 'skin_miku' } });
    expect(next.preview.bgPackId).toBe('skin_miku');
    expect(next.preview.fieldPackId).toBe('skin00');
    expect(next.preview.noteSpeed).toBe(prev.preview.noteSpeed);
    expect(next.display).toEqual(prev.display);
  });
});
