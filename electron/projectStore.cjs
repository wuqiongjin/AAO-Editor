// 谱面工程文件后端（ADR-0015 §5）：<数据根>/projects/<id>/{project.json, audio.bin, cover.bin}
// schemaVersion 保持 1（未发布）。旧「一份 notes」目录（无 charts）不读、不删。
const fs = require('fs');
const path = require('path');
const { projectDir, projectsDir, safeProjectId } = require('./dataRoot.cjs');

const SCHEMA_VERSION = 1;

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
        console.warn('[project-store] project.json 解析失败，按空数据处理:', err);
        return null;
    }
}

async function readBinIfPresent(dir, fileName, present) {
    if (!present) return null;
    try {
        return await fs.promises.readFile(path.join(dir, fileName));
    } catch (err) {
        console.warn(`[project-store] ${fileName} 缺失，按无数据处理:`, err);
        return null;
    }
}

async function applyBinaryIntent(dir, fileName, intent, bytes) {
    const binPath = path.join(dir, fileName);
    if (intent === 'cleared') {
        await fs.promises.rm(binPath, { force: true });
        return false;
    }
    if (intent === 'set') {
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
    const { id, doc, audio, cover } = payload || {};
    const dir = projectDir(dataRoot, id);
    const existing = await readProjectJson(dir);
    if (existing != null && !isCurrentDoc(existing)) {
        throw new Error(`拒绝覆盖旧 schema 工程: ${JSON.stringify(id)}`);
    }
    await fs.promises.mkdir(dir, { recursive: true });

    const audioPresent = await applyBinaryIntent(dir, 'audio.bin', doc.audioIntent, audio);
    const coverPresent = await applyBinaryIntent(dir, 'cover.bin', doc.coverIntent, cover);

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

module.exports = {
    SCHEMA_VERSION,
    getProject,
    putProject,
    listProjects,
    deleteProject,
};
