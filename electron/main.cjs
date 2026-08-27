const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const isDev = process.env.NODE_ENV === 'development';

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

function createWindow() {
    // 创建浏览器窗口
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
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
        mainWindow.show();
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

// 设置应用菜单
app.whenReady().then(() => {
    const template = [
        {
            label: '文件',
            submenu: [
                {
                    label: '新建',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        // 这里可以添加新建功能
                    }
                },
                {
                    label: '打开',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => {
                        // 这里可以添加打开功能
                    }
                },
                { type: 'separator' },
                {
                    label: '退出',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: '编辑',
            submenu: [
                { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
                { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
                { type: 'separator' },
                { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
                { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
                { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' }
            ]
        },
        {
            label: '视图',
            submenu: [
                { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
                { label: '强制重新加载', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
                { label: '开发者工具', accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', role: 'toggleDevTools' },
                { type: 'separator' },
                { label: '实际大小', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
                { label: '放大', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
                { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
                { type: 'separator' },
                { label: '全屏', accelerator: process.platform === 'darwin' ? 'Ctrl+Cmd+F' : 'F11', role: 'togglefullscreen' }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
});
