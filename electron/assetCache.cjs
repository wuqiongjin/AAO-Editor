/**
 * 社区素材缓存（bestdori-integration 14）：下载一次、跨启动复用。
 *
 * 它取代了 07 的「下载暂存」（`<数据根>/downloads/`，过程态、启动清空）——定案见
 * `.scratch/bestdori-integration/issues/14-素材缓存与过期策略.md`：
 *   - 范围：曲库索引 / 单曲详情 / 谱面原文 / 封面（原图 + 缩略图）/ 音频；json / text / binary 同一套机制；
 *   - 位置：`<数据根>/cache/community/`，按 URL 哈希寻址（`<hash16>-<名>`），旁边一份 index.json 记条目；
 *   - 回收：30 天未用即清；总量超 1GB 按最久未用清；半截文件（`.part-*`）一并清。
 *
 * 三件事只住在这里：**寻址（URL → 文件）**、**记账（lastUsedAt / bytes）**、**回收**。
 * 「多久算新鲜、过期怎么办」是网关的策略（见 communityNet.cjs），本模块不掺和。
 *
 * 缩略图（票 15）是**同一条目的附产**：图片进缓存时顺手产一份（`makeThumb` 注入，见
 * assetThumbnails.cjs），文件名挂在条目的 `thumb` 上；占用、回收、摘除都算上它。
 * 「老条目没有缩略图」由 `ensureThumb()` 现产自愈 —— 它是**只读时的补救**，不影响 store 的写法。
 *
 * 版权口径（ADR-0011 §4 + issue 05）：缓存只在用户本机、只为复用下载，**不进任何分发物**；
 * 工程自己的音频 / 封面仍是拷进 `<数据根>/projects/<id>/`，缓存只做「下载一次、多处复用」的源。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** 条目最长闲置：30 天未用即清（票 14 定案） */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** 总量上限：1GB，超了按最久未用清（票 14 定案） */
const MAX_BYTES = 1024 * 1024 * 1024;
/** 半截文件（`.part-*`）超过这个年龄才算崩溃残留 —— 正在写的那一份不动 */
const PART_MAX_AGE_MS = 60 * 60 * 1000;
/**
 * 策略可配之后的**硬边界**（票 18）：界面那把尺在 `AppSettings.CACHE_POLICY_RANGE`（1–365 天 / 64MB–64GB），
 * 这里放宽一档兜着 —— renderer 递什么进来都先夹一次，绝不让它把缓存清成空转或撑爆磁盘。
 */
const POLICY_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const POLICY_MAX_AGE_MS = 3650 * 24 * 60 * 60 * 1000;
const POLICY_MIN_BYTES = 1024 * 1024;
const POLICY_MAX_BYTES = 64 * 1024 * 1024 * 1024;
/** 命中后 lastUsedAt 的落盘节流：30 天的口径不差这一会儿，免得每次命中都写索引 */
const BUMP_FLUSH_INTERVAL_MS = 5 * 60 * 1000;
/** 写入后年龄清扫的节流：长开着的会话也会被扫到，但不会每次写入都全量 stat */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const INDEX_FILE = 'index.json';
const INDEX_VERSION = 1;

function emptyIndex() {
    return { version: INDEX_VERSION, entries: {} };
}

/** URL → 短哈希（16 hex = 64 位；命中时还会比对完整 URL，哈希撞了也只当未命中） */
function hash16(text) {
    return crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);
}

/** 建议名只取 basename、剥掉路径分隔符（renderer 递进来的名字不可信） */
function safeStem(suggestedName) {
    const base = path.basename(String(suggestedName || '')).replace(/[^\w.-]+/g, '_').replace(/^\.+/, '');
    return base === '' ? 'download' : base.slice(0, 80);
}

function cacheFileName(url, suggestedName) {
    return `${hash16(url)}-${safeStem(suggestedName)}`;
}

/** 有限数夹进区间；不是有限数就保持原值（策略参数不接受 NaN / 字符串） */
function clampNumber(value, min, max, fallback) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
}

/** 文件名只准是文件名：越界路径（历史索引被改过）一律不认 */
function isFileName(value) {
    return typeof value === 'string' && value !== '' && !value.includes('/') && !value.includes('\\');
}

/** 索引里的缩略图记录（可以没有）：file 与条目同规矩，bytes / contentType 供记账与响应头用 */
function isThumb(value) {
    if (value == null) return true;
    if (typeof value !== 'object') return false;
    if (!isFileName(value.file)) return false;
    if (!Number.isFinite(value.bytes) || value.bytes < 0) return false;
    if (value.contentType != null && typeof value.contentType !== 'string') return false;
    return true;
}

/** 索引里的条目：形状不对的整条丢（索引文件是本机状态，坏了不能拖垮功能） */
function isEntry(value) {
    if (value == null || typeof value !== 'object') return false;
    const { url, kind, file, bytes, cachedAt, lastUsedAt } = value;
    if (typeof url !== 'string' || url === '') return false;
    if (typeof kind !== 'string' || kind === '') return false;
    if (!isFileName(file)) return false;
    if (!Number.isFinite(bytes) || bytes < 0) return false;
    if (!Number.isFinite(cachedAt) || !Number.isFinite(lastUsedAt)) return false;
    if (!isThumb(value.thumb)) return false;
    return true;
}

/** 一条素材的磁盘占用：原图 + 缩略图（统计与回收都看它，别把缩略图漏在账外） */
function entryBytes(entry) {
    return entry.bytes + (entry.thumb ? entry.thumb.bytes : 0);
}

function parseIndex(raw) {
    if (raw == null) return emptyIndex();
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return emptyIndex();
    }
    if (parsed == null || typeof parsed !== 'object' || parsed.entries == null || typeof parsed.entries !== 'object') {
        return emptyIndex();
    }
    const entries = {};
    for (const [key, value] of Object.entries(parsed.entries)) {
        if (isEntry(value)) entries[key] = value;
    }
    return { version: INDEX_VERSION, entries };
}

async function removeFile(filePath) {
    try {
        await fs.promises.rm(filePath, { force: true });
    } catch {
        // 尽力：删不掉的文件下次清扫还会来
    }
}

/**
 * 创建缓存实例。
 * @param {{
 *   dir: string | (() => string),
 *   now?: () => number,
 *   maxAgeMs?: number,
 *   maxBytes?: number,
 *   makeThumb?: (bytes: Buffer, contentType: string | null) => ({ bytes: Buffer | Uint8Array, contentType?: string | null } | null),
 * }} options
 */
function createAssetCache(options) {
    const dir = options && options.dir;
    const now = (options && options.now) || Date.now;
    /** 回收参数：票 14 定案的默认值，票 18 起可以由界面改（`configure()`） */
    let maxAgeMs = (options && options.maxAgeMs) ?? MAX_AGE_MS;
    let maxBytes = (options && options.maxBytes) ?? MAX_BYTES;
    /** 缩略图产出（票 15）：注入的纯函数，产出为空 = 这条素材没有缩略图 */
    const makeThumb = (options && options.makeThumb) || null;

    /** @type {{ version: number, entries: Record<string, any> } | null} */
    let index = null;
    let lastFlushAt = -Infinity;
    let lastSweepAt = -Infinity;

    function resolveDir() {
        const value = typeof dir === 'function' ? dir() : dir;
        if (typeof value !== 'string' || value.trim() === '') throw new Error('素材缓存需要目录');
        return value;
    }

    async function ensureDir() {
        const resolved = resolveDir();
        await fs.promises.mkdir(resolved, { recursive: true });
        return resolved;
    }

    async function loadIndex() {
        if (index != null) return index;
        const resolved = await ensureDir();
        let raw = null;
        try {
            raw = await fs.promises.readFile(path.join(resolved, INDEX_FILE), 'utf8');
        } catch {
            raw = null;
        }
        index = parseIndex(raw);
        lastFlushAt = now();
        return index;
    }

    /** 落索引（尽力而为：写不进去只丢「最久未用」的记账精度，不影响读写素材） */
    async function flush() {
        const resolved = resolveDir();
        const target = path.join(resolved, INDEX_FILE);
        const tmpPath = `${target}.part-${process.pid}-${Date.now()}`;
        try {
            await fs.promises.writeFile(tmpPath, JSON.stringify(index));
            await fs.promises.rename(tmpPath, target);
            lastFlushAt = now();
            return true;
        } catch {
            await removeFile(tmpPath);
            return false;
        }
    }

    /** 命中后的 lastUsedAt 攒着写：距上次落盘超过节流窗才顺手写一次 */
    function bumpFlush() {
        if (now() - lastFlushAt >= BUMP_FLUSH_INTERVAL_MS) void flush();
    }

    /** 超上限就按最久未用清到线上（写入后扫一次用这条） */
    async function enforceSize(resolved, idx) {
        const entries = Object.entries(idx.entries);
        let total = entries.reduce((sum, [, entry]) => sum + entryBytes(entry), 0);
        if (total <= maxBytes) return { removed: 0, freedBytes: 0 };
        let removed = 0;
        let freedBytes = 0;
        for (const [key, entry] of entries.sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)) {
            if (total <= maxBytes) break;
            delete idx.entries[key];
            await removeEntryFiles(resolved, entry);
            total -= entryBytes(entry);
            freedBytes += entryBytes(entry);
            removed += 1;
        }
        return { removed, freedBytes };
    }

    /** 清掉崩溃残留的半截文件（`.part-*`；正在写的那份太新，不动） */
    async function sweepParts(resolved, at) {
        let freedBytes = 0;
        let names;
        try {
            names = await fs.promises.readdir(resolved);
        } catch {
            return 0;
        }
        for (const name of names) {
            if (!/\.part-\d+-\d+$/.test(name)) continue;
            const filePath = path.join(resolved, name);
            try {
                const stat = await fs.promises.stat(filePath);
                if (at - stat.mtimeMs > PART_MAX_AGE_MS) {
                    freedBytes += stat.size;
                    await removeFile(filePath);
                }
            } catch {
                // 已经不在了
            }
        }
        return freedBytes;
    }

    /**
     * 给一条素材产缩略图并落盘，回索引里那条 `thumb` 记录（产不出 / 写不进都回 null）。
     * 全程尽力而为：缩略图是**加速件**，它失败不该让素材本身进不去缓存。
     * 文件名 = 原图名 + `.thumb.png`（产出器只产 PNG，见 assetThumbnails.cjs）。
     * @returns {Promise<{ file: string, bytes: number, contentType: string | null } | null>}
     */
    async function writeThumb(resolved, file, bytes, contentType) {
        if (typeof makeThumb !== 'function') return null;
        let made = null;
        try {
            made = await makeThumb(bytes, contentType ?? null);
        } catch {
            return null;
        }
        if (made == null || !(made.bytes instanceof Uint8Array) || made.bytes.length === 0) return null;
        const thumbFile = `${file}.thumb.png`;
        const thumbPath = path.join(resolved, thumbFile);
        const tmpPath = `${thumbPath}.part-${process.pid}-${Date.now()}`;
        try {
            await fs.promises.writeFile(tmpPath, Buffer.from(made.bytes));
            await fs.promises.rename(tmpPath, thumbPath);
        } catch {
            await removeFile(tmpPath);
            return null;
        }
        return {
            file: thumbFile,
            bytes: Buffer.from(made.bytes).length,
            contentType: made.contentType ?? null,
        };
    }

    /** 摘掉条目名下（原图之外）的缩略图文件；本来就是坏的索引也尽力删 */
    async function removeEntryFiles(resolved, entry) {
        await removeFile(path.join(resolved, entry.file));
        if (entry.thumb) await removeFile(path.join(resolved, entry.thumb.file));
    }

    const api = {
        /** 缓存目录（现取：数据根可以被用户搬家） */
        resolveDir,

        /**
         * 按 URL + kind 找条目；文件没了 / URL 对不上都当未命中（顺手把坏条目摘掉）。
         * 命中会更新 lastUsedAt（回收看的是它）。缩略图缺失**不算未命中**（`thumb` 只是记录，
         * 真要读它走 `ensureThumb()`）。
         * @param {{ url: string, kind: string }} query
         */
        async lookup(query) {
            const { url, kind } = query;
            const resolved = await ensureDir();
            const idx = await loadIndex();
            const key = hash16(url);
            const entry = idx.entries[key];
            if (entry == null || entry.url !== url || entry.kind !== kind) return null;
            const filePath = path.join(resolved, entry.file);
            try {
                await fs.promises.access(filePath);
            } catch {
                delete idx.entries[key];
                await flush();
                return null;
            }
            entry.lastUsedAt = now();
            bumpFlush();
            return { ...entry, path: filePath };
        },

        /**
         * 读条目字节
         * @param {{ path: string }} entry
         */
        async read(entry) {
            return fs.promises.readFile(entry.path);
        },

        /**
         * 落一份素材（原子写：先 `.part-*` 再 rename，绝不出现半截条目）
         * @param {{
         *   url: string,
         *   kind: string,
         *   bytes: Buffer | Uint8Array,
         *   contentType?: string | null,
         *   status?: number,
         *   suggestedName?: string,
         * }} input
         */
        async store(input) {
            const { url, kind, bytes, contentType = null, status = 200, suggestedName = '' } = input;
            const resolved = await ensureDir();
            const idx = await loadIndex();
            const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
            const file = cacheFileName(url, suggestedName);
            const filePath = path.join(resolved, file);
            const tmpPath = `${filePath}.part-${process.pid}-${Date.now()}`;
            await fs.promises.writeFile(tmpPath, buffer);
            await fs.promises.rename(tmpPath, filePath);

            const at = now();
            const previous = idx.entries[hash16(url)];
            const thumb = await writeThumb(resolved, file, buffer, contentType);
            idx.entries[hash16(url)] = {
                url,
                kind,
                file,
                bytes: buffer.length,
                contentType,
                status,
                cachedAt: at,
                lastUsedAt: at,
                ...(thumb ? { thumb } : {}),
            };
            // 旧的缩略图不再被这条引用（这次没产出来 / 换了文件名）：删掉，别留成索引里没有的孤儿
            if (previous != null && previous.thumb != null && previous.thumb.file !== thumb?.file) {
                await removeFile(path.join(resolved, previous.thumb.file));
            }
            await flush();
            await enforceSize(resolved, idx);
            await maybeSweep();
            return { ...idx.entries[hash16(url)], path: filePath };
        },

        /**
         * 取缩略图（票 15）：条目里记着就直接用；没记着（本功能之前进的缓存 / 上次产出失败）
         * 就拿原图现产一份并写回索引 —— **老缓存自愈**，不必让用户清缓存。
         * 产不出（不是图片 / 解码失败 / 没接产出器）回 null = 界面降级成图标。
         * @param {{ url: string, file: string, bytes: number, contentType?: string | null, path?: string, thumb?: any }} entry
         * @returns {Promise<{ file: string, bytes: number, contentType: string | null, path: string } | null>}
         */
        async ensureThumb(entry) {
            const resolved = await ensureDir();
            const idx = await loadIndex();
            // 只认「索引里还是那一条」：条目被清 / 被换过就不产了 —— 免得产出一份没人认领的文件
            const current = idx.entries[hash16(entry.url)];
            if (current == null || current.file !== entry.file) return null;
            if (entry.thumb != null) {
                const existing = path.join(resolved, entry.thumb.file);
                try {
                    await fs.promises.access(existing);
                    return { ...entry.thumb, path: existing };
                } catch {
                    // 文件没了（被清 / 被删）：下面重建
                }
            }
            const originalPath = entry.path ?? path.join(resolved, entry.file);
            let original;
            try {
                original = await fs.promises.readFile(originalPath);
            } catch {
                return null;
            }
            const made = await writeThumb(resolved, entry.file, original, entry.contentType ?? null);
            if (made == null) return null;
            current.thumb = made;
            await flush();
            return { ...made, path: path.join(resolved, made.file) };
        },

        /** 摘掉一条（内容坏了 / 不再适用）；缩略图跟着走 */
        async drop(entry) {
            const idx = await loadIndex();
            const key = hash16(entry.url);
            const current = idx.entries[key];
            if (current != null && current.file !== entry.file) return;
            delete idx.entries[key];
            await removeFile(entry.path ?? path.join(resolveDir(), entry.file));
            const thumbFile = entry.thumb?.file ?? current?.thumb?.file;
            if (thumbFile) await removeFile(path.join(resolveDir(), thumbFile));
            await flush();
        },

        /** 占用统计（设置页「存储与数据」用）；缩略图算进它所属条目的桶里，不单列 */
        async stats() {
            await ensureDir();
            const idx = await loadIndex();
            /** @type {Record<string, { bytes: number, count: number }>} */
            const byKind = {};
            let totalBytes = 0;
            let count = 0;
            for (const entry of Object.values(idx.entries)) {
                totalBytes += entryBytes(entry);
                count += 1;
                const bucket = byKind[entry.kind] ?? { bytes: 0, count: 0 };
                bucket.bytes += entryBytes(entry);
                bucket.count += 1;
                byKind[entry.kind] = bucket;
            }
            return { totalBytes, count, byKind };
        },

        /** 清扫：文件缺失 / 30 天未用 / 崩溃残留的半截文件 / 超 1GB 的最久未用项 */
        async sweep() {
            const resolved = await ensureDir();
            const idx = await loadIndex();
            const at = now();
            let removed = 0;
            let freedBytes = 0;

            for (const [key, entry] of Object.entries(idx.entries)) {
                const filePath = path.join(resolved, entry.file);
                let exists = true;
                try {
                    await fs.promises.access(filePath);
                } catch {
                    exists = false;
                }
                if (!exists || at - entry.lastUsedAt > maxAgeMs) {
                    delete idx.entries[key];
                    if (exists) {
                        await removeEntryFiles(resolved, entry);
                        freedBytes += entryBytes(entry);
                    } else if (entry.thumb) {
                        // 原图已经没了：缩略图别留成没人认领的孤儿
                        await removeFile(path.join(resolved, entry.thumb.file));
                    }
                    removed += 1;
                }
            }

            freedBytes += await sweepParts(resolved, at);
            const enforced = await enforceSize(resolved, idx);
            await flush();
            lastSweepAt = at;
            return { removed, freedBytes: freedBytes + enforced.freedBytes };
        },

        /**
         * 改回收策略（票 18）：**下一次清扫 / 写入容量兜底就按新值算**，不用重启。
         * renderer 递来的数一律再夹一次（界面是软约束，这里是硬约束）。
         * @param {{ maxAgeMs?: number, maxBytes?: number }} policy
         */
        configure(policy) {
            const input = policy && typeof policy === 'object' ? policy : {};
            maxAgeMs = clampNumber(input.maxAgeMs, POLICY_MIN_AGE_MS, POLICY_MAX_AGE_MS, maxAgeMs);
            maxBytes = clampNumber(input.maxBytes, POLICY_MIN_BYTES, POLICY_MAX_BYTES, maxBytes);
            return { maxAgeMs, maxBytes };
        },

        /** 清空（设置页「清除缓存」）：整目录重来，索引一并清 */
        async clear() {
            const resolved = resolveDir();
            let freedBytes = 0;
            try {
                freedBytes = (await api.stats()).totalBytes;
            } catch {
                freedBytes = 0;
            }
            await fs.promises.rm(resolved, { recursive: true, force: true });
            await fs.promises.mkdir(resolved, { recursive: true });
            index = emptyIndex();
            lastFlushAt = now();
            return { freedBytes };
        },
    };

    /** 写入后顺手扫一次（节流 1 小时）：长开着的会话也会被扫到，但不每次写入都全量 stat */
    async function maybeSweep() {
        if (now() - lastSweepAt < SWEEP_INTERVAL_MS) return;
        await api.sweep();
    }

    return api;
}

/**
 * 注册 IPC 通道（形态照既有桥：一个命名空间一条 invoke）。
 * 三条，都是设置页「存储与数据」用的：只读查询 / 显式清除 / 回收策略推送（票 18）。
 * @param {{ handle: (channel: string, listener: Function) => void }} ipcMain
 * @param {ReturnType<typeof createAssetCache>} assetCache
 */
function registerAssetCacheIpc(ipcMain, assetCache) {
    ipcMain.handle('assetCache:stats', () => assetCache.stats());
    ipcMain.handle('assetCache:clear', () => assetCache.clear());
    ipcMain.handle('assetCache:configure', (_event, policy) => assetCache.configure(policy));
}

module.exports = {
    MAX_AGE_MS,
    MAX_BYTES,
    POLICY_MIN_AGE_MS,
    POLICY_MAX_AGE_MS,
    POLICY_MIN_BYTES,
    POLICY_MAX_BYTES,
    PART_MAX_AGE_MS,
    INDEX_FILE,
    createAssetCache,
    registerAssetCacheIpc,
};
