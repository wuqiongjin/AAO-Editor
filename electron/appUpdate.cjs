/**
 * 应用更新（ADR-0021）：远端（有没有新发行）和本地包（能不能装）分开记。
 * 检查只改远端；下载成功才改本地；稍后不改任何轴。
 * 发版原址仍是 GitHub；运行时按本机 updateSource setFeedURL（两边都 generic）。
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

function compareVersions(a, b) {
    const parse = (v) => String(v || '').replace(/^v/i, '').split(/[.+-]/).map((p) => {
        const n = parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
    });
    const pa = parse(a);
    const pb = parse(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i += 1) {
        const da = pa[i] || 0;
        const db = pb[i] || 0;
        if (da > db) return 1;
        if (da < db) return -1;
    }
    return 0;
}

function deriveStatus(remote, local) {
    if (local === 'downloading') return 'downloading';
    if (remote === 'checking') return 'checking';
    if (remote === 'error') return 'error';
    if (local === 'ready') return 'ready';
    if (remote === 'available') return 'available';
    if (remote === 'current') return 'current';
    return 'idle';
}

function createAppUpdater(deps) {
    const { isPackaged, getVersion, autoUpdater, send } = deps;
    const readSource = deps.getUpdateSource || (() => 'github');
    const persistSource = deps.setUpdateSource || (() => {});
    const readReadyVersion = deps.getReadyVersion || (() => '');
    const persistReadyVersion = deps.setReadyVersion || (() => {});
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

    let remote = 'idle';
    let local = 'none';
    let percent = 0;
    let availableVersion = '';
    let readyVersion = '';
    let releaseNotes = '';
    let errorMessage = '';
    let checking = false;
    let cycle = 0;
    let localBeforeDownload = 'none';
    let readyVersionBeforeDownload = '';

    const storedReady = typeof readReadyVersion === 'function' ? String(readReadyVersion() || '') : '';
    if (storedReady && compareVersions(storedReady, getVersion()) > 0 && Boolean(autoUpdater.installerPath)) {
        local = 'ready';
        readyVersion = storedReady;
        percent = 100;
    }

    autoUpdater.autoDownload = false;
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
            remote,
            local,
            status: deriveStatus(remote, local),
            percent,
            availableVersion: availableVersion || undefined,
            readyVersion: readyVersion || undefined,
            releaseNotes: releaseNotes || undefined,
            errorMessage: errorMessage || undefined,
            updateSource: currentSource(),
            cycle,
        };
    }

    function emit() {
        send(EVENT, snapshot());
    }

    function rememberReady(version) {
        readyVersion = version || readyVersion;
        if (readyVersion && compareVersions(readyVersion, getVersion()) > 0) {
            local = 'ready';
            percent = 100;
            persistReadyVersion(readyVersion);
        }
    }

    autoUpdater.on('checking-for-update', () => {
        remote = 'checking';
        errorMessage = '';
        emit();
    });
    autoUpdater.on('update-available', (info) => {
        checking = false;
        remote = 'available';
        availableVersion = info && typeof info.version === 'string' ? info.version : '';
        releaseNotes = stripNotes(info && info.releaseNotes);
        if (readyVersion && compareVersions(readyVersion, getVersion()) > 0) {
            local = 'ready';
            percent = 100;
        }
        emit();
    });
    autoUpdater.on('update-not-available', () => {
        checking = false;
        remote = 'current';
        percent = local === 'downloading' ? percent : local === 'ready' ? 100 : 0;
        availableVersion = '';
        releaseNotes = '';
        if (local !== 'downloading' && !(readyVersion && compareVersions(readyVersion, getVersion()) > 0)) {
            local = 'none';
            readyVersion = '';
        }
        emit();
    });
    autoUpdater.on('download-progress', (progress) => {
        local = 'downloading';
        const p = progress && typeof progress.percent === 'number' ? progress.percent : 0;
        percent = Math.max(0, Math.min(100, p));
        emit();
    });
    autoUpdater.on('update-downloaded', (info) => {
        checking = false;
        const version = info && typeof info.version === 'string' ? info.version : availableVersion;
        const notes = stripNotes(info && info.releaseNotes);
        if (notes) releaseNotes = notes;
        rememberReady(version);
        emit();
    });
    autoUpdater.on('error', (err) => {
        checking = false;
        remote = 'error';
        errorMessage = err && err.message ? String(err.message) : 'update failed';
        if (local === 'downloading') {
            if (localBeforeDownload === 'ready' && compareVersions(readyVersionBeforeDownload, getVersion()) > 0) {
                local = 'ready';
                readyVersion = readyVersionBeforeDownload;
                percent = 100;
            } else {
                local = 'none';
                percent = 0;
            }
        }
        emit();
    });

    return {
        getState() {
            return snapshot();
        },
        async check() {
            if (!isPackaged()) {
                remote = 'idle';
                errorMessage = '';
                return snapshot();
            }
            if (checking || local === 'downloading') return snapshot();
            cycle += 1;
            checking = true;
            try {
                await applyFeed();
                await autoUpdater.checkForUpdates();
            } catch (err) {
                checking = false;
                if (remote !== 'error') {
                    remote = 'error';
                    errorMessage = err && err.message ? String(err.message) : 'update failed';
                    emit();
                }
            }
            return snapshot();
        },
        setUpdateSource(raw) {
            const next = normalizeUpdateSource(raw);
            if (local === 'downloading') {
                return { ...snapshot(), ok: false };
            }
            persistSource(next);
            if (remote === 'error') {
                remote = 'idle';
                errorMessage = '';
            }
            emit();
            return { ...snapshot(), ok: true };
        },
        async download() {
            if (!isPackaged() || local === 'downloading') return snapshot();
            if (typeof autoUpdater.downloadUpdate !== 'function') return snapshot();
            if (local === 'ready' && (!availableVersion || availableVersion === readyVersion)) {
                return snapshot();
            }
            if (remote !== 'available') return snapshot();
            localBeforeDownload = local;
            readyVersionBeforeDownload = readyVersion;
            checking = true;
            local = 'downloading';
            percent = 0;
            emit();
            try {
                await autoUpdater.downloadUpdate();
                if (local === 'downloading') {
                    rememberReady(availableVersion);
                    emit();
                }
            } catch (err) {
                checking = false;
                if (remote !== 'error') {
                    remote = 'error';
                    errorMessage = err && err.message ? String(err.message) : 'update failed';
                    if (localBeforeDownload === 'ready' && compareVersions(readyVersionBeforeDownload, getVersion()) > 0) {
                        local = 'ready';
                        readyVersion = readyVersionBeforeDownload;
                        percent = 100;
                    } else {
                        local = 'none';
                    }
                    emit();
                }
            }
            return snapshot();
        },
        async install() {
            if (!isPackaged() || local !== 'ready') return snapshot();
            try {
                autoUpdater.quitAndInstall(false, true);
            } catch (err) {
                checking = false;
                remote = 'error';
                errorMessage = err && err.message ? String(err.message) : 'update failed';
                emit();
            }
            return snapshot();
        },
    };
}

function registerAppUpdateIpc(ipcMain, updater) {
    ipcMain.handle('appUpdate:getState', () => updater.getState());
    ipcMain.handle('appUpdate:check', () => updater.check());
    ipcMain.handle('appUpdate:install', () => updater.install());
    ipcMain.handle('appUpdate:download', () => updater.download());
    ipcMain.handle('appUpdate:setUpdateSource', (_event, source) => updater.setUpdateSource(source));
}

module.exports = { EVENT, stripNotes, compareVersions, createAppUpdater, registerAppUpdateIpc };
