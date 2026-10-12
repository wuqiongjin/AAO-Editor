/**
 * 社区平台网络网关（bestdori-integration 07 + 14）：Electron 主进程**唯一**的网络出口。
 *
 * 主进程只做四件事（ADR-0011 §2 / issue 06 Q1 薄主进程）：
 *   1. 发 HTTP —— 主机白名单 + 队列分档（API 档 1 并发 / 素材档 4 并发，见下面 LANES 一段）+ 单次超时；
 *   2. 管 Cookie —— 见 communityCookies.cjs（renderer 递进来的凭据头一律拒收）；
 *   3. 响应校验 —— 非 2xx、非 JSON、平台业务错误（`{"result":false,"code":…}`）都翻成结构化错误；
 *   4. 素材缓存（票 14）—— GET 的 json / text / binary 命中就不碰网络（策略见下面 CACHE 一段）；
 *      **票 09 修订**：读型 POST（帖子列表）显式声明 `cacheable` 后同样进 json 档（key 带 body 哈希），
 *      写请求（发帖 / 登录）不传该标记、照旧直连；`revalidate` = 用户主动刷新，跳过缓存读。
 * 端点 / 领域转换 / 搜索全在 renderer（靠注入的 transport 收发，见 src/community/）。
 *
 * 二进制不过 IPC（issue 06 Q7）：落到 `<数据根>/cache/community/`（素材缓存，票 14 取代了
 * 07 的「下载暂存」），只回路径与字节数。
 * 失败一律 `return { ok: false, error }`、**不 throw** —— renderer 侧拿到的是统一错误域
 * （见 src/community/transport.ts），IPC 上不传异常对象。
 *
 * 重试不在这里：主进程只做单次请求，退避重试归 renderer（src/community/rateLimit.ts）。
 */

const crypto = require('crypto');
const { createCookieJar } = require('./communityCookies.cjs');

/**
 * 读型 POST 的缓存键后缀：body 的短哈希（sha1 前 16 位）。
 * 同一 URL 不同查询体是两份数据（帖子列表的 search / offset 组合），不哈希就会互相串味。
 */
function hashCacheKey(body) {
    return crypto.createHash('sha1').update(body).digest('hex').slice(0, 16);
}

/** 唯一允许的主机（renderer 侧的端点常量在 src/community/bestdori/endpoints.ts） */
const ALLOWED_HOSTS = ['bestdori.com'];
/** 自报身份：低速率、写清用途（照 scripts/lib/bestdori-http.mjs 口径） */
const DEFAULT_USER_AGENT = 'aao-bestdori-client/1.0 (local chart editor; low-rate fetching)';
/**
 * 队列分档（票 17 修订 07 的「单飞」口径）：
 *   - **API 档**（json / text：曲库索引、单曲详情、谱面原文、帖子）：1 并发 + 两次开始间隔 ≥400ms —— 07 原口径不动；
 *   - **素材档**（binary：封面 / 音频这类静态文件）：4 并发 + 每条链上间隔 ≥100ms —— 站点自己的列表页同屏并发 ≈6，
 *     我们比它更客气；这档原来串在 API 后面，导致「滚动列表 10s 才出一张」。
 * 分档还顺带把「一张卡住」隔离开：素材档 stall 不再堵住 API 档（详情 / 导入照走）。
 */
const MIN_REQUEST_INTERVAL_MS = 400;
const ASSET_CONCURRENCY = 4;
const ASSET_MIN_REQUEST_INTERVAL_MS = 100;
const JSON_TIMEOUT_MS = 30_000;
const BINARY_TIMEOUT_MS = 120_000;
/** 文本 / JSON 响应的上限（防呆：拿回一坨回退页或超大响应） */
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
/** 请求体上限（谱面代码 / 发帖 payload 都是文本，远小于此） */
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const ALLOWED_METHODS = ['GET', 'POST'];
const RESPONSE_TYPES = ['json', 'text', 'binary'];
/** renderer 不得自带的头：凭据 / 目标主机 / 长度（都由网关自己算） */
const FORBIDDEN_HEADERS = ['cookie', 'host', 'content-length'];
/** 平台业务码 → 统一错误域（错误码全集见 docs/research/bestdori-api.md §0） */
const UNAUTHORIZED_CODES = ['LOGIN_REQUIRED', 'CREDENTIALS_INVALID', 'USER_INVALID'];
const RATE_LIMIT_CODES = ['RATE_LIMITED', 'TOO_MANY_REQUESTS', 'TOO_MANY_POSTS', 'TOO_MANY_UPLOADS'];
/** 文本响应类型 → 默认 Accept */
const DEFAULT_ACCEPT = { json: 'application/json', text: 'text/plain', binary: '*/*' };

/**
 * 素材缓存策略（票 14 定案 + 票 09 修订，只此一份）：
 *   - 范围：**GET** 的 json / text / binary；外加**显式 `cacheable` 的读型 POST**（帖子列表：
 *     key = URL + body 哈希）。写请求永不进缓存 —— 「发帖 / 登录」是同一个 POST 方法，
 *     靠 renderer 的显式声明区分，不给方法开例外；
 *   - json / text：24h 内直接回；过期「先回旧的 + 后台补一枪」——列表这类资源要的是「一打开就有」；
 *     单曲详情 / 谱面原文也用这一档（它们是「用过就留到 30 天没动才清」，鲜度按天刷新不是负担）；
 *   - binary：当不可变内容长期复用（音频 / 封面下了就不再变）；
 *   - 例外：**回退页**（平台对不存在的素材回 200 + `text/html`）只当 1 小时负缓存 ——
 *     既免得反复打平台，也不把一张网页钉死 30 天（平台后来补上的素材还能取到）；
 *   - `revalidate: true`（用户主动刷新，票 09）：跳过缓存读、真打一发并写回。
 * 条目回收（30 天未用 / 1GB 上限）在 assetCache.sweep() 里，网关只负责存与取。
 */
const CACHE_FRESH_MS = 24 * 60 * 60 * 1000;
const FALLBACK_FRESH_MS = 60 * 60 * 1000;

/** 载荷不合法（越界 URL / 非法方法 / 自带凭据头）—— 网关在发起请求之前就拒掉 */
class RequestRejected extends Error {}

function errorMessage(error) {
    if (error && typeof error.message === 'string' && error.message !== '') return error.message;
    return String(error);
}

/**
 * 结构化失败：载荷形状与 src/community/transport.ts 的 CommunityWireError 一致。
 * @returns {{ ok: false, error: { kind: string, message: string, httpStatus?: number, platformCode?: string } }}
 */
function fail(kind, message, extra = {}) {
    return { ok: false, error: { kind, message, ...extra } };
}

function normalizeHeaders(raw) {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new RequestRejected('headers 必须是对象');
    const headers = {};
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value !== 'string') throw new RequestRejected(`请求头 ${key} 必须是字符串`);
        const lower = key.toLowerCase();
        if (FORBIDDEN_HEADERS.includes(lower)) {
            throw new RequestRejected(`请求头 ${lower} 由网关自己算，renderer 不得自带`);
        }
        headers[key] = value;
    }
    return headers;
}

function hasHeader(headers, name) {
    return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

function normalizeTimeout(raw, responseType) {
    if (raw === undefined || raw === null) {
        return responseType === 'binary' ? BINARY_TIMEOUT_MS : JSON_TIMEOUT_MS;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new RequestRejected('timeoutMs 必须是正数');
    return Math.min(value, BINARY_TIMEOUT_MS);
}

/**
 * 校验载荷并归一化成一次请求。
 * @param {any} payload
 */
function normalizeRequest(payload, allowedHosts) {
    if (!payload || typeof payload !== 'object') throw new RequestRejected('请求载荷必须是对象');
    const rawUrl = typeof payload.url === 'string' ? payload.url.trim() : '';
    if (rawUrl === '') throw new RequestRejected('缺少 url');
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new RequestRejected(`url 不是合法地址：${rawUrl}`);
    }
    if (parsed.protocol !== 'https:') throw new RequestRejected('社区请求只走 https');
    const host = parsed.hostname.toLowerCase();
    if (!allowedHosts.includes(host)) throw new RequestRejected(`主机不在白名单：${host}`);

    const method = String(payload.method || 'GET').toUpperCase();
    if (!ALLOWED_METHODS.includes(method)) throw new RequestRejected(`不支持的方法：${method}`);

    const responseType = payload.responseType || 'json';
    if (!RESPONSE_TYPES.includes(responseType)) throw new RequestRejected(`未知的 responseType：${responseType}`);

    let body;
    if (payload.body !== undefined && payload.body !== null) {
        if (typeof payload.body !== 'string') throw new RequestRejected('body 只收字符串（序列化由 renderer 负责）');
        if (method !== 'POST') throw new RequestRejected('只有 POST 能带 body');
        if (Buffer.byteLength(payload.body) > MAX_BODY_BYTES) throw new RequestRejected('请求体过大');
        body = payload.body;
    }

    const headers = normalizeHeaders(payload.headers);
    if (!hasHeader(headers, 'user-agent')) headers['user-agent'] = DEFAULT_USER_AGENT;
    if (!hasHeader(headers, 'accept')) headers.accept = DEFAULT_ACCEPT[responseType];

    // 读型 POST 的缓存许可（票 09 修订 07/14 的口径：POST 默认不缓存，发帖 / 登录照旧直连）
    const cacheable = payload.cacheable === true;
    const revalidate = payload.revalidate === true;

    return {
        url: rawUrl,
        method,
        headers,
        body,
        responseType,
        timeoutMs: normalizeTimeout(payload.timeoutMs, responseType),
        suggestedName: typeof payload.suggestedName === 'string' ? payload.suggestedName : '',
        cacheable,
        revalidate,
        // 缓存键：POST 把 body 一并算进去（同 URL 不同查询体是两份数据）。GET 就是 URL 本身。
        cacheKey: cacheable && method === 'POST' ? `${rawUrl}#${hashCacheKey(body || '')}` : rawUrl,
    };
}

/** 平台业务错误也是 HTTP 200 + `{result:false, code}` —— 按码翻成统一错误域 */
function classifyBusiness(data) {
    if (!data || typeof data !== 'object' || data.result !== false) return null;
    const code = typeof data.code === 'string' && data.code !== '' ? data.code : 'UNKNOWN';
    if (UNAUTHORIZED_CODES.includes(code)) {
        return { kind: 'unauthorized', code, message: `平台要求登录（${code}）` };
    }
    if (RATE_LIMIT_CODES.includes(code)) {
        return { kind: 'rate-limited', code, message: `平台限流（${code}）` };
    }
    return { kind: 'invalid-response', code, message: `平台拒绝了请求（${code}）` };
}

/** Set-Cookie 的取法：标准 getSetCookie() 优先，退回单条 set-cookie 头 */
function readSetCookie(response) {
    const headers = response && response.headers;
    if (!headers) return [];
    if (typeof headers.getSetCookie === 'function') {
        const all = headers.getSetCookie();
        if (Array.isArray(all) && all.length > 0) return all;
    }
    if (typeof headers.get === 'function') {
        const single = headers.get('set-cookie');
        if (typeof single === 'string' && single !== '') return [single];
    }
    return [];
}

/**
 * 创建网关。
 * @param {{
 *   fetchImpl: (url: string, init: any) => Promise<any>,
 *   assetCache?: any,
 *   cookieJar?: any,
 *   hosts?: string[],
 *   minIntervalMs?: number,
 *   assetConcurrency?: number,
 *   assetMinIntervalMs?: number,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   timers?: { setTimeout: Function, clearTimeout: Function },
 * }} options
 */
function createCommunityGateway(options) {
    const fetchImpl = options && options.fetchImpl;
    if (typeof fetchImpl !== 'function') throw new Error('社区网关需要 fetchImpl（主进程传 net.fetch）');
    const assetCache = (options && options.assetCache) || null;
    const cookieJar = options.cookieJar || createCookieJar();
    const allowedHosts = options.hosts || ALLOWED_HOSTS;
    const minIntervalMs = options.minIntervalMs ?? MIN_REQUEST_INTERVAL_MS;
    const assetConcurrency = options.assetConcurrency ?? ASSET_CONCURRENCY;
    const assetMinIntervalMs = options.assetMinIntervalMs ?? ASSET_MIN_REQUEST_INTERVAL_MS;
    const now = options.now || Date.now;
    const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const timers = options.timers || { setTimeout, clearTimeout };

    /**
     * 一条队列：`concurrency` 条独立串行链，链上两次「开始」至少隔 `minIntervalMs`。
     * 并发 1 时与 07 原来的「单飞 + 最小间隔」逐字等价（既有锁测原样通过）。
     * @param {{ concurrency: number, minIntervalMs: number }} lane
     */
    function createLane(lane) {
        const tails = Array.from({ length: Math.max(1, lane.concurrency) }, () => Promise.resolve());
        const lastStartedAt = new Array(tails.length).fill(-Infinity);
        let cursor = 0;

        return function schedule(task) {
            const index = cursor % tails.length;
            cursor += 1;
            const run = tails[index].then(async () => {
                const waitMs = lane.minIntervalMs - (now() - lastStartedAt[index]);
                if (waitMs > 0) await sleep(waitMs);
                lastStartedAt[index] = now();
                return task();
            });
            tails[index] = run.then(
                () => undefined,
                () => undefined,
            );
            return run;
        };
    }

    const apiLane = createLane({ concurrency: 1, minIntervalMs });
    const assetLane = createLane({
        concurrency: assetConcurrency,
        minIntervalMs: assetMinIntervalMs,
    });
    /** 素材（静态文件）走素材档，其余走 API 档 */
    const schedule = (req, task) => (req.responseType === 'binary' ? assetLane : apiLane)(task);

    async function send(req) {
        const controller = new AbortController();
        const timer = timers.setTimeout(() => controller.abort(), req.timeoutMs);
        let response;
        try {
            response = await fetchImpl(req.url, {
                method: req.method,
                headers: cookieJar.attach(req.url, req.headers),
                body: req.body,
                signal: controller.signal,
                redirect: 'follow',
                // 凭据只走我们自己的 jar，不进 Electron 默认 session 的 cookie store（ADR-0011 §3）
                credentials: 'omit',
                // 站点的 cache-control 很短；显式关掉 HTTP 缓存，免得拿到过期列表
                cache: 'no-store',
            });
        } catch (error) {
            if (controller.signal.aborted) return fail('timeout', `请求超时（${req.timeoutMs}ms）`);
            return fail('offline', `连不上社区平台：${errorMessage(error)}`);
        } finally {
            timers.clearTimeout(timer);
        }

        cookieJar.capture(req.url, readSetCookie(response));

        const status = Number(response.status) || 0;
        if (status === 429) return fail('rate-limited', 'HTTP 429（请求过快）', { httpStatus: status });
        if (status === 401 || status === 403) return fail('unauthorized', `HTTP ${status}`, { httpStatus: status });
        if (status >= 400) return fail('http', `HTTP ${status}`, { httpStatus: status });

        if (req.responseType === 'binary') return cacheBinary(response, req);

        let text;
        try {
            text = await response.text();
        } catch (error) {
            return fail('offline', `读响应失败：${errorMessage(error)}`, { httpStatus: status });
        }
        if (text.length > MAX_TEXT_BYTES) return fail('invalid-response', '响应体过大', { httpStatus: status });
        if (req.responseType === 'text') {
            await storeText(req, text, 'text', status, contentTypeOf(response));
            return { ok: true, responseType: 'text', status, text };
        }

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            return fail('invalid-response', '响应不是合法 JSON（疑似回退页）', { httpStatus: status });
        }
        const business = classifyBusiness(data);
        if (business) {
            return fail(business.kind, business.message, { httpStatus: status, platformCode: business.code });
        }
        await storeText(req, text, 'json', status, contentTypeOf(response));
        return { ok: true, responseType: 'json', status, data };
    }

    /** 缓存 kind：binary 原样；text / json 都是「文本命中」（过期策略相同） */
    function cacheKindOf(req) {
        if (req.responseType === 'binary') return 'binary';
        if (req.responseType === 'text') return 'text';
        return 'json';
    }

    /** 回退页判定（平台对不存在的素材回 200 + text/html；端点侧同规则：endpoints.isPlatformFallbackPage） */
    function isFallbackHtml(contentType) {
        return typeof contentType === 'string' && /text\/html/i.test(contentType);
    }

    function contentTypeOf(response) {
        return typeof response.headers?.get === 'function' ? response.headers.get('content-type') : null;
    }

    /**
     * 缓存命中就**不碰网络**。返回 `{ result, stale }`；未命中 / 条目坏了都回 null（当没缓存）。
     * stale 只对 json / text 有意义：调用方「先回旧的 + 后台补一枪」（票 14）。
     */
    async function readCache(req) {
        // 票 09 修订 07/14 的「POST 不进缓存」：**读型 POST** 显式声明 `cacheable` 才进（帖子列表），
        // 发帖 / 登录这类写请求不传该标记、照旧直连；`revalidate` = 用户主动刷新，跳过缓存读。
        if (assetCache == null) return null;
        if (req.method !== 'GET' && !req.cacheable) return null;
        if (req.revalidate) return null;
        const kind = cacheKindOf(req);
        const entry = await assetCache.lookup({ url: req.cacheKey, kind });
        if (entry == null) return null;
        if (kind !== 'binary' && entry.bytes > MAX_TEXT_BYTES) {
            await assetCache.drop(entry);
            return null;
        }

        if (kind === 'binary') {
            const freshMs = isFallbackHtml(entry.contentType) ? FALLBACK_FRESH_MS : Number.POSITIVE_INFINITY;
            if (now() - entry.cachedAt >= freshMs) return null;
            return {
                stale: false,
                result: {
                    ok: true,
                    responseType: 'binary',
                    status: entry.status,
                    path: entry.path,
                    byteLength: entry.bytes,
                    contentType: entry.contentType ?? null,
                },
            };
        }

        let text;
        try {
            text = (await assetCache.read(entry)).toString('utf8');
        } catch {
            await assetCache.drop(entry);
            return null;
        }
        // 回退页（text/html）当短期负缓存：文本形态也要认（谱面原文取不到时回的就是它）
        const freshMs = isFallbackHtml(entry.contentType) ? FALLBACK_FRESH_MS : CACHE_FRESH_MS;
        const stale = now() - entry.cachedAt >= freshMs;
        if (kind === 'text') {
            return { stale, result: { ok: true, responseType: 'text', status: entry.status, text } };
        }
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            await assetCache.drop(entry);
            return null;
        }
        return { stale, result: { ok: true, responseType: 'json', status: entry.status, data } };
    }

    /** 落文本（json / text）：缓存是加速层，写不进去不影响这次请求；contentType 记下来供回退页判定 */
    async function storeText(req, text, kind, status, contentType) {
        if (assetCache == null) return;
        // 只有「缓存许可」的请求才写：GET 的 json / text 与显式声明 cacheable 的读型 POST
        if (req.method !== 'GET' && !req.cacheable) return;
        try {
            await assetCache.store({
                url: req.cacheKey,
                kind,
                bytes: Buffer.from(text, 'utf8'),
                contentType: contentType ?? null,
                status,
                suggestedName: kind === 'json' ? 'response.json' : 'response.txt',
            });
        } catch {
            // 忽略
        }
    }

    /** 二进制落素材缓存（字节不过 IPC：只回路径与元数据） */
    async function cacheBinary(response, req) {
        if (assetCache == null) return fail('staging-failed', '社区网关需要素材缓存');
        const contentType = contentTypeOf(response);
        const status = Number(response.status) || 0;
        let bytes;
        try {
            bytes = Buffer.from(await response.arrayBuffer());
        } catch (error) {
            return fail('offline', `读响应失败：${errorMessage(error)}`, { httpStatus: status });
        }
        try {
            const entry = await assetCache.store({
                url: req.url,
                kind: 'binary',
                bytes,
                contentType: contentType || null,
                status,
                suggestedName: req.suggestedName,
            });
            return {
                ok: true,
                responseType: 'binary',
                status: entry.status,
                path: entry.path,
                byteLength: entry.bytes,
                contentType: entry.contentType,
            };
        } catch (error) {
            return fail('staging-failed', `素材缓存写入失败：${errorMessage(error)}`);
        }
    }

    return {
        /**
         * 一次社区请求。**不 throw**：预期内的失败都回 `{ ok: false, error }`。
         * @param {any} payload
         */
        async request(payload) {
            let req;
            try {
                req = normalizeRequest(payload, allowedHosts);
            } catch (error) {
                // RequestRejected（越界 URL / 非法方法 / 自带凭据头）：发起之前就拒，什么都不发
                return fail('request-rejected', errorMessage(error));
            }

            let hit = null;
            try {
                hit = await readCache(req);
            } catch {
                hit = null; // 缓存读不了（目录权限之类）当未命中，主线照走
            }
            if (hit == null) return schedule(req, () => send(req));
            if (hit.stale) {
                // 过期先用旧的：后台补一枪（失败静默 —— 旧副本继续服务，票 14）
                void schedule(req, () => send(req)).catch(() => undefined);
            }
            return hit.result;
        },
        /** 暴露 jar 供 10 接 safeStorage（07 只做内存，main.cjs 不碰它） */
        cookieJar,
    };
}

/**
 * 注册 IPC 通道（形态照既有 projectStore 桥：一个命名空间一条 invoke）。
 * @param {{ handle: (channel: string, listener: Function) => void }} ipcMain
 * @param {{ request: (payload: any) => Promise<any> }} gateway
 */
function registerCommunityNetIpc(ipcMain, gateway) {
    ipcMain.handle('communityNet:request', (_event, payload) => gateway.request(payload));
}

module.exports = {
    ALLOWED_HOSTS,
    DEFAULT_USER_AGENT,
    MIN_REQUEST_INTERVAL_MS,
    ASSET_CONCURRENCY,
    ASSET_MIN_REQUEST_INTERVAL_MS,
    JSON_TIMEOUT_MS,
    BINARY_TIMEOUT_MS,
    CACHE_FRESH_MS,
    FALLBACK_FRESH_MS,
    createCommunityGateway,
    registerCommunityNetIpc,
};
