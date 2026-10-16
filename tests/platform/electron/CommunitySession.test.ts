// 票 10：会话 Cookie 的加密持久化（主进程）+ 会话 IPC 契约 + 接线事实。
//
// 分工照 CommunityNetWiring.test.ts 的惯例：真函数跑行为（真 fs + 假 safeStorage / 假 ipcMain），
// 静态断言读源码锁接线。**单测覆盖不到的那一档**（safeStorage 真实加解密、跨进程真取值、
// Cookie TTL）归票 10 锁测 3 的真机手工验收 —— 这里用假 safeStorage 只锁「明文有没有机会落盘」。
//
// 最后一个 describe 是**全链**那一条：真 `{"result":false,"code":"CREDENTIALS_INVALID"}` 走
// 07 的真网关 → 翻成统一错误域 → 10 的账号层 → 清空 jar / 不落盘。票 10 锁测 1 在单测里喂的是
// 已经翻好的错误对象（能力层的接缝），「原码怎么翻」那一跳只有这里能连上（票 07 负责那一跳本身）。
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SESSION_FILENAME,
  createSessionStore,
  registerCommunitySessionIpc,
  sessionFilePath,
} from '@/electron/communitySession.cjs';
import { createCommunityGateway } from '@/electron/communityNet.cjs';
import { createCommunityAccount } from '@/src/community/bestdori/account';
import { userLoginUrl } from '@/src/community/bestdori/endpoints';
import {
  createSessionPersistence,
  type CommunitySessionBridge,
} from '@/src/community/sessionPersistence';
import { CommunityError, type CommunityTransport } from '@/src/community/transport';
import { readSource, readStripped } from '@/tests/support/source';
import { tmpDir } from '@/tests/support/fs';

const mainSrc = readStripped('electron/main.cjs');
const sessionSrc = readStripped('electron/communitySession.cjs');

/** 假 safeStorage：base64 当「加密」（真机是 DPAPI / Keychain）。够用来锁「明文没落盘」这条 */
function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text: string) => Buffer.from(`enc:${Buffer.from(text, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('解不开');
      return Buffer.from(text.slice(4), 'base64').toString('utf8');
    },
  };
}

/** 与 fakeSafeStorage 同一套「密封」写法，用来造坏文件 */
function sealed(text: string): string {
  return `enc:${Buffer.from(text, 'utf8').toString('base64')}`;
}

/** 假 ipcMain：收下注册进来的 handler，测试直接调它（跨进程语义的进程内替身） */
function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
  return {
    handlers,
    ipcMain: {
      handle: (channel: string, listener: any) => {
        handlers.set(channel, listener);
      },
    },
  };
}

const okFetch = async () => ({
  status: 200,
  headers: { get: () => null, getSetCookie: () => [] },
  text: async () => '{"result":true}',
});

/** 会话那套的主进程侧装配（网关 + store），与 main.cjs 的接线同形 */
function makeSessionPair(userData: string, deps: { safeStorage?: any; gateway?: any } = {}) {
  const gateway = deps.gateway ?? createCommunityGateway({ fetchImpl: okFetch });
  const store = createSessionStore({
    safeStorage: deps.safeStorage ?? fakeSafeStorage(),
    filePath: () => sessionFilePath(userData),
  });
  const { handlers, ipcMain } = fakeIpcMain();
  registerCommunitySessionIpc(ipcMain, { gateway, store });
  return { gateway, store, handlers };
}

/** 模拟一次登录响应：站点回的 `Set-Cookie: token=…` 被 07 的 jar 收下 */
function signInOnJar(jar: any, token = 's3cr3t-token') {
  jar.capture('https://bestdori.com/api/user/login', [`token=${token}; Path=/; HttpOnly`]);
}

/** 把假 ipcMain 上注册的那三条 handler 拼成**真形状**的桥（preload 桥背后就是它们） */
function bridgeOverHandlers(
  handlers: Map<string, (event: unknown, payload?: unknown) => unknown>,
): CommunitySessionBridge {
  const call = (channel: string) => async () => (await handlers.get(channel)?.(null)) as any;
  return {
    restore: call('communitySession:restore'),
    persist: call('communitySession:persist'),
    clear: async () => {
      await handlers.get('communitySession:clear')?.(null);
      return true;
    },
  };
}

/** 把真网关包成 renderer 侧的出口（形态照 electronTransport，只够这个文件用） */
function transportOverGateway(gateway: any): CommunityTransport {
  const send = async (req: any) => {
    const result = await gateway.request(req);
    if (!result.ok) throw new CommunityError(result.error.message, result.error);
    return result;
  };
  return {
    kind: 'ipc',
    async requestJson(req) {
      return (await send({ ...req, responseType: 'json' })).data;
    },
    async requestText(req) {
      return (await send({ ...req, responseType: 'text' })).text;
    },
    async requestBinary(req) {
      const result = await send({ ...req, responseType: 'binary' });
      return { path: result.path, byteLength: result.byteLength, contentType: result.contentType };
    },
  };
}

describe('票 10 · 会话存储（safeStorage 加密落盘）', () => {
  it('落点固定在 <userData>/community-session.bin', () => {
    expect(SESSION_FILENAME).toBe('community-session.bin');
    expect(sessionFilePath('/userData')).toBe(join('/userData', SESSION_FILENAME));
  });

  it('写进去的是**密文**、读回来形状不变（盘上找不到 token 原文）', async () => {
    const userData = tmpDir('aao-session-');
    try {
      const store = createSessionStore({ safeStorage: fakeSafeStorage(), filePath: () => sessionFilePath(userData) });
      const cookies = [{ name: 'token', value: 's3cr3t-token', domain: 'bestdori.com', path: '/', expiresAt: null }];

      await expect(store.write(cookies)).resolves.toBe(true);
      expect(existsSync(sessionFilePath(userData))).toBe(true);
      // 明文不落盘：文件里读不出 token 的值（真机是 DPAPI / Keychain，这里锁的是「走了加密那一步」）
      expect(readFileSync(sessionFilePath(userData), 'utf8')).not.toContain('s3cr3t-token');

      await expect(store.read()).resolves.toEqual(cookies);
      expect(store.available()).toBe(true);
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('本机不支持加密：不落盘、不留文件（没有「退化成明文」这条兜底）', async () => {
    const userData = tmpDir('aao-session-plain-');
    try {
      const store = createSessionStore({ safeStorage: fakeSafeStorage(false), filePath: () => sessionFilePath(userData) });

      expect(store.available()).toBe(false);
      await expect(store.write([{ name: 'token', value: 'x', domain: 'bestdori.com', path: '/' }])).resolves.toBe(false);
      expect(existsSync(sessionFilePath(userData))).toBe(false);
      await expect(store.read()).resolves.toBeNull();
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('坏文件 / 旧版本 / 形态不对 / 解不开：一律当「没有会话」，不抛错（不挡启动）', async () => {
    const userData = tmpDir('aao-session-broken-');
    try {
      const store = createSessionStore({ safeStorage: fakeSafeStorage(), filePath: () => sessionFilePath(userData) });

      writeFileSync(sessionFilePath(userData), 'not-encrypted-at-all', 'utf8');
      await expect(store.read()).resolves.toBeNull();

      writeFileSync(sessionFilePath(userData), sealed('{"version":0,"cookies":[]}'), 'utf8');
      await expect(store.read()).resolves.toBeNull();

      writeFileSync(sessionFilePath(userData), sealed('{"version":1,"cookies":"nope"}'), 'utf8');
      await expect(store.read()).resolves.toBeNull();

      writeFileSync(sessionFilePath(userData), sealed('not json'), 'utf8');
      await expect(store.read()).resolves.toBeNull();
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('清盘：clear 删掉那份密文；本来就没有也不报错', async () => {
    const userData = tmpDir('aao-session-clear-');
    try {
      const store = createSessionStore({ safeStorage: fakeSafeStorage(), filePath: () => sessionFilePath(userData) });
      await store.write([{ name: 'token', value: 'x', domain: 'bestdori.com', path: '/' }]);

      await store.clear();
      expect(existsSync(sessionFilePath(userData))).toBe(false);
      await expect(store.clear()).resolves.toBeUndefined();
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });
});

describe('票 10 · 会话 IPC（三条，全部零入参）', () => {
  it('persist 从主进程自己的 jar 快照落盘；restore 灌回 jar；renderer 递不进凭据', async () => {
    const userData = tmpDir('aao-session-ipc-');
    try {
      const first = makeSessionPair(userData);
      signInOnJar(first.gateway.cookieJar);

      // 就算 renderer 硬塞一个载荷进来，落盘的也只能是主进程 jar 里的东西
      await expect(first.handlers.get('communitySession:persist')?.(null, { cookies: [{ name: 'evil', value: 'x' }] }))
        .resolves.toEqual({ persisted: true });
      expect(readFileSync(sessionFilePath(userData), 'utf8')).not.toContain('evil');

      // 新开一套（= 下次启动）：restore 把 Cookie 灌进空的 jar，之后的请求自然带上
      const second = makeSessionPair(userData);
      expect(second.gateway.cookieJar.attach('https://bestdori.com/api/user/me', {}).cookie).toBeUndefined();

      await expect(second.handlers.get('communitySession:restore')?.(null)).resolves.toEqual({ restored: true });
      expect(second.gateway.cookieJar.attach('https://bestdori.com/api/user/me', {}).cookie).toBe('token=s3cr3t-token');
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('jar 空时不写文件；盘上没文件时 restore 只是「没恢复」（不打网络、不报错）', async () => {
    const userData = tmpDir('aao-session-empty-');
    try {
      const { handlers } = makeSessionPair(userData);

      await expect(handlers.get('communitySession:persist')?.(null)).resolves.toEqual({ persisted: false });
      expect(existsSync(sessionFilePath(userData))).toBe(false);
      await expect(handlers.get('communitySession:restore')?.(null)).resolves.toEqual({ restored: false });
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('clear = 清内存 jar + 删密文（登出与「平台不认了」共用同一个出口）', async () => {
    const userData = tmpDir('aao-session-logout-');
    try {
      const { gateway, handlers } = makeSessionPair(userData);
      signInOnJar(gateway.cookieJar);
      await handlers.get('communitySession:persist')?.(null);
      expect(existsSync(sessionFilePath(userData))).toBe(true);

      await expect(handlers.get('communitySession:clear')?.(null)).resolves.toBe(true);

      expect(gateway.cookieJar.attach('https://bestdori.com/api/user/me', {}).cookie).toBeUndefined();
      expect(existsSync(sessionFilePath(userData))).toBe(false);
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });
});

/** 按调用顺序依次回载荷的假 fetch（第一发登录、第二发 user/me，各自可带 Set-Cookie） */
function respondInOrder(steps: { body: string; cookies?: string[] }[]) {
  let index = 0;
  return async () => {
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;
    return {
      status: 200,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
        getSetCookie: () => step.cookies ?? [],
      },
      text: async () => step.body,
    };
  };
}

describe('票 10 · 真实载荷走满全链（07 网关 → 10 账号层 → 磁盘）', () => {
  /** 站点对登录失败的**真实**响应（docs/research/bestdori-community-upload.md §2 实测） */
  const loginFailureFetch = async () => ({
    status: 200,
    headers: { get: () => 'application/json', getSetCookie: () => [] },
    text: async () => '{"result":false,"code":"CREDENTIALS_INVALID"}',
  });

  it('CREDENTIALS_INVALID：翻成 unauthorized、会话仍未登录，且盘上一点凭据都没有', async () => {
    const userData = tmpDir('aao-session-chain-');
    try {
      const gateway = createCommunityGateway({ fetchImpl: loginFailureFetch });
      const store = createSessionStore({ safeStorage: fakeSafeStorage(), filePath: () => sessionFilePath(userData) });
      const { handlers, ipcMain } = fakeIpcMain();
      registerCommunitySessionIpc(ipcMain, { gateway, store });

      const account = createCommunityAccount({
        transport: transportOverGateway(gateway),
        // 走真形状的桥：renderer → preload → 三条 IPC handler → jar → safeStorage 文件
        persistence: createSessionPersistence(bridgeOverHandlers(handlers)),
      });

      await expect(account.login('envy09', 'wrong')).rejects.toMatchObject({
        kind: 'unauthorized',
        platformCode: 'CREDENTIALS_INVALID',
      });

      // 平台当面拒了凭据 = 「没登上」，不是「会话失效」（票 39：expired 留给 user/me 401 那条路）
      expect(account.getSession()).toEqual({ signedIn: false, account: null, remembered: null, expired: false, verifying: false });
      // 平台拒了凭据 → 本机一份都不留：jar 空、没写过文件、也没有「可以写进盘里的东西」
      expect(gateway.cookieJar.snapshot()).toEqual([]);
      await expect(handlers.get('communitySession:persist')?.(null)).resolves.toEqual({ persisted: false });
      expect(existsSync(sessionFilePath(userData))).toBe(false);
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('成功路径同一条链：登录 → 落盘（密文）→ 下次启动 restore 后请求自带 token', async () => {
    const userData = tmpDir('aao-session-chain-ok-');
    try {
      const gateway = createCommunityGateway({
        fetchImpl: respondInOrder([
          // ① POST /api/user/login：成功 + 站点给的 token Cookie
          { body: '{"result":true}', cookies: ['token=s3cr3t-token; Path=/; HttpOnly'] },
          // ② GET /api/user/me：只答资料，不再发 Cookie
          { body: '{"result":true,"username":"envy09","nickname":"Envy"}' },
        ]),
      });
      const store = createSessionStore({ safeStorage: fakeSafeStorage(), filePath: () => sessionFilePath(userData) });
      const { handlers, ipcMain } = fakeIpcMain();
      registerCommunitySessionIpc(ipcMain, { gateway, store });
      const account = createCommunityAccount({
        transport: transportOverGateway(gateway),
        persistence: createSessionPersistence(bridgeOverHandlers(handlers)),
      });

      await account.login('envy09', 'hunter2');

      expect(account.getSession()).toMatchObject({ signedIn: true, account: { username: 'envy09' } });
      // 落盘的是密文（真 safeStorage 是 DPAPI / Keychain，这里锁的是「走了加密那一步」）
      expect(readFileSync(sessionFilePath(userData), 'utf8')).not.toContain('s3cr3t-token');

      // 下次启动：进程里的 jar 是新的、空的；restore 之后请求自己就带上 token
      const restarted = createCommunityGateway({
        fetchImpl: async () => ({ status: 200, headers: { get: () => null, getSetCookie: () => [] }, text: async () => '{"result":true}' }),
      });
      const restart = makeSessionPair(userData, { gateway: restarted });

      expect(restarted.cookieJar.attach(userLoginUrl(), {}).cookie).toBeUndefined();
      await expect(restart.handlers.get('communitySession:restore')?.(null)).resolves.toEqual({ restored: true });
      expect(restarted.cookieJar.attach(userLoginUrl(), {}).cookie).toBe('token=s3cr3t-token');
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });
});

describe('票 10 · 接线事实（主进程 + CJS 单向依赖）', () => {
  it('main.cjs 注入 safeStorage 与 userData 路径，store 接在网关的 jar 上', () => {
    expect(mainSrc).toMatch(/safeStorage/);
    expect(mainSrc).toMatch(/createSessionStore\(\{\s*safeStorage,\s*filePath:\s*\(\)\s*=>\s*sessionFilePath\(userDataDir\(\)\),\s*\}\)/);
    expect(mainSrc).toMatch(/registerCommunitySessionIpc\(ipcMain,\s*\{\s*gateway:\s*communityGateway,\s*store:\s*communitySessionStore\s*\}\)/);
  });

  it('会话模块不 require electron（safeStorage 由 main 注入，便于平台测试跑真函数）', () => {
    expect(sessionSrc).not.toMatch(/require\(\s*['"]electron['"]\s*\)/);
    expect(readSource('electron/communitySession.cjs')).not.toMatch(/from '@\/src|require\(['"]\.\.\/src/);
  });

  it('加解密只在请求时现做（safeStorage 在 app ready 之前不可用，加载期不许碰）', () => {
    expect(sessionSrc).toMatch(/isEncryptionAvailable/);
    expect(sessionSrc).toMatch(/function available\(\)/);
    expect(mainSrc).not.toMatch(/isEncryptionAvailable/);
  });
});
