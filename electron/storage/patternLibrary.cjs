// 片段库文件后端（issue 184 / 208 / ADR-0023 §3）：<数据根>/patterns/patterns.json
//
// 与工程目录不同：片段库是**应用级用户素材**，独立单文件、不跟设置走。
// v1 全量读写；将来分片只换实现，不动语义。
//
// 首次载入：文件不存在 → null（渲染侧按空库处理，且**不写盘**）。
// 文件损坏 / 版本不认识 → 改名 `<file>.broken` 备份后回落 null —— 不静默覆盖用户的库。
const fs = require('fs');
const path = require('path');
const { patternLibraryPath } = require('./dataRoot.cjs');
const { writeFileAtomic } = require('../foundation/atomicWrite.cjs');
const { saveJsonWithDialog } = require('../foundation/saveDialog.cjs');

const SCHEMA_VERSION = 1;

/** 主进程 logger sink（票 05 口径）。测试 / 未注入时退回 console.warn。 */
let appLog = null;

function setAppLog(log) {
    appLog = log && typeof log.write === 'function' ? log : null;
}

function libraryWarn(message, extra) {
    if (appLog) {
        try {
            appLog.write({
                level: 'warn',
                module: 'pattern-library',
                message,
                extra,
                ts: new Date().toISOString(),
            });
        } catch {
            /* 日志失败不能打翻业务 */
        }
        return;
    }
    console.warn(`[pattern-library] ${message}`, extra);
}

async function fileExists(filePath) {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function isCurrentDoc(doc) {
    return doc !== null
        && typeof doc === 'object'
        && !Array.isArray(doc)
        && doc.schemaVersion === SCHEMA_VERSION
        && Array.isArray(doc.patterns);
}

/**
 * 把坏文件改名保留（`patterns.json.broken`；同名的已存在则带序号）。
 * 备份失败只记日志：宁可读空库，也不让「备份不了」把整个片段库功能卡死。
 */
async function quarantineBrokenFile(filePath) {
    let target = `${filePath}.broken`;
    for (let n = 1; await fileExists(target); n++) {
        target = `${filePath}.${n}.broken`;
    }
    try {
        await fs.promises.rename(filePath, target);
        libraryWarn('patterns.json 损坏，已备份', { backup: target });
        return target;
    } catch (err) {
        libraryWarn('patterns.json 损坏且备份失败', { error: String(err) });
        return null;
    }
}

/** 读整库；文件不存在 → null（不落盘）。 */
async function loadPatternLibrary(dataRoot) {
    const filePath = patternLibraryPath(dataRoot);
    let raw;
    try {
        raw = await fs.promises.readFile(filePath, 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') return null;
        throw err;
    }

    let doc;
    try {
        doc = JSON.parse(raw);
    } catch {
        await quarantineBrokenFile(filePath);
        return null;
    }
    if (!isCurrentDoc(doc)) {
        await quarantineBrokenFile(filePath);
        return null;
    }
    return doc;
}

/** 全量写整库（渲染侧给片段数组，主进程套上 schemaVersion 信封）。 */
async function savePatternLibrary(dataRoot, patterns) {
    if (!Array.isArray(patterns)) {
        throw new Error('patternLibrary:saveAll 需要片段数组');
    }
    const filePath = patternLibraryPath(dataRoot);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await writeFileAtomic(filePath, JSON.stringify({ schemaVersion: SCHEMA_VERSION, patterns }));
    return true;
}

/**
 * 片段库通道（issue 184 / 208 / 187）：读 / 全量写 / 分享另存。
 * 另存每次弹系统保存对话框、不记路径；取消返回 { cancelled: true }。
 * @param {{ handle: Function }} ipcMain
 */
function registerPatternLibraryIpc(ipcMain, deps) {
    const currentDataRoot = deps.currentDataRoot;

    ipcMain.handle('patternLibrary:load', () => loadPatternLibrary(currentDataRoot()));
    ipcMain.handle('patternLibrary:saveAll', (_event, patterns) =>
        savePatternLibrary(currentDataRoot(), patterns));
    ipcMain.handle('patternLibrary:saveAs', (event, payload) =>
        saveJsonWithDialog(event, payload, {
            channel: 'patternLibrary:saveAs',
            titleKey: 'electron.exportPatterns',
            fallbackName: 'aao-patterns.json',
            filters: [{ name: 'JSON', extensions: ['json'] }],
        }, deps));
}

module.exports = {
    SCHEMA_VERSION,
    setAppLog,
    loadPatternLibrary,
    savePatternLibrary,
    registerPatternLibraryIpc,
};
