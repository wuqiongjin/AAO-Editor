// issue 145 #1 / #143：BPM 就地编辑的两条接线事实。
// `commitBpmEdit` 住在 FinalVirtualCanvas 里、单测碰不到 ref，故用静态源码断言锁（照
// `SlideFlickDecorator.test.ts` 惯例）；数值解析本身由 `parseBpmInput` 的单测覆盖。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const CANVAS = 'src/chart/components/canvas/FinalVirtualCanvas.tsx';

describe('BPM 就地编辑', () => {
  const src = readStripped(CANVAS);

  it('负值不进「上次填写值」（lastBpmRef 的写入被 v > 0 守卫）', () => {
    const m = src.match(/lastBpmRef\.current\s*=/);
    expect(m, '应存在 lastBpmRef 的写入').toBeTruthy();
    // 守卫与写入同处一条 if —— 取写入前最近的 120 字符
    const before = src.slice(Math.max(0, m!.index! - 120), m!.index!);
    expect(before, 'lastBpmRef 写入应被正值守卫').toMatch(/if\s*\(\s*v\s*>\s*0\s*\)/);
  });

  it('数值解析走 parseBpmInput（不再内联 parseInt 截断小数）', () => {
    expect(src).toMatch(/parseBpmInput\s*\(/);
    expect(src).not.toMatch(/parseInt\s*\(\s*bpmEdit\.value/);
  });
});
