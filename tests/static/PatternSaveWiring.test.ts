// issue 185 静态锁：收藏选区这条链的**接线事实**（组件行为测不到的部分）。
// 1. `execSavePattern` 不属于谱面修改类功能 —— 收藏读的是选区、不写谱面，只读谱面也允许；
// 2. 工作台真的把它分发出去，并把库 + 只读态 + "有没有选区" 交给抽屉；
// 3. 库状态活在页面（抽屉关着也能收藏），不是抽屉自持。
//
// 「收藏按钮只按选区置灰」「只读卡片带说明」这些是**组件行为**，由
// `tests/dom/workspace/PatternLibraryDrawer.test.tsx` 锁，这里不逐字读源码行。
import { describe, expect, it } from 'vitest';
import { CHART_EDIT_FUNCTIONS } from '@/src/project/chartReadonlyGate';
import { FUNCTIONS, getDefaultConfig, resolveAction } from '@/src/chart/config/ShortcutConfig';
import { readStripped } from '@/tests/support/source';

describe('issue 185 · execSavePattern 的闸门归属', () => {
  it('默认键 = Ctrl+Shift+D，进快捷键表（可改键 / 冲突拒绝走同一套）', () => {
    const def = FUNCTIONS.find((f) => f.id === 'execSavePattern');
    expect(def?.binding).toBe('ctrl+shift+d');
    expect(def?.category).toBe('pattern');
    expect(def?.scope).toBeUndefined(); // 画布作用域
    expect(getDefaultConfig().execSavePattern).toBe('ctrl+shift+d');
    expect(resolveAction(
      { key: 'd', ctrlKey: true, shiftKey: true, metaKey: false, altKey: false } as KeyboardEvent,
      getDefaultConfig(),
    )).toBe('execSavePattern');
  });

  it('不在 CHART_EDIT_FUNCTIONS 里：只读（已上传）谱面照常可用', () => {
    expect(CHART_EDIT_FUNCTIONS.has('execSavePattern' as never)).toBe(false);
    // 反向对照：真正写谱面的功能仍在表里（防这张表被整个清空后本锁空转）
    expect(CHART_EDIT_FUNCTIONS.has('execPaste' as never)).toBe(true);
  });
});

describe('issue 185 · 工作台接线', () => {
  const page = readStripped('src/pages/workspace/WorkspacePage.tsx');

  it('分发 execSavePattern 到同一个收藏入口', () => {
    expect(page).toContain("case 'execSavePattern'");
    expect(page).toContain('saveSelection');
  });

  it('抽屉拿到页面持有的库、只读态、选区可收藏态与收藏回调', () => {
    expect(page).toMatch(/<PatternLibraryDrawer[\s\S]*?library=\{patternLibrary\}/);
    expect(page).toMatch(/<PatternLibraryDrawer[\s\S]*?canSaveSelection=\{canSaveSelection\}/);
    expect(page).toMatch(/<PatternLibraryDrawer[\s\S]*?readOnly=\{isReadOnly\}/);
    expect(page).toMatch(/<PatternLibraryDrawer[\s\S]*?onSaveSelection=/);
  });

  it('库状态活在页面（抽屉关着也能收藏），不是抽屉自持', () => {
    expect(page).toContain('usePatternLibrary()');
    expect(page).toContain('useSaveSelectionPattern(patternLibrary)');
  });
});
