/**
 * 应用更新（ADR-0021）：已安装的正式产品向 GitHub Releases 检查、下载，下完请用户重启。
 * 未打包不调 updater。主进程只接线；渲染进程决定何时 check（自动检查偏好在设置对象里）。
 */

const EVENT = 'appUpdate:event';

function stripNotes(raw) {
    if (typeof raw === 'string') return raw.replace(/<[^>]+>/g, '').trim();
    if (Array.isArray(raw)) {
        return raw
            .map((item) => (item && typeof item.note === 'string' ? stripNotes(item.note) : ''))
            .filter(Boolean)
            .join('\n\n');
    }
    return '';
}

function createAppUpdater(deps) {
    const { isPackaged, getVersion, autoUpdater, send } = deps;
    let status = 'idle';
    let percent = 0;
    let availableVersion = '';
    let releaseNotes = '';
    let errorMessage = '';
    let checking = false;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;

    function snapshot() {
        return {
            packaged: isPackaged(),
            currentVersion: getVersion(),
            status,
            percent,
            availableVersion: availableVersion || undefined,
            releaseNotes: releaseNotes || undefined,
            errorMessage: errorMessage || undefined,
        };
    }

    function emit() {
        send(EVENT, snapshot());
    }

    autoUpdater.on('checking-for-update', () => {
        status = 'checking';
        errorMessage = '';
        emit();
    });
    autoUpdater.on('update-available', (info) => {
        status = 'downloading';
        percent = 0;
        availableVersion = info && typeof info.version === 'string' ? info.version : '';
        releaseNotes = stripNotes(info && info.releaseNotes);
        emit();
    });
    autoUpdater.on('update-not-available', () => {
        checking = false;
        status = 'current';
        percent = 0;
        availableVersion = '';
        releaseNotes = '';
        emit();
    });
    autoUpdater.on('download-progress', (progress) => {
        status = 'downloading';
        const p = progress && typeof progress.percent === 'number' ? progress.percent : 0;
        percent = Math.max(0, Math.min(100, p));
        emit();
    });
    autoUpdater.on('update-downloaded', (info) => {
        checking = false;
        status = 'ready';
        percent = 100;
        if (info && typeof info.version === 'string') availableVersion = info.version;
        const notes = stripNotes(info && info.releaseNotes);
        if (notes) releaseNotes = notes;
        emit();
    });
    autoUpdater.on('error', (err) => {
        checking = false;
        status = 'error';
        errorMessage = err && err.message ? String(err.message) : 'update failed';
        emit();
    });

    return {
        getState() {
            return snapshot();
        },
        async check() {
            if (!isPackaged()) {
                status = 'idle';
                errorMessage = '';
                return snapshot();
            }
            if (checking || status === 'downloading') return snapshot();
            checking = true;
            try {
                await autoUpdater.checkForUpdates();
            } catch (err) {
                checking = false;
                status = 'error';
                errorMessage = err && err.message ? String(err.message) : 'update failed';
                emit();
            }
            return snapshot();
        },
        install() {
            if (!isPackaged() || status !== 'ready') return snapshot();
            autoUpdater.quitAndInstall(false, true);
            return snapshot();
        },
    };
}

function registerAppUpdateIpc(ipcMain, updater) {
    ipcMain.handle('appUpdate:getState', () => updater.getState());
    ipcMain.handle('appUpdate:check', () => updater.check());
    ipcMain.handle('appUpdate:install', () => updater.install());
}

module.exports = { EVENT, stripNotes, createAppUpdater, registerAppUpdateIpc };
