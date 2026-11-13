/**
 * 站外链接出口（票 39 Q47 定形；票 18 起增加产品自有站点）。
 *
 * 为什么校验在主进程：与社区网络那条出口同一条纪律（票 07「出口唯一 + 域名白名单」）——
 * renderer 只能递一个 URL 过来，**放不放行由这一侧说了算**。其余（其它站、子域伪装
 * `bestdori.com.evil.example`、`javascript:` 之类）一律不 open、直接抛错。
 *
 * **两份白名单，刻意不合并**：
 *   - `ALLOWED_HOSTS`（`communityNet.cjs`）= **网络出口**的信任边界（哪些站可以发请求）；
 *   - `PRODUCT_HOSTS`（本文件）= 产品自己的站（关于页四行 + 导航作者块，票 18）。
 * 把产品域名并进社区那份，等于顺手放宽了网络出口 —— 两者关心的事根本不同。
 *
 * URL 的产生地：社区那条是 `src/community/bestdori/endpoints.ts`，产品那条是
 * `src/app/productLinks.ts`（域名只住各自那一处）。本文件只认**主机名**，不认路径。
 *
 * 与 communitySession / assetCache 同形（`register*Ipc` + main.cjs 只做接线）：
 * 逻辑住本文件，才能照 CommunitySession.test.ts 的形式跑真函数（假 ipcMain + 假 shell），
 * 而不是只能对着 main.cjs 的源码做静态断言。
 */
const { ALLOWED_HOSTS } = require('./communityNet.cjs');

/**
 * 产品自有站点（`src/app/productLinks.ts` 在主进程侧的镜像）：
 * github.com 是仓库 / Issues / 作者主页，wuqiongjin.github.io 是产品主页与文档站。
 * 子域按同一条规则放行（都是同一持份者名下的主机）。
 */
const PRODUCT_HOSTS = ['github.com', 'wuqiongjin.github.io'];

/**
 * 是不是「https + 主机在白名单内（含子域）」。
 * @param {unknown} rawUrl
 * @param {string[]} hosts
 */
function isHttpsOnHosts(rawUrl, hosts) {
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
 * 是不是「社区平台自己或其子域」的 https 地址。
 * @param {unknown} rawUrl
 * @param {string[]} [hosts] 允许的主机（默认 ALLOWED_HOSTS；测试可注入）
 */
function isSiteUrl(rawUrl, hosts = ALLOWED_HOSTS) {
    return isHttpsOnHosts(rawUrl, hosts);
}

/**
 * 是不是「产品自有站点」的 https 地址。
 * @param {unknown} rawUrl
 * @param {string[]} [hosts] 允许的主机（默认 PRODUCT_HOSTS；测试可注入）
 */
function isProductUrl(rawUrl, hosts = PRODUCT_HOSTS) {
    return isHttpsOnHosts(rawUrl, hosts);
}

/**
 * 挂 `shell:openExternal`（主进程唯一的站外出口）。
 * @param {{ handle: (channel: string, listener: Function) => void }} ipcMain
 * @param {{ openExternal: (url: string) => Promise<void> }} shell
 */
function registerExternalLinkIpc(ipcMain, shell) {
    ipcMain.handle('shell:openExternal', async (_event, rawUrl) => {
        if (!isSiteUrl(rawUrl) && !isProductUrl(rawUrl)) {
            // 不合法就不 open（也不回一个"成不成"的模糊值）：renderer 侧拿到 false 静默降级
            throw new Error('站外链接被拒：主机不在白名单');
        }
        await shell.openExternal(rawUrl);
        return true;
    });
}

module.exports = { PRODUCT_HOSTS, isSiteUrl, isProductUrl, registerExternalLinkIpc };
