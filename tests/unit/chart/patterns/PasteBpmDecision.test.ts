// issue 186 锁测：片段粘贴的「目标落点生效 BPM」取值（ADR-0023 §2 的判定输入端）。
// 口径 = 稳定排序后最后一条 `beat ≤ 落点` 的 BPM（与采集侧 startBpm 同一份前驱函数）；
// 落点之前没有 BPM 时按 DEFAULT_BPM —— 与播放/几何侧对"首条 BPM 之前"的假定一致。
import { describe, expect, it } from 'vitest';
import { DEFAULT_BPM } from '@/src/audio/AudioTiming';
import { effectiveBpmAt } from '@/src/chart/patterns/PasteBpmDecision';
import type { ChartNote } from '@/src/chart/types';

const bpm = (beat: number, value: number): ChartNote => ({ type: 'BPM', beat, bpm: value });
const single = (beat: number, lane: number): ChartNote => ({ type: 'Single', beat, lane });

describe('issue 186 · 目标落点生效 BPM', () => {
  it('取落点前（含同拍）最后一条 BPM', () => {
    const notes = [bpm(0, 120), bpm(4, 180), bpm(8, 90)];
    expect(effectiveBpmAt(notes, 0)).toBe(120);
    expect(effectiveBpmAt(notes, 3.9)).toBe(120);
    expect(effectiveBpmAt(notes, 4)).toBe(180); // 同拍算已生效
    expect(effectiveBpmAt(notes, 7.5)).toBe(180);
    expect(effectiveBpmAt(notes, 20)).toBe(90);
  });

  it('同拍多条：取数组序最后一条（稳定排序口径）', () => {
    const notes = [bpm(0, 120), bpm(4, 180), bpm(4, 200), bpm(4, 160)];
    expect(effectiveBpmAt(notes, 4)).toBe(160);
    expect(effectiveBpmAt(notes, 5)).toBe(160);
  });

  it('落点在首条 BPM 之前 → DEFAULT_BPM（谱面域对"还没定速"的假定）', () => {
    const notes = [bpm(4, 180), single(5, 1)];
    expect(effectiveBpmAt(notes, 1)).toBe(DEFAULT_BPM);
    expect(effectiveBpmAt(notes, 0)).toBe(DEFAULT_BPM);
  });

  it('beat 非有限 / bpm 非有限的条目跳过，不污染取值', () => {
    const notes = [bpm(0, 120), bpm(Number.NaN, 999), bpm(4, Number.POSITIVE_INFINITY)];
    expect(effectiveBpmAt(notes, 6)).toBe(120);
  });

  it('负 BPM 照常作为生效值（倒流区不特殊对待，ADR-0010）', () => {
    const notes = [bpm(0, 120), bpm(4, -120)];
    expect(effectiveBpmAt(notes, 5)).toBe(-120);
  });
});
