// issue 184 · BPM 事件「按 beat 稳定排序」口径的公共函数。
// 两条判据（末条 / 起点前驱）必须与 issue 142 的 `indexOfTrailingNegativeBpm` 同口径：
// 同 beat 取数组序最后一条，beat 非有限的条目跳过。
import { describe, expect, it } from 'vitest';
import type { ChartNote } from '@/src/chart/types';
import { indexOfLastBpm, indexOfPrecedingBpm } from '@/src/chart/editing/BpmPredecessor';
import { indexOfTrailingNegativeBpm } from '@/src/chart/editing/BpmTail';

const bpm = (beat: number, value: number): ChartNote => ({ type: 'BPM', beat, bpm: value });
const single = (beat: number): ChartNote => ({ type: 'Single', beat, lane: 1 });

describe('indexOfPrecedingBpm · 起点生效 BPM', () => {
  it('取最后一条 beat ≤ target 的 BPM 值（不是第一条 ≥ target）', () => {
    const notes = [bpm(0, 120), bpm(4, 200), bpm(8, 160)];
    expect(indexOfPrecedingBpm(notes, 5)).toBe(1);
    expect(indexOfPrecedingBpm(notes, 3.9)).toBe(0);
    expect(indexOfPrecedingBpm(notes, 8)).toBe(2);
  });

  it('同 beat 多条：取数组序最后一条（稳定排序口径）', () => {
    const notes = [bpm(4, 200), bpm(4, 210), bpm(4, 220)];
    expect(indexOfPrecedingBpm(notes, 4)).toBe(2);
  });

  it('beat 非有限的条目跳过；非 BPM 音符不参与', () => {
    const notes = [bpm(0, 120), single(2), bpm(Number.NaN, 300), bpm(Number.POSITIVE_INFINITY, 400)];
    expect(indexOfLastBpm(notes)).toBe(0);
    expect(indexOfPrecedingBpm(notes, 99)).toBe(0);
  });

  it('没有前驱（含 target 非有限）→ -1', () => {
    expect(indexOfPrecedingBpm([bpm(4, 200)], 1)).toBe(-1);
    expect(indexOfPrecedingBpm([], 1)).toBe(-1);
    expect(indexOfPrecedingBpm([bpm(0, 120)], Number.NaN)).toBe(-1);
  });
});

describe('indexOfLastBpm · 与 issue 142 末条判据同口径', () => {
  it('末条为负 → 两边指向同一条', () => {
    const notes = [bpm(0, 120), bpm(8, 90), bpm(8, -100)];
    expect(indexOfLastBpm(notes)).toBe(2);
    expect(indexOfTrailingNegativeBpm(notes)).toBe(2);
  });

  it('同 beat 有正有负：数组序最后一条为准（正数 → 不报警）', () => {
    const notes = [bpm(0, 120), bpm(8, -100), bpm(8, 90)];
    expect(indexOfLastBpm(notes)).toBe(2);
    expect(indexOfTrailingNegativeBpm(notes)).toBe(-1);
  });

  it('beat 非有限的负值不算末条（与导入校验跳过脏数据一致）', () => {
    const notes = [bpm(0, 120), bpm(8, -100), bpm(Number.NaN, -5)];
    expect(indexOfLastBpm(notes)).toBe(1);
    expect(indexOfTrailingNegativeBpm(notes)).toBe(1);
  });

  it('没有 BPM → 两边都是 -1', () => {
    expect(indexOfLastBpm([single(1)])).toBe(-1);
    expect(indexOfTrailingNegativeBpm([single(1)])).toBe(-1);
  });
});
