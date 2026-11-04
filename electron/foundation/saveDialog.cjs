// 另存对话框的公共骨架（issue 118 / 187 / chart-preview 03 / 07）。
// 每次弹系统保存对话框，不记路径；defaultPath 只用 basename —— 渲染侧即使传入
// 带目录的 suggestedName 也无法写进记忆。取消 → { cancelled: true }；
// 写盘失败抛给渲染侧（取消不是错误）。
//
// deps 由装配根注入（dialog / BrowserWindow / t），module 不自行 require('electron')。
// JSON 与二进制共用弹框骨架，但各自保留一条逐字写盘语句（两种载荷类型不同型）。
const fs = require('fs');
const path = require('path');

/**
 * 弹框骨架：basename 消毒 / fromWebContents / showSaveDialog / 取消判断。
 * @returns {Promise<object | null>} dialog 的 result；取消时 null
 */
async function promptSaveDialog(event, payload, opts, deps) {
    const rawName = payload && payload.suggestedName;
    const suggestedName =
        typeof rawName === 'string' && rawName.length > 0
            ? path.basename(rawName)
            : opts.fallbackName;
    const win = deps.BrowserWindow.fromWebContents(event.sender);
    const result = await deps.dialog.showSaveDialog(win ?? undefined, {
        title: deps.t(opts.titleKey),
        defaultPath: suggestedName,
        filters: opts.filters,
    });
    if (result.canceled || !result.filePath) {
        return null;
    }
    return result;
}

/** JSON 文本另存（谱面代码 / 片段库分享导出）。 */
async function saveJsonWithDialog(event, payload, opts, deps) {
    const json = payload && payload.json;
    if (typeof json !== 'string') {
        throw new Error(`${opts.channel} 需要 json 字符串`);
    }
    const result = await promptSaveDialog(event, payload, opts, deps);
    if (!result) {
        return { cancelled: true };
    }
    await fs.promises.writeFile(result.filePath, json, 'utf8');
    return { cancelled: false };
}

/** 二进制另存（宽图 PNG / WebP、回放视频 MP4 / WebM）。 */
async function saveBinaryWithDialog(event, payload, opts, deps) {
    const bytes = payload && payload.bytes;
    if (!(bytes instanceof Uint8Array)) {
        throw new Error(`${opts.channel} 需要字节`);
    }
    const result = await promptSaveDialog(event, payload, opts, deps);
    if (!result) {
        return { cancelled: true };
    }
    // 整块写完，不做流式：宽图上百 MB（30 分钟谱）、视频几十 MB~数百 MB 都走同一条路。
    await fs.promises.writeFile(result.filePath, Buffer.from(bytes));
    return { cancelled: false };
}

module.exports = {
    saveJsonWithDialog,
    saveBinaryWithDialog,
};
