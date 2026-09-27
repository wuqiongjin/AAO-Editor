// chart-projects 14：工程网格键盘监听守卫的静态装配锁测。
// 票面要求：静态断言 keydown 监听被「当前页 + 非输入焦点」守卫包住，
// 防止未来重构时把方向键监听改回无守卫的全局监听、污染其他页快捷键。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

describe('chart-projects 14: 工程网格键盘监听守卫装配', () => {
  const src = readStripped('src/pages/ProjectsPage.tsx');

  it('keydown 监听注册前先过页面激活守卫（仅工程管理页为当前页）', () => {
    expect(src).toMatch(/if \(activePage !== 'projects'\) return;/);
    expect(src).toMatch(/window\.addEventListener\('keydown', onKeyDown\);/);
  });

  it('keydown 处理器放行输入焦点（INPUT / TEXTAREA / SELECT / contentEditable）', () => {
    expect(src).toMatch(
      /tag === 'INPUT' \|\| tag === 'TEXTAREA' \|\| tag === 'SELECT' \|\| target\?\.isContentEditable\) return;/,
    );
  });

  it('弹窗与卡片菜单打开（scrim 存在）时不响应方向键', () => {
    expect(src).toMatch(/document\.querySelector\('\.pp-dialog__scrim, \.pp-menu__scrim'\)\) return;/);
  });
});
