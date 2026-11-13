const fs = require('fs');
const path = require('path');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_AGE_DAYS = 7;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

const MANAGED = /^(errors|trail)-(\d{8})(?:-(\d+))?(\.log|\.jsonl)$/;

function utcStamp(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

function trackExt(track) {
    return track === 'trail' ? '.jsonl' : '.log';
}

function parseManaged(name) {
    const m = MANAGED.exec(name);
    if (!m) return null;
    const track = m[1];
    const ext = m[4];
    if (track === 'errors' && ext !== '.log') return null;
    if (track === 'trail' && ext !== '.jsonl') return null;
    return {
        name,
        track,
        stamp: m[2],
        index: m[3] ? Number(m[3]) : 1,
    };
}

function fileName(track, stamp, index) {
    const ext = trackExt(track);
    if (index <= 1) return `${track}-${stamp}${ext}`;
    return `${track}-${stamp}-${index}${ext}`;
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

function managedWithSize(files) {
    const out = [];
    for (const f of files) {
        const parsed = parseManaged(f.name);
        if (!parsed) continue;
        out.push({ ...parsed, size: f.size });
    }
    return out;
}

function olderFirst(a, b) {
    if (a.stamp !== b.stamp) return a.stamp < b.stamp ? -1 : 1;
    if (a.index !== b.index) return a.index - b.index;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function chooseWriteName(files, now, entryBytes, track) {
    const today = utcStamp(now);
    const todayFiles = files
        .map((f) => {
            const parsed = parseManaged(f.name);
            if (!parsed || parsed.track !== track || parsed.stamp !== today) return null;
            return { ...parsed, size: f.size };
        })
        .filter(Boolean)
        .sort((a, b) => a.index - b.index);
    if (todayFiles.length === 0) return fileName(track, today, 1);
    const latest = todayFiles[todayFiles.length - 1];
    const wouldExceed = latest.size + entryBytes > MAX_FILE_BYTES;
    if (!wouldExceed || latest.size === 0) return latest.name;
    return fileName(track, today, latest.index + 1);
}

/**
 * 按天切文件、单文件 5MB、保留 7 天 / 目录合计 50MB。
 * 输入当前目录文件状态 + 新条目字节数，输出写哪个文件、删哪些。
 *
 * @param {{
 *   files: Array<{ name: string, size: number }>,
 *   now: Date,
 *   entryBytes: number,
 *   track: 'errors' | 'trail',
 * }} input
 * @returns {{ writeName: string, deleteNames: string[] }}
 */
function planLogRotation(input) {
    const { files, now, entryBytes, track } = input;
    const writeName = chooseWriteName(files, now, entryBytes, track);
    const managed = managedWithSize(files).sort(olderFirst);
    const todayNum = utcDayNumber(now);
    const deleteNames = [];
    const remaining = [];
    for (const f of managed) {
        if (todayNum - stampDayNumber(f.stamp) >= MAX_AGE_DAYS) {
            deleteNames.push(f.name);
        } else {
            remaining.push(f);
        }
    }
    const foreignBytes = files.reduce((sum, f) => (parseManaged(f.name) ? sum : sum + f.size), 0);
    let total = remaining.reduce((sum, f) => sum + f.size, 0) + entryBytes + foreignBytes;
    for (const f of remaining.slice()) {
        if (total <= MAX_TOTAL_BYTES) break;
        if (f.name === writeName) continue;
        deleteNames.push(f.name);
        total -= f.size;
        const idx = remaining.indexOf(f);
        if (idx >= 0) remaining.splice(idx, 1);
    }
    return { writeName, deleteNames };
}

function jsonableExtra(extra) {
    if (extra === undefined || extra === null) return undefined;
    if (extra instanceof Error) return { message: extra.message, stack: extra.stack };
    try {
        JSON.stringify(extra);
        return extra;
    } catch {
        return String(extra);
    }
}

/** 与 src/diagnostics/logger.ts 的 formatLogLine 同形（两边不能互相 import）。 */
function formatLogLine(level, module, message, extra, at) {
    const prefix = String(module).startsWith('[') ? String(module) : `[${module}]`;
    let line = `${at.toISOString()} ${String(level).toUpperCase()} ${prefix} ${message}`;
    const jsonVal = jsonableExtra(extra);
    if (jsonVal !== undefined) line += ` ${JSON.stringify(jsonVal)}`;
    return line;
}

function listLogFiles(dir) {
    try {
        return fs.readdirSync(dir).flatMap((name) => {
            try {
                const st = fs.statSync(path.join(dir, name));
                if (!st.isFile()) return [];
                return [{ name, size: st.size }];
            } catch {
                return [];
            }
        });
    } catch {
        return [];
    }
}

/**
 * 每条写入都重新扫目录，在轨迹 flush（一次最多 500 条）时太贵：
 * 扫描结果按 UTC 天缓存，同一天的连续写入只扫一次；
 * 文件大小随 append / 删除增量更新，轮转判定仍然准确；跨天必然重扫。
 *
 * @param {{ userData: string | (() => string), now?: () => Date }} deps
 */
function createAppLog(deps) {
    const nowFn = deps.now || (() => new Date());
    function logsDir() {
        const userData = typeof deps.userData === 'function' ? deps.userData() : deps.userData;
        return path.join(userData, 'logs');
    }
    let scanDay = null;
    let scanFiles = [];
    // 单实例口径：logs 目录只由本进程的 appLog 写。第二个实例 / 外部删文件看不到，
    // 最坏晚一个 UTC 天反映——轮转上限（5MB / 7 天 / 50MB）仍由下次重扫兜住。
    function filesFor(now) {
        const day = utcStamp(now);
        if (scanDay !== day) {
            scanDay = day;
            scanFiles = listLogFiles(logsDir());
        }
        return scanFiles;
    }
    function append(track, line, now) {
        const entryBytes = Buffer.byteLength(line, 'utf8');
        const files = filesFor(now);
        const plan = planLogRotation({ files, now, entryBytes, track });
        fs.mkdirSync(logsDir(), { recursive: true });
        for (const name of plan.deleteNames) {
            try {
                fs.unlinkSync(path.join(logsDir(), name));
            } catch {
                // 删不掉：缓存里留着它——50MB 预算与轮转判定才不会少算一份
                continue;
            }
            const idx = files.findIndex((f) => f.name === name);
            if (idx >= 0) files.splice(idx, 1);
        }
        try {
            fs.appendFileSync(path.join(logsDir(), plan.writeName), line);
        } catch (err) {
            // 写失败：缓存里的体积没更新，作废等下次重扫，避免轮转判定少算
            scanDay = null;
            throw err;
        }
        const target = files.find((f) => f.name === plan.writeName);
        if (target) target.size += entryBytes;
        else files.push({ name: plan.writeName, size: entryBytes });
    }
    return {
        write(payload) {
            try {
                const wall = nowFn();
                const parsed = payload && payload.ts ? new Date(payload.ts) : wall;
                const atDate = Number.isNaN(parsed.getTime()) ? wall : parsed;
                const line = `${formatLogLine(
                    (payload && payload.level) || 'info',
                    (payload && payload.module) || 'app',
                    payload && payload.message != null ? String(payload.message) : '',
                    payload && payload.extra,
                    atDate,
                )}\n`;
                append('errors', line, wall);
            } catch {
                /* 日志失败不能打翻业务 */
            }
        },
        appendTrail(event) {
            // 本票 sink 立刻落 jsonl；票 02 的 ring buffer 是调用方，崩溃/诊断包再 dump。
            try {
                // JSON.stringify(undefined) 得到 undefined 而不是字符串
                const text = JSON.stringify(event);
                if (typeof text !== 'string') return;
                append('trail', `${text}\n`, nowFn());
            } catch {
                /* 不可序列化 / 写盘失败：丢掉这一条 */
            }
        },
    };
}

function registerAppLogIpc(ipcMain, appLog) {
    ipcMain.handle('log:write', (_event, payload) => appLog.write(payload));
    ipcMain.handle('log:trail', (_event, payload) => appLog.appendTrail(payload));
}

module.exports = {
    MAX_FILE_BYTES,
    MAX_AGE_DAYS,
    MAX_TOTAL_BYTES,
    planLogRotation,
    formatLogLine,
    createAppLog,
    registerAppLogIpc,
    // 与 diagnosticsExport.cjs 共享的托管日志文件名 / 日期计算（避免两处漂移）
    parseManaged,
    utcDayNumber,
    stampDayNumber,
};
