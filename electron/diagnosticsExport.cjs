/**
 * 诊断包导出（ADR-0019 §4 / 票 04）：主进程读 logs、打 zip、弹保存对话框。
 * 不读 community-session.bin，不碰 Cookie jar。
 */
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip/dist/jszip.min.js');
const { MAX_AGE_DAYS, parseManaged, utcDayNumber, stampDayNumber } = require('./appLog.cjs');
const { writeFileAtomic } = require('./atomicWrite.cjs');

// 与 src/diagnostics/sanitizeDiagnosticsPayload.ts 的键名表一致（tests/static/DiagnosticsExportWiring.test.ts 钉住）。
const SENSITIVE_KEY = /token|cookie|session|password|authorization|secret|credential|apiKey/i;

function pad2(n) {
    return String(n).padStart(2, '0');
}

function diagnosticsArchiveName(now) {
    return `aao-diagnostics-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}.zip`;
}

function sanitizeForDiagnostics(value) {
    if (Array.isArray(value)) return value.map(sanitizeForDiagnostics);
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const [key, child] of Object.entries(value)) {
            if (SENSITIVE_KEY.test(key)) continue;
            out[key] = sanitizeForDiagnostics(child);
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
        // parseManaged 已挡住 errors→.log / trail→.jsonl 之外的组合
        const parsed = parseManaged(name);
        if (!parsed) continue;
        if (today - stampDayNumber(parsed.stamp) >= MAX_AGE_DAYS) continue;
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
 *   handle: (channel: string, listener: (event: unknown, payload?: unknown) => unknown) => void,
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
    const writeFile = deps.writeFile || writeFileAtomic;

    ipcMain.handle('diagnostics:export', async (event, payload) => {
        const now = nowFn();
        const logs = collectLogFiles(deps.logsDir(), now);
        const versions = resolveVersions(deps.versions);
        const body = payload && typeof payload === 'object' ? payload : {};
        const rawChart = Object.prototype.hasOwnProperty.call(body, 'chart') ? body.chart : undefined;
        // chart 与 settings 过同一把键名筛：谱面文档将来若带 token 类字段不会原样进包
        const chart = rawChart === undefined ? undefined : sanitizeForDiagnostics(rawChart);
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
        const settings = sanitizeForDiagnostics(body.settings ?? {});
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
    sanitizeForDiagnostics,
    diagnosticsZipFiles,
    collectLogFiles,
    registerDiagnosticsExportIpc,
};
