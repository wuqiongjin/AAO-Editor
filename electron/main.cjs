const { app, BrowserWindow, Menu, ipcMain, dialog, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const isDev = process.env.NODE_ENV === 'development';
const {
    MIN_WINDOW_WIDTH,
    MIN_WINDOW_HEIGHT,
    loadWindowStateSync,
    saveWindowStateSync,
    snapshotFromBrowserWindow,
    browserWindowCreateOptions,
} = require('./windowState.cjs');
const {
    normalizeAppTheme,
    resolvedAppearance,
    chromeBackgroundFor,
    applyNativeThemeSource,
    applyBrowserWindowChrome,
    attachWin32CaptionHoverMitigation,
} = require('./windowChrome.cjs');
const {
    claimDataRoot,
    loadDataRootSync,
    moveDataRoot,
    backgroundSkinPath,
} = require('./dataRoot.cjs');
const {
    getProject,
    putProject,
    listProjects,
    deleteProject,
} = require('./projectStore.cjs');
const { t, setActiveUiLanguage } = require('./i18n.cjs');

// ---------------------------------------------------------------------------
// 谱面工程文件后端（ADR-0015）：<数据根>/projects/<id>/{project.json, audio.bin, cover.bin}
// 默认数据根 = userData/data；当前根记在 userData/app-state.json。
// 旧「一份 notes」工程不读、不删。封面/音频与 JSON 分离，仅 intent=set 时重写字节。
// ---------------------------------------------------------------------------

function userDataDir() {
    return app.getPath('userData');
}

function currentDataRoot() {
    return loadDataRootSync(userDataDir());
}

async function writeFileAtomic(filePath, data) {
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(tmpPath, data);
    await fs.promises.rename(tmpPath, filePath);
}

function registerProjectStoreIpc() {
    ipcMain.handle('project:get', (_event, rawId) => getProject(currentDataRoot(), rawId));
    ipcMain.handle('project:put', (_event, payload) => putProject(currentDataRoot(), payload));
    ipcMain.handle('project:list', () => listProjects(currentDataRoot()));
    ipcMain.handle('project:delete', (_event, rawId) => deleteProject(currentDataRoot(), rawId));
}
registerProjectStoreIpc();

// ---------------------------------------------------------------------------
// 数据根（issue 117）：只读当前路径；搬家与认领分开，失败不切根。
// ---------------------------------------------------------------------------
function registerDataRootIpc() {
    ipcMain.handle('dataRoot:get', async () => ({ path: currentDataRoot() }));

    ipcMain.handle('dataRoot:change', async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showOpenDialog(win ?? undefined, {
            title: t('electron.changeDataRoot'),
            properties: ['openDirectory', 'createDirectory'],
        });
        if (result.canceled || !result.filePaths || !result.filePaths[0]) {
            return { ok: true, cancelled: true, path: currentDataRoot() };
        }
        const moved = await moveDataRoot({
            userData: userDataDir(),
            fromRoot: currentDataRoot(),
            toRoot: result.filePaths[0],
        });
        if (!moved.ok) {
            return {
                ok: false,
                cancelled: false,
                path: currentDataRoot(),
                message: moved.message || t('electron.moveFail'),
            };
        }
        return { ok: true, cancelled: false, path: currentDataRoot() };
    });

    ipcMain.handle('dataRoot:claim', async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showOpenDialog(win ?? undefined, {
            title: t('electron.claimDataRoot'),
            properties: ['openDirectory', 'createDirectory'],
        });
        if (result.canceled || !result.filePaths || !result.filePaths[0]) {
            return { ok: true, cancelled: true, path: currentDataRoot() };
        }
        const claimed = await claimDataRoot({
            userData: userDataDir(),
            toRoot: result.filePaths[0],
        });
        if (!claimed.ok) {
            return {
                ok: false,
                cancelled: false,
                path: currentDataRoot(),
                message: claimed.message || t('electron.claimFail'),
            };
        }
        return { ok: true, cancelled: false, path: currentDataRoot() };
    });
}
registerDataRootIpc();

// ---------------------------------------------------------------------------
// 背景皮肤文件（issue 117）：<数据根>/assets/background-skin.bin
// ---------------------------------------------------------------------------
function registerBackgroundSkinIpc() {
    ipcMain.handle('backgroundSkin:get', async () => {
        try {
            return await fs.promises.readFile(backgroundSkinPath(currentDataRoot()));
        } catch {
            return null;
        }
    });

    ipcMain.handle('backgroundSkin:put', async (_event, bytes) => {
        if (!(bytes instanceof Uint8Array)) {
            throw new Error('backgroundSkin:put 需要字节');
        }
        const filePath = backgroundSkinPath(currentDataRoot());
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await writeFileAtomic(filePath, Buffer.from(bytes));
        return true;
    });

    ipcMain.handle('backgroundSkin:clear', async () => {
        await fs.promises.rm(backgroundSkinPath(currentDataRoot()), { force: true });
        return true;
    });
}
registerBackgroundSkinIpc();

// ---------------------------------------------------------------------------
// 谱面代码另存为（issue 118）：每次 dialog，不记路径。
// defaultPath 只用 basename，渲染侧即使传入带目录的 suggestedName 也无法写进记忆。
// ---------------------------------------------------------------------------
function registerChartCodeExportIpc() {
    ipcMain.handle('chartCode:saveAs', async (event, payload) => {
        const json = payload && payload.json;
        if (typeof json !== 'string') {
            throw new Error('chartCode:saveAs 需要 json 字符串');
        }
        const rawName = payload && payload.suggestedName;
        const suggestedName =
            typeof rawName === 'string' && rawName.length > 0
                ? path.basename(rawName)
                : 'chart.json';
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showSaveDialog(win ?? undefined, {
            title: t('electron.exportChart'),
            defaultPath: suggestedName,
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (result.canceled || !result.filePath) {
            return { cancelled: true };
        }
        await fs.promises.writeFile(result.filePath, json, 'utf8');
        return { cancelled: false };
    });
}
registerChartCodeExportIpc();

// ---------------------------------------------------------------------------
// 二进制另存（chart-preview 03）：宽图 PNG（07 的视频导出复用同一通道）。
// 收 { bytes: Uint8Array, suggestedName, mime }；每次 dialog、不记路径；
// defaultPath 只用 basename（渲染侧即使传带目录的名字也写不进记忆）。
// ---------------------------------------------------------------------------
/** mime → [对话框过滤器名, 扩展名]；生产者 = 宽图 PNG（03）与视频导出（07） */
function binaryFilter(mime) {
    if (mime === 'image/webp') return { label: 'WebP', ext: 'webp' };
    if (mime === 'video/mp4') return { label: 'MP4', ext: 'mp4' };
    if (mime === 'video/webm') return { label: 'WebM', ext: 'webm' };
    return { label: 'PNG', ext: 'png' };
}

/** mime → 对话框标题的 i18n key（宽图 = 谱面图，视频 = 回放视频） */
function binaryDialogTitleKey(mime) {
    return mime === 'video/mp4' || mime === 'video/webm' ? 'electron.exportVideo' : 'electron.exportSheet';
}

function registerPreviewIpc() {
    ipcMain.handle('preview:saveBinary', async (event, payload) => {
        const bytes = payload && payload.bytes;
        if (!(bytes instanceof Uint8Array)) {
            throw new Error('preview:saveBinary 需要字节');
        }
        const mime = payload && payload.mime;
        const { label, ext } = binaryFilter(mime);
        const rawName = payload && payload.suggestedName;
        const suggestedName =
            typeof rawName === 'string' && rawName.length > 0
                ? path.basename(rawName)
                : `export.${ext}`;
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showSaveDialog(win ?? undefined, {
            title: t(binaryDialogTitleKey(mime)),
            defaultPath: suggestedName,
            filters: [{ name: label, extensions: [ext] }],
        });
        if (result.canceled || !result.filePath) {
            return { cancelled: true };
        }
        // 整块写完，不做流式：宽图上百 MB（30 分钟谱）、视频几十 MB~数百 MB 都走同一条路。
        // 07 落地时按票面「若需分块 / 流式，同票扩展」评估过：先跑通整块，真机遇到大文件再动这里
        await fs.promises.writeFile(result.filePath, Buffer.from(bytes));
        return { cancelled: false };
    });
}
registerPreviewIpc();

// ---------------------------------------------------------------------------
// 窗体 OS chrome 与 settings.theme（issue 126）：nativeTheme + backgroundColor；
// 渲染进程经 windowChrome:sync 推送 light/dark/system。
// ---------------------------------------------------------------------------

/** @type {'light' | 'dark' | 'system'} */
let currentAppTheme = 'system';

function syncAllWindowsChrome() {
    applyNativeThemeSource(currentAppTheme, nativeTheme);
    for (const win of BrowserWindow.getAllWindows()) {
        applyBrowserWindowChrome(win, currentAppTheme, nativeTheme);
    }
}

function registerWindowChromeIpc() {
    ipcMain.handle('windowChrome:sync', async (_event, payload) => {
        currentAppTheme = normalizeAppTheme(payload && payload.theme);
        syncAllWindowsChrome();
        return true;
    });
}
registerWindowChromeIpc();

function registerI18nIpc() {
    ipcMain.handle('i18n:setLanguage', async (_event, locale) => {
        setActiveUiLanguage(locale);
        return true;
    });
}
registerI18nIpc();

// ---------------------------------------------------------------------------
// 主窗体几何记忆（issue 119 / 117）：userData/app-state.json 的 window 字段。
// 不进 settings / 导出配置；不记位置（多屏）。
// ---------------------------------------------------------------------------

function resolveAppIcon() {
    const filename = process.platform === 'win32' ? 'favicon.ico' : 'icon.png';
    const candidateDirs = isDev
        ? [path.join(__dirname, '../public'), path.join(__dirname, '../dist')]
        : [path.join(__dirname, '../dist'), path.join(__dirname, '../public')];
    for (const dir of candidateDirs) {
        const full = path.join(dir, filename);
        if (fs.existsSync(full)) return full;
    }
    return undefined;
}

function createWindow() {
    const minWidth = MIN_WINDOW_WIDTH;
    const minHeight = MIN_WINDOW_HEIGHT;
    const saved = loadWindowStateSync(app.getPath('userData'));
    const { width, height } = browserWindowCreateOptions(saved, { minWidth, minHeight });
    const initialAppearance = resolvedAppearance(currentAppTheme, nativeTheme.shouldUseDarkColors);
    const appIcon = resolveAppIcon();

    // 创建浏览器窗口
    const mainWindow = new BrowserWindow({
        title: 'AAO Editor',
        width,
        height,
        minWidth,
        minHeight,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: appIcon, // 应用图标
        titleBarStyle: 'default',
        backgroundColor: chromeBackgroundFor(initialAppearance),
        show: false // 先不显示，等加载完成后再显示
    });

    attachWin32CaptionHoverMitigation(mainWindow, () =>
        chromeBackgroundFor(resolvedAppearance(currentAppTheme, nativeTheme.shouldUseDarkColors)),
    );
    applyBrowserWindowChrome(mainWindow, currentAppTheme, nativeTheme);

    // 加载应用
    if (isDev) {
        // 开发环境：连接到Vite开发服务器
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        // 生产环境：加载构建后的文件
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // 窗口准备好后显示
    mainWindow.once('ready-to-show', () => {
        if (saved.isMaximized) {
            mainWindow.maximize();
        }
        mainWindow.show();
    });

    mainWindow.on('close', () => {
        saveWindowStateSync(app.getPath('userData'), snapshotFromBrowserWindow(mainWindow));
    });

    // 当窗口被关闭时
    mainWindow.on('closed', () => {
        // 在macOS上，应用通常会保持活跃状态，直到用户使用Cmd + Q明确退出
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    return mainWindow;
}

// 当Electron完成初始化并准备创建浏览器窗口时调用此方法
app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    nativeTheme.on('updated', () => {
        if (currentAppTheme === 'system') {
            syncAllWindowsChrome();
        }
    });
    createWindow();

    // 在macOS上，当点击dock图标并且没有其他窗口打开时，
    // 通常在应用程序中重新创建一个窗口
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// 当所有窗口都被关闭时退出应用
app.on('window-all-closed', () => {
    // 在macOS上，除非用户用Cmd + Q确定地退出，
    // 否则绝大部分应用及其菜单栏会保持激活
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
