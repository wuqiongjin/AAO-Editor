const path = require('path');
const fs = require('fs');
const { patchAppStateSync, readAppStateRawSync } = require('./appState.cjs');
const { t } = require('./i18n.cjs');

const DATA_DIRNAME = 'data';
const PROJECTS_DIRNAME = 'projects';
const ASSETS_DIRNAME = 'assets';
/** 社区平台的下载暂存（bestdori-integration 07）：过程态，启动即清空，不进任何分发物 */
const DOWNLOADS_DIRNAME = 'downloads';
const BACKGROUND_SKIN_RELATIVE = path.join(ASSETS_DIRNAME, 'background-skin.bin');

function dataRootUnderParent(parent) {
    return path.join(path.resolve(parent), DATA_DIRNAME);
}

function defaultDataRoot(userData) {
    return dataRootUnderParent(userData);
}

function projectsDir(dataRoot) {
    return path.join(dataRoot, PROJECTS_DIRNAME);
}

function assetsDir(dataRoot) {
    return path.join(dataRoot, ASSETS_DIRNAME);
}

function backgroundSkinPath(dataRoot) {
    return path.join(dataRoot, BACKGROUND_SKIN_RELATIVE);
}

/** 下载暂存目录（<数据根>/downloads/）—— 社区音频 / 封面的落脚区，导入才写进工程 */
function downloadsDir(dataRoot) {
    return path.join(dataRoot, DOWNLOADS_DIRNAME);
}

function ensureDataRootLayoutSync(dataRoot) {
    fs.mkdirSync(projectsDir(dataRoot), { recursive: true });
    fs.mkdirSync(assetsDir(dataRoot), { recursive: true });
    fs.mkdirSync(downloadsDir(dataRoot), { recursive: true });
}

/** 工程 id 白名单：字母数字开头，仅字母数字 . _ -，≤64 位 */
function safeProjectId(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
        throw new Error(`非法的谱面工程 id: ${JSON.stringify(id)}`);
    }
    return id;
}

function projectDir(dataRoot, id) {
    return path.join(projectsDir(dataRoot), safeProjectId(id));
}

function normalizeDataRootPath(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') {
        throw new Error('数据根路径无效');
    }
    return path.resolve(raw.trim());
}

function parseStoredDataRoot(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    try {
        return normalizeDataRootPath(raw);
    } catch {
        return null;
    }
}

function loadDataRootSync(userData) {
    const fallback = defaultDataRoot(userData);
    const stored = parseStoredDataRoot(readAppStateRawSync(userData).dataRoot);
    const root = stored ?? fallback;
    ensureDataRootLayoutSync(root);
    return root;
}

function saveDataRootSync(userData, rootPath) {
    const resolved = normalizeDataRootPath(rootPath);
    ensureDataRootLayoutSync(resolved);
    patchAppStateSync(userData, { dataRoot: resolved });
}

function isPathInside(parent, child) {
    const rel = path.relative(parent, child);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function pathExists(filePath) {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function dirEmptyOrMissing(dir) {
    try {
        const entries = await fs.promises.readdir(dir);
        return entries.length === 0;
    } catch (err) {
        if (err && err.code === 'ENOENT') return true;
        throw err;
    }
}

/**
 * 搬家目标路径：所选为空文件夹 → 即新数据根；所选已有内容 → 视为父目录，落到其下的「当前根目录名」。
 * 例：根为 …/123、选 …/music（内含 data/）→ …/music/123，不碰 music/data。
 */
async function resolveMoveDestRoot(fromRoot, selection) {
    const from = normalizeDataRootPath(fromRoot);
    const sel = normalizeDataRootPath(selection);
    if (await dirEmptyOrMissing(sel)) {
        return sel;
    }
    return path.join(sel, path.basename(from));
}

/**
 * 搬家：整包拷到新数据根（见 resolveMoveDestRoot），成功删旧根；失败不切根。
 * @param {{ userData: string, fromRoot: string, toRoot: string, copyDir?: Function }} opts
 */
async function moveDataRoot(opts) {
    const userData = opts.userData;
    const fromRoot = normalizeDataRootPath(opts.fromRoot);
    const toRoot = await resolveMoveDestRoot(fromRoot, opts.toRoot);
    if (fromRoot === toRoot) {
        ensureDataRootLayoutSync(toRoot);
        return { ok: true, unchanged: true };
    }
    if (isPathInside(fromRoot, toRoot) || isPathInside(toRoot, fromRoot)) {
        return {
            ok: false,
            code: 'dest-inside-source',
            message: t('electron.destInside'),
        };
    }
    if (!(await dirEmptyOrMissing(toRoot))) {
        const leaf = path.basename(toRoot);
        return {
            ok: false,
            code: 'dest-occupied',
            message: t('electron.destOccupied', { leaf }),
        };
    }

    const copyDir = opts.copyDir ?? ((src, dest) => fs.promises.cp(src, dest, { recursive: true }));

    try {
        await copyDir(fromRoot, toRoot);
        ensureDataRootLayoutSync(toRoot);
        saveDataRootSync(userData, toRoot);
    } catch (err) {
        await rollbackDest(toRoot);
        return {
            ok: false,
            code: 'copy-failed',
            message: t('electron.moveFail'),
            error: err,
        };
    }

    try {
        await fs.promises.rm(fromRoot, { recursive: true, force: true });
    } catch {
        // 指针已切；旧副本清不掉不回滚
    }

    return { ok: true, unchanged: false };
}

async function rollbackDest(destRoot) {
    try {
        await fs.promises.rm(destRoot, { recursive: true, force: true });
    } catch {
        // 尽力
    }
}

/**
 * 认领：只改指针，不拷不删。所选目录缺 projects/、assets/ 时补空目录（含空目录首次选用）。
 * @param {{ userData: string, toRoot: string }} opts
 */
async function claimDataRoot(opts) {
    const toRoot = normalizeDataRootPath(opts.toRoot);
    const current = loadDataRootSync(opts.userData);
    if (current === toRoot) {
        ensureDataRootLayoutSync(toRoot);
        return { ok: true, unchanged: true };
    }
    saveDataRootSync(opts.userData, toRoot);
    return { ok: true, unchanged: false };
}

module.exports = {
    DATA_DIRNAME,
    PROJECTS_DIRNAME,
    ASSETS_DIRNAME,
    DOWNLOADS_DIRNAME,
    BACKGROUND_SKIN_RELATIVE,
    defaultDataRoot,
    dataRootUnderParent,
    projectsDir,
    assetsDir,
    downloadsDir,
    backgroundSkinPath,
    ensureDataRootLayoutSync,
    safeProjectId,
    projectDir,
    normalizeDataRootPath,
    loadDataRootSync,
    saveDataRootSync,
    isPathInside,
    resolveMoveDestRoot,
    moveDataRoot,
    claimDataRoot,
};
