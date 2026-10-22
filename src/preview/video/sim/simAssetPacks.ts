// 仿真场素材包清单的**消费侧**（chart-preview 41 · ADR-0018）：
// 包清单由素材取件侧产出（`./gen/simAssetPacks.gen`，与 `public/assets/sim/` 二进制同版本、
// 一起取件；应用仓不自己生成），本模块只做「按包 ID 查清单 + 非法 ID 静默回落默认 `skin00`」
// —— 照 `rendering/skin/noteSkin.ts` 的 `normalizeNoteSkinSelection` 回落写法。
//
// **列表即真相**（ADR-0018 §1）：清单只列实际取到的包；选中的包不在清单里（快照缩水 /
// 脏设置值）时静默回落默认包，不弹错、不做"缺失"占位。
import {
  SIM_ASSET_PACKS,
  type SimBackgroundPackEntry,
  type SimFieldPackEntry,
} from './gen/simAssetPacks.gen';

/** 两个独立选择器（ADR-0018 §1：背景 / 轨道各自独立选择，不做成对整包） */
export type SimAssetPackKind = 'field' | 'background';

/** 默认包 ID：两个选择器各自默认 `skin00`（用户 2026-10-11 定案） */
export const SIM_DEFAULT_PACK_IDS: Record<SimAssetPackKind, string> = {
  field: 'skin00',
  background: 'skin00',
};

/**
 * 空清单（这类素材一个包都没取到）时的兜底文件名：拼出来的 URL 必然 404，
 * 调用方据此走"缺素材"空态。**正常路径永远走清单条目**，这三个字面量只服务
 * "快照连默认包都没摆"这一条 degenerate 分支（取件侧把 skin00 列为必备默认包）。
 */
export const SIM_EMPTY_REGISTRY_FILES = {
  background: 'liveBG_normal.png',
  field: 'bg_line_rhythm.png',
  playLine: 'game_play_line.png',
} as const;

/** 场地皮肤包清单（只含实际取到的包；空 = 快照没摆这类素材） */
export function listSimFieldPacks(): readonly SimFieldPackEntry[] {
  return SIM_ASSET_PACKS.field;
}

/** 表演背景包清单（口径同上） */
export function listSimBackgroundPacks(): readonly SimBackgroundPackEntry[] {
  return SIM_ASSET_PACKS.background;
}

/** 按包 ID 查场地皮肤包；不在清单里（含空清单）→ undefined */
export function findSimFieldPack(id: string): SimFieldPackEntry | undefined {
  return listSimFieldPacks().find((p) => p.id === id);
}

/** 按包 ID 查表演背景包；口径同上 */
export function findSimBackgroundPack(id: string): SimBackgroundPackEntry | undefined {
  return listSimBackgroundPacks().find((p) => p.id === id);
}

/**
 * 包 ID 归一化（设置读写 + URL 解析共用）：非字符串 / 清单里没有 → 静默回落默认 `skin00`
 * （照 noteSkin.ts：默认值原样返回，不因清单内容改道；连默认包都没取到时 URL 自然 404
 * → 缺素材空态，调用方不抛错）。
 */
export function normalizeSimAssetPackId(kind: SimAssetPackKind, raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return SIM_DEFAULT_PACK_IDS[kind];
  const entry = kind === 'field' ? findSimFieldPack(raw) : findSimBackgroundPack(raw);
  return entry ? raw : SIM_DEFAULT_PACK_IDS[kind];
}
