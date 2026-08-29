// 键音击打样式的展示元数据（issue 29 素材页）：
// 素材包数据模型见 KeySound.ts（含音频资源，测试环境不便直接导入），
// 此处仅承载 UI 展示用的标签/说明，供素材页与未来素材导入校验复用。
import type { KeySoundKind } from './KeySound';

export interface KeySoundKindMeta {
  kind: KeySoundKind;
  label: string;
  /** 说明：该击打样式对应哪些音符（素材页展示用） */
  hint: string;
}

/** 击打样式全集（与 KeySoundSet.samples 的五类一一对应） */
export const KEY_SOUND_KINDS: KeySoundKind[] = ['tap', 'flick', 'skill', 'slide', 'directional'];

export const KEY_SOUND_KIND_META: Record<KeySoundKind, KeySoundKindMeta> = {
  tap: { kind: 'tap', label: '单键', hint: '单键（无标记）' },
  flick: { kind: 'flick', label: '滑键', hint: '滑键（flick 标记）' },
  skill: { kind: 'skill', label: '技能键', hint: '技能键（skill 标记）' },
  slide: { kind: 'slide', label: '滑条 / 长条', hint: '滑条与长条的拖动过程' },
  directional: { kind: 'directional', label: '方向键', hint: '方向键，按组合长度 1~3 分档' },
};
