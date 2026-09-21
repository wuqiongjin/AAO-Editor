// 「谱面以负 BPM 收尾」的判定（issue 142）—— 抽成纯函数，让口径能被单测锁住。
//
// ADR-0010 关键事实：谱面**以负 BPM 收尾**会让 Bestdori OUT_OF_MEMORY 崩溃（可连续多条负值，
// 但后面必须出现正值）。导入侧已据此整份拒收（`checkBackflowBoundaries` ②）。
// issue 142 定案：编辑器**不拦**（数据保真，与 ADR-0010 结论 6「不拦」同气质），
// 只做**就地视觉警示** —— 让作者看得见「这份谱导出后 Bestdori 打不开」。
import type { ChartNote } from '../types';

/**
 * 末条 BPM 事件为负时，返回它在 `notes` 里的**下标**；否则 `-1`（含「没有 BPM 事件」）。
 *
 * 「最后一条」的口径与导入校验 / 导出排序一致：**按 beat 稳定排序**后的最后一条
 * （同 beat 取数组序最后一条，与 `convertNotesToChartCode` 的稳定排序同款）。
 * `beat` 非有限的条目跳过（导入侧同样跳过，不在脏数据上做判定）。
 *
 * 与导入侧 `checkBackflowBoundaries` ②的分工：二者判的是**同一条规则**（末条为负 ⇒ Bestdori 打不开），
 * 但落点不同 —— 导入侧据此**整份拒收**，画布侧据此**就地警示**（issue 142 定案：编辑器不拦）。
 * ①（beat 0 为负）在导入侧是另一条规则并被单独报出；本函数不区分①：
 * 全谱只有一条 BPM 且它在 beat 0 为负时它同时也是末条，照报警示（两种情况都会让谱不可用）。
 */
export function indexOfTrailingNegativeBpm(notes: readonly ChartNote[]): number {
  let last = -1;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    if (n.type !== 'BPM') continue;
    if (!Number.isFinite(n.beat)) continue;
    // `>=` 取后者：同 beat 时数组序靠后的那条才是「最后一条」（稳定排序口径）
    if (last < 0 || n.beat >= (notes[last] as { beat: number }).beat) last = i;
  }
  if (last < 0) return -1;
  const bpm = (notes[last] as { bpm: number }).bpm;
  return Number.isFinite(bpm) && bpm < 0 ? last : -1;
}

