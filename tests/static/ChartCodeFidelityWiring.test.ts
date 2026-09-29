// 05 票 · 保真收口的**接线看守**。
//
// 语义在 tests/unit/chart/editing/ChartEditingState.test.ts（纯模块）；这里锁的是「绕不过」：
// EditingProvider 不再自己养保真 state / setter，改 notes 的每个入口都打同一个 commit，
// Apply 的回写与置位也是一次转移，记录侧仍是两个扁平字段（保真是编辑态的字段，不是记录形状）。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const EDITING = 'src/app/providers/EditingProvider.tsx';
const PERSIST = 'src/project/useChartProjectPersistence.ts';
const WORKSPACE = 'src/pages/workspace/WorkspacePage.tsx';

/** 取一段源码区间（从 `signature` 到下一个 `until`），把断言钉在具体函数体内 */
function bodyUntil(src: string, signature: string, until: string): string {
  const from = src.indexOf(signature);
  expect(from, `未找到 ${signature}`).toBeGreaterThan(-1);
  const to = src.indexOf(until, from + signature.length);
  expect(to, `未找到 ${until}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

describe('05 · 保真收成一个 commit（改 notes 的路径绕不过作废）', () => {
  const src = readStripped(EDITING);

  it('EditingProvider 不再有独立的保真 state / setter（唯一持有者是编辑态的那一个字段）', () => {
    expect(src).not.toMatch(/setChartCodePristine|setAppliedChartCodeText/);
    expect(src).toMatch(/const chartCodeFidelity = editingState\.fidelity/);
  });

  it('改 notes 的四个入口都收在 ChartEditingState 的转移函数上', () => {
    expect(bodyUntil(src, 'const handleNotesChange', 'const setNotes')).toMatch(/commitNotes\(/);
    expect(bodyUntil(src, 'const setNotes', 'const resetNotes')).toMatch(/commitNotes\(/);
    expect(bodyUntil(src, 'const undo', 'const redo')).toMatch(/setEditingState\(undoNotes\)/);
    expect(bodyUntil(src, 'const redo', 'const copy')).toMatch(/setEditingState\(redoNotes\)/);
  });

  it('Apply：回写画布与置位走同一次转移（不会只成一半）', () => {
    expect(bodyUntil(src, 'const applyChartCodeToCanvas', 'const handleNotesChange'))
      .toMatch(/setEditingState\(prev => applyChartCode\(prev, newNotes, text\)\)/);
  });

  it('切工程 / 切谱面：从记录恢复保真（resetNotes + resetChartEditingState）', () => {
    expect(bodyUntil(src, 'const resetNotes', 'const undo'))
      .toMatch(/resetChartEditingState\(next\.history, fidelity\)/);
    // 记录的两个扁平字段 → 保真（映射在边界做）
    const page = readStripped(WORKSPACE);
    expect(bodyUntil(page, 'handleProjectRestore', 'if (project.durationSeconds > 0)'))
      .toMatch(/resetNotes\(chart\.notes, \{[\s\S]*?text: chart\.appliedChartCodeText \?\? null,[\s\S]*?pristine: chart\.chartCodePristine === true/);
  });

  it('落盘仍写记录的两个扁平字段（记录形状不变，映射在 hook 边界）', () => {
    const persist = readStripped(PERSIST);
    expect(persist).toMatch(/appliedChartCodeText: fidelity\?\.text \?\? null/);
    expect(persist).toMatch(/chartCodePristine: fidelity\?\.pristine === true/);
  });
});
