const { app, BrowserWindow, Menu, ipcMain, dialog, nativeTheme, net, protocol, nativeImage, shell } = require('electron');
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
    cacheDir,
    removeLegacyDownloads,
} = require('./dataRoot.cjs');
const {
    createCommunityGateway,
    registerCommunityNetIpc,
} = require('./communityNet.cjs');
const {
    createAssetCache,
    registerAssetCacheIpc,
} = require('./assetCache.cjs');
const {
    registerAssetSchemePrivileges,
    registerAssetProtocol,
} = require('./assetProtocol.cjs');
const { createThumbMaker } = require('./assetThumbnails.cjs');
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

    ipcMain.handle('dataRoot:open', async () => {
        const root = currentDataRoot();
        try {
            const errMsg = await shell.openPath(root);
            if (errMsg) {
                return { ok: false, message: errMsg, path: root };
            }
            return { ok: true, path: root };
        } catch (err) {
            return { ok: false, message: err?.message || String(err), path: root };
        }
    });

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
/** mime → [对话框过滤器名, 扩展名]；当下唯一生产者是宽图 PNG（07 加视频时在这里补一行） */
function binaryFilter(mime) {
    if (mime === 'image/webp') return { label: 'WebP', ext: 'webp' };
    return { label: 'PNG', ext: 'png' };
}

function registerPreviewIpc() {
    ipcMain.handle('preview:saveBinary', async (event, payload) => {
        const bytes = payload && payload.bytes;
        if (!(bytes instanceof Uint8Array)) {
            throw new Error('preview:saveBinary 需要字节');
        }
        const { label, ext } = binaryFilter(payload && payload.mime);
        const rawName = payload && payload.suggestedName;
        const suggestedName =
            typeof rawName === 'string' && rawName.length > 0
                ? path.basename(rawName)
                : `export.${ext}`;
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showSaveDialog(win ?? undefined, {
            title: t('electron.exportSheet'),
            defaultPath: suggestedName,
            filters: [{ name: label, extensions: [ext] }],
        });
        if (result.canceled || !result.filePath) {
            return { cancelled: true };
        }
        // 成图可能上百 MB（30 分钟谱的宽图）：整块写完，不做流式（07 要流式时再说）
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
// 社区平台网络面（bestdori-integration 07 + 14）：主进程只做发 HTTP / 管 Cookie / 限流 /
// 素材缓存（ADR-0011 §2、issue 06 薄主进程）。端点、领域转换、搜索都在 renderer；
// 二进制落 <数据根>/cache/community/（素材缓存，跨启动复用）后只回路径。
// 缓存目录每次现取 —— 数据根可以被用户搬家。
// 缩略图（票 15）：图片进缓存时顺手产 96×96（nativeImage 由这里注入，见 assetThumbnails.cjs）。
// ---------------------------------------------------------------------------
const makeThumb = createThumbMaker(nativeImage);
const assetCache = createAssetCache({
    dir: () => cacheDir(currentDataRoot()),
    makeThumb,
});
const communityGateway = createCommunityGateway({
    // net.fetch 只能在 app ready 之后调用；这里只是包一层，加载期不发任何请求。
    fetchImpl: (url, init) => net.fetch(url, init),
    assetCache,
});
registerCommunityNetIpc(ipcMain, communityGateway);
registerAssetCacheIpc(ipcMain, assetCache);

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

// 本机素材协议（票 15）：scheme 特权必须在 app ready **之前**登记（Electron 的硬要求），
// 处理器本身在 ready 之后挂（见下）。渲染侧用它的 URL 形参见 src/community/assetUrls.ts。
registerAssetSchemePrivileges(protocol);

// 当Electron完成初始化并准备创建浏览器窗口时调用此方法
app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    // 只读协议：媒体标签按 URL 读素材缓存里的缩略图（不联网；缺图回 404，界面自己降级）
    registerAssetProtocol(protocol, assetCache);
    // 素材缓存（票 14）：启动扫一遍（30 天未用 / 1GB 上限 / 崩溃残留的半截文件）。
    // 清不掉（权限 / 占用）不影响功能 —— 下次写缓存会自己补目录，所以这里吞掉。
    void assetCache.sweep().catch(() => {});
    // 07 的下载暂存退役（票 14）：旧数据根里若还留着 downloads/，顺手清掉。
    void removeLegacyDownloads(currentDataRoot());
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
