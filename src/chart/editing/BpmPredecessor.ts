// BPM 事件的「按 beat 稳定排序」口径（issue 184 / ADR-0023 Consequences）。
//
// 导入校验、导出排序、画布末条警示（issue 142）、片段速度语境取「起点前驱」都判同一件事：
// **同 beat 取数组序最后一条，beat 非有限的跳过**。抽在这里，避免出现第二套口径。
import type { ChartNote } from '../types';

/** 按稳定排序口径找最后一条满足 `accept(beat)` 的 BPM 事件；没有 → -1。 */
function lastBpmIndex(notes: readonly ChartNote[], accept: (beat: number) => boolean): number {
  let last = -1;
  let lastBeat = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]!;
    if (note.type !== 'BPM') continue;
    const beat = note.beat;
    if (!Number.isFinite(beat)) continue;
    if (!accept(beat)) continue;
    // `>=` 取后者：同 beat 时数组序靠后的那条才是「最后一条」（稳定排序口径）
    if (last < 0 || beat >= lastBeat) {
      last = i;
      lastBeat = beat;
    }
  }
  return last;
}

/** 稳定排序后的**末条** BPM 事件下标；没有 BPM 事件 → -1。 */
export function indexOfLastBpm(notes: readonly ChartNote[]): number {
  return lastBpmIndex(notes, () => true);
}

/**
 * 稳定排序后最后一条 `beat ≤ target` 的 BPM 事件下标 —— 即 `target` 处的**生效 BPM**来源。
 * 没有（含 target 非有限）→ -1。
 */
export function indexOfPrecedingBpm(notes: readonly ChartNote[], target: number): number {
  if (!Number.isFinite(target)) return -1;
  return lastBpmIndex(notes, (beat) => beat <= target);
}
