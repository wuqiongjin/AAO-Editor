import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const mainSrc = readStripped('electron/main.cjs');
const appMenuSrc = readStripped('electron/window/applicationMenu.cjs');
const lifecycleSrc = readStripped('electron/window/lifecycle.cjs');

describe('issue 211 · macOS 菜单与生命周期静态锁测', () => {
  it('main.cjs 严禁无条件执行 Menu.setApplicationMenu(null)', () => {
    // 负锁：不得在没有任何平台判断的情况下直接抹掉全局菜单
    expect(mainSrc).not.toMatch(/app\.whenReady\(\)\.then\([^)]*Menu\.setApplicationMenu\(null\)/);
    expect(mainSrc).not.toMatch(/app\.whenReady\(\)\s*\.then\(\(\)\s*=>\s*\{\s*Menu\.setApplicationMenu\(null\);/);
  });

  it('main.cjs 正确引用 applicationMenu 与 lifecycle 模块进行平台分流', () => {
    expect(mainSrc).toMatch(/require\(['"]\.\/window\/applicationMenu\.cjs['"]\)/);
    expect(mainSrc).toMatch(/setupApplicationMenu\(/);
    expect(mainSrc).toMatch(/require\(['"]\.\/window\/lifecycle\.cjs['"]\)/);
    expect(mainSrc).toMatch(/handleWindowAllClosed\(/);
    expect(mainSrc).toMatch(/handleActivate\(/);
  });

  it('applicationMenu.cjs 在 darwin 平台配置 quit / about / editMenu 原生菜单，Win/Linux 设为 null', () => {
    expect(appMenuSrc).toMatch(/platform === ['"]darwin['"]/);
    expect(appMenuSrc).toMatch(/role:\s*['"]quit['"]/);
    expect(appMenuSrc).toMatch(/role:\s*['"]about['"]/);
    expect(appMenuSrc).toMatch(/role:\s*['"]editMenu['"]/);
    expect(appMenuSrc).toMatch(/setApplicationMenu\(null\)/);
  });

  it('lifecycle.cjs 在 darwin 平台关闭窗口时不退出，其它平台安全退出', () => {
    expect(lifecycleSrc).toMatch(/platform !== ['"]darwin['"]/);
    expect(lifecycleSrc).toMatch(/\.quit\(\)/);
  });
});
