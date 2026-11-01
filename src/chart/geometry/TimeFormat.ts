// 播放时间码格式化（issue 22 画布左下角高精度时间 + 播放条）。
// 分离纯函数以便单测。

export type TimePrecision = 'standard' | 'centisecond' | 'millisecond';

/** 精确到 0.1 秒（standard，如 01:23.4）、0.01 秒（centisecond，如 01:23.45）或毫秒（millisecond，如 01:23.456） */
export function formatTimePrecise(
  seconds: number,
  precision: TimePrecision = 'standard',
): string {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const decimals = precision === 'millisecond' ? 3 : precision === 'centisecond' ? 2 : 1;
  const factor = precision === 'millisecond' ? 1000 : precision === 'centisecond' ? 100 : 10;
  const totalUnits = Math.floor(s * factor + 1e-4);
  const mm = Math.floor(totalUnits / (60 * factor)).toString().padStart(2, '0');
  const ss = Math.floor((totalUnits % (60 * factor)) / factor).toString().padStart(2, '0');
  const frac = (totalUnits % factor).toString().padStart(decimals, '0');
  return `${mm}:${ss}.${frac}`;
}

/** 整秒：mm:ss（如 01:23），用于播放条右侧总时长 */
export function formatTimeWhole(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * 分内时间（issue 54 实时显示线左沟槽）：`SS.s`（0.1s 标准 1 位小数）、`SS.ss`（0.01s 2 位小数）或 `SS.sss`（0.001s 毫秒 3 位小数），
 * 00.0–59.9 循环（mod 60），不含分钟位。负值/非有限值按 00.0 / 00.00 / 00.000 处理。
 */
export function formatInMinuteTime(
  seconds: number,
  precision: TimePrecision = 'standard',
): string {
  const decimals = precision === 'millisecond' ? 3 : precision === 'centisecond' ? 2 : 1;
  const factor = precision === 'millisecond' ? 1000 : precision === 'centisecond' ? 100 : 10;
  if (!Number.isFinite(seconds)) {
    return '00.'.padEnd(decimals + 3, '0');
  }
  let v = Math.round((Math.max(0, seconds) % 60) * factor) / factor;
  if (v >= 60) v = 0; // 四舍五入到 60 → 回绕
  return v.toFixed(decimals).padStart(decimals + 3, '0');
}

/**
 * 紧凑时间码（chart-preview 08「Time 标记」的沟槽刻度）：**分钟不补零** —— `0:25` / `1:05` / `12:30`。
 * 与 `formatTimeWhole`（`00:25`）只差一位，但沟槽只有 ~30px 宽，少一位就多一分放得下的机会。
 */
export function formatTimeCompact(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

/**
 * 解析时间输入（播放条时间码双击编辑，issue 22）：接受 mm:ss / mm:ss.s（也容忍秒带小数）。
 * 返回秒数；无法解析返回 null。
 */
export function parseTimeInput(value: string): number | null {
  const s = value.trim();
  const m = s.match(/^(\d{1,3})(?::(\d{1,2}))?(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const mm = Number(m[1] ?? 0);
  const ss = Number(m[2] ?? 0);
  const frac = m[3] ? Number(`0.${m[3]}`) : 0;
  if (ss > 59) return null;
  const sec = mm * 60 + ss + frac;
  return Number.isFinite(sec) ? sec : null;
}
