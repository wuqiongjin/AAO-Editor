// issue 200 锁测：滚轮反转逻辑（FinalVirtualCanvas handleWheel）
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const CANVAS = 'src/chart/components/canvas/FinalVirtualCanvas.tsx';

describe('issue 200 · 画布滚轮反转（invertWheel）接线与逻辑锁', () => {
  const src = readStripped(CANVAS);

  it('handleWheel 读取 display.invertWheel 配置', () => {
    expect(src).toMatch(/const\s+invert\s*=\s*display\.invertWheel\s*\?\?\s*false/);
  });

  it('Shift+滚轮在开启 invertWheel 时同频反转', () => {
    const shiftBlock = src.match(/if\s*\(e\.shiftKey\)\s*\{[\s\S]{0,400}?\}/);
    expect(shiftBlock, '应存在 Shift+滚轮分支').toBeTruthy();
    expect(shiftBlock![0]).toMatch(/const\s+delta\s*=\s*invert\s*\?\s*-rawDelta\s*:\s*rawDelta/);
    expect(shiftBlock![0]).toMatch(/host\.scrollTop\s*\+=\s*delta/);
  });

  it('普通滚轮在开启 invertWheel 时拦截并取反（仅作用于 deltaY，不劫持横向手势）', () => {
    const normalInvertBlock = src.match(/if\s*\(invert\)\s*\{[\s\S]{0,400}?\}/);
    expect(normalInvertBlock, '应存在 invert 普通滚动分支').toBeTruthy();
    expect(normalInvertBlock![0]).toMatch(/if\s*\(e\.deltaY\s*===\s*0\)\s*return/);
    expect(normalInvertBlock![0]).toMatch(/e\.preventDefault\(\)/);
    expect(normalInvertBlock![0]).toMatch(/host\.scrollTop\s*-=\s*e\.deltaY/);
  });

  it('Ctrl+滚轮缩放逻辑保持原样，优先于 invertWheel', () => {
    const ctrlIdx = src.indexOf('if (e.ctrlKey)');
    const invertIdx = src.indexOf('const invert = display.invertWheel');
    expect(ctrlIdx).toBeGreaterThan(0);
    expect(invertIdx).toBeGreaterThan(ctrlIdx);
  });
});
