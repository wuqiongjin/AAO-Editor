// 「某个拍位处的**生效 BPM**」的唯一实现（ADR-0023 §2）：片段采集（源谱面在片段起点）
// 与片段粘贴判定（目标谱面在落点）都问这一句 —— 两边各写一份的话，"同值不写线"的判据
// 与 `bpmContext.startBpm` 会各漂一次。
//
// 口径 = 稳定排序（同拍取数组序最后一条、非有限 beat 跳过）后最后一条 `beat ≤ 落点` 的 BPM。
// 落点之前一条 BPM 都没有时按 `DEFAULT_BPM`：这是谱面域对"首条 BPM 之前"的既有假定
// （`AudioTiming.getBpmEvents` 会在首条 BPM 之前补一条 120、`ChartGeometry` 同口径）。
import { DEFAULT_BPM } from '../../audio/AudioTiming';
import { indexOfPrecedingBpm } from '../editing/BpmPredecessor';
import type { BpmNote, ChartNote } from '../types';

/** 目标谱面在 `beat` 处的生效 BPM（片段粘贴判定「同速则不写线」的对照值） */
export function effectiveBpmAt(notes: readonly ChartNote[], beat: number): number {
  const index = indexOfPrecedingBpm(notes, beat);
  if (index < 0) return DEFAULT_BPM;
  const value = (notes[index] as BpmNote).bpm;
  return Number.isFinite(value) ? value : DEFAULT_BPM;
}
