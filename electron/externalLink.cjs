/**
 * 站外链接出口（票 39 Q47）：注册 / 找回密码这类「去站点」的入口只开**系统浏览器**。
 *
 * 为什么校验在主进程：与社区网络那条出口同一条纪律（票 07「出口唯一 + 域名白名单」）——
 * renderer 只能递一个 URL 过来，**放不放行由这一侧说了算**。只放行社区平台自己与其子域，
 * 其余（其它站、子域伪装 `bestdori.com.evil.example`、`javascript:` 之类）一律不 open、直接抛错。
 *
 * URL 的产生地是 renderer 的 `src/community/bestdori/endpoints.ts`（域名只住那一处）；
 * 白名单复用 `communityNet.cjs` 的 `ALLOWED_HOSTS` —— 主进程侧只有一份域名事实。
 *
 * 与 communitySession / assetCache 同形（`register*Ipc` + main.cjs 只做接线）：
 * 逻辑住本文件，才能照 CommunitySession.test.ts 的形式跑真函数（假 ipcMain + 假 shell），
 * 而不是只能对着 main.cjs 的源码做静态断言。
 */
const { ALLOWED_HOSTS } = require('./communityNet.cjs');

/**
 * 是不是「社区平台自己或其子域」的 https 地址。
 * @param {unknown} rawUrl
 * @param {string[]} [hosts] 允许的主机（默认 ALLOWED_HOSTS；测试可注入）
 */
function isSiteUrl(rawUrl, hosts = ALLOWED_HOSTS) {
    if (typeof rawUrl !== 'string') return false;
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return false;
    }
    // 只放行 https：`file:` / `javascript:` / `data:` 这类协议一律出不去
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * 挂 `shell:openExternal`（主进程唯一的站外出口）。
 * @param {{ handle: (channel: string, listener: Function) => void }} ipcMain
 * @param {{ openExternal: (url: string) => Promise<void> }} shell
 */
function registerExternalLinkIpc(ipcMain, shell) {
    ipcMain.handle('shell:openExternal', async (_event, rawUrl) => {
        if (!isSiteUrl(rawUrl)) {
            // 不合法就不 open（也不回一个"成不成"的模糊值）：renderer 侧拿到 false 静默降级
            throw new Error('站外链接被拒：主机不在白名单');
        }
        await shell.openExternal(rawUrl);
        return true;
    });
}

module.exports = { isSiteUrl, registerExternalLinkIpc };
