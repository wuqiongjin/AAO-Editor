/**
 * 社区平台网络网关（bestdori-integration 07）：Electron 主进程**唯一**的网络出口。
 *
 * 主进程只做三件事（ADR-0011 §2 / issue 06 Q1 薄主进程）：
 *   1. 发 HTTP —— 主机白名单 + 最小请求间隔（单飞队列）+ 单次超时；
 *   2. 管 Cookie —— 见 communityCookies.cjs（renderer 递进来的凭据头一律拒收）；
 *   3. 响应校验 —— 非 2xx、非 JSON、平台业务错误（`{"result":false,"code":…}`）都翻成结构化错误。
 * 端点 / 领域转换 / 搜索全在 renderer（靠注入的 transport 收发，见 src/community/）。
 *
 * 二进制不过 IPC（issue 06 Q7）：落到数据根下的**下载暂存**，只回路径与字节数。
 * 失败一律 `return { ok: false, error }`、**不 throw** —— renderer 侧拿到的是统一错误域
 * （见 src/community/transport.ts），IPC 上不传异常对象。
 *
 * 重试不在这里：主进程只做单次请求，退避重试归 renderer（src/community/rateLimit.ts）。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createCookieJar } = require('./communityCookies.cjs');

/** 唯一允许的主机（renderer 侧的端点常量在 src/community/bestdori/endpoints.ts） */
const ALLOWED_HOSTS = ['bestdori.com'];
/** 自报身份：低速率、写清用途（照 scripts/lib/bestdori-http.mjs 口径） */
const DEFAULT_USER_AGENT = 'tsugu-bestdori-client/1.0 (local chart editor; low-rate fetching)';
/** 同主机两次请求的最小间隔（低速率；单飞队列保证不会并发打过去） */
const MIN_REQUEST_INTERVAL_MS = 400;
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

/** 载荷不合法（越界 URL / 非法方法 / 自带凭据头）—— 网关在发起请求之前就拒掉 */
class RequestRejected extends Error {}

function errorMessage(error) {
    if (error && typeof error.message === 'string' && error.message !== '') return error.message;
    return String(error);
}

function hash8(text) {
    return crypto.createHash('sha1').update(text).digest('hex').slice(0, 8);
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

    return {
        url: rawUrl,
        method,
        headers,
        body,
        responseType,
        timeoutMs: normalizeTimeout(payload.timeoutMs, responseType),
        suggestedName: typeof payload.suggestedName === 'string' ? payload.suggestedName : '',
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

/** 暂存文件名：`<url 短哈希>-<建议名>`；建议名只取 basename 并剥掉路径分隔符 */
function stagingFileName(url, suggestedName) {
    const base = path.basename(String(suggestedName || '')).replace(/[^\w.-]+/g, '_').replace(/^\.+/, '');
    const stem = base === '' ? 'download' : base.slice(0, 80);
    return `${hash8(url)}-${stem}`;
}

function resolveStagingDir(stagingDir) {
    const dir = typeof stagingDir === 'function' ? stagingDir() : stagingDir;
    if (typeof dir !== 'string' || dir.trim() === '') throw new Error('社区网关需要下载暂存目录');
    return dir;
}

/**
 * 创建网关。
 * @param {{
 *   fetchImpl: (url: string, init: any) => Promise<any>,
 *   stagingDir: string | (() => string),
 *   cookieJar?: any,
 *   hosts?: string[],
 *   minIntervalMs?: number,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   timers?: { setTimeout: Function, clearTimeout: Function },
 * }} options
 */
function createCommunityGateway(options) {
    const fetchImpl = options && options.fetchImpl;
    if (typeof fetchImpl !== 'function') throw new Error('社区网关需要 fetchImpl（主进程传 net.fetch）');
    const stagingDir = options.stagingDir;
    const cookieJar = options.cookieJar || createCookieJar();
    const allowedHosts = options.hosts || ALLOWED_HOSTS;
    const minIntervalMs = options.minIntervalMs ?? MIN_REQUEST_INTERVAL_MS;
    const now = options.now || Date.now;
    const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const timers = options.timers || { setTimeout, clearTimeout };

    // 单飞 + 最小间隔：请求排队，两次「开始」之间至少隔 minIntervalMs
    let tail = Promise.resolve();
    let lastStartedAt = -Infinity;

    function schedule(task) {
        const run = tail.then(async () => {
            const waitMs = minIntervalMs - (now() - lastStartedAt);
            if (waitMs > 0) await sleep(waitMs);
            lastStartedAt = now();
            return task();
        });
        tail = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }

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

        if (req.responseType === 'binary') return stageBinary(response, req);

        let text;
        try {
            text = await response.text();
        } catch (error) {
            return fail('offline', `读响应失败：${errorMessage(error)}`, { httpStatus: status });
        }
        if (text.length > MAX_TEXT_BYTES) return fail('invalid-response', '响应体过大', { httpStatus: status });
        if (req.responseType === 'text') return { ok: true, responseType: 'text', status, text };

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
        return { ok: true, responseType: 'json', status, data };
    }

    async function stageBinary(response, req) {
        let dir;
        try {
            dir = resolveStagingDir(stagingDir);
        } catch (error) {
            return fail('staging-failed', errorMessage(error));
        }
        try {
            const bytes = Buffer.from(await response.arrayBuffer());
            await fs.promises.mkdir(dir, { recursive: true });
            const filePath = path.join(dir, stagingFileName(req.url, req.suggestedName));
            const tmpPath = `${filePath}.part-${process.pid}-${Date.now()}`;
            await fs.promises.writeFile(tmpPath, bytes);
            await fs.promises.rename(tmpPath, filePath);
            const contentType = typeof response.headers?.get === 'function' ? response.headers.get('content-type') : null;
            return {
                ok: true,
                responseType: 'binary',
                status: Number(response.status) || 0,
                path: filePath,
                byteLength: bytes.length,
                contentType: contentType || null,
            };
        } catch (error) {
            return fail('staging-failed', `下载暂存写入失败：${errorMessage(error)}`);
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
            return schedule(() => send(req));
        },
        /** 暴露 jar 供 10 接 safeStorage（07 只做内存，main.cjs 不碰它） */
        cookieJar,
    };
}

/** 下载暂存只在「导入前的落脚」期间有意义：启动时整目录清掉重建 */
async function resetCommunityStaging(stagingDir) {
    const dir = resolveStagingDir(stagingDir);
    await fs.promises.rm(dir, { recursive: true, force: true });
    await fs.promises.mkdir(dir, { recursive: true });
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
    JSON_TIMEOUT_MS,
    BINARY_TIMEOUT_MS,
    createCommunityGateway,
    registerCommunityNetIpc,
    resetCommunityStaging,
};
