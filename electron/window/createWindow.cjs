// 主窗体创建（issue 119 / 117 / 126）：几何记忆在 userData/app-state.json，
// 不进 settings / 导出配置；不记位置（多屏）。
// 装配根注入全部资源路径与 electron 依赖，本 module 不碰 __dirname。
const fs = require('fs');
const path = require('path');
const {
    MIN_WINDOW_WIDTH,
    MIN_WINDOW_HEIGHT,
    loadWindowStateSync,
    saveWindowStateSync,
    snapshotFromBrowserWindow,
    browserWindowCreateOptions,
} = require('./windowState.cjs');
const {
    resolvedAppearance,
    chromeBackgroundFor,
    applyBrowserWindowChrome,
    attachWin32CaptionHoverMitigation,
} = require('./windowChrome.cjs');

/** 应用图标：dev 优先 public/，打包后优先 dist/。找不到就交给 Electron 默认。 */
function resolveAppIcon(deps) {
    const filename = process.platform === 'win32' ? 'favicon.ico' : 'icon.png';
    const candidateDirs = deps.isDev
        ? [deps.publicDir, deps.distDir]
        : [deps.distDir, deps.publicDir];
    for (const dir of candidateDirs) {
        const full = path.join(dir, filename);
        if (fs.existsSync(full)) return full;
    }
    return undefined;
}

/** @returns {{ createWindow: () => any, getMainWindow: () => any }} */
function createWindowFactory(deps) {
    let mainWindow = null;

    function createWindow() {
        const minWidth = MIN_WINDOW_WIDTH;
        const minHeight = MIN_WINDOW_HEIGHT;
        const saved = loadWindowStateSync(deps.app.getPath('userData'));
        const { width, height } = browserWindowCreateOptions(saved, { minWidth, minHeight });
        const initialAppearance = resolvedAppearance(
            deps.getCurrentAppTheme(), deps.nativeTheme.shouldUseDarkColors,
        );
        const appIcon = resolveAppIcon(deps);

        const win = new deps.BrowserWindow({
            title: 'AAO Editor',
            width,
            height,
            minWidth,
            minHeight,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                enableRemoteModule: false,
                backgroundThrottling: false,
                preload: deps.preload,
            },
            icon: appIcon,
            titleBarStyle: 'default',
            backgroundColor: chromeBackgroundFor(initialAppearance),
            show: false,
        });
        mainWindow = win;

        attachWin32CaptionHoverMitigation(win, () =>
            chromeBackgroundFor(resolvedAppearance(
                deps.getCurrentAppTheme(), deps.nativeTheme.shouldUseDarkColors,
            )),
        );
        applyBrowserWindowChrome(win, deps.getCurrentAppTheme(), deps.nativeTheme);

        if (deps.isDev) {
            win.loadURL('http://localhost:5173');
            win.webContents.openDevTools();
        } else {
            win.loadFile(deps.indexHtml);
        }

        win.once('ready-to-show', () => {
            if (saved.isMaximized) {
                win.maximize();
            }
            win.show();
        });

        win.on('close', () => {
            saveWindowStateSync(deps.app.getPath('userData'), snapshotFromBrowserWindow(win));
        });

        win.on('closed', () => {
            if (mainWindow === win) {
                mainWindow = null;
            }
        });

        return win;
    }

    return { createWindow, getMainWindow: () => mainWindow };
}

module.exports = { createWindowFactory, resolveAppIcon };
