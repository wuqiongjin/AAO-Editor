// 装配根：只负责 require 域模块、构造 deps、调 15 个 register*Ipc 入口、编排 app 生命周期。
// 域内 module 不自行取跨域依赖；preload.js 与资源路径按文件名在这里解析后注入。
const { app, BrowserWindow, Menu, ipcMain, dialog, nativeTheme, net, protocol, nativeImage, shell, safeStorage } = require('electron');
const path = require('path');
const os = require('os');
const { autoUpdater } = require('electron-updater');
const isDev = process.env.NODE_ENV === 'development';
const {
    loadDataRootSync,
    cacheDir,
    projectsDir,
    removeLegacyDownloads,
    registerDataRootIpc,
} = require('./storage/dataRoot.cjs');
const {
    setAppLog,
    registerProjectStoreIpc,
} = require('./storage/projectStore.cjs');
const {
    setAppLog: setPatternLibraryAppLog,
    registerPatternLibraryIpc,
} = require('./storage/patternLibrary.cjs');
const { registerChartCodeExportIpc } = require('./storage/chartCodeExport.cjs');
const { loadUpdateSourceSync, loadReadyVersionSync, patchAppStateSync } = require('./storage/appState.cjs');
const {
    createCommunityGateway,
    registerCommunityNetIpc,
} = require('./community/communityNet.cjs');
const { registerExternalLinkIpc } = require('./community/externalLink.cjs');
const {
    sessionFilePath,
    createSessionStore,
    registerCommunitySessionIpc,
} = require('./community/communitySession.cjs');
const {
    createAssetCache,
    registerAssetCacheIpc,
} = require('./assets/assetCache.cjs');
const {
    registerAssetSchemePrivileges,
    registerAssetProtocol,
} = require('./assets/assetProtocol.cjs');
const { createThumbMaker } = require('./assets/assetThumbnails.cjs');
const { registerBackgroundSkinIpc } = require('./assets/backgroundSkin.cjs');
const { registerPreviewIpc } = require('./assets/previewExport.cjs');
const { t, registerI18nIpc } = require('./foundation/i18n.cjs');
const { createAppLog, registerAppLogIpc } = require('./diagnostics/appLog.cjs');
const { registerDiagnosticsExportIpc } = require('./diagnostics/diagnosticsExport.cjs');
const { createAppUpdater, registerAppUpdateIpc } = require('./update/appUpdate.cjs');
const {
    getCurrentAppTheme,
    syncAllWindowsChrome,
    registerWindowChromeIpc,
} = require('./window/windowChrome.cjs');
const { createWindowFactory } = require('./window/createWindow.cjs');
const { setupApplicationMenu } = require('./window/applicationMenu.cjs');
const { handleWindowAllClosed, handleActivate } = require('./window/lifecycle.cjs');

function userDataDir() {
    return app.getPath('userData');
}

function currentDataRoot() {
    return loadDataRootSync(userDataDir());
}

/** 另存对话框共用的 electron 依赖（foundation/saveDialog.cjs 不自行 require('electron')）。 */
const saveDialogDeps = { BrowserWindow, dialog, t };

/** OS chrome 只需要这两个 electron 对象；窗口创建另取一份更宽的 deps。 */
const chromeDeps = { BrowserWindow, nativeTheme };

/** 窗体的全部外部依赖：状态、资源路径、electron 对象都在这里注入。 */
const windowDeps = {
    ...chromeDeps,
    app,
    isDev,
    publicDir: path.join(__dirname, '../public'),
    distDir: path.join(__dirname, '../dist'),
    indexHtml: path.join(__dirname, '../dist/index.html'),
    preload: path.join(__dirname, 'preload.js'),
    getCurrentAppTheme,
};

// ---------------------------------------------------------------------------
// 1. 日志 / 诊断（ADR-0019 / 票 01 / 票 04）：userData/logs/，不跟数据根走。
// ---------------------------------------------------------------------------
const appLog = createAppLog({ userData: () => userDataDir() });
registerAppLogIpc(ipcMain, appLog);
setAppLog(appLog);
setPatternLibraryAppLog(appLog);
registerDiagnosticsExportIpc(ipcMain, {
    logsDir: () => path.join(userDataDir(), 'logs'),
    dataRoot: () => currentDataRoot(),
    versions: () => ({
        app: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        os: `${process.platform} ${os.release()}`,
    }),
    fromWebContents: (sender) => BrowserWindow.fromWebContents(sender),
    showSaveDialog: (win, opts) => dialog.showSaveDialog(win ?? undefined, opts),
    t,
});

// ---------------------------------------------------------------------------
// 2. 工程 / 数据根 / 皮肤 / 片段库 / 另存（ADR-0015 / issue 117 / 118 / 184 / 187）。
// 数据根每次现取 —— 用户可以运行时搬家；对话框每次弹、不记路径。
// ---------------------------------------------------------------------------
registerProjectStoreIpc(ipcMain, { currentDataRoot });
registerDataRootIpc(ipcMain, { currentDataRoot, userDataDir, shell, dialog, BrowserWindow, t });
registerBackgroundSkinIpc(ipcMain, { currentDataRoot });
registerPatternLibraryIpc(ipcMain, { ...saveDialogDeps, currentDataRoot });
registerChartCodeExportIpc(ipcMain, saveDialogDeps);
registerPreviewIpc(ipcMain, saveDialogDeps);

// ---------------------------------------------------------------------------
// 3. 窗体 OS chrome 与语言（issue 126 / 128）：主题状态留在 window/windowChrome.cjs。
// ---------------------------------------------------------------------------
registerWindowChromeIpc(ipcMain, chromeDeps);
registerI18nIpc(ipcMain);

// ---------------------------------------------------------------------------
// 4. 站外链接（票 39 Q47）：校验与 handler 都在 externalLink.cjs，这里只接线。
// ---------------------------------------------------------------------------
registerExternalLinkIpc(ipcMain, shell);

// ---------------------------------------------------------------------------
// 5. 社区平台网络面（07 + 14 / ADR-0011 §2）：主进程只发 HTTP / 管 Cookie / 限流 /
// 素材缓存，端点与领域转换都在 renderer。缓存目录每次现取，不跟设置走。
// ---------------------------------------------------------------------------
const makeThumb = createThumbMaker(nativeImage);
const assetCache = createAssetCache({
    dir: () => cacheDir(currentDataRoot()),
    makeThumb,
});
const communityGateway = createCommunityGateway({
    // 只能在 app ready 之后调用；这里只是包一层，加载期不发任何请求。
    fetchImpl: (url, init) => net.fetch(url, init),
    // 发布（票 11）：multipart 上传只准读工程目录里的文件（音频 / 封面）。
    uploadRoots: () => [projectsDir(currentDataRoot())],
    assetCache,
});
registerCommunityNetIpc(ipcMain, communityGateway);
registerAssetCacheIpc(ipcMain, assetCache);

// 会话 Cookie 的加密持久化（票 10）：落到 userData 下，不跟数据根走。
// safeStorage 只在 app ready 之后可用，store 只记「怎么取路径」，加解密都在请求时现做。
const communitySessionStore = createSessionStore({
    safeStorage,
    filePath: () => sessionFilePath(userDataDir()),
});
registerCommunitySessionIpc(ipcMain, { gateway: communityGateway, store: communitySessionStore });

// ---------------------------------------------------------------------------
// 6. 应用更新（票 09）：更新源与就绪版本读写 app-state.json。
// ---------------------------------------------------------------------------
registerAppUpdateIpc(ipcMain, createAppUpdater({
    isPackaged: () => app.isPackaged,
    getVersion: () => app.getVersion(),
    autoUpdater,
    getUpdateSource: () => loadUpdateSourceSync(userDataDir()),
    setUpdateSource: (source) => patchAppStateSync(userDataDir(), { updateSource: source }),
    getReadyVersion: () => loadReadyVersionSync(userDataDir()),
    setReadyVersion: (version) => patchAppStateSync(userDataDir(), { readyVersion: version }),
    send: (channel, payload) => {
        for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(channel, payload);
        }
    },
}));

const { createWindow, getMainWindow } = createWindowFactory(windowDeps);

// 本机素材协议（票 15）：scheme 特权必须在 app ready **之前**登记（Electron 的硬要求），
// 处理器本身在 ready 之后挂（见下）。
registerAssetSchemePrivileges(protocol);

app.whenReady().then(() => {
    setupApplicationMenu(process.platform, app.name, Menu);
    // 只读协议：媒体标签按 URL 读素材缓存里的缩略图（不联网；缺图回 404，界面自己降级）
    registerAssetProtocol(protocol, assetCache);
    // 素材缓存（票 14）：启动扫一遍（30 天未用 / 1GB 上限 / 崩溃残留的半截文件）。
    // 清不掉（权限 / 占用）不影响功能 —— 下次写缓存会自己补目录，所以这里吞掉。
    void assetCache.sweep().catch(() => {});
    // 07 的下载暂存退役（票 14）：旧数据根里若还留着 downloads/，顺手清掉。
    void removeLegacyDownloads(currentDataRoot());
    nativeTheme.on('updated', () => {
        if (getCurrentAppTheme() === 'system') {
            syncAllWindowsChrome(chromeDeps);
        }
    });
    createWindow();

    // macOS 上点击 dock 图标且没有其他窗口打开时，重新创建一个窗口
    app.on('activate', () => {
        handleActivate({
            getWindows: () => BrowserWindow.getAllWindows(),
            createWindow,
            getMainWindow,
        });
    });
});

app.on('window-all-closed', () => {
    handleWindowAllClosed(process.platform, app);
});
