import { describe, it, expect } from 'vitest';
import { BpmTimeline } from '@/src/chart/geometry/BpmTimeline';
import { DEFAULT_BPM, getBpmEvents, beatToSeconds, secondsToBeat } from '@/src/audio/AudioTiming';
import type { ChartNote } from '@/src/chart/types';

describe('BpmTimeline（秒坐标系）', () => {
  const sec = (events: { beat: number; bpm: number }[]) => new BpmTimeline(events, (bpm) => 60 / bpm);

  it('单段：位置随拍线性（120bpm 每拍 0.5s）', () => {
    const tl = sec([{ beat: 0, bpm: 120 }]);
    expect(tl.positionOfBeat(0)).toBe(0);
    expect(tl.positionOfBeat(1)).toBeCloseTo(0.5);
    expect(tl.positionOfBeat(120)).toBeCloseTo(60);
  });

  it('分段：BPM 交界处累计正确', () => {
    const tl = sec([
      { beat: 0, bpm: 120 },
      { beat: 60, bpm: 240 },
    ]);
    expect(tl.positionOfBeat(60)).toBeCloseTo(30); // 60拍*0.5s
    expect(tl.positionOfBeat(90)).toBeCloseTo(30 + 30 * 0.25);
  });

  it('单调谱面：maxBeatSolutionOf 与 positionOfBeat 互逆，解集恒一元', () => {
    const tl = sec([
      { beat: 0, bpm: 120 },
      { beat: 30, bpm: 240 },
    ]);
    for (const beat of [0, 5, 30, 42, 100]) {
      const sols = tl.beatSolutionsOf(tl.positionOfBeat(beat));
      expect(sols).toHaveLength(1);
      expect(sols[0].beat).toBeCloseTo(beat, 6);
      expect(tl.maxBeatSolutionOf(tl.positionOfBeat(beat)).beat).toBeCloseTo(beat, 6);
    }
  });

  it('末段无限延伸，按末段速率延续', () => {
    const tl = sec([{ beat: 0, bpm: 240 }]);
    expect(tl.maxBeatSolutionOf(0.5).beat).toBeCloseTo(2);
    expect(tl.maxBeatSolutionOf(1).beat).toBeCloseTo(4);
  });

  it('空段返回 0', () => {
    const tl = sec([]);
    expect(tl.positionOfBeat(5)).toBe(0);
    expect(tl.beatSolutionsOf(5)).toEqual([]);
    expect(tl.maxBeatSolutionOf(5)).toEqual({ beat: 0, segmentIndex: 0 });
  });
});

describe('AudioTiming 复用 BpmTimeline 后行为不变', () => {
  it('beatToSeconds / secondsToBeat 与 getBpmEvents 协作', () => {
    const notes: ChartNote[] = [
      { type: 'BPM', beat: 60, bpm: 240 },
      { type: 'BPM', beat: 30, bpm: 180 },
    ];
    const events = getBpmEvents(notes);
    expect(events[0]).toEqual({ beat: 0, bpm: DEFAULT_BPM });
    expect(beatToSeconds(events, 0)).toBe(0);
    expect(secondsToBeat(events, beatToSeconds(events, 30))).toBeCloseTo(30, 6);
  });
});

/**
 * issue 104 修法 2/8（ADR-0010 结论 5）：反查的**显式取解**。
 * 附录 B 变体谱（120 → -240 beat 5 → 120 beat 6.5），秒域坐标：
 *   t(0)=0 → t(5)=2.5 → t(6.5)=2.125；折返带 t ∈ [2.125, 2.5] 内同一秒有三层。
 */
describe('BpmTimeline · 倒流区反查与层（issue 104）', () => {
  const sec = (events: { beat: number; bpm: number }[]) => new BpmTimeline(events, (bpm) => 60 / bpm);
  const FOLD = [{ beat: 0, bpm: 120 }, { beat: 5, bpm: -240 }, { beat: 6.5, bpm: 120 }];

  it('折返带内同一秒给三个解（各层一个），按段序 = 拍升序', () => {
    const sols = sec(FOLD).beatSolutionsOf(2.3);
    expect(sols.map(s => s.segmentIndex)).toEqual([0, 1, 2]);
    expect(sols.map(s => s.beat)).toEqual([
      expect.closeTo(4.6, 6),   // L1：0.5 s/拍上坡
      expect.closeTo(5.8, 6),   // L2：-0.25 s/拍回程
      expect.closeTo(6.85, 6),  // L3：0.5 s/拍上坡
    ]);
  });

  it('maxBeatSolutionOf = 解集末项；单调谱面下与解集唯一项一致', () => {
    expect(sec(FOLD).maxBeatSolutionOf(2.3).beat).toBeCloseTo(6.85, 6);
    const mono = sec([{ beat: 0, bpm: 120 }, { beat: 10, bpm: 240 }]);
    expect(mono.maxBeatSolutionOf(3).beat).toBeCloseTo(mono.beatSolutionsOf(3)[0].beat, 9);
  });

  it('段区间半开：恰在段界的解归后段，不重复计入', () => {
    // t=2.5 由 beat 5（L1 末 / L2 首）与 beat 7.25（L3）共同达到 → beat 5 只归 L2 一次，不重复
    const sols = sec(FOLD).beatSolutionsOf(2.5);
    expect(sols).toEqual([{ beat: 5, segmentIndex: 1 }, expect.objectContaining({ beat: 7.25, segmentIndex: 2 })]);
  });

  it('segmentIndexAtBeat / perBeatOfSegment / beatInSegment：层内换算与段外外推', () => {
    const tl = sec(FOLD);
    expect(tl.segmentIndexAtBeat(4)).toBe(0);
    expect(tl.segmentIndexAtBeat(6)).toBe(1);
    expect(tl.segmentIndexAtBeat(99)).toBe(2);   // 越界钳到末段
    expect(tl.perBeatOfSegment(1)).toBeCloseTo(-0.25);
    // 层内映射：L2 内 t=2.3 → beat 5.8；同值在 L3 内 → 6.85（拖拽必须按被拖元素的层算）
    expect(tl.beatInSegment(1, 2.3)).toBeCloseTo(5.8, 6);
    expect(tl.beatInSegment(2, 2.3)).toBeCloseTo(6.85, 6);
    // 段外外推：L2 的 t=3（超出段范围）仍按本层斜率延续
    expect(tl.beatInSegment(1, 3)).toBeCloseTo(5 + (3 - 2.5) / -0.25, 6);
  });

  it('positionRangeOfBeats：折返的极值也在区间内（不是两端相减）', () => {
    const tl = sec(FOLD);
    // beat [5,7] 两端 = 2.5 / 2.375，但区间内 beat 6.5 处回落到 2.125 → 真范围是 [2.125, 2.5]
    const r = tl.positionRangeOfBeats(5, 7);
    expect(r.min).toBeCloseTo(2.125, 6);
    expect(r.max).toBeCloseTo(2.5, 6);
    // 单调谱面下 = 两端取值
    const mono = sec([{ beat: 0, bpm: 120 }]);
    expect(mono.positionRangeOfBeats(2, 6)).toEqual({ min: 1, max: 3 });
  });

  it('beatRangesForPositionRange：折返带 → 多段区间，并集覆盖各层', () => {
    const rs = sec(FOLD).beatRangesForPositionRange(2.125, 2.5);
    expect(rs).toHaveLength(3);
    expect(rs[0].start).toBeCloseTo(4.25, 6); // L1
    expect(rs[0].end).toBeCloseTo(5, 6);
    expect(rs[1].start).toBeCloseTo(5, 6);    // L2（半开：[5, 6.5)）
    expect(rs[1].end).toBeCloseTo(6.5, 6);
    expect(rs[2].start).toBeCloseTo(6.5, 6);  // L3
    expect(rs[2].end).toBeCloseTo(7.25, 6);
    // 单调谱面 → 单区间
    expect(sec([{ beat: 0, bpm: 120 }]).beatRangesForPositionRange(1, 2)).toEqual([
      { start: 2, end: 4 },
    ]);
  });

  it('退化段（perBeat 0 / 非有限）跳过而不是除零', () => {
    // perBeatValue = bpm 本体：首段 bpm 0 → perBeat 0（无解）且不给后续段贡献累计值
    const tl = new BpmTimeline([{ beat: 0, bpm: 0 }, { beat: 4, bpm: 120 }], (bpm) => bpm);
    const sols = tl.beatSolutionsOf(4);
    expect(sols).toHaveLength(1);
    expect(sols[0].segmentIndex).toBe(1);
    expect(Number.isFinite(sols[0].beat)).toBe(true);
    expect(tl.beatRangesForPositionRange(0, 8).every(r => Number.isFinite(r.start) && Number.isFinite(r.end))).toBe(true);
  });
});