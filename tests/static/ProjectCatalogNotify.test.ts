// 工程目录通知接线（issue 10）。
// 结论是**接线事实**：ensure 新建未命名工程必须 notifyCatalogChanged，
// 否则保活挂载的 ProjectsPage（只在 catalogEpoch 变化时 reload）列表里看不到它。
// 与 ChartProjectPersistence.test.ts 同手法：不 import 被测模块，读源码文本断言。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const src = readStripped('src/app/providers/CurrentProjectProvider.tsx');

/** 取 `from` 到 `to` 之间的源码片段；锚点找不到就返回空串，交给断言去红（不在收集期抛错）。 */
function body(from: string, to: string): string {
  const start = src.indexOf(from);
  if (start < 0) return '';
  const end = src.indexOf(to, start);
  if (end < 0) return '';
  return src.slice(start, end);
}

describe('CurrentProjectProvider · 工程目录通知（issue 10）', () => {
  it('ensure 里通知目录：新建的未命名工程会进工程管理页列表', () => {
    const ensureBody = body('const ensure', 'const open');
    expect(ensureBody).toMatch(/notifyCatalogChanged\(\)/);
  });

  it('只在确实新建了工程时通知（result.created），打开已有工程不通知', () => {
    const ensureBody = body('const ensure', 'const open');
    const openBody = body('const open', 'const reset');
    expect(ensureBody).toMatch(/if\s*\(\s*result\.created\s*\)\s*notifyCatalogChanged\(\)/);
    expect(openBody).not.toMatch(/notifyCatalogChanged/);
  });
});
