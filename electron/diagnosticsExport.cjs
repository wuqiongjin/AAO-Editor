/**
 * 诊断包导出（ADR-0019 §4 / 票 04）：主进程读 logs、打 zip、弹保存对话框。
 * 不读 community-session.bin，不碰 Cookie jar。
 */
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip/dist/jszip.min.js');
const { MAX_AGE_DAYS } = require('./appLog.cjs');

const SENSITIVE_KEY = /token|cookie|session|password|authorization|secret|credential|apiKey/i;
const LOG_FILE = /^(errors|trail)-(\d{8})(?:-\d+)?(\.log|\.jsonl)$/;

function pad2(n) {
    return String(n).padStart(2, '0');
}

function diagnosticsArchiveName(now) {
    return `aao-diagnostics-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}.zip`;
}

function sanitizeSettingsForDiagnostics(value) {
    if (Array.isArray(value)) return value.map(sanitizeSettingsForDiagnostics);
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const [key, child] of Object.entries(value)) {
            if (SENSITIVE_KEY.test(key)) continue;
            out[key] = sanitizeSettingsForDiagnostics(child);
        }
        return out;
    }
    return value;
}

function diagnosticsZipFiles({ env, settings, logFiles, chart }) {
    const files = [
        { path: 'env.json', data: JSON.stringify(env, null, 2) },
        { path: 'settings.json', data: JSON.stringify(settings, null, 2) },
    ];
    for (const file of logFiles) {
        files.push({ path: `logs/${file.name}`, data: file.content });
    }
    if (chart !== undefined) {
        files.push({ path: 'chart/project.json', data: JSON.stringify(chart, null, 2) });
    }
    return files;
}

function planDiagnosticsEntries({ logNames, hasChart }) {
    return diagnosticsZipFiles({
        env: {},
        settings: {},
        logFiles: logNames.map((name) => ({ name, content: Buffer.alloc(0) })),
        chart: hasChart ? {} : undefined,
    }).map((file) => ({ path: file.path }));
}

function utcDayNumber(date) {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000;
}

function stampDayNumber(stamp) {
    const y = Number(stamp.slice(0, 4));
    const m = Number(stamp.slice(4, 6));
    const d = Number(stamp.slice(6, 8));
    return Date.UTC(y, m - 1, d) / 86400000;
}

function collectLogFiles(logsDir, now) {
    let names = [];
    try {
        names = fs.readdirSync(logsDir);
    } catch {
        return [];
    }
    const today = utcDayNumber(now);
    const out = [];
    for (const name of names) {
        const m = LOG_FILE.exec(name);
        if (!m) continue;
        if (m[1] === 'errors' && m[3] !== '.log') continue;
        if (m[1] === 'trail' && m[3] !== '.jsonl') continue;
        if (today - stampDayNumber(m[2]) >= MAX_AGE_DAYS) continue;
        try {
            out.push({ name, content: fs.readFileSync(path.join(logsDir, name)) });
        } catch {
            /* 读失败则省略该文件 */
        }
    }
    return out;
}

function resolveVersions(raw) {
    return typeof raw === 'function' ? raw() : raw || {};
}

/**
 * @param {{
 *   handle: (channel: string, listener: Function) => void,
 * }} ipcMain
 * @param {{
 *   logsDir: () => string,
 *   dataRoot: () => string,
 *   versions: object | (() => object),
 *   now?: () => Date,
 *   showSaveDialog: (win: unknown, opts: object) => Promise<{ canceled?: boolean, cancelled?: boolean, filePath?: string }>,
 *   fromWebContents?: (sender: unknown) => unknown,
 *   t?: (key: string) => string,
 *   writeFile?: (filePath: string, bytes: Buffer) => Promise<void>,
 * }} deps
 */
function registerDiagnosticsExportIpc(ipcMain, deps) {
    const nowFn = deps.now || (() => new Date());
    const writeFile = deps.writeFile || ((filePath, bytes) => fs.promises.writeFile(filePath, bytes));

    ipcMain.handle('diagnostics:export', async (event, payload) => {
        const now = nowFn();
        const logs = collectLogFiles(deps.logsDir(), now);
        const versions = resolveVersions(deps.versions);
        const body = payload && typeof payload === 'object' ? payload : {};
        const chart = Object.prototype.hasOwnProperty.call(body, 'chart') ? body.chart : undefined;
        const env = {
            exportedAt: now.toISOString(),
            appVersion: versions.app || '',
            electron: versions.electron || '',
            chrome: versions.chrome || '',
            node: versions.node || '',
            os: versions.os || '',
            dataRoot: deps.dataRoot(),
            pageId: body.pageId ?? null,
            projectId: body.projectId ?? null,
        };
        const settings = sanitizeSettingsForDiagnostics(body.settings ?? {});
        const zip = new JSZip();
        for (const file of diagnosticsZipFiles({ env, settings, logFiles: logs, chart })) {
            zip.file(file.path, file.data);
        }
        const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
        const suggestedName = diagnosticsArchiveName(now);
        const win = deps.fromWebContents ? deps.fromWebContents(event && event.sender) : undefined;
        const title = deps.t ? deps.t('electron.exportDiagnostics') : suggestedName;
        const result = await deps.showSaveDialog(win, {
            title,
            defaultPath: path.basename(suggestedName),
            filters: [{ name: 'ZIP', extensions: ['zip'] }],
        });
        if (result.canceled || result.cancelled || !result.filePath) {
            return { cancelled: true };
        }
        await writeFile(result.filePath, bytes);
        return { cancelled: false };
    });
}

module.exports = {
    diagnosticsArchiveName,
    sanitizeSettingsForDiagnostics,
    diagnosticsZipFiles,
    planDiagnosticsEntries,
    collectLogFiles,
    registerDiagnosticsExportIpc,
};
