/**
 * 应用更新（ADR-0021）：已安装的正式产品检查、下载，下完请用户重启。
 * 发版原址仍是 GitHub；运行时按本机 updateSource setFeedURL（两边都 generic，避开 api.github.com）。
 * 未打包不调 updater。主进程只接线；渲染进程决定何时 check（自动检查偏好在设置对象里）。
 */

const { normalizeUpdateSource } = require('./appState.cjs');
const {
    CNB_SLUG,
    cnbGenericFeedUrlForTag,
    cnbReleasesListUrl,
    pickLatestCnbReleaseTag,
} = require('./cnbFeed.cjs');

const EVENT = 'appUpdate:event';
/** 运行时走 GitHub 的 generic 目录，避开 api.github.com（未认证 403 / 国内常失败）。打包 publish 仍是 github。 */
const GITHUB_GENERIC_FEED_URL = 'https://github.com/wuqiongjin/AAO-Editor/releases/latest/download';

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
    const readSource = deps.getUpdateSource || (() => 'github');
    const persistSource = deps.setUpdateSource || (() => {});
    const fetchCnbReleases =
        deps.fetchCnbReleases ||
        (async () => {
            const url = cnbReleasesListUrl(CNB_SLUG);
            const res = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!res.ok) {
                throw new Error(`HttpError: ${res.status} "method: GET url: ${url}"`);
            }
            return res.json();
        });
    let status = 'idle';
    let percent = 0;
    let availableVersion = '';
    let releaseNotes = '';
    let errorMessage = '';
    let checking = false;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;

    function currentSource() {
        return normalizeUpdateSource(readSource());
    }

    async function applyFeed() {
        if (!isPackaged() || typeof autoUpdater.setFeedURL !== 'function') return;
        const source = currentSource();
        if (source === 'cnb') {
            const tag = pickLatestCnbReleaseTag(await fetchCnbReleases());
            if (!tag) {
                throw new Error('Cannot find channel "latest.yml" update info: CNB has no stable release');
            }
            autoUpdater.setFeedURL({
                provider: 'generic',
                url: cnbGenericFeedUrlForTag(CNB_SLUG, tag),
            });
            return;
        }
        autoUpdater.setFeedURL({
            provider: 'generic',
            url: GITHUB_GENERIC_FEED_URL,
        });
    }

    function snapshot() {
        return {
            packaged: isPackaged(),
            currentVersion: getVersion(),
            status,
            percent,
            availableVersion: availableVersion || undefined,
            releaseNotes: releaseNotes || undefined,
            errorMessage: errorMessage || undefined,
            updateSource: currentSource(),
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
                await applyFeed();
                await autoUpdater.checkForUpdates();
            } catch (err) {
                checking = false;
                if (status !== 'error') {
                    status = 'error';
                    errorMessage = err && err.message ? String(err.message) : 'update failed';
                    emit();
                }
            }
            return snapshot();
        },
        setUpdateSource(raw) {
            const next = normalizeUpdateSource(raw);
            if (status === 'downloading') {
                return { ...snapshot(), ok: false };
            }
            persistSource(next);
            if (status === 'error') {
                status = 'idle';
                errorMessage = '';
            }
            emit();
            return { ...snapshot(), ok: true };
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
    ipcMain.handle('appUpdate:setUpdateSource', (_event, source) => updater.setUpdateSource(source));
}

module.exports = { EVENT, stripNotes, createAppUpdater, registerAppUpdateIpc };
