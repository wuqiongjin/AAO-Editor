// 谱面末端判据（ADR-0005 §5）：**放置 / 执行键 / 粘贴 / 拖拽四条入口共用同一份**，
// 不得各写一份 epsilon 或各写一份"组的最大拍位"（issue 73：此前粘贴漏了末端校验，
// 只有锚点被 `snapChartPos` 校验过，组尾可以越出 END）。
import type { ChartNote, SlideNote } from '../types';

/** 越过谱面末端的容差（唯一实现） */
export const CHART_END_EPS = 1e-6;

export function isPastChartEnd(beat: number, chartEndBeat: number): boolean {
  return beat > chartEndBeat + CHART_END_EPS;
}

/** 子拍的真实拍位（**唯一实现**）：subBeat 的单位是 1/beatDisplay（与 ChartGeometry 同口径）。 */
export const trueBeat = (beat: number, subBeat: number | undefined, beatDisplay: number) =>
  beat + (subBeat && subBeat > 0 ? subBeat / beatDisplay : 0);

/**
 * 一组音符（含滑条/长条的**全部结点**）的**最大真实拍位**。
 * 用于粘贴等"整组落子"的入口：只要组里任一成员越出谱面末端，就整组拒绝。
 */
export function groupMaxBeat(notes: readonly ChartNote[], beatDisplay = 1): number {
  const bd = beatDisplay > 0 ? beatDisplay : 1;
  let max = -Infinity;
  for (const n of notes) {
    if (n.type === 'Slide' || n.type === 'Long') {
      for (const c of (n as SlideNote).connections) max = Math.max(max, trueBeat(c.beat, c.subBeat, bd));
    } else {
      // BPM / System 无 subBeat 字段：只按整数拍计
      const sub = 'subBeat' in n ? (n.subBeat as number | undefined) : undefined;
      max = Math.max(max, trueBeat(n.beat, sub, bd));
    }
  }
  return max;
}
