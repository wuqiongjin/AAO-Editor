/**
 * 会话 Cookie 的加密持久化（bestdori-integration 10；ADR-0011 §3 凭据红线）。
 *
 * 分工：
 *   - 07 的 `communityCookies.cjs` 管「解析 / 附着 / 捕获 / 快照」，jar 只活在内存；
 *   - 本模块管「把 jar 的快照落到磁盘、再读回来」—— 走 Electron `safeStorage`
 *     （Windows DPAPI / macOS Keychain / Linux libsecret），**明文永不落盘**；
 *     解不开 / 形态不对就当作没有会话（不猜、不兜底、不报错）。
 *
 * 落点：`<userData>/community-session.bin` —— **不跟数据根走**。数据根是「用户数据」
 * （可搬家、可拷到别的机器、可能被分享），凭据是本机的事，与 `app-state.json` 同级。
 *
 * **renderer 一条凭据都不递也不收**：三条 IPC 全为**零入参** —— 恢复 / 落盘 / 清除
 * 都由主进程从**自己**的 jar 快照做，回给 renderer 的只有布尔。这是「凭据不经 renderer」
 * 的结构保证，不是一句约定（`tests/static/CommunityCredentialBoundary.test.ts` 盯这条）。
 *
 * 本机不支持加密时（Linux 无 keyring、或 app 未 ready）**不落盘**：宁可不记住登录态，
 * 也不往用户盘上写一份明文 / 弱加密的 token。会话在本次运行里照用，只是下次启动要重新登录。
 *
 * `safeStorage` 只能在 app ready 之后使用 —— 所以这里**不在加载期调用它**，
 * 每次现问（`available()`），main.cjs 也就敢在模块顶层建这个 store。
 */
const path = require('path');
const fs = require('fs');

/** 会话文件名（落在 userData 下，与 app-state.json 同级） */
const SESSION_FILENAME = 'community-session.bin';
/** 加密载荷的形态版本：解出来不是这一版就当没有（旧版 / 被改过的文件都不算数） */
const SESSION_FORMAT_VERSION = 1;

/** `<userData>/community-session.bin` */
function sessionFilePath(userData) {
    return path.join(userData, SESSION_FILENAME);
}

/** 原子写（口径同 main.cjs 的 writeFileAtomic）：崩在半路不会留下一份截断的密文 */
async function writeFileAtomic(filePath, data) {
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(tmpPath, data);
    await fs.promises.rename(tmpPath, filePath);
}

/**
 * 会话存储（主进程）。
 * @param {{ safeStorage: any, filePath: () => string }} options
 *   `safeStorage` 由 main.cjs 注入（本模块不 require electron，便于平台测试跑真函数）；
 *   `filePath` 是**函数**：userData 在测试里是临时目录。
 */
function createSessionStore(options) {
    const safeStorage = options && options.safeStorage;
    const filePath = options && options.filePath;
    if (!safeStorage || typeof safeStorage.encryptString !== 'function' || typeof safeStorage.decryptString !== 'function') {
        throw new Error('会话存储需要 safeStorage（由主进程注入）');
    }
    if (typeof filePath !== 'function') {
        throw new Error('会话存储需要 filePath 提供者');
    }

    /** 本机此刻能不能加密。每次现问 —— safeStorage 在 app ready 之前不可用 */
    function available() {
        try {
            return safeStorage.isEncryptionAvailable() === true;
        } catch {
            return false;
        }
    }

    /**
     * 读回 cookie 条目（形状与 `cookieJar.restore()` 收的一致）。
     * 任何一步不成立都回 null：不支持 / 没文件 / 解不开 / 形态不对 —— 都当「没有会话」。
     */
    async function read() {
        if (!available()) return null;
        let cipher;
        try {
            cipher = await fs.promises.readFile(filePath());
        } catch {
            return null;
        }
        let text;
        try {
            text = safeStorage.decryptString(Buffer.from(cipher));
        } catch {
            return null;
        }
        let doc;
        try {
            doc = JSON.parse(text);
        } catch {
            return null;
        }
        if (!doc || typeof doc !== 'object' || doc.version !== SESSION_FORMAT_VERSION) return null;
        return Array.isArray(doc.cookies) ? doc.cookies : null;
    }

    /** 落盘。写不进 / 不支持都回 false —— 调用方照用内存会话，不当登录失败 */
    async function write(cookies) {
        if (!available()) return false;
        if (!Array.isArray(cookies) || cookies.length === 0) return false;
        try {
            const text = JSON.stringify({ version: SESSION_FORMAT_VERSION, cookies });
            await writeFileAtomic(filePath(), safeStorage.encryptString(text));
            return true;
        } catch {
            return false;
        }
    }

    async function clear() {
        try {
            await fs.promises.rm(filePath(), { force: true });
        } catch {
            // 删不掉也不抛：内存 jar 那边已经清了，功能不受影响
        }
    }

    return { available, read, write, clear };
}

/**
 * 注册会话 IPC（形态照既有桥：一个命名空间一条 invoke）。
 * 三条 handler **都零入参** —— renderer 递不进凭据，也拿不到凭据。
 * 只有这三条：凭据面的接口越小越好（`clear()` 的返回值是「办完了」的回执，与
 * backgroundSkin:clear / windowChrome:sync 同形）。
 * @param {{ handle: (channel: string, listener: Function) => void }} ipcMain
 * @param {{ gateway: { cookieJar: any }, store: any }} deps
 */
function registerCommunitySessionIpc(ipcMain, deps) {
    const cookieJar = deps.gateway.cookieJar;
    const store = deps.store;

    ipcMain.handle('communitySession:restore', async () => {
        const cookies = await store.read();
        if (!cookies || cookies.length === 0) return { restored: false };
        cookieJar.restore(cookies);
        return { restored: cookieJar.snapshot().length > 0 };
    });

    ipcMain.handle('communitySession:persist', async () => {
        const cookies = cookieJar.snapshot();
        if (cookies.length === 0) return { persisted: false };
        return { persisted: await store.write(cookies) };
    });

    ipcMain.handle('communitySession:clear', async () => {
        cookieJar.clear();
        await store.clear();
        return true;
    });
}

module.exports = {
    SESSION_FILENAME,
    SESSION_FORMAT_VERSION,
    sessionFilePath,
    createSessionStore,
    registerCommunitySessionIpc,
};
