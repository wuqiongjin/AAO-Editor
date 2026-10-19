import { describe, expect, it } from 'vitest';
import { createAppUpdater, registerAppUpdateIpc, stripNotes } from '@/electron/appUpdate.cjs';
import { APP_VERSION } from '@/src/app/appVersion';
import { readSource, readStripped } from '@/tests/support/source';

function fakeIpcMain() {
  const handlers = new Map<string, () => unknown>();
  return {
    handlers,
    ipcMain: {
      handle: (channel: string, listener: () => unknown) => {
        handlers.set(channel, listener);
      },
    },
  };
}

function fakeAutoUpdater() {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    checkCalls: 0,
    installCalls: 0,
    on(ev: string, fn: (...args: unknown[]) => void) {
      (handlers[ev] ??= []).push(fn);
    },
    emit(ev: string, ...args: unknown[]) {
      (handlers[ev] ?? []).forEach((fn) => fn(...args));
    },
    async checkForUpdates() {
      this.checkCalls += 1;
      this.emit('checking-for-update');
    },
    quitAndInstall() {
      this.installCalls += 1;
    },
  };
}

describe('ADR-0021 · 主进程应用更新', () => {
  it('stripNotes 去掉 HTML', () => {
    expect(stripNotes('<p>hello</p>')).toBe('hello');
    expect(stripNotes([{ note: '<b>a</b>' }, { note: 'b' }])).toBe('a\n\nb');
  });

  it('未打包：check 不调 updater', async () => {
    const updater = fakeAutoUpdater();
    const sent: unknown[] = [];
    const api = createAppUpdater({
      isPackaged: () => false,
      getVersion: () => '0.1.0',
      autoUpdater: updater,
      send: (_ch: string, payload: unknown) => sent.push(payload),
    });
    const snap = await api.check();
    expect(updater.checkCalls).toBe(0);
    expect(snap.packaged).toBe(false);
    expect(snap.status).toBe('idle');
  });

  it('已打包：check 后 downloaded → ready；install 调 quitAndInstall', async () => {
    const updater = fakeAutoUpdater();
    const api = createAppUpdater({
      isPackaged: () => true,
      getVersion: () => '0.1.0',
      autoUpdater: updater,
      send: () => {},
    });
    await api.check();
    expect(updater.checkCalls).toBe(1);
    updater.emit('update-downloaded', { version: '0.2.0', releaseNotes: 'notes' });
    expect(api.getState().status).toBe('ready');
    expect(api.getState().availableVersion).toBe('0.2.0');
    api.install();
    expect(updater.installCalls).toBe(1);
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowPrerelease).toBe(false);
  });

  it('IPC 接线与 GitHub 源、版本号锁在一起', () => {
    const { handlers, ipcMain } = fakeIpcMain();
    const updater = fakeAutoUpdater();
    const api = createAppUpdater({
      isPackaged: () => true,
      getVersion: () => '0.1.0',
      autoUpdater: updater,
      send: () => {},
    });
    registerAppUpdateIpc(ipcMain, api);
    expect(handlers.has('appUpdate:getState')).toBe(true);
    expect(handlers.has('appUpdate:check')).toBe(true);
    expect(handlers.has('appUpdate:install')).toBe(true);

    const mainSrc = readStripped('electron/main.cjs');
    expect(mainSrc).toMatch(/registerAppUpdateIpc/);
    expect(mainSrc).toMatch(/electron-updater/);

    const preload = readStripped('electron/preload.js');
    expect(preload).toMatch(/appUpdate:/);
    expect(preload).toMatch(/appUpdate:event/);

    const pkg = JSON.parse(readSource('package.json')) as {
      version: string;
      dependencies: Record<string, string>;
      build: { publish: { owner: string; repo: string; provider: string }; files: string[] };
    };
    expect(pkg.version).toBe(APP_VERSION);
    expect(pkg.dependencies['electron-updater']).toBeTruthy();
    expect(pkg.build.publish).toEqual({
      provider: 'github',
      owner: 'wuqiongjin',
      repo: 'AAO-Editor',
    });
    expect(pkg.build.files.some((f) => f.includes('electron-updater'))).toBe(true);

    const renderer = readStripped('src/app/appUpdate.ts');
    expect(renderer).not.toMatch(/from ['"]electron-updater['"]/);
  });
});
