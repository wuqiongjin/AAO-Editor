// 节拍吸附档位（issue 180 Q5 / Q16，实现票 181）：编辑落点按 1/N 拍吸附，N 即 `beatDisplay`。
// 全局一份、跨会话沿用（`settings.beatSnap`，与 `settings.curve` 同属"我的习惯"，不随谱面工程走）。
// 改档不会移动既有音符：放置写的是小数拍 + `subBeat: 0`，N 只决定新落点与画布细分线。

/** 预设档位：一行升序、只认数字（不分二分系 / 三分系） */
export const BEAT_SNAP_PRESETS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64] as const;

/** 自定义输入的整数区间 */
export const BEAT_SNAP_RANGE = { min: 1, max: 192 } as const;

export const DEFAULT_BEAT_SNAP = 4;

const isValidBeatSnap = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= BEAT_SNAP_RANGE.min && v <= BEAT_SNAP_RANGE.max;

/** 读盘归一化：区间内整数原样保留，其余回落默认 */
export function normalizeBeatSnap(raw: unknown): number {
  return isValidBeatSnap(raw) ? raw : DEFAULT_BEAT_SNAP;
}

/** 滚轮步进：在预设间走一档，越过端点停住；当前是自定义值时落到该方向上相邻的预设 */
export function stepBeatSnap(current: number, dir: 1 | -1): number {
  const list: readonly number[] = BEAT_SNAP_PRESETS;
  if (dir > 0) return list.find((v) => v > current) ?? list[list.length - 1];
  return [...list].reverse().find((v) => v < current) ?? list[0];
}

/** 自定义输入解析：区间内整数 → 数值，其余（空串 / 越界 / 小数 / 非数字）→ null */
export function parseCustomBeatSnap(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return isValidBeatSnap(n) ? n : null;
}
