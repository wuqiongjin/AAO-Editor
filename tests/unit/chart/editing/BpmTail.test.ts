// issue 142：末条 BPM 为负（= 导出后 Bestdori 打不开）的判定口径。
// 判据必须与导入校验 `checkBackflowBoundaries` ② 同口径（按 beat 稳定排序的最后一条），
// 否则会出现「画布上没警示、导入却被拒」的分歧。
import { describe, it, expect } from 'vitest';
import { indexOfTrailingNegativeBpm } from '@/src/chart/editing/BpmTail';
import { bpmLabelText, BPM_TAIL_WARNING_MARK } from '@/src/visual/gutterLabels';
import type { ChartNote } from '@/src/chart/types';

const bpm = (beat: number, v: number): ChartNote => ({ type: 'BPM', beat, bpm: v });

describe('indexOfTrailingNegativeBpm', () => {
  it('末条为负 → 返回它的下标', () => {
    const notes = [bpm(0, 120), bpm(8, -120)];
    expect(indexOfTrailingNegativeBpm(notes)).toBe(1);
  });

  it('连续多条负值收尾 → 取最后一条（下标）', () => {
    const notes = [bpm(0, 120), bpm(8, -120), bpm(9, -240)];
    expect(indexOfTrailingNegativeBpm(notes)).toBe(2);
  });

  it('中间有负值、末条为正 → -1（倒流区本体是合法写法，不警示）', () => {
    const notes = [bpm(0, 120), bpm(8, -120), bpm(12, 120)];
    expect(indexOfTrailingNegativeBpm(notes)).toBe(-1);
  });

  it('没有 BPM 事件 / 末条为 0 → -1', () => {
    expect(indexOfTrailingNegativeBpm([])).toBe(-1);
    expect(indexOfTrailingNegativeBpm([bpm(0, 120)])).toBe(-1);
  });

  it('同 beat 多条：取数组序最后一条（与导出稳定排序同口径）', () => {
    expect(indexOfTrailingNegativeBpm([bpm(4, -120), bpm(4, 120)])).toBe(-1);
    expect(indexOfTrailingNegativeBpm([bpm(4, 120), bpm(4, -120)])).toBe(1);
  });

  it('beat 非有限的条目跳过（与导入侧同款，不在脏数据上判定）', () => {
    const dirty = [{ type: 'BPM', beat: Number.NaN, bpm: -120 } as ChartNote, bpm(0, 120)];
    expect(indexOfTrailingNegativeBpm(dirty)).toBe(-1);
  });

  // ADR-0010 结论 7 有两条：① beat 0 为负 ② 末条为负。导入侧把①单独报出并跳过②；
  // 画布警示不区分 —— 全谱只有一条 BPM 且它在 beat 0 为负时，它同时也是末条，照报警示
  // （两种写法导出后都不可用）。
  it('全谱只有一条 BPM 且它在 beat 0 为负 → 也算末条为负（①/② 同为「不可用」）', () => {
    expect(indexOfTrailingNegativeBpm([bpm(0, -120)])).toBe(0);
  });
});

describe('bpmLabelText', () => {
  it('末条负 BPM 附警示后缀；其余原样（含小数，issue 143）', () => {
    expect(bpmLabelText(-120, true)).toBe(`-120${BPM_TAIL_WARNING_MARK}`);
    expect(bpmLabelText(-120, false)).toBe('-120');
    expect(bpmLabelText(128.5, false)).toBe('128.5');
  });

  it('后缀是 ASCII（等宽字体栈不依赖 emoji/符号字形）', () => {
    expect(/^[\x20-\x7E]+$/.test(BPM_TAIL_WARNING_MARK)).toBe(true);
  });
});
