// 二进制另存（chart-preview 03）：宽图 PNG / WebP 与视频导出（07）复用同一通道。
// 收 { bytes: Uint8Array, suggestedName, mime }；每次 dialog、不记路径。
// 弹框骨架与类型闸在 foundation/saveDialog.cjs，这里只做 mime → 过滤器 / 标题。
const { saveBinaryWithDialog } = require('../foundation/saveDialog.cjs');

/** mime → [对话框过滤器名, 扩展名]；生产者 = 宽图（03）与视频导出（07） */
function binaryFilter(mime) {
    if (mime === 'image/webp') return { label: 'WebP', ext: 'webp' };
    if (mime === 'video/mp4') return { label: 'MP4', ext: 'mp4' };
    if (mime === 'video/webm') return { label: 'WebM', ext: 'webm' };
    return { label: 'PNG', ext: 'png' };
}

/** mime → 对话框标题的 i18n key（宽图 = 谱面图，视频 = 回放视频） */
function binaryDialogTitleKey(mime) {
    return mime === 'video/mp4' || mime === 'video/webm' ? 'electron.exportVideo' : 'electron.exportSheet';
}

function registerPreviewIpc(ipcMain, deps) {
    ipcMain.handle('preview:saveBinary', (event, payload) => {
        const mime = payload && payload.mime;
        const { label, ext } = binaryFilter(mime);
        return saveBinaryWithDialog(event, payload, {
            channel: 'preview:saveBinary',
            titleKey: binaryDialogTitleKey(mime),
            fallbackName: `export.${ext}`,
            filters: [{ name: label, extensions: [ext] }],
        }, deps);
    });
}

module.exports = { registerPreviewIpc };
