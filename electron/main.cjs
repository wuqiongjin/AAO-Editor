const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
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

// ---------------------------------------------------------------------------
// 谱面工程文件后端（issue 25）：userData/projects/<id>/{project.json, audio.bin}
// 设计要点：
// - project.json 与 audio.bin 分离：音频仅在字节变化时写入（audioIntent='set'），
//   防抖保存（~800ms/次）不会反复重写大音频；
// - 写入一律「临时文件 + rename」原子替换，进程中断不留半截 JSON；
// - 工程目录名经严格白名单校验，杜绝路径穿越。
// ---------------------------------------------------------------------------

/** 工程存储根目录：<userData>/projects */
function projectsRootDir() {
    return path.join(app.getPath('userData'), 'projects');
}

/** 工程 id 白名单校验：字母开头，仅字母数字 . _ -，≤64 位；非法即抛错 */
function safeProjectId(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
        throw new Error(`非法的谱面工程 id: ${JSON.stringify(id)}`);
    }
    return id;
}

function projectDir(id) {
    return path.join(projectsRootDir(), safeProjectId(id));
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
            title: '导出谱面代码',
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
// 主窗体几何记忆（issue 119）：userData/window-state.json，仅宽高 + 是否最大化。
// 不进 settings / 导出配置；不记位置（多屏）。
// ---------------------------------------------------------------------------

function createWindow() {
    const minWidth = MIN_WINDOW_WIDTH;
    const minHeight = MIN_WINDOW_HEIGHT;
    const saved = loadWindowStateSync(app.getPath('userData'));
    const { width, height } = browserWindowCreateOptions(saved, { minWidth, minHeight });

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
        show: false // 先不显示，等加载完成后再显示
    });

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
