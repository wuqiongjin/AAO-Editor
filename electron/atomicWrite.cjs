/**
 * 原子写：先写同目录临时文件，再 rename 到目标位置。
 * 崩在半路不会在目标位置留半截文件；失败时清理临时文件，不留 `.tmp-*` 垃圾。
 * 不 require electron —— 平台测试可以直接跑真函数。
 *
 * Windows：目标文件被占用时 `rename` 会 EPERM（ERROR_SHARING_VIOLATION），
 * 例如工程封面 cover.bin 正在被列表读、资源管理器预览或杀毒扫描。
 * POSIX 的 rename 覆盖已存在文件；Win32 在句柄未放时不能替换。短暂重试 + 先卸目标再 rename。
 */
const fs = require('fs');

const WIN_RENAME_TRIES = 8;

/** 临时文件与目标同目录（rename 才能原子），带 pid + 时间戳（同进程并发不互踩） */
function tmpPathFor(filePath) {
    return `${filePath}.tmp-${process.pid}-${Date.now()}`;
}

function isWinLockErr(err) {
    return process.platform === 'win32' && err && (err.code === 'EPERM' || err.code === 'EACCES');
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function delaySync(ms) {
    const buf = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(buf, 0, 0, ms);
}

/** 把 tmp 换到目标位；Windows 上目标被锁时短暂重试。成功后 tmp 不再存在。 */
async function renameOver(tmpPath, filePath) {
    try {
        await fs.promises.rename(tmpPath, filePath);
        return;
    } catch (err) {
        if (!isWinLockErr(err)) throw err;
        let last = err;
        for (let i = 0; i < WIN_RENAME_TRIES; i++) {
            await delay(25 * (i + 1));
            try {
                await fs.promises.rm(filePath, { force: true });
                await fs.promises.rename(tmpPath, filePath);
                return;
            } catch (retryErr) {
                last = retryErr;
                if (!isWinLockErr(retryErr) && retryErr.code !== 'ENOENT') throw retryErr;
            }
        }
        throw last;
    }
}

function renameOverSync(tmpPath, filePath) {
    try {
        fs.renameSync(tmpPath, filePath);
        return;
    } catch (err) {
        if (!isWinLockErr(err)) throw err;
        let last = err;
        for (let i = 0; i < WIN_RENAME_TRIES; i++) {
            delaySync(25 * (i + 1));
            try {
                fs.rmSync(filePath, { force: true });
                fs.renameSync(tmpPath, filePath);
                return;
            } catch (retryErr) {
                last = retryErr;
                if (!isWinLockErr(retryErr) && retryErr.code !== 'ENOENT') throw retryErr;
            }
        }
        throw last;
    }
}

/** @param {string} filePath @param {string | Buffer} data */
async function writeFileAtomic(filePath, data) {
    const tmpPath = tmpPathFor(filePath);
    try {
        await fs.promises.writeFile(tmpPath, data);
        await renameOver(tmpPath, filePath);
    } catch (err) {
        await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
        throw err;
    }
}

/** 同步版：appState 这类同步保存路径用（口径与异步版一致） */
function writeFileAtomicSync(filePath, data) {
    const tmpPath = tmpPathFor(filePath);
    try {
        fs.writeFileSync(tmpPath, data);
        renameOverSync(tmpPath, filePath);
    } catch (err) {
        try {
            fs.rmSync(tmpPath, { force: true });
        } catch {
            /* 清不掉不挡原错误 */
        }
        throw err;
    }
}

module.exports = { writeFileAtomic, writeFileAtomicSync, renameOver };
