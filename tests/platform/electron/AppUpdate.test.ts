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
    feedCalls: [] as unknown[],
    on(ev: string, fn: (...args: unknown[]) => void) {
      (handlers[ev] ??= []).push(fn);
    },
    emit(ev: string, ...args: unknown[]) {
      (handlers[ev] ?? []).forEach((fn) => fn(...args));
    },
    setFeedURL(opts: unknown) {
      this.feedCalls.push(opts);
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

function packagedUpdater(
  updater: ReturnType<typeof fakeAutoUpdater>,
  extras: Record<string, unknown> = {},
) {
  return createAppUpdater({
    isPackaged: () => true,
    getVersion: () => '0.1.0',
    autoUpdater: updater,
    send: () => {},
    getUpdateSource: () => 'github',
    setUpdateSource: () => {},
    ...extras,
  });
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
    expect(preload).toMatch(/setUpdateSource/);

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
    expect(handlers.has('appUpdate:setUpdateSource')).toBe(true);
  });

  it('CNB 先读公开 Release 列表再 setFeedURL 到真实 tag；GitHub 走 generic 不打 api.github.com', async () => {
    const updater = fakeAutoUpdater();
    let source: 'github' | 'cnb' = 'cnb';
    const api = packagedUpdater(updater, {
      getUpdateSource: () => source,
      setUpdateSource: (next: 'github' | 'cnb') => {
        source = next;
      },
      fetchCnbReleases: async () => [
        {
          tag_name: 'v0.1.0',
          draft: false,
          prerelease: false,
          is_latest: false,
          published_at: '2026-10-22T02:02:16Z',
        },
      ],
    });
    await api.check();
    expect(updater.feedCalls[0]).toEqual({
      provider: 'generic',
      url: 'https://cnb.cool/AsterPicker/AAO-Editor/-/releases/download/v0.1.0',
    });
    updater.emit('update-not-available');
    const switched = api.setUpdateSource('github');
    expect(switched.updateSource).toBe('github');
    await api.check();
    expect(updater.feedCalls.at(-1)).toEqual({
      provider: 'generic',
      url: 'https://github.com/wuqiongjin/AAO-Editor/releases/latest/download',
    });
  });

  it('未打包不调 updater、不 setFeedURL', async () => {
    const updater = fakeAutoUpdater();
    const api = createAppUpdater({
      isPackaged: () => false,
      getVersion: () => '0.1.0',
      autoUpdater: updater,
      send: () => {},
      getUpdateSource: () => 'cnb',
      setUpdateSource: () => {},
    });
    await api.check();
    expect(updater.checkCalls).toBe(0);
    expect(updater.feedCalls).toEqual([]);
  });

  it('下载中改源被拒；ready 时可改源且仍能 install', async () => {
    const updater = fakeAutoUpdater();
    let stored: 'github' | 'cnb' = 'github';
    const api = packagedUpdater(updater, {
      getUpdateSource: () => stored,
      setUpdateSource: (next: 'github' | 'cnb') => {
        stored = next;
      },
    });
    await api.check();
    updater.emit('update-available', { version: '0.2.0' });
    expect(api.getState().status).toBe('downloading');
    const denied = api.setUpdateSource('cnb');
    expect(denied.ok).toBe(false);
    expect(stored).toBe('github');
    expect(denied.updateSource).toBe('github');
    updater.emit('update-downloaded', { version: '0.2.0' });
    expect(api.getState().status).toBe('ready');
    const allowed = api.setUpdateSource('cnb');
    expect(allowed.ok).toBe(true);
    expect(stored).toBe('cnb');
    expect(api.getState().status).toBe('ready');
    api.install();
    expect(updater.installCalls).toBe(1);
  });

  it('失败后改源只记账、不立刻检查，清掉 error 以免再 toast', async () => {
    const updater = fakeAutoUpdater();
    let stored: 'github' | 'cnb' = 'github';
    const api = packagedUpdater(updater, {
      getUpdateSource: () => stored,
      setUpdateSource: (next: 'github' | 'cnb') => {
        stored = next;
      },
    });
    await api.check();
    updater.emit('error', new Error('net::ERR_FAILED'));
    expect(api.getState().status).toBe('error');
    const checks = updater.checkCalls;
    const switched = api.setUpdateSource('cnb');
    expect(switched.ok).toBe(true);
    expect(switched.updateSource).toBe('cnb');
    expect(switched.status).toBe('idle');
    expect(switched.errorMessage).toBeFalsy();
    expect(updater.checkCalls).toBe(checks);
  });
});
