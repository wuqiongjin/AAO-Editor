// issue 186 静态锁：片段粘贴这条链的**接线事实**（画布跑不进 jsdom，组件行为测不到的部分）。
// 1. 画布把片段来源同时交给"单击粘贴"（GestureSession）与"Ctrl+V"（execPaste）；
// 2. 幽灵预览复用同一条粘贴预览通道（片段粘贴态下"剪贴板"就是该片段的音符）；
// 3. 工作台把"点卡片"接到进态入口，并把胶囊挂到画布左上角。
//
// 「点卡片不改写剪贴板 / 可连续两次」是纯逻辑，由 `tests/unit/app/PatternPasteIsolation.test.ts` 锁；
// 「卡片置灰不进态」「胶囊显隐与切换」「工具轨回剪贴板来源」都由 DOM 测试锁
//（`PatternLibraryDrawer` / `PatternPastePill` / `WorkspaceToolRail`），这里只锁画布与页面接线。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const canvas = readStripped('src/chart/components/canvas/FinalVirtualCanvas.tsx');
const gesture = readStripped('src/chart/editing/GestureSession.ts');
const render = readStripped('src/rendering/render.ts');
const page = readStripped('src/pages/workspace/WorkspacePage.tsx');

describe('issue 186 · 画布接线', () => {
  it('片段来源进手势世界（单击粘贴行）', () => {
    expect(canvas).toMatch(/session\.bindWorld\(\{[\s\S]{0,240}clipboard, pastePattern/);
    expect(gesture).toContain('pastePattern: w.pastePattern');
  });

  it('Ctrl+V 走同一个 paste 行，故也带片段来源', () => {
    expect(canvas).toMatch(/tool: 'paste'[\s\S]{0,200}clipboard, pastePattern/);
  });

  it('幽灵预览按落点现算载荷（含 BPM 虚线），不是把音符塞进剪贴板', () => {
    expect(canvas).toContain('pastePayloadAt,');
    expect(canvas).toContain('buildPatternPastePayload(pastePattern');
    expect(render).toContain('rc.pastePayloadAt(pos.preciseBeat)');
    expect(render).toContain('renderBpmGhost(');
  });
});

describe('issue 186 · 页面接线', () => {
  it('抽屉的"点卡片"接到进/退入口，并把当前来源交给它高亮', () => {
    expect(page).toMatch(/<PatternLibraryDrawer[\s\S]*?onPastePattern=\{ui\.togglePatternPaste\}/);
    expect(page).toMatch(/<PatternLibraryDrawer[\s\S]*?activePatternId=\{ui\.patternPaste\?\.id \?\? null\}/);
  });

  it('片段粘贴胶囊挂在画布区（与曲线胶囊同级）', () => {
    expect(page).toContain('<PatternPastePill />');
  });
});
