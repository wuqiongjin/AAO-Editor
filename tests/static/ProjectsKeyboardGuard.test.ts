// chart-projects 14：工程网格键盘监听守卫的静态装配锁测。
// 票面要求：静态断言 keydown 监听被「当前页 + 非输入焦点」守卫包住，
// 防止未来重构时把方向键监听改回无守卫的全局监听、污染其他页快捷键。
//
// 页面拆解后（architecture-refactor 01）两处 window keydown 监听各住一个文件：
//   卡片网格 → components/ProjectHub.tsx；详情左栏 ↑↓ → ProjectsPage.tsx。
// 两份守卫口径必须一致，故两条都锁。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const page = readStripped('src/pages/projects/ProjectsPage.tsx');
const hub = readStripped('src/pages/projects/components/ProjectHub.tsx');

/** 注册 window keydown 的两个文件：名字 → 源码 */
const listeners: [string, string][] = [
  ['pages/projects/ProjectsPage.tsx（详情左栏 ↑↓）', page],
  ['pages/projects/components/ProjectHub.tsx（卡片网格方向键）', hub],
];

describe('chart-projects 14: 工程网格键盘监听守卫装配', () => {
  it('keydown 监听注册前先过页面激活守卫（仅工程管理页为当前页）', () => {
    // 详情左栏那份额外要求「在详情视图里」（detailId 非空）
    expect(page).toMatch(/if \(activePage !== 'projects' \|\| !detailId\) return;/);
    expect(hub).toMatch(/if \(activePage !== 'projects'\) return;/);
    for (const [name, src] of listeners) {
      expect(src, name).toMatch(/window\.addEventListener\('keydown', onKeyDown\);/);
    }
  });

  it('keydown 处理器放行输入焦点（INPUT / TEXTAREA / SELECT / contentEditable）', () => {
    for (const [name, src] of listeners) {
      expect(src, name).toMatch(
        /tag === 'INPUT' \|\| tag === 'TEXTAREA' \|\| tag === 'SELECT' \|\| target\?\.isContentEditable\) return;/,
      );
    }
  });

  it('弹窗与卡片菜单打开（scrim 存在）时不响应方向键', () => {
    // issue 16 起弹窗只剩一个壳（.dialog__scrim 覆盖新建 / 编辑工程 / 谱面信息 / 删除确认）
    for (const [name, src] of listeners) {
      expect(src, name).toMatch(/document\.querySelector\('\.dialog__scrim, \.pp-menu__scrim'\)\) return;/);
    }
  });
});
