// architecture-refactor 02：pages 统一收敛与工作台解耦的**落点锁**。
//
// 本票是纯搬迁（行为零变化），行为测试抓不住"工作台装配又搬回 src/chart/、
// 应用页又散回各领域目录、chart 又反向伸手进 pages"这类回潮 —— 落点是结构事实，
// 只能按源码路径 / import 形态断言。手法照 ProjectDomainLayout.test.ts：扫 src/ 全量源码。
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStripped, repoRoot } from '@/tests/support/source';

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

describe('architecture-refactor 02 · pages 收敛与 chart 解耦的落点', () => {
  it('六个路由页全部收进 src/pages/ 的子目录，领域目录里不再有 *Page.tsx', () => {
    expect(files).toContain('src/pages/projects/ProjectsPage.tsx');
    expect(files).toContain('src/pages/workspace/WorkspacePage.tsx');
    expect(files).toContain('src/pages/audio/AudioPage.tsx');
    expect(files).toContain('src/pages/assets/AssetsPage.tsx');
    expect(files).toContain('src/pages/settings/SettingsPage.tsx');
    expect(files).toContain('src/pages/settings/ShortcutsPage.tsx');
    // src/audio、src/visual、src/settings 只留引擎 / 皮肤 / 配置，不许再长出页面
    const strays = files.filter((f) => /^src\/(audio|visual|settings)\/[^/]*Page\.tsx$/.test(f));
    expect(strays).toEqual([]);
  });

  it('工作台页壳（Editor 本体 + 工具栏 / 切换器 / 面板）统一在 src/pages/workspace/', () => {
    // 票面「目标结构」点名的七件套 —— 缺一件即回潮
    const WORKSPACE_SHELL = [
      'src/pages/workspace/WorkspacePage.tsx',
      'src/pages/workspace/Toolbar.tsx',
      'src/pages/workspace/Toolbar.css',
      'src/pages/workspace/ToolbarSection.tsx',
      'src/pages/workspace/ChartSwitcher.tsx',
      'src/pages/workspace/ChartSwitcher.css',
      'src/pages/workspace/CurveConfigPanel.tsx',
    ];
    expect(WORKSPACE_SHELL.filter((f) => !files.includes(f))).toEqual([]);
    // 旧目录整体消失（含死壳 WorkspacePage.tsx），不保留同名壳
    expect(files.filter((f) => f.startsWith('src/pages/WorkspacePage/'))).toEqual([]);
  });

  it('src/chart/ 不再反向依赖 src/pages/（chart 纯化为画布与编辑核心库）', () => {
    const offenders = files
      .filter((f) => f.startsWith('src/chart/'))
      .filter((f) => /(?:from\s+['"][^'"]*pages\/|import\(\s*['"][^'"]*pages\/)/.test(readStripped(f)));
    expect(offenders).toEqual([]);
  });
});
