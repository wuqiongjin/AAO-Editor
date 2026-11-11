// 另存对话框的公共骨架（issue 118 / 187 / chart-preview 03 / 07 / 62）。
// 每次弹系统保存对话框，不记路径；建议名（defaultPath）与实际写盘目标（filePath 的 basename）
// 都清洗非法字符、再用 basename 兜一层 —— 渲染侧即使传入带目录的 suggestedName 也无法写进
// 记忆，曲名 / 工程名里的符号（含用户在对话框里改出的）也不会留到 writeFile 那一刻才在
// Windows 上抛 EINVAL（票 62）。取消 → { cancelled: true }；
// 写盘失败抛给渲染侧（取消不是错误；域层据此回 failure: save 档）。
//
// deps 由装配根注入（dialog / BrowserWindow / t），module 不自行 require('electron')。
// JSON 与二进制共用弹框骨架，但各自保留一条逐字写盘语句（两种载荷类型不同型）。
const fs = require('fs');
const path = require('path');

/** 各平台文件名非法字符（控制字符按码点判，不进正则）。口径同渲染侧两支就地清洗实现 */
const ILLEGAL_FILENAME_CHARS = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|']);

/** Windows 保留设备名（大小写不敏感，按第一个点之前那段判） */
const WINDOWS_RESERVED_NAMES = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
    ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/**
 * 文件名清洗（与渲染侧 `src/patterns/shareFile.ts` / `src/preview/video/encode/exportSpec.ts`
 * 同一口径；CJS 不能 import TS，故各留一份，由 PatternFileName.test.ts /
 * ExportFileName.test.ts / SaveDialogFileName.test.ts 三处行为测锁一致）。
 * 非法字符 / 控制字符 → `_`（替换不删除）、trim、去尾点空格、空名回落、保留名前置 `_`。
 * 作用于**整条** suggestedName（含扩展名）：扩展名收尾是字母数字，尾点空格清洗不碰它。
 * @returns {string} 可落盘的文件名
 */
function sanitizeFileName(name, fallbackName) {
    let out = '';
    for (const ch of name.trim()) {
        const code = ch.codePointAt(0) || 0;
        out += ILLEGAL_FILENAME_CHARS.has(ch) || code <= 0x1f || code === 0x7f ? '_' : ch;
    }
    out = out.replace(/[. ]+$/, '');
    if (!out) return fallbackName;
    const head = out.split('.')[0].trim().toUpperCase();
    return WINDOWS_RESERVED_NAMES.has(head) ? `_${out}` : out;
}

/**
 * 弹框骨架：文件名清洗 + basename 兜底 / fromWebContents / showSaveDialog / 取消判断。
 * 三条另存通道（preview:saveBinary / chartCode:saveAs / patternLibrary:saveAs）都过这里，
 * 故静态宽图 / 谱面代码与视频同源一并受益。
 * @returns {Promise<object | null>} dialog 的 result；取消时 null
 */
async function promptSaveDialog(event, payload, opts, deps) {
    const rawName = payload && payload.suggestedName;
    const candidate = typeof rawName === 'string' && rawName.length > 0 ? rawName : opts.fallbackName;
    // 先清洗再 basename：`/` 换 `_` 保住全名（原先会被 basename 截掉前缀、名字悄悄变短）
    const suggestedName = path.basename(sanitizeFileName(candidate, opts.fallbackName));
    const win = deps.BrowserWindow.fromWebContents(event.sender);
    const result = await deps.dialog.showSaveDialog(win ?? undefined, {
        title: deps.t(opts.titleKey),
        defaultPath: suggestedName,
        filters: opts.filters,
    });
    if (result.canceled || !result.filePath) {
        return null;
    }
    // 再兜一层：用户可能在对话框里把名改出非法字符，落盘目标的文件名也清洗
    // （只动 basename、不动目录），免得非法字符留到 writeFile 那一刻才抛 EINVAL。
    // 返回给两条写盘语句的仍是 result.filePath，故它们逐字不变。
    return {
        ...result,
        filePath: path.join(
            path.dirname(result.filePath),
            sanitizeFileName(path.basename(result.filePath), opts.fallbackName),
        ),
    };
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
