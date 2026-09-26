// issue 163：删除工具 / 右键按住时 hover 必须能命中 BPM 整线，描边才画得出危险色。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const canvas = readStripped('src/chart/components/canvas/FinalVirtualCanvas.tsx');

describe('issue 163 · 删除 hover 接线', () => {
  it('hoverItem 在 findItemAt 未命中后，删除工具或右键按住会问 findBpmLineAt', () => {
    const hover = canvas.slice(canvas.indexOf('const hoverItem = useMemo'), canvas.indexOf('const getScaledVirtualBounds'));
    expect(hover).toMatch(/findItemAt\s*\(/);
    expect(hover).toMatch(/findBpmLineAt\s*\(/);
    expect(hover).toMatch(/armedTool === 'delete'/);
    expect(hover).toMatch(/rightButtonHeld/);
  });
});
