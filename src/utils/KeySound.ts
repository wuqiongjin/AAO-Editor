// 键音素材包（ADR-0004 §7 修订）：按"击打样式"分类，不做 per-lane 音高。
// 每种采样可以是：真实音频文件（src / tierSrcs）或振荡器占位（frequency/oscillatorType）。
// 真实音频以 Vite `?inline` 内联为 base64 data-URI（issue 20）：**不产生 .mp3 网络请求**，
// 从而规避浏览器下载插件（如 IDM）劫持 fetch 导致的无声/弹下载，且 web/Electron 都可靠可用。
// 方向键（LDirectional/RDirectional）按组合长度 length(1..3) 分 3 档音效。
import perfectMp3 from '../assets/audio/perfect.mp3?inline';
import flickMp3 from '../assets/audio/flick.mp3?inline';
import skillMp3 from '../assets/audio/SE_RHYTHM_TAP_SKILL.mp3?inline';
import directionalFlMp3 from '../assets/audio/directional_fl.mp3?inline';
import directionalFl2Mp3 from '../assets/audio/directional_fl_2.mp3?inline';
import directionalFl3Mp3 from '../assets/audio/directional_fl_3.mp3?inline';

export type KeySoundKind = 'tap' | 'flick' | 'skill' | 'slide' | 'directional';

/** 单个采样的规格：真实音频（src/tierSrcs，Vite 内联 data-URI）或振荡器占位（frequency/oscillatorType） */
export interface KeySoundSample {
  /** 真实音频资源（issue 20：Vite `?inline` 内联 data-URI，无 .mp3 网络请求）；缺省走振荡器占位 */
  src?: string;
  /** 方向键专用：按组合长度 length(1..3) 分档 → 采样（data-URI） */
  tierSrcs?: Record<number, string>;
  // 振荡器占位兜底（无 src 或采样未加载时使用）
  frequency?: number;
  oscillatorType?: OscillatorType;
}

export interface KeySoundSet {
  id: string;
  label: string;
  samples: Record<KeySoundKind, KeySoundSample>;
}

export const DEFAULT_KEY_SOUND_SET_ID = 'placeholder';
/** 默认激活素材包（官方真实音效；ADR-0004 §7 默认占位 → 有真实素材后切换为官方） */
export const DEFAULT_ACTIVE_KEY_SOUND_SET_ID = 'bangdream';

const PLACEHOLDER: KeySoundSet = {
  id: DEFAULT_KEY_SOUND_SET_ID,
  label: '占位',
  samples: {
    tap: { frequency: 880, oscillatorType: 'square' },
    flick: { frequency: 1320, oscillatorType: 'square' },
    skill: { frequency: 660, oscillatorType: 'square' },
    slide: { frequency: 1100, oscillatorType: 'triangle' },
    directional: { frequency: 990, oscillatorType: 'square' },
  },
};

// 官方真实音效（issue 18/20）：tap+slide→perfect，flick→flick，skill→SE_RHYTHM_TAP_SKILL，
// 方向键按 length(1..3)→directional_fl/_2/_3（全部内联 data-URI，不产生网络请求）。
const BANGDREAM: KeySoundSet = {
  id: DEFAULT_ACTIVE_KEY_SOUND_SET_ID,
  label: 'BanG Dream（官方）',
  samples: {
    tap: { src: perfectMp3, frequency: 880, oscillatorType: 'square' },
    flick: { src: flickMp3, frequency: 1320, oscillatorType: 'square' },
    skill: { src: skillMp3, frequency: 660, oscillatorType: 'square' },
    slide: { src: perfectMp3, frequency: 1100, oscillatorType: 'triangle' },
    directional: {
      frequency: 990,
      oscillatorType: 'square',
      tierSrcs: { 1: directionalFlMp3, 2: directionalFl2Mp3, 3: directionalFl3Mp3 },
    },
  },
};

/** 素材包注册表（向注册表追加真实包即可） */
export const KEY_SOUND_SETS: KeySoundSet[] = [BANGDREAM, PLACEHOLDER];

export const keySoundSetById = (id: string): KeySoundSet =>
  KEY_SOUND_SETS.find(s => s.id === id) ?? PLACEHOLDER;