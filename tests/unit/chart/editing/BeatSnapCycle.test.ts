import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BEAT_SNAP_CYCLE_LIST,
  cycleBeatSnap,
  normalizeBeatSnapCycleList,
} from '@/src/chart/editing/BeatSnap';

describe('issue 216 · BeatSnapCycle 纯算法逻辑锁测', () => {
  it('DEFAULT_BEAT_SNAP_CYCLE_LIST 出厂默认为 [4, 8, 12, 16]', () => {
    expect(DEFAULT_BEAT_SNAP_CYCLE_LIST).toEqual([4, 8, 12, 16]);
  });

  describe('cycleBeatSnap 循环寻址与回卷', () => {
    const list = [4, 8, 12, 16];

    it('在标准列表 [4, 8, 12, 16] 内正常顺时针步进', () => {
      expect(cycleBeatSnap(4, list)).toBe(8);
      expect(cycleBeatSnap(8, list)).toBe(12);
      expect(cycleBeatSnap(12, list)).toBe(16);
    });

    it('到达末尾项时回卷至首项', () => {
      expect(cycleBeatSnap(16, list)).toBe(4);
    });

    it('当前细分不在列表中（如 6、7）时，切入第一个严格大于当前值的项（8）', () => {
      expect(cycleBeatSnap(1, list)).toBe(4);
      expect(cycleBeatSnap(6, list)).toBe(8);
      expect(cycleBeatSnap(7, list)).toBe(8);
      expect(cycleBeatSnap(9, list)).toBe(12);
      expect(cycleBeatSnap(15, list)).toBe(16);
    });

    it('当前细分大于等于列表中所有项（如 24、32）时，回卷至首项（4）', () => {
      expect(cycleBeatSnap(24, list)).toBe(4);
      expect(cycleBeatSnap(32, list)).toBe(4);
      expect(cycleBeatSnap(192, list)).toBe(4);
    });

    it('空列表输入时自动回退默认 [4, 8, 12, 16]', () => {
      expect(cycleBeatSnap(4, [])).toBe(8);
      expect(cycleBeatSnap(16, [])).toBe(4);
      expect(cycleBeatSnap(6, [])).toBe(8);
    });
  });

  describe('normalizeBeatSnapCycleList 归一化与清洗保证', () => {
    it('非数组输入时回落默认 [4, 8, 12, 16]', () => {
      expect(normalizeBeatSnapCycleList(null)).toEqual([4, 8, 12, 16]);
      expect(normalizeBeatSnapCycleList(undefined)).toEqual([4, 8, 12, 16]);
      expect(normalizeBeatSnapCycleList('not an array')).toEqual([4, 8, 12, 16]);
      expect(normalizeBeatSnapCycleList({})).toEqual([4, 8, 12, 16]);
    });

    it('去重、剔除非整数、负数、越界数字并强制升序排列', () => {
      const raw = [16, 4, 8, 8, 12, -2, 0, 3.14, 'bad', 200, 193, 1];
      // 满足 1 <= v <= 192 且为整数的有: 16, 4, 8, 12, 1 -> 升序去重后: [1, 4, 8, 12, 16]
      expect(normalizeBeatSnapCycleList(raw)).toEqual([1, 4, 8, 12, 16]);
    });

    it('空数组或无有效元素时保持空数组（运行时 cycleBeatSnap 负责兜底默认档）', () => {
      expect(normalizeBeatSnapCycleList([])).toEqual([]);
      expect(normalizeBeatSnapCycleList([-1, 0, 500, 'x'])).toEqual([]);
    });
  });
});
