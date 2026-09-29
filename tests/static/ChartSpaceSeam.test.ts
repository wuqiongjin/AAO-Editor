// issue 134：布局轴几何只有一份生命周期。锁接线，不锁 ADR-0010 取解细则。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const space = readStripped('src/chart/geometry/ChartSpace.ts');
const canvas = readStripped('src/chart/components/canvas/FinalVirtualCanvas.tsx');
const scroll = readStripped('src/playback/useScrollModel.ts');
const editor = readStripped('src/pages/workspace/WorkspacePage.tsx');

describe('一份 ChartGeometry 生命周期（issue 134）', () => {
  it('应用侧秒域几何只在 ChartSpace 构造', () => {
    expect(space).toMatch(/new ChartGeometry\s*\(/);
    expect(space).toMatch(/\{\s*seconds:/);
    expect(canvas).not.toMatch(/new ChartGeometry\s*\(/);
    expect(scroll).not.toMatch(/new ChartGeometry\s*\(/);
  });

  it('Editor 组装 useChartSpace，scroll 与画布 bind 同一 geometry', () => {
    expect(editor).toMatch(/useChartSpace\s*\(/);
    expect(editor).toMatch(/<FinalVirtualCanvas[\s\S]*geometry=\{geometry\}/);
    expect(scroll).toMatch(/configure\s*\(\s*geometry/);
  });

  it('HUD 读 geometry 最大 beat 解，不旁路 secondsToBeat', () => {
    expect(canvas).toMatch(/beatOfSeconds\s*\(/);
    expect(canvas).not.toMatch(/secondsToBeat\s*\(/);
    expect(editor).toMatch(/segmentIndexOfSeconds\s*\(/);
    expect(editor).not.toMatch(/secondsSegmentIndex\s*\(/);
  });
});
