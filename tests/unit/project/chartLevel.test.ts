import { describe, expect, it } from 'vitest';
import { POST_LEVEL_MAX, POST_LEVEL_MIN } from '@/src/community/bestdori/endpoints';
import {
  parseLevel,
  readChartLevelInput,
} from '@/src/project/ui/ChartInfoDialog';

describe('票 43 · 等级输入口径', () => {
  it('可落盘区间就是平台发帖区间（区间常量单一真相源，不复制）', () => {
    expect(readChartLevelInput(String(POST_LEVEL_MIN))).toEqual({ persist: true, level: POST_LEVEL_MIN });
    expect(readChartLevelInput(String(POST_LEVEL_MIN - 1))).toEqual({ persist: false });
    expect(readChartLevelInput(String(POST_LEVEL_MAX))).toEqual({ persist: true, level: POST_LEVEL_MAX });
    expect(readChartLevelInput(String(POST_LEVEL_MAX + 1))).toEqual({ persist: false });
  });

  it('parseLevel：空与非整数 → null，整数原样', () => {
    expect(parseLevel('')).toBeNull();
    expect(parseLevel('  ')).toBeNull();
    expect(parseLevel('28.5')).toBeNull();
    expect(parseLevel('0')).toBe(0);
    expect(parseLevel('-1')).toBe(-1);
    expect(parseLevel('36')).toBe(36);
    expect(parseLevel('28')).toBe(28);
  });

  it('readChartLevelInput：空可落盘 null；1–35 可落盘；越界 / 非整数不写', () => {
    expect(readChartLevelInput('')).toEqual({ persist: true, level: null });
    expect(readChartLevelInput('1')).toEqual({ persist: true, level: 1 });
    expect(readChartLevelInput('35')).toEqual({ persist: true, level: 35 });
    expect(readChartLevelInput('0')).toEqual({ persist: false });
    expect(readChartLevelInput('-1')).toEqual({ persist: false });
    expect(readChartLevelInput('36')).toEqual({ persist: false });
    expect(readChartLevelInput('28.5')).toEqual({ persist: false });
  });
});
