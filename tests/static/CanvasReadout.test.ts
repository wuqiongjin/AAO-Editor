// issue 179 锁测：画布底部读数 = 左下判定线 BPM、右下「♪ 已过 / 总数」（177 Q22 / Q23 / Q26）。
// 读数挂在 FinalVirtualCanvas 里，jsdom 跑不动画布 → 静态源码断言（照 PlaybackMarkerWiring 惯例）。
import { describe, it, expect } from 'vitest';
import { readSource, stripComments } from '@/tests/support/source';

const canvas = stripComments(readSource('src/chart/components/canvas/FinalVirtualCanvas.tsx'));
const overlay = (() => {
  const start = canvas.indexOf('data-testid="canvas-readout"');
  expect(start, '读数叠加层带 data-testid="canvas-readout"').toBeGreaterThan(-1);
  return canvas.slice(start, canvas.indexOf('</div>', start));
})();

describe('issue 179 · 画布底部读数', () => {
  it('左下不再显示时间（与播放条时间码重复，Q23）', () => {
    expect(overlay).not.toContain('formatTimePrecise');
  });

  it('左下 = 判定线处 BPM，与顶栏同一算法（ChartGeometry.bpmAtSeconds）', () => {
    expect(overlay).toMatch(/BPM \{playheadBpm\}/);
    expect(canvas).toMatch(/playheadBpm\s*=\s*geometry\.bpmAtSeconds\(currentSeconds\)/);
  });

  it('右下 = 已过 / 总数，总数走 countChartNotes', () => {
    expect(overlay).toMatch(/♪ \{passedNoteCount\} \/ \{totalNoteCount\}/);
    expect(canvas).toMatch(/countChartNotes\(notes\)/);
  });
});
