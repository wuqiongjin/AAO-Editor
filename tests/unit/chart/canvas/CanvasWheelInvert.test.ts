// issue 200 + 缩小滚动加速：画布滚轮处理的接线与逻辑锁
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const CANVAS = 'src/chart/components/canvas/FinalVirtualCanvas.tsx';

describe('issue 200 · 画布滚轮反转（invertWheel）接线与逻辑锁', () => {
  const src = readStripped(CANVAS);

  it('handleWheel 读取 display.invertWheel 配置', () => {
    expect(src).toMatch(/const\s+invert\s*=\s*display\.invertWheel\s*\?\?\s*false/);
  });

  it('Shift+滚轮在开启 invertWheel 时同频反转，并按缩放倍率加速', () => {
    const shiftBlock = src.match(/if\s*\(e\.shiftKey\)\s*\{[\s\S]{0,500}?\}/);
    expect(shiftBlock, '应存在 Shift+滚轮分支').toBeTruthy();
    expect(shiftBlock![0]).toMatch(/const\s+delta\s*=\s*invert\s*\?\s*-rawDelta\s*:\s*rawDelta/);
    expect(shiftBlock![0]).toMatch(/host\.scrollTop\s*\+=\s*delta\s*\*\s*boost/);
  });

  it('普通滚轮按 1/scale 加速；invertWheel 只翻方向，且不劫持横向手势', () => {
    expect(src).toMatch(/const\s+deltaY\s*=\s*wheelDeltaPx\(e\.deltaY,\s*e\.deltaMode,\s*viewportPx\)/);
    expect(src).toMatch(/if\s*\(deltaY\s*===\s*0\)\s*return/);
    expect(src).toMatch(/host\.scrollTop\s*\+=\s*\(invert\s*\?\s*-deltaY\s*:\s*deltaY\)\s*\*\s*boost/);
  });

  it('未缩小且未反转时保留父容器原生滚动', () => {
    expect(src).toMatch(/if\s*\(!e\.shiftKey\s*&&\s*!invert\s*&&\s*boost\s*===\s*1\)\s*return/);
  });

  it('Ctrl+滚轮缩放逻辑保持原样，优先于 invertWheel', () => {
    const ctrlIdx = src.indexOf('if (e.ctrlKey)');
    const invertIdx = src.indexOf('const invert = display.invertWheel');
    expect(ctrlIdx).toBeGreaterThan(0);
    expect(invertIdx).toBeGreaterThan(ctrlIdx);
  });
});
