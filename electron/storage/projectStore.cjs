// 谱面工程文件后端（ADR-0015 §5）：<数据根>/projects/<id>/{project.json, audio.bin, cover.bin, liveBg.bin}
// schemaVersion 保持 1（未发布）。旧「一份 notes」目录（无 charts）不读、不删。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
    cacheDir,
    isPathInside,
    projectCacheDir,
    projectCacheIndexPath,
    projectDir,
    projectsDir,
    projectThumbPath,
    projectThumbsDir,
    safeProjectId,
} = require('./dataRoot.cjs');
const { writeFileAtomic, renameOver } = require('../foundation/atomicWrite.cjs');

const SCHEMA_VERSION = 1;
const SUMMARY_INDEX_VERSION = 1;
const LIST_STAT_CONCURRENCY = 16;

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
    try {
        await fs.promises.copyFile(source, tmpPath);
        await renameOver(tmpPath, destPath);
    } catch (err) {
        await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
        throw err;
    }
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

/**
 * 谱面音符数统计（chart-projects 44）：与渲染侧 `src/chart/editing/NoteEditing.ts`
 * `countChartNotes`（issue 36 + issue 84）逐条同口径：
 * - 排除 `BPM` / `System` / `Opaque`；
 * - `Slide` / `Long` 按非 `hidden` 结点数计（含负 beat 非 hidden）；
 * - 其余音符各计 1。
 */
function countChartNotes(notes) {
    if (!Array.isArray(notes)) return 0;
    let count = 0;
    for (const n of notes) {
        if (!n || typeof n !== 'object') continue;
        if (n.type === 'Slide' || n.type === 'Long') {
            if (Array.isArray(n.connections)) {
                for (const c of n.connections) {
                    if (c && !c.hidden) count += 1;
                }
            }
        } else if (n.type !== 'BPM' && n.type !== 'System' && n.type !== 'Opaque') {
            count += 1;
        }
    }
    return count;
}

function summarizeChart(chart) {
    return {
        id: chart.id,
        title: chart.title ?? null,
        diff: chart.diff,
        level: chart.level ?? null,
        completed: !!chart.completed,
        upload: chart.upload ?? null,
        ...(chart.pendingPublish ? { pendingPublish: true } : {}),
        lastModified: chart.lastModified,
        noteCount: countChartNotes(chart.notes),
    };
}

function summarizeProjectDoc(id, doc, coverStat) {
    const coverPresent = Boolean(doc.coverPresent) && Boolean(coverStat && coverStat.size > 0);
    const coverVersion = coverPresent && coverStat
        ? `${coverStat.mtimeMs}-${coverStat.size}`
        : null;
    return {
        id,
        name: doc.name ?? null,
        artist: doc.artist ?? null,
        source: doc.source,
        durationSeconds: doc.durationSeconds,
        lastOpened: doc.lastOpened,
        audioName: doc.audioName ?? null,
        coverName: doc.coverName ?? null,
        audioPresent: Boolean(doc.audioPresent),
        coverPresent,
        coverVersion,
        charts: (Array.isArray(doc.charts) ? doc.charts : []).map(summarizeChart),
    };
}

function isValidSummary(summary) {
    if (!summary || typeof summary !== 'object') return false;
    if (typeof summary.id !== 'string' || !Array.isArray(summary.charts)) return false;
    return summary.charts.every((c) => c && typeof c.id === 'string' && typeof c.noteCount === 'number');
}

function buildIndexEntry(projectStat, coverStat, summary) {
    return {
        projectMtimeMs: projectStat.mtimeMs,
        projectSize: projectStat.size,
        coverMtimeMs: coverStat ? coverStat.mtimeMs : null,
        coverSize: coverStat ? coverStat.size : null,
        summary,
    };
}

function isSummaryCacheHit(cached, projectStat, coverStat) {
    const coverMtimeMs = coverStat ? coverStat.mtimeMs : null;
    const coverSize = coverStat ? coverStat.size : null;
    return Boolean(
        cached
        && cached.projectMtimeMs === projectStat.mtimeMs
        && cached.projectSize === projectStat.size
        && cached.coverMtimeMs === coverMtimeMs
        && cached.coverSize === coverSize
        && isValidSummary(cached.summary)
    );
}

async function statOptional(filePath) {
    try {
        return await fs.promises.stat(filePath);
    } catch {
        return null;
    }
}

async function mapLimit(items, limit, worker) {
    if (items.length === 0) return [];
    const results = new Array(items.length);
    let nextIndex = 0;
    const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
        while (true) {
            const idx = nextIndex++;
            if (idx >= items.length) return;
            results[idx] = await worker(items[idx], idx);
        }
    });
    await Promise.all(workers);
    return results;
}

const indexWriteQueues = new Map();

function enqueueIndexWrite(dataRoot, task) {
    const key = path.resolve(dataRoot);
    const prev = indexWriteQueues.get(key) ?? Promise.resolve();
    const run = prev.then(task, task);
    const tail = run.finally(() => {
        if (indexWriteQueues.get(key) === tail) indexWriteQueues.delete(key);
    });
    indexWriteQueues.set(key, tail);
    return run;
}

async function readSummaryIndex(dataRoot) {
    const indexPath = projectCacheIndexPath(dataRoot);
    try {
        const raw = await fs.promises.readFile(indexPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (
            parsed
            && typeof parsed === 'object'
            && parsed.version === SUMMARY_INDEX_VERSION
            && parsed.entries
            && typeof parsed.entries === 'object'
            && !Array.isArray(parsed.entries)
        ) {
            return { index: parsed, corrupt: false };
        }
        return { index: { version: SUMMARY_INDEX_VERSION, entries: {} }, corrupt: true };
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            return { index: { version: SUMMARY_INDEX_VERSION, entries: {} }, corrupt: false };
        }
        return { index: { version: SUMMARY_INDEX_VERSION, entries: {} }, corrupt: true };
    }
}

async function writeSummaryIndex(dataRoot, index) {
    await fs.promises.mkdir(projectCacheDir(dataRoot), { recursive: true });
    await writeFileAtomic(projectCacheIndexPath(dataRoot), JSON.stringify(index));
}

async function removeProjectThumb(dataRoot, rawId) {
    try {
        await fs.promises.rm(projectThumbPath(dataRoot, rawId), { force: true });
    } catch {
        /* 缩略图清理失败不影响主流程 */
    }
}

async function cleanupOrphanThumbs(dataRoot, activeIds) {
    let files;
    try {
        files = await fs.promises.readdir(projectThumbsDir(dataRoot), { withFileTypes: true });
    } catch {
        return;
    }
    for (const ent of files) {
        if (!ent.isFile() || !ent.name.endsWith('.png')) continue;
        const id = ent.name.slice(0, -4);
        if (!activeIds.has(id)) {
            await fs.promises.rm(path.join(projectThumbsDir(dataRoot), ent.name), { force: true }).catch(() => {});
        }
    }
}

async function copyLiveBgFrom(dataRoot, fromId, destPath) {
    const source = path.join(projectDir(dataRoot, fromId), 'liveBg.bin');
    try {
        await fs.promises.access(source);
    } catch {
        return false;
    }
    const tmpPath = `${destPath}.tmp-${process.pid}-${Date.now()}`;
    try {
        await fs.promises.copyFile(source, tmpPath);
        await renameOver(tmpPath, destPath);
    } catch (err) {
        await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
        throw err;
    }
    return true;
}

async function applyLiveBgIntent(dataRoot, dir, intent, bytes, copyFromId) {
    const binPath = path.join(dir, 'liveBg.bin');
    if (intent === 'cleared') {
        await fs.promises.rm(binPath, { force: true });
        return false;
    }
    if (intent === 'set') {
        if (typeof copyFromId === 'string' && copyFromId !== '') {
            return copyLiveBgFrom(dataRoot, copyFromId, binPath);
        }
        if (!(bytes instanceof Uint8Array)) {
            throw new Error('project:put liveBg.bin intent=set 但缺少字节');
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

async function getProjectSummary(dataRoot, rawId) {
    const id = safeProjectId(rawId);
    const dir = projectDir(dataRoot, id);
    const jsonPath = path.join(dir, 'project.json');
    const coverPath = path.join(dir, 'cover.bin');
    const [projectStat, coverStat] = await Promise.all([statOptional(jsonPath), statOptional(coverPath)]);
    if (!projectStat) return null;

    const { index } = await readSummaryIndex(dataRoot);
    const cached = index.entries[id];
    if (isSummaryCacheHit(cached, projectStat, coverStat)) {
        return cached.summary;
    }
    const coverMtimeMs = coverStat ? coverStat.mtimeMs : null;
    const coverSize = coverStat ? coverStat.size : null;
    if (cached && (cached.coverMtimeMs !== coverMtimeMs || cached.coverSize !== coverSize)) {
        await removeProjectThumb(dataRoot, id);
    }

    const doc = await readProjectJson(dir);
    if (!isCurrentDoc(doc)) return null;
    const summary = summarizeProjectDoc(id, doc, coverStat);
    await enqueueIndexWrite(dataRoot, async () => {
        const { index: latest } = await readSummaryIndex(dataRoot);
        latest.entries[id] = buildIndexEntry(projectStat, coverStat, summary);
        await writeSummaryIndex(dataRoot, latest);
    }).catch(() => {});
    return summary;
}

async function updateSummaryIndexEntry(dataRoot, id, jsonPath, durableDoc, coverDir) {
    const [projectStat, coverStat] = await Promise.all([
        statOptional(jsonPath),
        durableDoc.coverPresent ? statOptional(path.join(coverDir, 'cover.bin')) : Promise.resolve(null),
    ]);
    if (!projectStat) return;
    const summary = summarizeProjectDoc(id, durableDoc, coverStat);
    await enqueueIndexWrite(dataRoot, async () => {
        const { index } = await readSummaryIndex(dataRoot);
        index.entries[id] = buildIndexEntry(projectStat, coverStat, summary);
        await writeSummaryIndex(dataRoot, index);
    });
}

async function touchLastOpened(dataRoot, rawId, now) {
    const id = safeProjectId(rawId);
    const dir = projectDir(dataRoot, id);
    const doc = await readProjectJson(dir);
    if (!isCurrentDoc(doc)) return false;
    const nextLastOpened = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
    const durableDoc = { ...doc, lastOpened: nextLastOpened };
    const jsonPath = path.join(dir, 'project.json');
    await writeFileAtomic(jsonPath, JSON.stringify(durableDoc));
    await updateSummaryIndexEntry(dataRoot, id, jsonPath, durableDoc, dir).catch(() => {});
    return true;
}

async function getLiveBg(dataRoot, rawId) {
    const dir = projectDir(dataRoot, rawId);
    const doc = await readProjectJson(dir);
    if (!isCurrentDoc(doc)) return null;
    return readBinIfPresent(dir, 'liveBg.bin', doc.liveBgPresent);
}

async function putProject(dataRoot, payload) {
    const { id, doc, audio, cover, liveBg, audioStagedPath, coverStagedPath, liveBgCopyFrom } = payload || {};
    const dir = projectDir(dataRoot, id);
    const existing = await readProjectJson(dir);
    if (existing != null && !isCurrentDoc(existing)) {
        throw new Error(`拒绝覆盖旧 schema 工程: ${JSON.stringify(id)}`);
    }
    await fs.promises.mkdir(dir, { recursive: true });

    const audioPresent = await applyBinaryIntent(dataRoot, dir, 'audio.bin', doc.audioIntent, audio, audioStagedPath);
    const coverPresent = await applyBinaryIntent(dataRoot, dir, 'cover.bin', doc.coverIntent, cover, coverStagedPath);
    if (doc.coverIntent === 'set' || doc.coverIntent === 'cleared') {
        await removeProjectThumb(dataRoot, id);
    }
    const liveBgIntent = doc.liveBgIntent ?? 'cleared';
    const liveBgPresent = await applyLiveBgIntent(dataRoot, dir, liveBgIntent, liveBg, liveBgCopyFrom);

    const { audioIntent: _a, coverIntent: _c, liveBgIntent: _l, ...docRest } = doc;
    const durableDoc = { ...docRest, audioPresent, coverPresent, liveBgPresent };
    const jsonPath = path.join(dir, 'project.json');
    await writeFileAtomic(jsonPath, JSON.stringify(durableDoc));

    await updateSummaryIndexEntry(dataRoot, id, jsonPath, durableDoc, dir);
    return true;
}

async function listProjects(dataRoot) {
    let entries;
    try {
        entries = await fs.promises.readdir(projectsDir(dataRoot), { withFileTypes: true });
    } catch {
        return [];
    }

    const validIds = [];
    for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        try {
            safeProjectId(ent.name);
            validIds.push(ent.name);
        } catch {
            continue;
        }
    }

    const { index, corrupt } = await readSummaryIndex(dataRoot);
    const oldEntries = index.entries;
    let dirty = corrupt;

    const scanned = await mapLimit(validIds, LIST_STAT_CONCURRENCY, async (id) => {
        const dir = path.join(projectsDir(dataRoot), id);
        const [projectStat, coverStat] = await Promise.all([
            statOptional(path.join(dir, 'project.json')),
            statOptional(path.join(dir, 'cover.bin')),
        ]);
        if (!projectStat) {
            if (oldEntries[id]) dirty = true;
            return null;
        }

        const cached = oldEntries[id];
        if (isSummaryCacheHit(cached, projectStat, coverStat)) {
            return { id, entry: cached };
        }

        // 未命中索引或 project.json / cover.bin 已变更：仅对本工程解析 project.json
        const doc = await readProjectJson(dir);
        if (!isCurrentDoc(doc)) {
            if (cached) dirty = true;
            return null;
        }
        const coverMtimeMs = coverStat ? coverStat.mtimeMs : null;
        const coverSize = coverStat ? coverStat.size : null;
        if (cached && (cached.coverMtimeMs !== coverMtimeMs || cached.coverSize !== coverSize)) {
            await removeProjectThumb(dataRoot, id);
        }
        dirty = true;
        return {
            id,
            entry: buildIndexEntry(projectStat, coverStat, summarizeProjectDoc(id, doc, coverStat)),
        };
    });

    const activeIds = new Set();
    const out = [];
    const scannedMap = new Map();
    for (const item of scanned) {
        if (!item) continue;
        activeIds.add(item.id);
        scannedMap.set(item.id, item.entry);
        out.push(item.entry.summary);
    }

    for (const oldId of Object.keys(oldEntries)) {
        if (!activeIds.has(oldId)) {
            dirty = true;
            break;
        }
    }

    await cleanupOrphanThumbs(dataRoot, activeIds);

    if (dirty) {
        await enqueueIndexWrite(dataRoot, async () => {
            const { index: latest } = await readSummaryIndex(dataRoot);
            const merged = {};
            for (const id of activeIds) {
                const latestEntry = latest.entries[id];
                const scannedEntry = scannedMap.get(id);
                if (
                    latestEntry
                    && scannedEntry
                    && (latestEntry.projectMtimeMs > scannedEntry.projectMtimeMs
                        || (latestEntry.projectMtimeMs === scannedEntry.projectMtimeMs
                            && latestEntry.summary.lastOpened > scannedEntry.summary.lastOpened))
                ) {
                    merged[id] = latestEntry;
                } else if (scannedEntry) {
                    merged[id] = scannedEntry;
                }
            }
            await writeSummaryIndex(dataRoot, { version: SUMMARY_INDEX_VERSION, entries: merged });
        }).catch(() => {});
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
    await removeProjectThumb(dataRoot, rawId);
    await enqueueIndexWrite(dataRoot, async () => {
        const { index } = await readSummaryIndex(dataRoot);
        if (index.entries[rawId]) {
            delete index.entries[rawId];
            await writeSummaryIndex(dataRoot, index);
        }
    }).catch(() => {});
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

/**
 * 工程文件通道（装配根只调本入口，数据根每次现取 —— 用户可以在运行时搬家）。
 * @param {{ handle: Function }} ipcMain
 * @param {{ currentDataRoot: () => string }} deps
 */
function registerProjectStoreIpc(ipcMain, deps) {
    const currentDataRoot = deps.currentDataRoot;

    ipcMain.handle('project:get', async (_event, rawId) => {
        const project = await getProject(currentDataRoot(), rawId);
        if (!project) return null;
        return { doc: JSON.stringify(project.doc), audio: project.audio, cover: project.cover };
    });
    ipcMain.handle('project:touchLastOpened', (_event, rawId, now) => touchLastOpened(currentDataRoot(), rawId, now));
    ipcMain.handle('project:put', (_event, payload) => {
        // issue 232：在渲染侧编码后传文本，嵌套对象不跨 contextBridge / IPC。
        // 解析与闸门在任何文件副作用之前；路径、旧记录保护和素材 intent 仍由 putProject 执行。
        if (typeof payload?.doc !== 'string') throw new Error('project:put doc 必须是 JSON 文本');
        const doc = JSON.parse(payload.doc);
        if (!isCurrentDoc(doc)) throw new Error('project:put 工程文档 schema 无效');
        const liveBgIntent = doc.liveBgIntent ?? 'cleared';
        if (![doc.audioIntent, doc.coverIntent, liveBgIntent].every((intent) => ['set', 'keep', 'cleared'].includes(intent))) {
            throw new Error('project:put 素材 intent 无效');
        }
        return putProject(currentDataRoot(), { ...payload, doc: { ...doc, liveBgIntent } });
    });
    ipcMain.handle('project:list', async () => JSON.stringify(await listProjects(currentDataRoot())));
    ipcMain.handle('project:getSummary', async (_event, rawId) => {
        const summary = await getProjectSummary(currentDataRoot(), rawId);
        return summary ? JSON.stringify(summary) : null;
    });
    ipcMain.handle('project:delete', (_event, rawId) => deleteProject(currentDataRoot(), rawId));
    ipcMain.handle('project:getLiveBg', (_event, rawId) => getLiveBg(currentDataRoot(), rawId));
    // 发布（票 11）：工程音频 / 封面的上传引用（路径 + 字节数 + SHA-1）。
    // 二进制不过 IPC：字节留在主进程，渲染侧只拿「事实」去凑 prepare 与 multipart。
    ipcMain.handle('project:uploadRefs', (_event, rawId) => uploadRefs(currentDataRoot(), rawId));
}

module.exports = {
    SCHEMA_VERSION,
    SUMMARY_INDEX_VERSION,
    countChartNotes,
    getProject,
    getProjectSummary,
    touchLastOpened,
    getLiveBg,
    putProject,
    listProjects,
    deleteProject,
    uploadRefs,
    setAppLog,
    registerProjectStoreIpc,
};
