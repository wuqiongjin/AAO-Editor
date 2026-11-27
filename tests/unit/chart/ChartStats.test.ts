// 票 61：发布弹窗「谱面概览」的时长 / BPM 统计。
import { describe, expect, it } from 'vitest';
import { computeChartCodeStats } from '@/src/chart/analysis/ChartStats';
import type { ChartCodeNote } from '@/src/chart/editing/ChartConverter';

const bpm = (beat: number, value: number): ChartCodeNote => ({ type: 'BPM', beat, bpm: value });

describe('computeChartCodeStats', () => {
  it('首击到末击的秒数 + BPM 区间', () => {
    const stats = computeChartCodeStats([
      bpm(0, 120),
      { type: 'Single', beat: 0, lane: 0 },
      { type: 'Single', beat: 4, lane: 1 },
    ]);
    expect(stats.playableSeconds).toBeCloseTo(2);
    expect(stats.bpmRange).toBe('120');
  });

  it('BPM 变化按分段累加；区间给绝对值 min–max', () => {
    const stats = computeChartCodeStats([
      bpm(0, 120),
      bpm(4, 240),
      { type: 'Single', beat: 0, lane: 0 },
      { type: 'Directional', beat: 8, lane: 1, direction: 'Left', width: 1 },
    ]);
    expect(stats.playableSeconds).toBeCloseTo(3);
    expect(stats.bpmRange).toBe('120–240');
  });

  it('滑条只算非 hidden 结点；hidden 结点不会把末击推后', () => {
    const stats = computeChartCodeStats([
      bpm(0, 120),
      {
        type: 'Slide',
        connections: [
          { beat: 0, lane: 0 },
          { beat: 4, lane: 1, hidden: true },
          { beat: 8, lane: 2 },
          { beat: 12, lane: 3, hidden: true },
        ],
      },
    ]);
    expect(stats.playableSeconds).toBeCloseTo(4);
  });

  it('不足两个可击打点 = 0 秒；没有 BPM 事件回落默认 120', () => {
    expect(computeChartCodeStats([{ type: 'Single', beat: 0, lane: 0 }])).toEqual({
      playableSeconds: 0,
      bpmRange: '120',
    });
  });

  it('System / 未知 type 不计入；空谱面也没有时长', () => {
    expect(computeChartCodeStats([
      { type: 'System', beat: 0, data: 'bgm001.wav' },
      { type: 'Whatever', beat: 8 },
    ])).toEqual({ playableSeconds: 0, bpmRange: '120' });
  });
});
