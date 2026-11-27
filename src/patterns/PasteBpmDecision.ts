// 「某个拍位处的**生效 BPM**」的唯一实现（ADR-0023 §2）：片段采集（源谱面在片段起点）
// 与片段粘贴判定（目标谱面在落点）都问这一句 —— 两边各写一份的话，"同值不写线"的判据
// 与 `bpmContext.startBpm` 会各漂一次。
//
// 口径 = 稳定排序（同拍取数组序最后一条、非有限 beat 跳过）后最后一条 `beat ≤ 落点` 的 BPM。
// 落点之前一条 BPM 都没有时取**首条 BPM**（issue 62：首条 BPM 即时间原点）；
// 完全没有 BPM 才回 `DEFAULT_BPM`。
import { DEFAULT_BPM } from '../audio/AudioTiming';
import { indexOfFirstBpm, indexOfPrecedingBpm } from '../chart/editing/BpmPredecessor';
import type { BpmNote, ChartNote } from '../chart/types';

/** 目标谱面在 `beat` 处的生效 BPM（片段粘贴判定「同速则不写线」的对照值） */
export function effectiveBpmAt(notes: readonly ChartNote[], beat: number): number {
  const preceding = indexOfPrecedingBpm(notes, beat);
  const index = preceding >= 0 ? preceding : indexOfFirstBpm(notes);
  if (index < 0) return DEFAULT_BPM;
  const value = (notes[index] as BpmNote).bpm;
  return Number.isFinite(value) ? value : DEFAULT_BPM;
}
