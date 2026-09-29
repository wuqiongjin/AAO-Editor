// 06 票（架构评审候选 2）：整记录读-改-写必须走唯一写入口 `mutateProject`。
//
// 这是**接线事实**（static/ 的正当用途）：调用点是 React 页面 / hook 装配，
// 行为侧由 ProjectMutation.test.ts 与各域 DOM 测试看守；这里只钉住「没人再手搓一份读-改-写」。
import { describe, expect, it } from 'vitest';
import { readSource, readStripped } from '@/tests/support/source';

/** 检查过的整记录读-改-写调用点（06 票落点 3 + CurrentProjectSession.open）。 */
const MUTATION_CALLERS = [
  'src/pages/projects/ProjectsPage.tsx',
  'src/pages/workspace/ChartSwitcher.tsx',
  'src/pages/workspace/WorkspacePage.tsx',
  'src/audio/projectAudio.ts',
  'src/project/CurrentProjectSession.ts',
];

describe('06 · 唯一写入口接线', () => {
  it('每个读-改-写调用点都经 mutateProject', () => {
    for (const file of MUTATION_CALLERS) {
      expect(readStripped(file), file).toMatch(/mutateProject\(/);
    }
  });

  it('mutateProject 只在记录模块定义（调用点不得自造同名入口）', () => {
    const definition = /export async function mutateProject/;
    expect(readSource('src/project/ChartProjectRecord.ts')).toMatch(definition);
    for (const file of MUTATION_CALLERS) {
      expect(readStripped(file), file).not.toMatch(definition);
    }
  });
});
