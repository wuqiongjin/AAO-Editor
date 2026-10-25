const path = require('path');
const fs = require('fs');
const { writeFileAtomicSync } = require('./atomicWrite.cjs');

const APP_STATE_FILENAME = 'app-state.json';

function appStateFilePath(userData) {
    return path.join(userData, APP_STATE_FILENAME);
}

function readAppStateRawSync(userData) {
    try {
        const doc = JSON.parse(fs.readFileSync(appStateFilePath(userData), 'utf8'));
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return {};
        return doc;
    } catch {
        return {};
    }
}

function writeAppStateRawSync(userData, doc) {
    writeFileAtomicSync(appStateFilePath(userData), JSON.stringify(doc));
}

function normalizeUpdateSource(raw) {
    return raw === 'cnb' ? 'cnb' : 'github';
}

function loadUpdateSourceSync(userData) {
    return normalizeUpdateSource(readAppStateRawSync(userData).updateSource);
}

/** 只覆盖传入的键，保留文件里其它本机状态字段 */
function patchAppStateSync(userData, patch) {
    const cur = readAppStateRawSync(userData);
    const next = { ...cur };
    if (Object.prototype.hasOwnProperty.call(patch, 'dataRoot')) {
        next.dataRoot = patch.dataRoot;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'window')) {
        next.window = patch.window;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'updateSource')) {
        next.updateSource = normalizeUpdateSource(patch.updateSource);
    }
    writeAppStateRawSync(userData, next);
}

module.exports = {
    APP_STATE_FILENAME,
    appStateFilePath,
    readAppStateRawSync,
    writeAppStateRawSync,
    patchAppStateSync,
    normalizeUpdateSource,
    loadUpdateSourceSync,
};
