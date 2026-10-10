/**
 * 本机素材的只读协议（bestdori-integration 15 + 16）：
 * 素材缓存里的字节住在磁盘上，媒体标签（`<img>` / `<audio>`）要一个 URL 形态才能读它。
 *
 * 形态（两支，形参约定见 src/community/assetUrls.ts；scheme 自起名，现用 aao- 前缀占位 —— 旧占位名已弃用，产品名未定）：
 *   - `aao-asset://thumb/?url=<encodeURIComponent(素材原始 URL)>` —— 缩略图（票 15）；
 *   - `aao-asset://raw/?url=<encodeURIComponent(素材原始 URL)>` —— **原始字节**（票 16：
 *     预览区封面大图 / 试听音频；`<audio>` 边下边播靠 Range，这里按 RFC 7233 回 206 / 416）。
 *   - `url` 必须是白名单主机（与 communityNet.cjs 同口径；CJS 引不到 TS，两份常量靠测试互锁）；
 *   - **只读**：这里不联网、不下载 —— 「什么该进缓存」由渲染侧经网关决定（票 15 的懒加载）；
 *   - thumb：条目在、缩略图不在（本功能之前进的缓存 / 上次产出失败）就顺手产一张（assetCache.ensureThumb）；
 *   - raw：**回退页负缓存不外借**（平台对不存在素材回 200 + text/html，那一份只会误导媒体标签）；
 *   - 没有条目 / 产不出 / 文件没了：404，不抛 —— 媒体标签自己走 onError 降级
 *     （thumb 降级成图标，raw 按票 16 降级成直链）。
 *
 * 渲染侧那份 URL 形态在 `src/community/assetUrls.ts`（改一边，另一边要跟上）。
 */
const fs = require('fs');

/** 唯一允许的素材主机（与 electron/communityNet.cjs 的 ALLOWED_HOSTS 同值） */
const ALLOWED_HOSTS = ['bestdori.com'];
const ASSET_SCHEME = 'aao-asset';
/** 缩略图那一支的 host（票 15） */
const THUMB_HOST = 'thumb';
/** 原始字节那一支的 host（票 16：预览大图 / 音频共用） */
const RAW_HOST = 'raw';

/**
 * 登记 scheme 特权 —— **必须在 app ready 之前**调（Electron 的硬要求）。
 * `standard` 让 `aao-asset://host/?url=…` 按常规 URL 解析；`secure` 免得 https 页面上被当混合内容挡掉。
 * @param {{ registerSchemesAsPrivileged: (list: any[]) => void }} protocol
 */
function registerAssetSchemePrivileges(protocol) {
    protocol.registerSchemesAsPrivileged([
        { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true } },
    ]);
}

/**
 * 解析一次素材请求：host 必须是指定的那一支、`url` 必须是白名单里的 https 素材地址，
 * 回**素材原始 URL**（缓存就是按它寻址的）；其余一律 null。
 * 越界主机 / 非 https / 缺少 url —— 白名单在渲染侧是先手，在这里是兜底。
 * @param {string} rawUrl
 * @param {string} host
 */
function parseAssetRequest(rawUrl, host) {
    let request;
    try {
        request = new URL(String(rawUrl));
    } catch {
        return null;
    }
    if (request.protocol !== `${ASSET_SCHEME}:`) return null;
    if (request.hostname !== host) return null;
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

/** 缩略图请求（票 15） */
function parseThumbRequest(rawUrl) {
    return parseAssetRequest(rawUrl, THUMB_HOST);
}

/** 原始字节请求（票 16） */
function parseRawRequest(rawUrl) {
    return parseAssetRequest(rawUrl, RAW_HOST);
}

function notFound() {
    return new Response('', { status: 404 });
}

/** Range 头的取法：协议层给的是标准 Request（`headers.get`），没有 / 拿不到都当无 Range */
function rangeHeaderOf(request) {
    const value = request && typeof request.headers?.get === 'function' ? request.headers.get('range') : null;
    return typeof value === 'string' ? value : null;
}

/**
 * 解析 `Range: bytes=…`（RFC 7233 单区间；Chromium 的 `<audio>` 只发这一种）。
 * @param {string | null} header
 * @param {number} total 文件总字节数
 * @returns {{ start: number, end: number } | 'unsatisfiable' | null}
 *   null = 没带 / 解不开（当无 Range，回 200 全量）；'unsatisfiable' = 起点越界（回 416）
 */
function parseRange(header, total) {
    if (header == null) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match) return null;
    const [, startText, endText] = match;
    if (startText === '' && endText === '') return null;
    if (startText === '') {
        // 后缀式：`bytes=-N` = 最后 N 字节（N=0 无意义）
        const suffix = Number(endText);
        if (suffix <= 0) return 'unsatisfiable';
        return { start: Math.max(0, total - suffix), end: total - 1 };
    }
    const start = Number(startText);
    if (start >= total) return 'unsatisfiable';
    const end = endText === '' ? total - 1 : Math.min(Number(endText), total - 1);
    if (end < start) return null;
    return { start, end };
}

/** 按原始 URL 找 binary 条目；缓存读不了（目录权限之类）/ 未命中都回 null —— 别把异常甩给协议层 */
async function lookupBinary(assetCache, upstream) {
    try {
        return await assetCache.lookup({ url: upstream, kind: 'binary' });
    } catch {
        return null;
    }
}

/**
 * raw 支（票 16）：把缓存里的原始字节递给媒体标签。
 * `<audio>` 的播放 / 拖进度条靠 Range —— 不支持的话 Chromium 要么整包下、要么 seek 失败。
 * @param {any} assetCache
 * @param {{ headers?: any }} request
 * @param {string} upstream
 */
async function serveRawBytes(assetCache, request, upstream) {
    const entry = await lookupBinary(assetCache, upstream);
    if (entry == null) return notFound();
    // 回退页负缓存（1 小时）不外借：一张网页递给 <img>/<audio> 只会换来一次注定失败的解码
    if (typeof entry.contentType === 'string' && /text\/html/i.test(entry.contentType)) return notFound();

    let handle = null;
    try {
        handle = await fs.promises.open(entry.path, 'r');
        const stat = await handle.stat();
        const total = stat.size;
        const contentType = entry.contentType ?? 'application/octet-stream';
        const baseHeaders = {
            'content-type': contentType,
            'accept-ranges': 'bytes',
            'cache-control': 'no-store',
        };

        const range = parseRange(rangeHeaderOf(request), total);
        if (range === 'unsatisfiable') {
            return new Response('', {
                status: 416,
                headers: { ...baseHeaders, 'content-range': `bytes */${total}` },
            });
        }
        if (range == null) {
            const bytes = Buffer.alloc(total);
            await handle.read(bytes, 0, total, 0);
            return new Response(bytes, {
                status: 200,
                headers: { ...baseHeaders, 'content-length': String(total) },
            });
        }
        const { start, end } = range;
        const length = end - start + 1;
        const bytes = Buffer.alloc(length);
        await handle.read(bytes, 0, length, start);
        return new Response(bytes, {
            status: 206,
            headers: {
                ...baseHeaders,
                'content-length': String(length),
                'content-range': `bytes ${start}-${end}/${total}`,
            },
        });
    } catch {
        return notFound(); // 文件没了 / 读挂了：当没缓存，界面自己降级
    } finally {
        if (handle != null) await handle.close().catch(() => undefined);
    }
}

/**
 * 缩略图支（票 15）：命中即读缓存里那张 96×96（本地磁盘，几毫秒）。
 * @param {any} assetCache
 * @param {string} upstream
 */
async function serveThumbBytes(assetCache, upstream) {
    const entry = await lookupBinary(assetCache, upstream);
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
}

/**
 * 协议处理器：`{ url }` → Response。按 host 分发到缩略图 / 原始字节两支；其余一律 404。
 * @param {{ assetCache: any }} options
 */
function createAssetProtocolHandler(options) {
    const assetCache = options && options.assetCache;
    return async (request) => {
        if (assetCache == null) return notFound();
        const rawUrl = request && request.url;
        const thumbUpstream = parseThumbRequest(rawUrl);
        if (thumbUpstream != null) return serveThumbBytes(assetCache, thumbUpstream);
        const rawUpstream = parseRawRequest(rawUrl);
        if (rawUpstream != null) return serveRawBytes(assetCache, request, rawUpstream);
        return notFound();
    };
}

/**
 * 接线（app ready 之后）：`protocol.handle('aao-asset', …)`。
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
    RAW_HOST,
    registerAssetSchemePrivileges,
    parseThumbRequest,
    parseRawRequest,
    parseRange,
    createAssetProtocolHandler,
    registerAssetProtocol,
};
