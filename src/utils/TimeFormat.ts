// 播放时间码格式化（issue 22 画布左下角高精度时间 + 播放条）。
// 分离纯函数以便单测。

/** 精确到 0.1 秒：mm:ss.s（如 01:23.4） */
export function formatTimePrecise(seconds: number): string {
  const s = Math.max(0, seconds);
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = Math.floor(s % 60).toString().padStart(2, '0');
  const ds = Math.floor((s % 1) * 10);
  return `${mm}:${ss}.${ds}`;
}

/** 整秒：mm:ss（如 01:23），用于播放条右侧总时长 */
export function formatTimeWhole(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
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
