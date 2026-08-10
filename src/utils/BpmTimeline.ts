// 通用 BPM 分段换算（纯逻辑，node 环境可单测）。
// 一条"每拍值"的 BPM 段遍历器，同时服务"秒"（每拍 60/bpm 秒）与
// "虚拟像素"（每拍 BEAT_HEIGHT*120/bpm 像素）两种坐标系，消除 FinalCanvas
// 与 AudioTiming 各自实现 BPM 分段累加导致的重复与漂移（ADR-0003 候选 C）。
//
// 构造时预计算每段起点累计值，查询用二分查找：O(log BPM) 且不含浮点累加误差累积。

export interface BpmTimelineEvent {
  beat: number;
  bpm: number;
}

interface BpmSegment {
  /** 本段起始拍 */
  beatStart: number;
  /** 每拍对应的值（如秒或虚拟像素） */
  perBeat: number;
  /** beatStart 处的累计值 */
  offsetStart: number;
  /** 末段是否延伸到 +Infinity */
  isLast: boolean;
}

/**
 * 描述"值（秒/虚拟像素）随拍号变化"的时间线。
 * 按 beat 升序的 BPM 事件构造；`perBeatValue(bpm)` 决定每拍的值单位。
 */
export class BpmTimeline {
  readonly segments: readonly BpmSegment[] = [];
  private readonly offsets: number[];

  constructor(bpmEvents: readonly BpmTimelineEvent[], perBeatValue: (bpm: number) => number) {
    const segments: BpmSegment[] = [];
    const offsets: number[] = [];
    let offset = 0;
    for (let i = 0; i < bpmEvents.length; i++) {
      const cur = bpmEvents[i];
      const next = bpmEvents[i + 1];
      const isLast = !next;
      const seg: BpmSegment = {
        beatStart: cur.beat,
        perBeat: perBeatValue(cur.bpm),
        offsetStart: offset,
        isLast,
      };
      segments.push(seg);
      offsets.push(offset);
      if (!isLast && next) {
        offset += (next.beat - cur.beat) * seg.perBeat;
      }
    }
    this.segments = segments;
    this.offsets = offsets;
  }

  /** beat → 值：二分定位所在 BPM 段并线性插值 */
  positionOfBeat(beat: number): number {
    const segs = this.segments;
    if (segs.length === 0) return 0;
    let lo = 0;
    let hi = segs.length - 1;
    let idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (beat < segs[mid].beatStart) {
        hi = mid - 1;
      } else {
        idx = mid;
        lo = mid + 1;
      }
    }
    const seg = segs[idx];
    return seg.offsetStart + (beat - seg.beatStart) * seg.perBeat;
  }

  /** 值 → beat：与 positionOfBeat 互逆；超出末段按末段速率延续 */
  beatOfPosition(position: number): number {
    const segs = this.segments;
    if (segs.length === 0) return 0;
    const offsets = this.offsets;
    let lo = 0;
    let hi = segs.length - 1;
    let idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (position < offsets[mid]) {
        hi = mid - 1;
      } else {
        idx = mid;
        lo = mid + 1;
      }
    }
    const seg = segs[idx];
    return seg.beatStart + (position - seg.offsetStart) / seg.perBeat;
  }
}