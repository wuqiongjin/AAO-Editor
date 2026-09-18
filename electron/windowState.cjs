const { patchAppStateSync, readAppStateRawSync } = require('./appState.cjs');

const DEFAULT_WINDOW_WIDTH = 1260;
const DEFAULT_WINDOW_HEIGHT = 800;
const MIN_WINDOW_WIDTH = 800;
const MIN_WINDOW_HEIGHT = 600;

function defaultWindowState() {
    return {
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
        isMaximized: false,
    };
}

function clampDimension(value, min, fallback) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(min, Math.round(value));
}

/** @param {unknown} raw */
function normalizeWindowState(raw) {
    if (!raw || typeof raw !== 'object') {
        return defaultWindowState();
    }
    const o = /** @type {Record<string, unknown>} */ (raw);
    return {
        width: clampDimension(o.width, MIN_WINDOW_WIDTH, DEFAULT_WINDOW_WIDTH),
        height: clampDimension(o.height, MIN_WINDOW_HEIGHT, DEFAULT_WINDOW_HEIGHT),
        isMaximized: o.isMaximized === true,
    };
}

function parseWindowStateJson(text) {
    try {
        return normalizeWindowState(JSON.parse(text));
    } catch {
        return defaultWindowState();
    }
}

function serializeWindowState(state) {
    const n = normalizeWindowState(state);
    return JSON.stringify({
        width: n.width,
        height: n.height,
        isMaximized: n.isMaximized,
    });
}

function loadWindowStateSync(userDataPath) {
    return normalizeWindowState(readAppStateRawSync(userDataPath).window);
}

function saveWindowStateSync(userDataPath, state) {
    const n = normalizeWindowState(state);
    patchAppStateSync(userDataPath, {
        window: {
            width: n.width,
            height: n.height,
            isMaximized: n.isMaximized,
        },
    });
}

async function saveWindowState(userDataPath, state) {
    saveWindowStateSync(userDataPath, state);
}

/** 从 BrowserWindow 快照：最大化时记 normal bounds + 标志 */
function snapshotFromBrowserWindow(win) {
    const isMaximized = win.isMaximized();
    const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();
    return normalizeWindowState({
        width: bounds.width,
        height: bounds.height,
        isMaximized,
    });
}

function browserWindowCreateOptions(state, { minWidth = MIN_WINDOW_WIDTH, minHeight = MIN_WINDOW_HEIGHT } = {}) {
    const n = normalizeWindowState(state);
    return {
        width: clampDimension(n.width, minWidth, DEFAULT_WINDOW_WIDTH),
        height: clampDimension(n.height, minHeight, DEFAULT_WINDOW_HEIGHT),
    };
}

module.exports = {
    DEFAULT_WINDOW_WIDTH,
    DEFAULT_WINDOW_HEIGHT,
    MIN_WINDOW_WIDTH,
    MIN_WINDOW_HEIGHT,
    defaultWindowState,
    normalizeWindowState,
    parseWindowStateJson,
    serializeWindowState,
    loadWindowStateSync,
    saveWindowState,
    saveWindowStateSync,
    snapshotFromBrowserWindow,
    browserWindowCreateOptions,
};
