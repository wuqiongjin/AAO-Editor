// 通用 BPM 分段换算（纯逻辑，node 环境可单测）。
// 一条"每拍值"的 BPM 段遍历器，同时服务"秒"（每拍 60/bpm 秒）与
// "虚拟像素"（每拍 BEAT_HEIGHT*120/bpm 像素）两种坐标系，消除 FinalCanvas
// 与 AudioTiming 各自实现 BPM 分段累加导致的重复与漂移（ADR-0003 候选 C）。
//
// 构造时预计算每段起点累计值，查询用二分查找：O(log BPM) 且不含浮点累加误差累积。
//
// **issue 104 起本文件同时是"布局坐标 → 拍"反查的唯一所有者**（ADR-0010 结论 3/5）：
// 倒流区（`perBeat < 0` 的段）里同一个布局坐标有**多个解**，故反查不再是无条件单值——
// 一律经 `beatSolutionsOf`（解集 + 所属段序号）显式取解，`positionOfBeat` 仍是唯一的正向映射。

export interface BpmTimelineEvent {
  beat: number;
  bpm: number;
}

/** 一次反查得到的解：拍位 + 所属 BPM 段序号（= ADR-0010 结论 5 的「层」） */
export interface BpmBeatSolution {
  beat: number;
  /** 解落在哪一段（`segments` 下标，按 beatStart 升序；同一拍取**后段**，与 positionOfBeat 同口径） */
  segmentIndex: number;
}

/** 拍区间（半开 `[start, end]` 的闭区间形式；枚举用） */
export interface BpmBeatRange {
  start: number;
  end: number;
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

  constructor(bpmEvents: readonly BpmTimelineEvent[], perBeatValue: (bpm: number) => number) {
    const segments: BpmSegment[] = [];
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
      if (!isLast && next) {
        offset += (next.beat - cur.beat) * seg.perBeat;
      }
    }
    this.segments = segments;
  }

  /** 段（层）数；0 = 无 BPM 事件 */
  get segmentCount(): number {
    return this.segments.length;
  }

  /** beat → 值：定位所在 BPM 段（与 segmentIndexAtBeat 同一份二分）并线性插值 */
  positionOfBeat(beat: number): number {
    const segs = this.segments;
    if (segs.length === 0) return 0;
    const seg = segs[this.segmentIndexAtBeat(beat)];
    return seg.offsetStart + (beat - seg.beatStart) * seg.perBeat;
  }

  // ─────────── 反查（值 → 拍）：显式取解，单一所有者（issue 104 / ADR-0010 结论 5） ───────────

  /**
   * 值（秒 / 虚拟像素，取决于本时间线的 `perBeatValue` 单位）→ **全部解**，按段序（= beat 升序）。
   *
   * 单调谱面（全部 `perBeat > 0`）恒只有一解，与旧 `beatOfPosition` 逐位等价；倒流区内同一坐标
   * 每条经过它的段各出一解。段区间取**半开** `[beatStart, 下一段起点)`：恰落在段界的解归**后段**
   * （与 `positionOfBeat` 的"取最大 beatStart"同口径），故同拍不会重复计入。
   * 低于首段起点的坐标按首段斜率外推（解可为负拍）；高于末段的坐标按末段斜率延续。
   */
  beatSolutionsOf(position: number): BpmBeatSolution[] {
    const segs = this.segments;
    const out: BpmBeatSolution[] = [];
    if (!Number.isFinite(position)) return out;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (!isUsablePerBeat(seg.perBeat)) continue;
      const beat = seg.beatStart + (position - seg.offsetStart) / seg.perBeat;
      if (!Number.isFinite(beat)) continue;
      const lower = i === 0 ? -Infinity : seg.beatStart;
      const upper = i + 1 < segs.length ? segs[i + 1].beatStart : Infinity;
      if (beat < lower || beat >= upper) continue;
      out.push({ beat, segmentIndex: i });
    }
    return out;
  }

  /**
   * 值 → **最大 beat 解**（便捷单值，= `beatSolutionsOf` 末项）。
   * 这是"没有更具体上下文时"的默认取解口径，与制谱器编辑器逐操作等价（点倒流带 → 落到区后的拍）。
   * 解集为空（无段 / 全是退化段）时的兜底与旧实现一致：无段给 0。
   */
  maxBeatSolutionOf(position: number): BpmBeatSolution {
    const sols = this.beatSolutionsOf(position);
    if (sols.length > 0) return sols[sols.length - 1];
    const last = this.segments.length - 1;
    if (last < 0) return { beat: 0, segmentIndex: 0 };
    return { beat: this.beatInSegment(last, position), segmentIndex: last };
  }

  /** 拍位落在哪一段（**层**的标识；越界钳到首/末段） */
  segmentIndexAtBeat(beat: number): number {
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
    return idx;
  }

  /** 该段的每拍值（**拖拽锚定被拖元素所在层**时用它把 Δ 布局坐标换算成 Δ拍） */
  perBeatOfSegment(segmentIndex: number): number {
    const seg = this.segments[clampSegment(segmentIndex, this.segments.length)];
    return seg ? seg.perBeat : 0;
  }

  /**
   * 在**指定层**（BPM 段）内把值映回拍（ADR-0010 结论 5「拖拽的 Δy→Δ拍 锚定被拖元素自己所在的层」）：
   * 段内唯一解；超出该段的范围按**该段斜率外推**——拖拽时光标拖出段外仍按本层换算，不会跳层。
   */
  beatInSegment(segmentIndex: number, position: number): number {
    const segs = this.segments;
    const seg = segs[clampSegment(segmentIndex, segs.length)];
    if (!seg) return 0;
    if (!isUsablePerBeat(seg.perBeat) || !Number.isFinite(position)) return seg.beatStart;
    return seg.beatStart + (position - seg.offsetStart) / seg.perBeat;
  }

  // ─────────── 布局坐标 ↔ 拍区间（正向逐点求极值，issue 104 修法 4） ───────────

  /**
   * 拍区间 `[minBeat, maxBeat]` 在布局坐标上的**精确**范围（min/max）。
   * `positionOfBeat` 对本区间是分段线性的（折点 = 段起点），故极值只可能出现在两端或段界上。
   * 单调谱面下 = 两端取值；倒流区下会把折返的峰值一并纳入（保守但精确）。
   */
  positionRangeOfBeats(minBeat: number, maxBeat: number): { min: number; max: number } {
    const lo = Math.min(minBeat, maxBeat);
    const hi = Math.max(minBeat, maxBeat);
    const segs = this.segments;
    if (segs.length === 0) return { min: 0, max: 0 };
    let min = Infinity;
    let max = -Infinity;
    const sample = (b: number) => {
      if (!Number.isFinite(b) || b < lo || b > hi) return;
      const p = this.positionOfBeat(b);
      if (p < min) min = p;
      if (p > max) max = p;
    };
    sample(lo);
    sample(hi);
    for (const seg of segs) sample(seg.beatStart);
    if (min > max) {
      const p = this.positionOfBeat(lo);
      return { min: p, max: p };
    }
    return { min, max };
  }

  /**
   * 布局坐标区间 `[posMin, posMax]` 覆盖的**拍区间集合**（每段各一段，按段序；段内单调 → 区间内连续）。
   * 用于"网格只迭代可见拍"：单调谱面 = 单个区间；倒流区 = 多个区间（折返处同一 y 会被走过多次）。
   * 区间为**半开** `[start, end)`（末段以 +Infinity 收尾）——恰在段界的整拍只归后一段，避免重复画线。
   */
  beatRangesForPositionRange(posMin: number, posMax: number): BpmBeatRange[] {
    const lo = Math.min(posMin, posMax);
    const hi = Math.max(posMin, posMax);
    const segs = this.segments;
    const out: BpmBeatRange[] = [];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (!isUsablePerBeat(seg.perBeat)) continue;
      const a = seg.beatStart + (lo - seg.offsetStart) / seg.perBeat;
      const b = seg.beatStart + (hi - seg.offsetStart) / seg.perBeat;
      const lower = i === 0 ? -Infinity : seg.beatStart;
      const upper = i + 1 < segs.length ? segs[i + 1].beatStart : Infinity;
      const start = Math.max(Math.min(a, b), lower);
      // 半开：减去一个 ε 把"恰在段界的整拍"让给后一段（否则该处会画两道线）
      const end = Math.min(Math.max(a, b), upper) - (i + 1 < segs.length ? 1e-9 : 0);
      if (end >= start) out.push({ start, end });
    }
    return out;
  }
}

/** 段退化（perBeat 为 0 / 非有限）→ 该段无解，反查跳过它而不是除零 */
function isUsablePerBeat(perBeat: number): boolean {
  return Number.isFinite(perBeat) && perBeat !== 0;
}

function clampSegment(index: number, length: number): number {
  if (length <= 0) return -1;
  return Math.min(Math.max(Math.floor(index), 0), length - 1);
}