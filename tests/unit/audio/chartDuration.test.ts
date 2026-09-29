// architecture-refactor/10（架构评审候选 5 的「时长那一半」）：谱面时长的默认与夹取只有一份。
// 本文件锁**口径本身**（下界 / 上界 / 非有限回落）；调用点归 `tests/static/ChartDurationWiring.test.ts`。
import { describe, it, expect } from 'vitest';
import { MAX_DURATION_SECONDS } from '@/src/chart/config/AppSettings';
import {
  clampChartDuration, DEFAULT_CHART_DURATION_SECONDS, MIN_CHART_DURATION_SECONDS,
} from '@/src/audio/chartDuration';

describe('谱面时长语义 · 默认值', () => {
  it('无音频默认谱面长度 30s（ADR-0005 §4）', () => {
    expect(DEFAULT_CHART_DURATION_SECONDS).toBe(30);
  });
});

describe('谱面时长语义 · 夹取（唯一口径）', () => {
  it('区间内的值原样透传（含两端）', () => {
    expect(clampChartDuration(30)).toBe(30);
    expect(clampChartDuration(1)).toBe(1);
    expect(clampChartDuration(MIN_CHART_DURATION_SECONDS)).toBe(MIN_CHART_DURATION_SECONDS);
    expect(clampChartDuration(MAX_DURATION_SECONDS)).toBe(MAX_DURATION_SECONDS);
  });

  it('低于下界 → 下界 0.1（统一口径：此前只夹上界的三处会原样接受 0.05 这类值）', () => {
    expect(MIN_CHART_DURATION_SECONDS).toBe(0.1);
    expect(clampChartDuration(0.05)).toBe(MIN_CHART_DURATION_SECONDS);
    expect(clampChartDuration(0)).toBe(MIN_CHART_DURATION_SECONDS);
    expect(clampChartDuration(-10)).toBe(MIN_CHART_DURATION_SECONDS);
  });

  it('超上限 → 上限（issue 28 P6：30 分钟）', () => {
    expect(clampChartDuration(MAX_DURATION_SECONDS + 1)).toBe(MAX_DURATION_SECONDS);
    expect(clampChartDuration(1e9)).toBe(MAX_DURATION_SECONDS);
  });

  it('非有限值 → 默认（原 clampFinite 的 fallback 口径）', () => {
    expect(clampChartDuration(NaN)).toBe(DEFAULT_CHART_DURATION_SECONDS);
    expect(clampChartDuration(Infinity)).toBe(DEFAULT_CHART_DURATION_SECONDS);
    expect(clampChartDuration(-Infinity)).toBe(DEFAULT_CHART_DURATION_SECONDS);
  });
});
