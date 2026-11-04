/**
 * 窗体全部关闭事件处理 (window-all-closed)
 * 在 macOS 上遵循传统多文档/桌面软件规范：关闭窗口保留进程，仅 Cmd+Q 显式退出。
 * 在 Windows / Linux 上：关闭全部窗口即退出应用。
 *
 * @param {NodeJS.Platform} platform
 * @param {{ quit: () => void }} appInstance
 */
function handleWindowAllClosed(platform, appInstance) {
    if (platform !== 'darwin') {
        appInstance.quit();
    }
}

/**
 * macOS activate 事件处理（如点击 Dock 图标）
 * 若当前无活动窗口，重新创建窗口；若已有窗口处于最小化，则恢复并聚焦。
 *
 * @param {{
 *   getWindows: () => Array<any>,
 *   createWindow: () => any,
 *   getMainWindow?: () => any,
 * }} options
 */
function handleActivate({ getWindows, createWindow, getMainWindow }) {
    const windows = getWindows ? getWindows() : [];
    if (windows.length === 0) {
        return createWindow();
    }
    const win = (getMainWindow && getMainWindow()) || windows[0];
    if (win) {
        if (typeof win.isMinimized === 'function' && win.isMinimized()) {
            win.restore();
        }
        if (typeof win.focus === 'function') {
            win.focus();
        }
    }
    return win;
}

module.exports = {
    handleWindowAllClosed,
    handleActivate,
};
