/**
 * Electron 窗体 OS chrome 与 settings.theme 对齐（issue 126）。
 * 色值与 src/app/styles/tokens.css 的 --bg / --text 一致，供 nativeTheme 与 backgroundColor 使用。
 */

/** @typedef {'light' | 'dark' | 'system'} AppTheme */

const LIGHT_BG = '#f6f7f9';
const DARK_BG = '#15181d';

/**
 * @param {unknown} raw
 * @returns {AppTheme}
 */
function normalizeAppTheme(raw) {
    if (raw === 'light' || raw === 'dark' || raw === 'system') {
        return raw;
    }
    return 'system';
}

/**
 * @param {AppTheme} appTheme
 * @param {boolean} shouldUseDarkColors nativeTheme.shouldUseDarkColors
 * @returns {'light' | 'dark'}
 */
function resolvedAppearance(appTheme, shouldUseDarkColors) {
    if (appTheme === 'light') return 'light';
    if (appTheme === 'dark') return 'dark';
    return shouldUseDarkColors ? 'dark' : 'light';
}

/**
 * @param {'light' | 'dark'} appearance
 * @returns {string}
 */
function chromeBackgroundFor(appearance) {
    return appearance === 'dark' ? DARK_BG : LIGHT_BG;
}

/**
 * @param {AppTheme} appTheme
 * @param {{ themeSource: string }} nativeTheme
 */
function applyNativeThemeSource(appTheme, nativeTheme) {
    nativeTheme.themeSource = normalizeAppTheme(appTheme);
}

/**
 * @param {import('electron').BrowserWindow} win
 * @param {AppTheme} appTheme
 * @param {{ shouldUseDarkColors: boolean }} nativeTheme
 * @param {string} [platform]
 */
function applyBrowserWindowChrome(win, appTheme, nativeTheme, platform = process.platform) {
    const theme = normalizeAppTheme(appTheme);
    const appearance = resolvedAppearance(theme, nativeTheme.shouldUseDarkColors);
    const bg = chromeBackgroundFor(appearance);
    win.setBackgroundColor(bg);
    if (platform === 'win32') {
        nudgeWin32CaptionChrome(win, bg);
    }
}

/**
 * Win caption hover 偶发粘滞：尝试在失焦/获焦时用同色 backgroundColor 触发 DWM 重绘。
 * 无法根除时记为已知限制（issue 126）；不自绘标题栏。
 *
 * @param {import('electron').BrowserWindow} win
 * @param {string} bg
 */
function nudgeWin32CaptionChrome(win, bg) {
    win.setBackgroundColor(bg);
}

/**
 * @param {import('electron').BrowserWindow} win
 * @param {() => string} getBackgroundColor
 */
function attachWin32CaptionHoverMitigation(win, getBackgroundColor) {
    if (process.platform !== 'win32') {
        return;
    }
    const nudge = () => {
        const bg = getBackgroundColor();
        if (bg) {
            nudgeWin32CaptionChrome(win, bg);
        }
    };
    win.on('blur', nudge);
    win.on('focus', nudge);
}

/** @type {AppTheme} 渲染侧经 windowChrome:sync 推来的当前主题（装配根不持有这份状态）。 */
let currentAppTheme = 'system';

function getCurrentAppTheme() {
    return currentAppTheme;
}

/** nativeTheme 源 + 所有已开窗的 backgroundColor 一起对齐当前主题。 */
function syncAllWindowsChrome(deps) {
    applyNativeThemeSource(currentAppTheme, deps.nativeTheme);
    for (const win of deps.BrowserWindow.getAllWindows()) {
        applyBrowserWindowChrome(win, currentAppTheme, deps.nativeTheme);
    }
}

/**
 * 窗体 OS chrome 通道（issue 126）：渲染进程经 windowChrome:sync 推送 light/dark/system。
 * @param {{ handle: Function }} ipcMain
 */
function registerWindowChromeIpc(ipcMain, deps) {
    ipcMain.handle('windowChrome:sync', async (_event, payload) => {
        currentAppTheme = normalizeAppTheme(payload && payload.theme);
        syncAllWindowsChrome(deps);
        return true;
    });
}

module.exports = {
    LIGHT_BG,
    DARK_BG,
    normalizeAppTheme,
    resolvedAppearance,
    chromeBackgroundFor,
    applyNativeThemeSource,
    applyBrowserWindowChrome,
    attachWin32CaptionHoverMitigation,
    getCurrentAppTheme,
    syncAllWindowsChrome,
    registerWindowChromeIpc,
};
