// 自动生成（scripts/build-key-sounds.mjs）· 官方键音 01 键音包差异采样。勿手改。
// 静态 ?inline（issue 20：不产生 .mp3 网络请求）；本模块被注册表动态 import → 独立 chunk 懒下载。
import perfectSrc from '../../assets/audio/keysounds/skin01/perfect.mp3?inline';
import flickSrc from '../../assets/audio/keysounds/skin01/flick.mp3?inline';
import type { KeySoundSample } from '../KeySound';

/** 本包逐包差异采样（tap/slide→perfect，flick→flick；skill/directional 见注册表共享段） */
export const packSamples: Record<'tap' | 'slide' | 'flick', KeySoundSample> = {
  tap: { src: perfectSrc },
  slide: { src: perfectSrc },
  flick: { src: flickSrc },
};
