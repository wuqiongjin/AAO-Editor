// 谱面工程文件后端（ADR-0015 §5）：<数据根>/projects/<id>/{project.json, audio.bin, cover.bin}
// schemaVersion 保持 1（未发布）。旧「一份 notes」目录（无 charts）不读、不删。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { cacheDir, isPathInside, projectDir, projectsDir, safeProjectId } = require('./dataRoot.cjs');

const SCHEMA_VERSION = 1;

/** 主进程 logger sink（票 05）。测试 / 未注入时退回 console.warn。 */
let appLog = null;

function setAppLog(log) {
    appLog = log && typeof log.write === 'function' ? log : null;
}

function storeWarn(message, extra) {
    if (appLog) {
        try {
            appLog.write({
                level: 'warn',
                module: 'project-store',
                message,
                extra,
                ts: new Date().toISOString(),
            });
        } catch {
            /* 日志失败不能打翻业务 */
        }
        return;
    }
    console.warn(`[project-store] ${message}`, extra);
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

function isCurrentDoc(doc) {
    return doc && typeof doc === 'object' && doc.schemaVersion === SCHEMA_VERSION && Array.isArray(doc.charts);
}

async function readProjectJson(dir) {
    let raw;
    try {
        raw = await fs.promises.readFile(path.join(dir, 'project.json'), 'utf8');
    } catch {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch (err) {
        storeWarn('project.json 解析失败，按空数据处理:', err);
        return null;
    }
}

async function readBinIfPresent(dir, fileName, present) {
    if (!present) return null;
    try {
        return await fs.promises.readFile(path.join(dir, fileName));
    } catch (err) {
        storeWarn(`${fileName} 缺失，按无数据处理:`, err);
        return null;
    }
}

/**
 * 从素材缓存拷一份进工程（bestdori-integration 08 + 14）：导入的音频 / 封面由社区网关落到
 * `<数据根>/cache/community/`（票 14 取代了 07 的下载暂存），再在这里拷进工程目录 ——
 * 字节始终不进 IPC。
 *
 * 缓存路径是**渲染进程给的入参**，必须卡在缓存目录内：不卡就等于把「读任意文件」交出去。
 */
async function copyCachedFile(dataRoot, sourcePath, destPath) {
    if (typeof sourcePath !== 'string' || sourcePath.trim() === '') {
        throw new Error('素材缓存路径无效');
    }
    const cache = path.resolve(cacheDir(dataRoot));
    const source = path.resolve(sourcePath);
    if (!isPathInside(cache, source)) {
        throw new Error(`拒绝从素材缓存之外拷贝素材: ${sourcePath}`);
    }
    await fs.promises.access(source);
    const tmpPath = `${destPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.copyFile(source, tmpPath);
    await fs.promises.rename(tmpPath, destPath);
    return true;
}

async function applyBinaryIntent(dataRoot, dir, fileName, intent, bytes, sourcePath) {
    const binPath = path.join(dir, fileName);
    if (intent === 'cleared') {
        await fs.promises.rm(binPath, { force: true });
        return false;
    }
    if (intent === 'set') {
        // 缓存路径优先：给了它就用它（同一笔里不会再给字节）
        if (typeof sourcePath === 'string' && sourcePath !== '') {
            return copyCachedFile(dataRoot, sourcePath, binPath);
        }
        if (!(bytes instanceof Uint8Array)) {
            throw new Error(`project:put ${fileName} intent=set 但缺少字节`);
        }
        await writeFileAtomic(binPath, Buffer.from(bytes));
        return true;
    }
    return fileExists(binPath);
}

async function getProject(dataRoot, rawId) {
    const dir = projectDir(dataRoot, rawId);
    const doc = await readProjectJson(dir);
    if (!isCurrentDoc(doc)) return null;
    const audio = await readBinIfPresent(dir, 'audio.bin', doc.audioPresent);
    const cover = await readBinIfPresent(dir, 'cover.bin', doc.coverPresent);
    return { doc, audio, cover };
}

async function putProject(dataRoot, payload) {
    const { id, doc, audio, cover, audioStagedPath, coverStagedPath } = payload || {};
    const dir = projectDir(dataRoot, id);
    const existing = await readProjectJson(dir);
    if (existing != null && !isCurrentDoc(existing)) {
        throw new Error(`拒绝覆盖旧 schema 工程: ${JSON.stringify(id)}`);
    }
    await fs.promises.mkdir(dir, { recursive: true });

    const audioPresent = await applyBinaryIntent(dataRoot, dir, 'audio.bin', doc.audioIntent, audio, audioStagedPath);
    const coverPresent = await applyBinaryIntent(dataRoot, dir, 'cover.bin', doc.coverIntent, cover, coverStagedPath);

    const { audioIntent: _a, coverIntent: _c, ...docRest } = doc;
    const durableDoc = { ...docRest, audioPresent, coverPresent };
    await writeFileAtomic(path.join(dir, 'project.json'), JSON.stringify(durableDoc));
    return true;
}

async function listProjects(dataRoot) {
    let entries;
    try {
        entries = await fs.promises.readdir(projectsDir(dataRoot), { withFileTypes: true });
    } catch {
        return [];
    }
    const out = [];
    for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        try {
            safeProjectId(ent.name);
        } catch {
            continue;
        }
        const dir = path.join(projectsDir(dataRoot), ent.name);
        const doc = await readProjectJson(dir);
        if (!isCurrentDoc(doc)) continue;
        const cover = await readBinIfPresent(dir, 'cover.bin', doc.coverPresent);
        out.push({ id: ent.name, doc, cover });
    }
    return out;
}

async function deleteProject(dataRoot, rawId) {
    const dir = projectDir(dataRoot, rawId);
    const existing = await readProjectJson(dir);
    if (existing != null && !isCurrentDoc(existing)) {
        throw new Error(`拒绝删除旧 schema 工程: ${JSON.stringify(rawId)}`);
    }
    await fs.promises.rm(dir, { recursive: true, force: true });
}

/**
 * 发布用的上传引用（bestdori-integration 11）：工程音频 / 封面在主进程侧的
 * **路径 + 字节数 + SHA-1**。三步二进制上传里 prepare 要 `{hash, size}`、
 * multipart 要文件路径 —— 两样都只有主进程方便给（字节不过 IPC：这里回的是
 * 「事实」，字节始终不进渲染进程）。文件缺失（present 但盘上没有）按没有处理。
 * @returns {Promise<{ audio: { path: string, size: number, hash: string } | null, cover: ... } | null>}
 */
async function uploadRefs(dataRoot, rawId) {
    const dir = projectDir(dataRoot, rawId);
    const doc = await readProjectJson(dir);
    if (!isCurrentDoc(doc)) return null;
    const out = {};
    const kinds = [
        ['audio', 'audio.bin', doc.audioPresent],
        ['cover', 'cover.bin', doc.coverPresent],
    ];
    for (const [kind, fileName, present] of kinds) {
        if (!present) {
            out[kind] = null;
            continue;
        }
        const filePath = path.join(dir, fileName);
        try {
            const bytes = await fs.promises.readFile(filePath);
            out[kind] = {
                path: filePath,
                size: bytes.byteLength,
                hash: crypto.createHash('sha1').update(bytes).digest('hex'),
            };
        } catch (err) {
            storeWarn(`${fileName} 缺失，按无数据处理:`, err);
            out[kind] = null;
        }
    }
    return out;
}

module.exports = {
    SCHEMA_VERSION,
    getProject,
    putProject,
    listProjects,
    deleteProject,
    uploadRefs,
    setAppLog,
};
