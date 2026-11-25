// issue 256：复制 / 剪切持工具态的接线事实（组件行为由矩阵 / 工具轨单测锁）。
import { describe, expect, it } from 'vitest';
import { CHART_EDIT_FUNCTIONS } from '@/src/project/chartReadonlyGate';
import { readStripped } from '@/tests/support/source';

describe('issue 256 · 工作台接线', () => {
  const page = readStripped('src/pages/workspace/WorkspacePage.tsx');
  const rail = readStripped('src/pages/workspace/WorkspaceToolRail.tsx');
  const gesture = readStripped('src/chart/editing/CanvasGesture.ts');

  it('切换键只 setArmedTool，不顺带 copy/cut', () => {
    expect(page).toMatch(/case 'switchCopy':\s*setArmedTool\('copy'\)/);
    expect(page).toMatch(/case 'switchCut':\s*setArmedTool\('cut'\)/);
    expect(page).toMatch(/case 'execCopy':\s*copy\(\)/);
    expect(page).toMatch(/case 'execCut':\s*cut\(\)/);
  });

  it('工具轨复制/剪切不再走即时 action', () => {
    expect(rail).not.toMatch(/id: 'copy'[\s\S]{0,120}action:/);
    expect(rail).not.toMatch(/id: 'cut'[\s\S]{0,120}action:/);
  });

  it('画布对复制/剪切补 BPM 整线命中（与镜像同档）', () => {
    expect(gesture).toMatch(/tool === 'copy' \|\| tool === 'cut'/);
  });
});

describe('issue 256 · 只读闸', () => {
  it('switchCopy / switchCut 不进 CHART_EDIT_FUNCTIONS（对齐 switchDelete）', () => {
    expect(CHART_EDIT_FUNCTIONS.has('switchCopy' as never)).toBe(false);
    expect(CHART_EDIT_FUNCTIONS.has('switchCut' as never)).toBe(false);
    expect(CHART_EDIT_FUNCTIONS.has('switchDelete' as never)).toBe(false);
    expect(CHART_EDIT_FUNCTIONS.has('execCut' as never)).toBe(true);
  });
});
