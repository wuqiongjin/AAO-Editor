// 自动生成（scripts/build-key-sounds.mjs）· 键音素材包注册表。勿手改。
// 每包的差异采样（tap/flick/slide）经动态 import 独立 chunk 懒下载（issue 20：零 .mp3 网络请求）；
// 共享采样（skill / directional 3 档）静态内联，各包一致。
// 扩容（追加官方普通/联动/限定包）：改 scripts/build-key-sounds.mjs 的 PACKS 清单重跑。
import type { KeySoundSample, KeySoundSetEntry } from '../KeySound';

import skillSrc from '../../assets/audio/keysounds/shared/SE_RHYTHM_TAP_SKILL.mp3?inline';
import dir1Src from '../../assets/audio/keysounds/shared/directional_fl.mp3?inline';
import dir2Src from '../../assets/audio/keysounds/shared/directional_fl_2.mp3?inline';
import dir3Src from '../../assets/audio/keysounds/shared/directional_fl_3.mp3?inline';

/** 各包一致的共享采样（技能键 + 方向键按组合长度 1..3 分档） */
const SHARED_SAMPLES: Record<'skill' | 'directional', KeySoundSample> = {
  skill: { src: skillSrc },
  directional: { tierSrcs: { 1: dir1Src, 2: dir2Src, 3: dir3Src } },
};

export const GENERATED_KEY_SOUND_PACKS: KeySoundSetEntry[] = [
  {
    id: 'skin00',
    label: '官方键音 00',
    load: async () => {
      const { packSamples } = await import('./samples.skin00.gen');
      return { id: 'skin00', label: '官方键音 00', samples: { ...packSamples, ...SHARED_SAMPLES } };
    },
  },
  {
    id: 'skin01',
    label: '官方键音 01',
    load: async () => {
      const { packSamples } = await import('./samples.skin01.gen');
      return { id: 'skin01', label: '官方键音 01', samples: { ...packSamples, ...SHARED_SAMPLES } };
    },
  },
  {
    id: 'skin02',
    label: '官方键音 02',
    load: async () => {
      const { packSamples } = await import('./samples.skin02.gen');
      return { id: 'skin02', label: '官方键音 02', samples: { ...packSamples, ...SHARED_SAMPLES } };
    },
  },
  {
    id: 'skin03',
    label: '官方键音 03',
    load: async () => {
      const { packSamples } = await import('./samples.skin03.gen');
      return { id: 'skin03', label: '官方键音 03', samples: { ...packSamples, ...SHARED_SAMPLES } };
    },
  },
];
