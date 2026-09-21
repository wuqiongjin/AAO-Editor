// issue 144：工具栏缩放数字的**回写**条件。
// 生效值回写（ui.scale ← effectiveScale）是 2026-09-10 修「数字虚高 + 点 − 死行程」加的，不能整条删；
// 但它在「画布连 1× 都装不下」（fitScale < 1，窄窗 / 高系统缩放）时把默认的 100% 打成 88%。
// 定案：只在 fitScale ≥ 1（画布装得下、只是请求值更高）时回写。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const CANVAS = 'src/chart/components/canvas/FinalVirtualCanvas.tsx';

describe('画布缩放 · 生效值回写的守卫', () => {
  const src = readStripped(CANVAS);

  it('setScale(effective) 被 fitScale() >= 1 守卫', () => {
    const m = src.match(/setScale\(effective\)/);
    expect(m, '应存在生效值回写').toBeTruthy();
    const before = src.slice(Math.max(0, m!.index! - 200), m!.index!);
    expect(before, '回写应带 fitScale() >= 1 守卫').toMatch(/fitScale\(\)\s*>=\s*1/);
  });

  it('Ctrl+滚轮在钳住不动时不改数字（否则 100% 会被打成 88%）', () => {
    // 缩放分支里应有一条「生效值未变 → 直接 return」的守卫
    const wheel = src.match(/if\s*\(e\.ctrlKey\)\s*\{[\s\S]{0,600}?\}/);
    expect(wheel, '应存在 Ctrl+滚轮缩放分支').toBeTruthy();
    expect(wheel![0]).toMatch(/Math\.abs\(\s*effNewScale\s*-\s*viewport\.scale\s*\)\s*<\s*1e-9/);
  });
});
