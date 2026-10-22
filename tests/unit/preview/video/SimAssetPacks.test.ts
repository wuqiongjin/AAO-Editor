// chart-preview 41 · 仿真场素材包清单的消费侧（ADR-0018 §1/§2）：
//   - **列表即真相**：清单只列实际取到的包（list* 就是取件侧产物的镜子）；
//   - 非法 / 不在清单里的包 ID 静默回落默认 `skin00`（照 noteSkin.ts 的回落写法：
//     默认值原样返回，不因清单内容改道）；
//   - 空清单 → 归一化原样给回默认常量（调用方据此走"缺素材"空态，不抛错）。
// 注册表本体由素材取件侧产出（git 忽略、assets:sync 取件），本测试注入一份可控清单，
// 不依赖快照里实际取到哪些包（CI 桩环境同样可跑）。
import { describe, expect, it, vi } from 'vitest';

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

import {
  SIM_DEFAULT_PACK_IDS,
  findSimBackgroundPack,
  findSimFieldPack,
  listSimBackgroundPacks,
  listSimFieldPacks,
  normalizeSimAssetPackId,
} from '@/src/preview/video/sim/simAssetPacks';

describe('chart-preview 41 · 包清单（列表即真相）', () => {
  it('两个选择器各自一份清单；默认包都是 skin00', () => {
    expect(SIM_DEFAULT_PACK_IDS).toEqual({ field: 'skin00', background: 'skin00' });
    expect(listSimFieldPacks().map((p) => p.id)).toEqual(['skin00', 'skin_miku']);
    expect(listSimBackgroundPacks().map((p) => p.id)).toEqual(['skin00', 'skin_miku']);
  });

  it('按包 ID 定型查找：场地图 / 判定线 / 主背景图各就各位', () => {
    expect(findSimFieldPack('skin_miku')).toEqual({
      id: 'skin_miku', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png',
    });
    expect(findSimBackgroundPack('skin_miku')).toEqual({ id: 'skin_miku', background: 'liveBG.png' });
  });

  it('清单里没有的包 ID → undefined（UI 不渲染这一格）', () => {
    expect(findSimFieldPack('skin_satan')).toBeUndefined();
    expect(findSimBackgroundPack('skin01')).toBeUndefined(); // 轨道独有的编号包不在背景清单里
  });

  it('合法 ID 原样保留；非法 / 脏值 → 静默回落 skin00', () => {
    expect(normalizeSimAssetPackId('field', 'skin_miku')).toBe('skin_miku');
    expect(normalizeSimAssetPackId('background', 'skin_miku')).toBe('skin_miku');
    expect(normalizeSimAssetPackId('field', 'skin_satan')).toBe('skin00'); // 清单里没有
    expect(normalizeSimAssetPackId('background', '')).toBe('skin00');
    expect(normalizeSimAssetPackId('background', 42)).toBe('skin00');
    expect(normalizeSimAssetPackId('background', null)).toBe('skin00');
    expect(normalizeSimAssetPackId('background', undefined)).toBe('skin00');
  });

  it('清单里连默认包都没有 → 仍回落 skin00 常量（照 noteSkin.ts：默认值原样返回，不自建）', async () => {
    const gen = await import('@/src/preview/video/sim/gen/simAssetPacks.gen');
    const saved = gen.SIM_ASSET_PACKS.background;
    // 现场换一份没有 skin00 的背景清单（对象是注入的可变引用）
    (gen.SIM_ASSET_PACKS as { background: unknown }).background = [{ id: 'skin_5th', background: 'liveBG.png' }];
    try {
      expect(normalizeSimAssetPackId('background', 'whatever')).toBe('skin00');
      expect(normalizeSimAssetPackId('background', 'skin_5th')).toBe('skin_5th'); // 清单里的合法值照原样
    } finally {
      (gen.SIM_ASSET_PACKS as { background: unknown }).background = saved;
    }
  });

  it('空清单 → 归一化原样给回默认常量（调用方据此走缺素材空态，不抛错）', async () => {
    const gen = await import('@/src/preview/video/sim/gen/simAssetPacks.gen');
    const saved = gen.SIM_ASSET_PACKS.field;
    (gen.SIM_ASSET_PACKS as { field: unknown }).field = [];
    try {
      expect(normalizeSimAssetPackId('field', 'skin00')).toBe('skin00');
      expect(listSimFieldPacks()).toEqual([]);
      expect(findSimFieldPack('skin00')).toBeUndefined();
    } finally {
      (gen.SIM_ASSET_PACKS as { field: unknown }).field = saved;
    }
  });
});
