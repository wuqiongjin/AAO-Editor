// chart-preview 41 · 仿真场素材包清单的消费侧（ADR-0018 §1/§2）：
//   - **列表即真相**：清单只列实际取到的包（list* 就是取件侧产物的镜子）；
//   - 非法 / 不在清单里的包 ID 静默回落默认 `skin00`（照 noteSkin.ts 的回落写法：
//     默认值原样返回，不因清单内容改道）；
//   - 空清单 → 归一化原样给回默认常量（调用方据此走"缺素材"空态，不抛错）。
// 注册表本体由素材取件侧产出（git 忽略、assets:sync 取件），本测试注入一份可控清单，
// 不依赖快照里实际取到哪些包（CI 桩环境同样可跑）。
//
// issue 49：entry 带显示名契约字段 skinName（五服原样 [jp,en,tw,cn,kr]）。注入数据覆盖：
// 有官方名（skin00）/ 某服坏（skin05 cn 空、skin14 kr=null）/ 社区 fallback（skin_maid）/
// 旧快照缺字段（field skin_miku）。背景包官方名五服同值日文 → 当前语言名走 i18n 消息表；
// 展示序编号包在前、主题包在后（用户 2026-10-22 二轮反馈）。
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/src/preview/video/sim/gen/simAssetPacks.gen', () => ({
  SIM_ASSET_PACKS: {
    field: [
      { id: 'skin_maid', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png', skinName: ['Maid', 'Maid', 'Maid', 'Maid', 'Maid'] },
      { id: 'skin00', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png', skinName: ['レーンスキン00', 'レーンスキン00', '軌跡外觀00', '按键条皮肤00', '레인 스킨00'] },
      { id: 'skin05', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png', skinName: ["Poppin'Partyのレーン", "Poppin'Party Lane", "Poppin'Party的軌跡", "Poppin'Party的按键条皮肤", "Poppin'Party 레인"] },
      { id: 'skin14', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png', skinName: ['MyGO!!!!!のレーン', 'MyGO!!!!! Lane', '軌跡', '按键条皮肤', null] },
      { id: 'skin_miku', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png' },
    ],
    background: [
      { id: 'skin_miku', background: 'liveBG.png', skinName: ['Miku', 'Miku', 'Miku', 'Miku', 'Miku'] },
      { id: 'skin00', background: 'liveBG_normal.png', skinName: ['デフォルト背景', 'デフォルト背景', 'デフォルト背景', 'デフォルト背景', '기본 배경'] },
      { id: 'skin03', background: 'liveBG_normal.png', skinName: ['対バンイベント背景', '対バンイベント背景', '対バンイベント背景', '対バンイベント背景', '합동 이벤트 배경'] },
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
  simPackDisplayName,
} from '@/src/preview/video/sim/simAssetPacks';
import { setActiveUiLanguage } from '@/src/i18n';

describe('chart-preview 41 · 包清单（列表即真相）', () => {
  it('两个选择器各自一份清单；默认包都是 skin00', () => {
    expect(SIM_DEFAULT_PACK_IDS).toEqual({ field: 'skin00', background: 'skin00' });
    expect(listSimFieldPacks().map((p) => p.id)).toEqual(['skin00', 'skin05', 'skin14', 'skin_maid', 'skin_miku']);
    expect(listSimBackgroundPacks().map((p) => p.id)).toEqual(['skin00', 'skin03', 'skin_miku']);
  });

  it('按包 ID 定型查找：场地图 / 判定线 / 主背景图各就各位', () => {
    expect(findSimFieldPack('skin_miku')).toEqual({
      id: 'skin_miku', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png',
    });
    expect(findSimBackgroundPack('skin_miku')).toEqual({
      id: 'skin_miku', background: 'liveBG.png', skinName: ['Miku', 'Miku', 'Miku', 'Miku', 'Miku'],
    });
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

  it('展示序：编号包（skinNN）在前按号数排，主题包在后保留取件侧顺序（用户 2026-10-22 反馈）', async () => {
    const gen = await import('@/src/preview/video/sim/gen/simAssetPacks.gen');
    // 现场把清单打乱（skin10 混在主题包之间），验证排序不依赖取件侧的顺序
    (gen.SIM_ASSET_PACKS as { field: unknown }).field = [
      { id: 'skin_maid' }, { id: 'skin10' }, { id: 'skin02' }, { id: 'habahiro' },
    ];
    try {
      expect(listSimFieldPacks().map((p) => p.id)).toEqual(['skin02', 'skin10', 'skin_maid', 'habahiro']);
    } finally {
      (gen.SIM_ASSET_PACKS as { field: unknown }).field = [
        { id: 'skin_maid', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png', skinName: ['Maid', 'Maid', 'Maid', 'Maid', 'Maid'] },
        { id: 'skin00', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png', skinName: ['レーンスキン00', 'レーンスキン00', '軌跡外觀00', '按键条皮肤00', '레인 스킨00'] },
        { id: 'skin05', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png', skinName: ["Poppin'Partyのレーン", "Poppin'Party Lane", "Poppin'Party的軌跡", "Poppin'Party的按键条皮肤", "Poppin'Party 레인"] },
        { id: 'skin14', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png', skinName: ['MyGO!!!!!のレーン', 'MyGO!!!!! Lane', '軌跡', '按键条皮肤', null] },
        { id: 'skin_miku', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png' },
      ];
    }
  });
});

describe('issue 49 · 显示名（simPackDisplayName：官方命名选服，回落包 ID）', () => {
  const field00 = { id: 'skin00', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png', skinName: ['レーンスキン00', 'レーンスキン00', '軌跡外觀00', '按键条皮肤00', '레인 스킨00'] };
  const field05 = { id: 'skin05', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png', skinName: ["Poppin'Partyのレーン", "Poppin'Party Lane", "Poppin'Party的軌跡", "Poppin'Party的按键条皮肤", "Poppin'Party 레인"] };
  const field14 = { id: 'skin14', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png', skinName: ['MyGO!!!!!のレーン', 'MyGO!!!!! Lane', '軌跡', '按键条皮肤', null] };
  const bg00 = { id: 'skin00', background: 'liveBG_normal.png', skinName: ['デフォルト背景', 'デフォルト背景', 'デフォルト背景', 'デフォルト背景', '기본 배경'] };
  const bgMiku = { id: 'skin_miku', background: 'liveBG.png', skinName: ['Miku', 'Miku', 'Miku', 'Miku', 'Miku'] };
  const miku = { id: 'skin_miku', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png' };

  it('轨道包 zh-CN：取官方 cn 服条目（index 3）', () => {
    setActiveUiLanguage('zh-CN');
    expect(simPackDisplayName(field00, 'field')).toBe('按键条皮肤00');
    expect(simPackDisplayName(field05, 'field')).toBe("Poppin'Party的按键条皮肤");
  });

  it('轨道包 zh-CN：某服空串跳下一服（skin05 的 cn 空 → 取 en；en 也空 → 回落 jp）', () => {
    setActiveUiLanguage('zh-CN');
    expect(simPackDisplayName({ ...field05, skinName: ["Poppin'Partyのレーン", "Poppin'Party Lane", '', '', ''] }, 'field'))
      .toBe("Poppin'Party Lane");
    expect(simPackDisplayName({ ...field05, skinName: ["Poppin'Partyのレーン", '', '', '', ''] }, 'field'))
      .toBe("Poppin'Partyのレーン");
  });

  it('轨道包 en：取 en 服（index 1）；某服为 null（skin14 的 kr）不炸', () => {
    setActiveUiLanguage('en');
    expect(simPackDisplayName(field00, 'field')).toBe('レーンスキン00');
    expect(simPackDisplayName(field14, 'field')).toBe('MyGO!!!!! Lane');
  });

  it('轨道包：旧快照缺 skinName → 回落包 ID（灰度安全，= 现行为）', () => {
    setActiveUiLanguage('zh-CN');
    expect(simPackDisplayName(miku, 'field')).toBe('skin_miku');
  });

  it('背景包：官方名五服同值日文 → 取 i18n 消息表的当前语言名（用户 2026-10-22：不显示原始日文）', () => {
    setActiveUiLanguage('zh-CN');
    expect(simPackDisplayName(bg00, 'background')).toBe('默认背景');
    setActiveUiLanguage('en');
    expect(simPackDisplayName(bg00, 'background')).toBe('Default Background');
  });

  it('背景包：官方将来真给出本地化条目（异于 jp 槽）→ 以官方为准', () => {
    setActiveUiLanguage('zh-CN');
    const localizedBg = { ...bg00, skinName: ['デフォルト背景', 'Default Background', '預設背景', '默认背景（官方）', '기본 배경'] };
    expect(simPackDisplayName(localizedBg, 'background')).toBe('默认背景（官方）');
  });

  it('背景包：无官方名的主题包仍走社区 fallback（Miku）；消息表缺 key 不告警', () => {
    setActiveUiLanguage('zh-CN');
    expect(simPackDisplayName(bgMiku, 'background')).toBe('Miku');
  });

  it('背景包：旧快照缺 skinName → 有 i18n 名的照常显示（比回落包 ID 更好）', () => {
    setActiveUiLanguage('zh-CN');
    expect(simPackDisplayName({ id: 'skin00' }, 'background')).toBe('默认背景');
    // 没有 i18n 名又没有 skinName 的包才回落包 ID
    expect(simPackDisplayName({ id: 'skin_5th' }, 'background')).toBe('skin_5th');
  });

  it('两个选择器各自独立：同一 skin00 在轨道 / 背景清单里各取各的名', () => {
    setActiveUiLanguage('zh-CN');
    expect(simPackDisplayName(findSimFieldPack('skin00')!, 'field')).toBe('按键条皮肤00');
    expect(simPackDisplayName(findSimBackgroundPack('skin00')!, 'background')).toBe('默认背景');
  });
});
