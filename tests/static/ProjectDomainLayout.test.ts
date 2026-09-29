// architecture-refactor 01：工程域升顶层 + 工程页资产收敛的**落点锁**。
//
// 本票是纯搬迁（行为零变化），行为测试抓不住"某天又被搬回 `src/chart/project/`、
// 或工程页资产又散落回 `src/pages/` 根部"这类回潮 —— 落点是结构事实，只能按源码路径断言。
// 手法照 WorkspaceEntrySingle.test.ts：扫 src/ 全量源码文件，不 import 被测模块。
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource, repoRoot } from '@/tests/support/source';

/** src/ 下全部 .ts/.tsx/.css（相对仓库根的路径） */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...sourceFiles(abs));
    } else if (/\.(ts|tsx|css)$/.test(entry)) {
      out.push(relative(repoRoot, abs).split('\\').join('/'));
    }
  }
  return out;
}

const files = sourceFiles(join(repoRoot, 'src'));

describe('architecture-refactor 01 · 工程域与工程页资产的落点', () => {
  it('工程域在顶层 src/project/，src/chart/ 下不再有 project/ 目录', () => {
    expect(files.filter((f) => f.startsWith('src/project/')).length).toBeGreaterThan(5);
    expect(files.filter((f) => f.startsWith('src/chart/project/'))).toEqual([]);
  });

  it('跨页工程 UI 资产下沉到 src/project/ui/（ChartInfoDialog 含 parseLevel）', () => {
    expect(files).toContain('src/project/ui/ChartInfoDialog.tsx');
    expect(files).toContain('src/project/ui/projectUi.tsx');
  });

  it('工程页资产全部收进 src/pages/projects/，src/pages/ 根部不再散落', () => {
    const STRAYS = [
      'src/pages/ProjectsPage.tsx',
      'src/pages/ProjectsPage.css',
      'src/pages/ChartInfoDialog.tsx',
      'src/pages/projectUi.tsx',
      'src/pages/ProjectListSplit.tsx',
      'src/pages/projectGridSelection.ts',
      'src/pages/projectFormat.ts',
    ];
    expect(STRAYS.filter((f) => files.includes(f))).toEqual([]);
    expect(files).toContain('src/pages/projects/ProjectsPage.tsx');
    expect(files).toContain('src/pages/projects/components/ProjectDetail.tsx');
  });

  it('页面主组件只留调度 / state / 弹窗编排（拆解不许再长回单文件）', () => {
    // 拆解前 1056 行；上限留足正常增长的余量，只拦"又堆回大杂烩"这一种回潮
    expect(readSource('src/pages/projects/ProjectsPage.tsx').split('\n').length).toBeLessThan(500);
  });
});
