// 键音素材包（ADR-0004 §7）：按"击打样式"四类采样，不做 per-lane 音高。
// 占位实现：现有振荡器（频率/波形）作为"占位素材"；未来以真实 WAV 采样替换（依赖 ticket 04 文件 IPC）。
export type KeySoundKind = 'tap' | 'flick' | 'skill' | 'slide';

/** 占位素材的单个采样规格（振荡器） */
export interface KeySoundSample {
  frequency: number;
  oscillatorType: OscillatorType;
}

export interface KeySoundSet {
  id: string;
  label: string;
  samples: Record<KeySoundKind, KeySoundSample>;
}

export const DEFAULT_KEY_SOUND_SET_ID = 'placeholder';

const PLACEHOLDER: KeySoundSet = {
  id: DEFAULT_KEY_SOUND_SET_ID,
  label: '占位',
  samples: {
    tap: { frequency: 880, oscillatorType: 'square' },
    flick: { frequency: 1320, oscillatorType: 'square' },
    skill: { frequency: 660, oscillatorType: 'square' },
    slide: { frequency: 1100, oscillatorType: 'triangle' },
  },
};

/** 素材包注册表（未来向注册表追加真实包即可） */
export const KEY_SOUND_SETS: KeySoundSet[] = [PLACEHOLDER];

export const keySoundSetById = (id: string): KeySoundSet =>
  KEY_SOUND_SETS.find(s => s.id === id) ?? PLACEHOLDER;