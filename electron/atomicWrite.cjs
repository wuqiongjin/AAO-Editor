/**
 * 原子写：先写同目录临时文件，再 rename 到目标位置。
 * 崩在半路不会在目标位置留半截文件；失败时清理临时文件，不留 `.tmp-*` 垃圾。
 * 不 require electron —— 平台测试可以直接跑真函数。
 */
const fs = require('fs');

/** 临时文件与目标同目录（rename 才能原子），带 pid + 时间戳（同进程并发不互踩） */
function tmpPathFor(filePath) {
    return `${filePath}.tmp-${process.pid}-${Date.now()}`;
}

/** @param {string} filePath @param {string | Buffer} data */
async function writeFileAtomic(filePath, data) {
    const tmpPath = tmpPathFor(filePath);
    try {
        await fs.promises.writeFile(tmpPath, data);
        await fs.promises.rename(tmpPath, filePath);
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
        fs.renameSync(tmpPath, filePath);
    } catch (err) {
        try {
            fs.rmSync(tmpPath, { force: true });
        } catch {
            /* 清不掉不挡原错误 */
        }
        throw err;
    }
}

module.exports = { writeFileAtomic, writeFileAtomicSync };
