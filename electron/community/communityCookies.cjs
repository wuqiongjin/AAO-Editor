/**
 * 社区平台会话 Cookie 的**唯一**存放处（bestdori-integration 07 / 10）。
 *
 * 07 只做「解析 + 附着 + 捕获 + 快照」，jar 只活在主进程内存里：**不落盘，renderer 永远拿不到**
 * （ADR-0011 §3 凭据红线）。10 接登录时用 `snapshot()` / `restore()` 把它存进 Electron safeStorage，
 * 登出 = `clear()` + 清掉那份持久化。
 *
 * 与 Chromium 会话存储的关系：网关发请求时带 `credentials: 'omit'`（见 communityNet.cjs），
 * 凭据**只**从这份 jar 出，不落进 Electron 默认 session 的 cookie store。
 *
 * 待真机确认（10 登录时的第一件事）：Electron 官方文档没承诺 `net.fetch` 会把响应的
 * `Set-Cookie` 暴露给 `Headers`。网关会尽量从 `getSetCookie()` / `set-cookie` 两处取
 * （见 communityNet.cjs 的 readSetCookie），取不到时 jar 就是空的 —— 届时要换成 net.request 取原始头。
 */

const DEFAULT_PATH = '/';

/** `name=value`（Set-Cookie 的第一段） */
function parseCookiePair(text) {
    const eq = text.indexOf('=');
    if (eq <= 0) return null;
    const name = text.slice(0, eq).trim();
    if (name === '') return null;
    return { name, value: text.slice(eq + 1).trim() };
}

/** 请求路径推 Set-Cookie 的默认 Path（RFC 6265 §5.1.4） */
function defaultCookiePath(pathname) {
    if (typeof pathname !== 'string' || pathname === '' || pathname[0] !== '/') return DEFAULT_PATH;
    const lastSlash = pathname.lastIndexOf('/');
    if (lastSlash <= 0) return DEFAULT_PATH;
    return pathname.slice(0, lastSlash);
}

/**
 * 解析一条 Set-Cookie。
 * @param {string} raw
 * @param {string} requestHost 响应来源主机（小写）
 * @param {string} requestPath 响应来源路径
 * @param {number} now 当前时间（毫秒）
 */
function parseSetCookie(raw, requestHost, requestPath, now) {
    const parts = String(raw).split(';');
    const pair = parseCookiePair(parts[0]);
    if (!pair) return null;
    let domain = requestHost;
    let cookiePath = defaultCookiePath(requestPath);
    let expiresAt = null;
    let secure = false;
    let httpOnly = false;
    for (const attr of parts.slice(1)) {
        const eq = attr.indexOf('=');
        const key = (eq === -1 ? attr : attr.slice(0, eq)).trim().toLowerCase();
        const value = eq === -1 ? '' : attr.slice(eq + 1).trim();
        if (key === 'domain' && value !== '') {
            domain = value.replace(/^\./, '').toLowerCase();
        } else if (key === 'path' && value.startsWith('/')) {
            cookiePath = value;
        } else if (key === 'max-age') {
            const seconds = Number(value);
            if (Number.isFinite(seconds)) expiresAt = now + seconds * 1000;
        } else if (key === 'expires') {
            const at = Date.parse(value);
            if (!Number.isNaN(at)) expiresAt = at;
        } else if (key === 'secure') {
            secure = true;
        } else if (key === 'httponly') {
            httpOnly = true;
        }
    }
    return { ...pair, domain, path: cookiePath, expiresAt, secure, httpOnly };
}

function hostMatches(host, domain) {
    return host === domain || host.endsWith(`.${domain}`);
}

function pathMatches(pathname, cookiePath) {
    if (cookiePath === DEFAULT_PATH) return true;
    if (pathname === cookiePath) return true;
    return pathname.startsWith(cookiePath.endsWith('/') ? cookiePath : `${cookiePath}/`);
}

function keyOf(cookie) {
    return `${cookie.domain}\t${cookie.path}\t${cookie.name}`;
}

/**
 * 内存 cookie jar。
 * @param {{ now?: () => number }} [options]
 */
function createCookieJar(options = {}) {
    const now = options.now || Date.now;
    /** @type {Map<string, { name: string, value: string, domain: string, path: string, expiresAt: number | null, secure: boolean, httpOnly: boolean }>} */
    const cookies = new Map();

    function alive(cookie) {
        return !cookie || cookie.expiresAt === null || cookie.expiresAt > now();
    }

    function dropExpired() {
        for (const cookie of [...cookies.values()]) {
            if (!alive(cookie)) cookies.delete(keyOf(cookie));
        }
    }

    return {
        /**
         * 给请求头补上匹配的 Cookie（不改入参；没有匹配项时原样返回）。
         * @param {string} rawUrl
         * @param {Record<string, string>} headers
         */
        attach(rawUrl, headers) {
            const target = new URL(rawUrl);
            const host = target.hostname.toLowerCase();
            dropExpired();
            const picked = [...cookies.values()].filter(
                (cookie) =>
                    hostMatches(host, cookie.domain)
                    && pathMatches(target.pathname, cookie.path)
                    && (!cookie.secure || target.protocol === 'https:'),
            );
            if (picked.length === 0) return headers;
            // 长路径优先（RFC 6265 §5.4），同名时后来的在前面的后面 —— 与浏览器一致
            picked.sort((a, b) => b.path.length - a.path.length);
            const next = {};
            for (const [key, value] of Object.entries(headers || {})) {
                if (key.toLowerCase() === 'cookie') continue;
                next[key] = value;
            }
            next.cookie = picked.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
            return next;
        },

        /**
         * 收下响应里的 Set-Cookie（`Max-Age=0` / 已过期 = 删除）。
         * @param {string} rawUrl
         * @param {string[]} setCookieValues
         */
        capture(rawUrl, setCookieValues) {
            if (!Array.isArray(setCookieValues) || setCookieValues.length === 0) return;
            const target = new URL(rawUrl);
            for (const raw of setCookieValues) {
                const cookie = parseSetCookie(raw, target.hostname.toLowerCase(), target.pathname, now());
                if (!cookie) continue;
                if (alive(cookie)) cookies.set(keyOf(cookie), cookie);
                else cookies.delete(keyOf(cookie));
            }
        },

        /** 登出 / 会话作废：清空内存 jar（持久化那份由调用方一起清） */
        clear() {
            cookies.clear();
        },

        /** 快照给持久化用（10：safeStorage）；过滤已过期 */
        snapshot() {
            dropExpired();
            return [...cookies.values()].map((cookie) => ({ ...cookie }));
        },

        /** 从持久化恢复（10）；条目形状不合法就丢 */
        restore(entries) {
            cookies.clear();
            for (const entry of Array.isArray(entries) ? entries : []) {
                if (!entry || typeof entry.name !== 'string' || typeof entry.domain !== 'string') continue;
                if (typeof entry.value !== 'string') continue;
                const cookie = {
                    name: entry.name,
                    value: entry.value,
                    domain: String(entry.domain).replace(/^\./, '').toLowerCase(),
                    path: typeof entry.path === 'string' && entry.path.startsWith('/') ? entry.path : DEFAULT_PATH,
                    expiresAt: typeof entry.expiresAt === 'number' ? entry.expiresAt : null,
                    secure: entry.secure === true,
                    httpOnly: entry.httpOnly === true,
                };
                if (alive(cookie)) cookies.set(keyOf(cookie), cookie);
            }
        },
    };
}

module.exports = {
    createCookieJar,
    parseSetCookie,
};
