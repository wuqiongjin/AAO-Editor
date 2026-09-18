const path = require('path');
const fs = require('fs');

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
    const filePath = appStateFilePath(userData);
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(doc), 'utf8');
    fs.renameSync(tmpPath, filePath);
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
    writeAppStateRawSync(userData, next);
}

module.exports = {
    APP_STATE_FILENAME,
    appStateFilePath,
    readAppStateRawSync,
    writeAppStateRawSync,
    patchAppStateSync,
};
