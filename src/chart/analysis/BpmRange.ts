/**
 * BPM 摘要（用户 2026-10-06 定案口径）：多条取**绝对值**的 min–max（倒流区的负 BPM 按速度读，
 * 如 "120–240"），单条只写一个值；没有有效值（空 / 全 0 / 非有限）→ null。
 *
 * 消费方：导出头带的 BPM chip（`preview/static/sheetHeader`）与发布弹窗的谱面概览。
 * 只出**区间文本**，套 i18n 外壳在调用方完成。
 */

/** BPM 读数：整数原样、小数最多两位（谱面 BPM 可以是小数） */
export function formatBpm(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

export function bpmRangeText(bpms: readonly number[]): string | null {
  const values = bpms.filter((v) => Number.isFinite(v) && v !== 0).map((v) => Math.abs(v));
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? formatBpm(min) : `${formatBpm(min)}–${formatBpm(max)}`;
}
