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
    projectDir: projectDirAtRoot,
    backgroundSkinPath,
} = require('./dataRoot.cjs');
const { t, setActiveUiLanguage } = require('./i18n.cjs');

// ---------------------------------------------------------------------------
// 谱面工程文件后端（issue 25 + 117）：<数据根>/projects/<id>/{project.json, audio.bin}
// 默认数据根 = userData/data；当前根记在 userData/app-state.json。
// 设计要点：
// - project.json 与 audio.bin 分离：音频仅在字节变化时写入（audioIntent='set'），
//   防抖保存（~800ms/次）不会反复重写大音频；
// - 写入一律「临时文件 + rename」原子替换，进程中断不留半截 JSON；
// - 工程目录名经严格白名单校验，杜绝路径穿越。
// ---------------------------------------------------------------------------

function userDataDir() {
    return app.getPath('userData');
}

function currentDataRoot() {
    return loadDataRootSync(userDataDir());
}

function projectDir(id) {
    return projectDirAtRoot(currentDataRoot(), id);
}

async function writeFileAtomic(filePath, data) {
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(tmpPath, data);
    await fs.promises.rename(tmpPath, filePath);
}

async function fileExists(filePath) {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function registerProjectStoreIpc() {
    ipcMain.handle('project:get', async (_event, rawId) => {
        const dir = projectDir(rawId);
        let raw;
        try {
            raw = await fs.promises.readFile(path.join(dir, 'project.json'), 'utf8');
        } catch {
            return null; // 无工程文件 = 尚无数据（含首启迁移前的状态）
        }
        let doc;
        try {
            doc = JSON.parse(raw);
        } catch (err) {
            console.warn('[project-store] project.json 解析失败，按空数据处理:', err);
            return null;
        }
        let audio = null;
        if (doc && doc.audioPresent) {
            try {
                // Buffer 结构化克隆到渲染侧为 Uint8Array，可直接包 Blob
                audio = await fs.promises.readFile(path.join(dir, 'audio.bin'));
            } catch (err) {
                console.warn('[project-store] audio.bin 缺失，按无音频返回:', err);
            }
        }
        return { doc, audio };
    });

    ipcMain.handle('project:put', async (_event, payload) => {
        const { id, doc, audio } = payload || {};
        const dir = projectDir(id);
        await fs.promises.mkdir(dir, { recursive: true });

        const audioBinPath = path.join(dir, 'audio.bin');
        if (doc.audioIntent === 'cleared') {
            await fs.promises.rm(audioBinPath, { force: true });
        } else if (doc.audioIntent === 'set') {
            if (!(audio instanceof Uint8Array)) {
                throw new Error('project:put audioIntent=set 但缺少音频字节');
            }
            // 不比较内容直接重写：'set' 只在音频真实变化（导入/迁移）时发生，频率极低
            await writeFileAtomic(audioBinPath, Buffer.from(audio));
        } // 'keep'：不动磁盘上的 audio.bin

        const { audioIntent: _intent, ...docRest } = doc;
        const durableDoc = {
            ...docRest,
            audioPresent:
                doc.audioIntent === 'set'
                    ? true
                    : doc.audioIntent === 'keep'
                      ? await fileExists(audioBinPath)
                      : false,
        };
        await writeFileAtomic(path.join(dir, 'project.json'), JSON.stringify(durableDoc));
        return true;
    });
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

function createWindow() {
    const minWidth = MIN_WINDOW_WIDTH;
    const minHeight = MIN_WINDOW_HEIGHT;
    const saved = loadWindowStateSync(app.getPath('userData'));
    const { width, height } = browserWindowCreateOptions(saved, { minWidth, minHeight });
    const initialAppearance = resolvedAppearance(currentAppTheme, nativeTheme.shouldUseDarkColors);

    // 创建浏览器窗口
    const mainWindow = new BrowserWindow({
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
        icon: path.join(__dirname, '../public/vite.svg'), // 应用图标
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
