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

/** @type {WeakMap< object, string >} 记录窗口已应用的背景色，避免同色重复调用 setBackgroundColor 触发根表面全量失效（issue 215） */
const appliedWindowBg = new WeakMap();

/**
 * @param {import('electron').BrowserWindow} win
 * @param {AppTheme} appTheme
 * @param {{ shouldUseDarkColors: boolean }} nativeTheme
 * @param {string} [_platform]
 */
function applyBrowserWindowChrome(win, appTheme, nativeTheme, _platform = process.platform) {
    const theme = normalizeAppTheme(appTheme);
    const appearance = resolvedAppearance(theme, nativeTheme.shouldUseDarkColors);
    const bg = chromeBackgroundFor(appearance);
    if (win && typeof win === 'object') {
        if (appliedWindowBg.get(win) === bg) {
            return;
        }
        appliedWindowBg.set(win, bg);
    }
    win.setBackgroundColor(bg);
}

/**
 * issue 126 / issue 215：
 * 原先在每次 blur / focus 时调用 `win.setBackgroundColor(bg)` 试图刷新 Win32 标题栏按钮 hover 态，
 * 但 Perfetto Trace 证实 `setBackgroundColor` 会导致 Chromium `ui::Compositor` 根窗口表面全量失效
 * （`dirty_rect: 0,0 FullWindow`），在快速 `Alt+Tab` 切换 D3D11/DirectComposition 窗口（如 QQ NT）时
 * 严重加剧 DWM 硬件覆盖层（Overlay）重建与 `CrGpuMain` `Swap throttled` 卡顿。
 * 故不再在 blur / focus 热路径中强刷窗口背景色。
 *
 * @param {import('electron').BrowserWindow} _win
 * @param {() => string} _getBackgroundColor
 */
function attachWin32CaptionHoverMitigation(_win, _getBackgroundColor) {
    // no-op（保留导出签名以兼容 createWindow.cjs 调用方）
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
