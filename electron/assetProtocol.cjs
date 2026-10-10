/**
 * 本机素材的只读协议（bestdori-integration 15；「与 16 同一条通道」）：
 * 素材缓存里的字节住在磁盘上，媒体标签（`<img>`，将来 16 的 `<audio>`）要一个 URL 形态才能读它。
 *
 * 形态：`tsugu-asset://thumb/?url=<encodeURIComponent(素材原始 URL)>`
 *   - `url` 必须是白名单主机（与 communityNet.cjs 同口径；CJS 引不到 TS，两份常量靠测试互锁）；
 *   - **只读**：这里不联网、不下载 —— 「什么该进缓存」由渲染侧经网关决定（票 15 的懒加载）；
 *   - 条目在、缩略图不在（本功能之前进的缓存 / 上次产出失败）就顺手产一张（见 assetCache.ensureThumb）；
 *   - 没有条目 / 产不出：404，不抛 —— 媒体标签自己走 onError 降级成图标。
 *
 * 渲染侧那份 URL 形态在 `src/community/assetUrls.ts`（改一边，另一边要跟上）。
 */
const fs = require('fs');

/** 唯一允许的素材主机（与 electron/communityNet.cjs 的 ALLOWED_HOSTS 同值） */
const ALLOWED_HOSTS = ['bestdori.com'];
const ASSET_SCHEME = 'tsugu-asset';
/** 缩略图那一支的 host（16 的大图 / 音频会另加一支） */
const THUMB_HOST = 'thumb';

/**
 * 登记 scheme 特权 —— **必须在 app ready 之前**调（Electron 的硬要求）。
 * `standard` 让 `tsugu-asset://host/?url=…` 按常规 URL 解析；`secure` 免得 https 页面上被当混合内容挡掉。
 * @param {{ registerSchemesAsPrivileged: (list: any[]) => void }} protocol
 */
function registerAssetSchemePrivileges(protocol) {
    protocol.registerSchemesAsPrivileged([
        { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true } },
    ]);
}

/**
 * 解析一次缩略图请求，回**素材原始 URL**（缓存就是按它寻址的）；不是本协议的缩略图请求回 null。
 * 越界主机 / 非 https / 缺少 url 一律 null —— 白名单在渲染侧是先手，在这里是兜底。
 * @param {string} rawUrl
 */
function parseThumbRequest(rawUrl) {
    let request;
    try {
        request = new URL(String(rawUrl));
    } catch {
        return null;
    }
    if (request.protocol !== `${ASSET_SCHEME}:`) return null;
    if (request.hostname !== THUMB_HOST) return null;
    const upstream = request.searchParams.get('url') ?? '';
    let target;
    try {
        target = new URL(upstream);
    } catch {
        return null;
    }
    if (target.protocol !== 'https:') return null;
    if (!ALLOWED_HOSTS.includes(target.hostname.toLowerCase())) return null;
    return upstream;
}

function notFound() {
    return new Response('', { status: 404 });
}

/**
 * 协议处理器：`{ url }` → Response。
 * 命中即读缓存里的缩略图字节（本地磁盘，几毫秒）；其余一律 404。
 * @param {{ assetCache: any }} options
 */
function createAssetProtocolHandler(options) {
    const assetCache = options && options.assetCache;
    return async (request) => {
        const upstream = parseThumbRequest(request && request.url);
        if (upstream == null || assetCache == null) return notFound();

        let entry = null;
        try {
            entry = await assetCache.lookup({ url: upstream, kind: 'binary' });
        } catch {
            entry = null; // 缓存读不了（目录权限之类）当没有，别把异常甩给协议层
        }
        if (entry == null) return notFound();

        let thumb = null;
        try {
            thumb = await assetCache.ensureThumb(entry);
        } catch {
            thumb = null;
        }
        if (thumb == null) return notFound();

        let bytes;
        try {
            bytes = await fs.promises.readFile(thumb.path);
        } catch {
            return notFound();
        }
        return new Response(bytes, {
            status: 200,
            headers: { 'content-type': thumb.contentType ?? 'image/png' },
        });
    };
}

/**
 * 接线（app ready 之后）：`protocol.handle('tsugu-asset', …)`。
 * @param {{ handle: (scheme: string, handler: Function) => void }} protocol
 * @param {any} assetCache
 */
function registerAssetProtocol(protocol, assetCache) {
    protocol.handle(ASSET_SCHEME, createAssetProtocolHandler({ assetCache }));
}

module.exports = {
    ALLOWED_HOSTS,
    ASSET_SCHEME,
    THUMB_HOST,
    registerAssetSchemePrivileges,
    parseThumbRequest,
    createAssetProtocolHandler,
    registerAssetProtocol,
};
