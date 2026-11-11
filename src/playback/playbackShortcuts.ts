// 倍速 / 音量快捷键的共用步进（issue 230）：工作台与动态预览两处 runFunction 只做接线，
// 「按一次该变成多少」收在这一处，避免两页各写一份预设档 / 端点口径。
//
// 反馈只靠播放条常显的 `1×` 读数与音量滑条位置：本层不弹 toast / OSD，也不新增设置字段
//（倍速仍是模块级内存态、刷新回 1×；音量仍只落 `settings.audio.volume`）。
import type { FunctionId } from '../settings/ShortcutConfig';
import { SIM_PLAYBACK_RATE_PRESETS } from './playbackRateState';

/**
 * 四个播放控制功能 = `useShortcutDispatch` 的 `noRepeat` 名单，也是预览页 `PLAY_ONLY` 的追加项。
 * 按住不连发：倍速只有 7 档，键盘自动连发会一瞬间冲到底并把引擎 / React 成本放大 ~30 倍；
 * 其它快捷键（含空格播放）的连发行为保持原样。
 */
export const PLAYBACK_SHORTCUT_IDS: readonly FunctionId[] = [
  'rateDown', 'rateUp', 'volumeDown', 'volumeUp',
];

/** 音量步长：与 `PlayBar` / `CompactAudio` 滑杆的 `step` 一致 */
export const AUDIO_VOLUME_STEP = 0.05;

const EPS = 1e-9;
const RATE_MIN = SIM_PLAYBACK_RATE_PRESETS[0];
const RATE_MAX = SIM_PLAYBACK_RATE_PRESETS[SIM_PLAYBACK_RATE_PRESETS.length - 1];

/**
 * 按现有 7 档预设跳一档，端点停住。
 * - 手填值（不在档上）向两侧切入相邻档；
 * - 快捷键**封顶 2×**：升档永不产出 >2× 的值（引擎区间上限 4× 仍靠手填）；
 *   当前值已在 2× 以上时升档不动作、降档落回 2×。
 */
export function stepPlaybackRatePreset(current: number, dir: 1 | -1): number {
  if (dir > 0) {
    if (current >= RATE_MAX - EPS) return current;
    return SIM_PLAYBACK_RATE_PRESETS.find((r) => r > current + EPS) ?? RATE_MAX;
  }
  if (current <= RATE_MIN + EPS) return current;
  let lower: number = RATE_MIN;
  for (const r of SIM_PLAYBACK_RATE_PRESETS) {
    if (r >= current - EPS) break;
    lower = r;
  }
  return lower;
}

/** 音量每次恰好 ±0.05、clamp `[0,1]`、端点停住；四位小数只用来收掉 0.1 进制浮点尾巴 */
export function stepAudioVolume(current: number, dir: 1 | -1): number {
  const base = Number.isFinite(current) ? Math.min(1, Math.max(0, current)) : 1;
  const next = Math.round((base + dir * AUDIO_VOLUME_STEP) * 1e4) / 1e4;
  return Math.min(1, Math.max(0, next));
}
