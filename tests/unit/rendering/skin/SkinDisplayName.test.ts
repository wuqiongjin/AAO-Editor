// issue 49 · ADR-0018 §6：皮肤显示名选服矩阵 + 官方命名实例数据。
// 夹具照 Bestdori `/api/skin/*.all.3.json` 实测（附 A + 复核）：skin09 的 cn 条目实为
// NBSP 变体、skin14 的 kr 为 null——这两条是选服规则里最不显然的部分，故钉实例。
import { describe, it, expect } from 'vitest';
import { pickSkinName, readPackSkinName } from '@/src/rendering/skin/skinDisplayName';

describe('pickSkinName：选服矩阵', () => {
  it('zh-CN 取 cn 服（index 3）', () => {
    expect(pickSkinName(['レーンスキン00', 'Lane Skin 00', '軌跡外觀00', '按键条皮肤00', '레인 스킨00'], 'zh-CN', 'skin00'))
      .toBe('按键条皮肤00');
  });

  it('zh-CN：cn 空串跳 en（index 1）', () => {
    expect(pickSkinName(['デフォルト背景', 'Default BG', '預設背景', '', '기본 배경'], 'zh-CN', 'skin00'))
      .toBe('Default BG');
  });

  it('zh-CN：cn / en 皆空回落 jp（index 0）', () => {
    expect(pickSkinName(['デフォルト背景', '', '預設背景', '', '기본 배경'], 'zh-CN', 'skin00'))
      .toBe('デフォルト背景');
  });

  it('en 取 en 服（index 1）', () => {
    expect(pickSkinName(['ハロー、ハッピーワールド！のレーン', 'Hello, Happy World! Lane', '軌跡', '按键条皮肤', '레인'], 'en', 'skin09'))
      .toBe('Hello, Happy World! Lane');
  });

  it('en：en 空串回落 jp', () => {
    expect(pickSkinName(['レーンスキン01', '', '軌跡外觀01', '按键条皮肤01', '레인 스킨01'], 'en', 'skin01'))
      .toBe('レーンスキン01');
  });

  it('某服为 null（API 实给过）→ 当不可用跳下一服', () => {
    expect(pickSkinName(['MyGO!!!!!のレーン', 'MyGO!!!!! Lane', '軌跡', '按键条皮肤', null], 'zh-CN', 'skin14'))
      .toBe('按键条皮肤');
    expect(pickSkinName(['MyGO!!!!!のレーン', 'MyGO!!!!! Lane', '軌跡', '按键条皮肤', null], 'en', 'skin14'))
      .toBe('MyGO!!!!! Lane');
  });

  it('全空 / 纯空白回落 fallback', () => {
    expect(pickSkinName(['', '', '', '', ''], 'zh-CN', 'skin00')).toBe('skin00');
    expect(pickSkinName(['   ', '\t', '', '', ''], 'en', 'skin00')).toBe('skin00');
  });

  it('undefined（旧快照未带 skinName）回落 fallback = 现 label / 包 ID', () => {
    expect(pickSkinName(undefined, 'zh-CN', 'Skin 00')).toBe('Skin 00');
    expect(pickSkinName(undefined, 'en', 'skin_maid')).toBe('skin_maid');
  });

  it('fallback 传 null = 明确表达"没有名"（背景包 i18n 补名前用）', () => {
    expect(pickSkinName(['', '', '', '', ''], 'zh-CN', null)).toBeNull();
    expect(pickSkinName(undefined, 'en', null)).toBeNull();
    expect(pickSkinName(['TYPE1', 'TYPE1', 'TYPE1', 'TYPE1', 'TYPE1'], 'en', null)).toBe('TYPE1');
  });
});

describe('pickSkinName：ADR-0018 §6 实例数据', () => {
  it('音符 skin05 = TYPE7（官方序号错位照官方显示，不按包号重排；五服同值）', () => {
    const skinName = ['TYPE7', 'TYPE7', 'TYPE7', 'TYPE7', 'TYPE7'];
    expect(pickSkinName(skinName, 'zh-CN', 'Skin 05')).toBe('TYPE7');
    expect(pickSkinName(skinName, 'en', 'Skin 05')).toBe('TYPE7');
  });

  it('轨道 skin05（Poppin\'Party）：cn 中文名优先；en 取英文名', () => {
    const skinName = ["Poppin'Partyのレーン", "Poppin'Party Lane", "Poppin'Party的軌跡", "Poppin'Party的按键条皮肤", "Poppin'Party 레인"];
    expect(pickSkinName(skinName, 'zh-CN', 'skin05')).toBe("Poppin'Party的按键条皮肤");
    expect(pickSkinName(skinName, 'en', 'skin05')).toBe("Poppin'Party Lane");
  });

  it('轨道 skin09：cn 服是 NBSP 变体 → 跳过取 en「Hello, Happy World! Lane」', () => {
    // API 实测：cn 条目为 "Hello,\u00A0Happy\u00A0World!的按键条皮肤"（词间 NBSP 而非普通空格）
    const skinName = [
      'ハロー、ハッピーワールド！のレーン',
      'Hello, Happy World! Lane',
      'Hello，Happy World！的軌跡',
      'Hello,\u00A0Happy\u00A0World!的按键条皮肤',
      '헬로 해피월드! 레인',
    ];
    expect(pickSkinName(skinName, 'zh-CN', 'skin09')).toBe('Hello, Happy World! Lane');
    expect(pickSkinName(skinName, 'en', 'skin09')).toBe('Hello, Happy World! Lane');
  });

  it('背景 skin00：五服同值「デフォルト背景」（tw/cn 曾未填回落日文，实填后同值）', () => {
    const skinName = ['デフォルト背景', 'デフォルト背景', 'デフォルト背景', 'デフォルト背景', '기본 배경'];
    expect(pickSkinName(skinName, 'zh-CN', 'skin00')).toBe('デフォルト背景');
    expect(pickSkinName(skinName, 'en', 'skin00')).toBe('デフォルト背景');
  });
});

describe('readPackSkinName：取件侧契约字段的防御性读取', () => {
  it('带了该字段 → 原样给出', () => {
    expect(readPackSkinName({ id: 'skin00', skinName: ['TYPE1', 'TYPE1', 'TYPE1', 'TYPE1', 'TYPE1'] }))
      .toEqual(['TYPE1', 'TYPE1', 'TYPE1', 'TYPE1', 'TYPE1']);
  });

  it('旧快照缺字段 / 脏值（非数组）→ undefined（调用方回落现行为）', () => {
    expect(readPackSkinName({ id: 'skin00', label: 'Skin 00' })).toBeUndefined();
    expect(readPackSkinName({ id: 'skin00', skinName: 'TYPE1' })).toBeUndefined();
    expect(readPackSkinName({ id: 'skin00', skinName: null })).toBeUndefined();
    expect(readPackSkinName(undefined)).toBeUndefined();
    expect(readPackSkinName(null)).toBeUndefined();
  });
});
