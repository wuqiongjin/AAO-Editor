// 倍速的「一个共享内存单点」（chart-preview 58 / 59 A 案）。
//
//   - 值区间 / 常用档 / 归一化随 `PlaybackRate` 控件一起从预览侧抽到本层，
//     但上下限仍以引擎的 `PLAYBACK_RATE_RANGE` 为**唯一真相源**（不另立第二份）；
//   - 工作台与动态预览两处 `<PlayBar rateSlot>` 都经 `usePlaybackRate()` 读写这一个值，实时同步；
//   - 只是一次运行内的内存态：不落设置、不进 settings schema；模块重新求值（刷新 / 重启）即回 1×；
//     保活挂载下切页不卸载模块 ⇒ 跨切页存活。
// 声调改善（变速保调）由 61 另跟：本层只持有数值，绝不在这里或两处各做一套补偿。
import { useSyncExternalStore } from 'react';
import { PLAYBACK_RATE_RANGE } from '../audio/AudioEngine';

/** 倍速上下限（= 引擎既有的钳制区间，唯一真相源） */
export { PLAYBACK_RATE_RANGE };

/** 倍速输入框里 ↑↓ 的步长 */
export const SIM_PLAYBACK_RATE_STEP = 0.1;

/**
 * 常用倍速档（面板里那一列）：**0.25× 起、2× 止**。
 * 区间上下限那两档**不进表**（0.1× 只有手填到得了）；手填值不受这张表限制。
 */
export const SIM_PLAYBACK_RATE_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/**
 * 倍速归一化：上下限就是引擎的钳制区间，越界**就地钳回**；
 * 非法输入（空串 / 非数字 / NaN）回落 `fallback`（缺省 1 = 原速），回落值同样过一遍钳制。
 */
export function normalizePlaybackRate(raw: unknown, fallback: number = 1): number {
  const { min, max } = PLAYBACK_RATE_RANGE;
  const n = raw === '' || (typeof raw === 'string' && raw.trim() === '') ? Number.NaN : Number(raw);
  if (!Number.isFinite(n)) return Math.min(max, Math.max(min, fallback));
  return Math.min(max, Math.max(min, n));
}

// ===== 共享内存单点 =====
let rate = 1;
const listeners = new Set<() => void>();

/** 读取当前共享倍速（1 = 原速） */
export function getPlaybackRate(): number {
  return rate;
}

/** 写共享倍速：按引擎区间钳制，值不变则不通知 */
export function setPlaybackRate(next: number): void {
  const clamped = normalizePlaybackRate(next, 1);
  if (clamped === rate) return;
  rate = clamped;
  for (const l of listeners) l();
}

/** 订阅共享倍速变化（给 `useSyncExternalStore` 用）；返回 unsubscribe */
export function subscribePlaybackRate(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * 把共享值复位回 1×（刷新 / 重启语义）。仅供测试与"重开一轮"用；
 * 复位后通知订阅者，已挂载的两处控件跟着回显。
 */
export function resetPlaybackRate(): void {
  if (rate === 1) return;
  rate = 1;
  for (const l of listeners) l();
}

/** React 绑定：两处页面各自取 `[rate, setRate]`，`setRate` 是稳定的模块级 setter */
export function usePlaybackRate(): [number, (rate: number) => void] {
  const value = useSyncExternalStore(subscribePlaybackRate, getPlaybackRate, getPlaybackRate);
  return [value, setPlaybackRate];
}
