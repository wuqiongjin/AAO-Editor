// issue 134：布局轴几何只有一份生命周期。obtainChartGeometry 是复用规则的纯接缝。
import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { obtainChartGeometry, PLACEHOLDER_SURFACE } from '@/src/chart/geometry/ChartSpace';

const BPM = [{ beat: 0, bpm: 120 }];
const SURF = { w: 750, h: 900 };

describe('obtainChartGeometry（issue 134）', () => {
  it('无前一份时构造秒域几何', () => {
    const g = obtainChartGeometry(null, BPM, 30, SURF, 1);
    expect(g.chartLengthSeconds).toBe(30);
    expect(g.chartEndVirtualY).toBeCloseTo(30 * g.virtualPxPerSecond, 6);
    expect(g).toBeInstanceOf(ChartGeometry);
  });

  it('BPM / 秒长 / surface / 纵向比例未变 → 复用同一引用', () => {
    const a = obtainChartGeometry(null, BPM, 30, SURF, 1);
    const b = obtainChartGeometry(a, [{ beat: 0, bpm: 120 }], 30, { w: 750, h: 900 }, 1);
    expect(b).toBe(a);
  });

  it('BPM 事件变 → 新实例', () => {
    const a = obtainChartGeometry(null, BPM, 30, SURF, 1);
    const b = obtainChartGeometry(a, [{ beat: 0, bpm: 180 }], 30, SURF, 1);
    expect(b).not.toBe(a);
  });

  it('谱面秒长变 → 新实例', () => {
    const a = obtainChartGeometry(null, BPM, 30, SURF, 1);
    expect(obtainChartGeometry(a, BPM, 31, SURF, 1)).not.toBe(a);
  });

  it('渲染面变 → 新实例', () => {
    const a = obtainChartGeometry(null, BPM, 30, SURF, 1);
    expect(obtainChartGeometry(a, BPM, 30, { w: 751, h: 900 }, 1)).not.toBe(a);
  });

  it('纵向比例变 → 新实例', () => {
    const a = obtainChartGeometry(null, BPM, 30, SURF, 1);
    expect(obtainChartGeometry(a, BPM, 30, SURF, 1.5)).not.toBe(a);
  });

  it('占位渲染面与画布/滚动旧 fallback 同尺寸', () => {
    expect(PLACEHOLDER_SURFACE).toEqual({ w: 200, h: 240 });
  });
});
