import { describe, expect, it, vi } from 'vitest';
import {
  buildDarwinMenuTemplate,
  setupApplicationMenu,
} from '@/electron/applicationMenu.cjs';
import {
  handleActivate,
  handleWindowAllClosed,
} from '@/electron/lifecycle.cjs';

describe('issue 211 · electron/applicationMenu 平台菜单', () => {
  it('buildDarwinMenuTemplate 包含 App 主菜单与编辑菜单，不含冗余 View/Window 菜单', () => {
    const template = buildDarwinMenuTemplate('AAO Editor');
    expect(template).toHaveLength(2);

    const [appMenu, editMenu] = template as any[];
    expect(appMenu.label).toBe('AAO Editor');
    expect(Array.isArray(appMenu.submenu)).toBe(true);

    const appRoles = appMenu.submenu.map((item: any) => item.role).filter(Boolean);
    expect(appRoles).toContain('about');
    expect(appRoles).toContain('services');
    expect(appRoles).toContain('hide');
    expect(appRoles).toContain('hideOthers');
    expect(appRoles).toContain('unhide');
    expect(appRoles).toContain('quit');

    expect(editMenu.role).toBe('editMenu');
    expect(Array.isArray(editMenu.submenu)).toBe(true);
    const editRoles = editMenu.submenu.map((item: any) => item.role).filter(Boolean);
    expect(editRoles).toContain('undo');
    expect(editRoles).toContain('redo');
    expect(editRoles).toContain('cut');
    expect(editRoles).toContain('copy');
    expect(editRoles).toContain('paste');
    expect(editRoles).toContain('selectAll');

    // 严禁存在多余的菜单项
    const allRoles = template.map((m: any) => m.role);
    expect(allRoles).not.toContain('viewMenu');
    expect(allRoles).not.toContain('windowMenu');
    expect(allRoles).not.toContain('help');
  });

  it('macOS (darwin) 平台挂载原生轻量菜单，提供 Cmd+Q 退出能力', () => {
    const fakeBuiltMenu = { id: 'darwin-menu' };
    const fakeMenuModule = {
      buildFromTemplate: vi.fn().mockReturnValue(fakeBuiltMenu),
      setApplicationMenu: vi.fn(),
    };

    const res = setupApplicationMenu('darwin', 'AAO Editor', fakeMenuModule as any);
    expect(fakeMenuModule.buildFromTemplate).toHaveBeenCalledOnce();
    expect(fakeMenuModule.setApplicationMenu).toHaveBeenCalledWith(fakeBuiltMenu);
    expect(res).toBe(fakeBuiltMenu);
  });

  it('Windows / Linux 平台调用 Menu.setApplicationMenu(null)，保持沉浸式无边框窗口', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const fakeMenuModule = {
        buildFromTemplate: vi.fn(),
        setApplicationMenu: vi.fn(),
      };

      const res = setupApplicationMenu(platform, 'AAO Editor', fakeMenuModule as any);
      expect(fakeMenuModule.buildFromTemplate).not.toHaveBeenCalled();
      expect(fakeMenuModule.setApplicationMenu).toHaveBeenCalledWith(null);
      expect(res).toBeNull();
    }
  });
});

describe('issue 211 · electron/lifecycle 应用生命周期收敛', () => {
  it('handleWindowAllClosed: Windows / Linux 全部窗口关闭时退出应用', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const fakeApp = { quit: vi.fn() };
      handleWindowAllClosed(platform, fakeApp);
      expect(fakeApp.quit).toHaveBeenCalledOnce();
    }
  });

  it('handleWindowAllClosed: macOS (darwin) 关闭全部窗口时不退出应用，保留进程以待唤醒', () => {
    const fakeApp = { quit: vi.fn() };
    handleWindowAllClosed('darwin', fakeApp);
    expect(fakeApp.quit).not.toHaveBeenCalled();
  });

  it('handleActivate: 无窗口时创建新窗口', () => {
    const createWindow = vi.fn().mockReturnValue({ id: 'new-win' });
    const getWindows = vi.fn().mockReturnValue([]);

    const res = handleActivate({ getWindows, createWindow });
    expect(createWindow).toHaveBeenCalledOnce();
    expect(res).toEqual({ id: 'new-win' });
  });

  it('handleActivate: 已有窗口时聚焦并恢复最小化窗口，不重复创建窗口', () => {
    const createWindow = vi.fn();
    const existingWin = {
      isMinimized: vi.fn().mockReturnValue(true),
      restore: vi.fn(),
      focus: vi.fn(),
    };
    const getWindows = vi.fn().mockReturnValue([existingWin]);

    const res = handleActivate({
      getWindows,
      createWindow,
      getMainWindow: () => existingWin,
    });
    expect(createWindow).not.toHaveBeenCalled();
    expect(existingWin.isMinimized).toHaveBeenCalled();
    expect(existingWin.restore).toHaveBeenCalledOnce();
    expect(existingWin.focus).toHaveBeenCalledOnce();
    expect(res).toBe(existingWin);
  });
});
