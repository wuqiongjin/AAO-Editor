// bestdori-integration 10：账号与会话能力（登录 / 登出 / 会话 · 当前用户）。
//
// 锁测口径（票 10）：
//   ① 假出口 —— 登录成功置会话（登录 POST → Cookie 落盘 → 查一次 `user/me`）；
//   ② 登录失败（`{"result":false,"code":"CREDENTIALS_INVALID"}`）**不写入任何凭据**；
//   ③ `user/me` 401 → 会话失效、持久化被清，**读能力仍可用**（写能力变灰 = signed-out）；
//   ④ 凭据红线的两个反例：持久化接缝**零入参**（renderer 递不进凭据）、离线不乱清 Cookie。
import { describe, expect, it } from 'vitest';
import {
  createCommunityAccount,
  getCommunityAccount,
  resetCommunityAccount,
  type CommunityAccount,
} from '@/src/community/bestdori/account';
import { userLoginUrl, userMeUrl } from '@/src/community/bestdori/endpoints';
import { toAccountProfile } from '@/src/community/bestdori/mapping';
import { capabilitiesFor } from '@/src/community/availability';
import {
  CommunityError,
  type CommunityErrorKind,
  type CommunityRequest,
  type CommunityTransport,
} from '@/src/community/transport';
import type { CommunitySessionPersistence } from '@/src/community/sessionPersistence';

const LOGIN_URL = userLoginUrl();
const ME_URL = userMeUrl();

/** `GET /api/user/me` 的实测形状（docs/research/bestdori-community-upload.md §2） */
const ME_OK = {
  result: true,
  username: 'envy09',
  nickname: 'Envy',
  titles: null,
  email: 'envy09@example.com',
  messageCount: 3,
};

/** 平台侧的失败：网关已按 code 翻成统一错误域（票 07），能力层只认 kind */
function platformError(kind: CommunityErrorKind, platformCode?: string): CommunityError {
  return new CommunityError(`fake ${kind}`, { kind, message: `fake ${kind}`, platformCode });
}

interface FakeAccountTransport extends CommunityTransport {
  requests: CommunityRequest[];
}

/** 按 URL 打桩的假出口：命中值可以是载荷，也可以是「要抛的 CommunityError」 */
function fakeTransport(routes: Record<string, unknown>): FakeAccountTransport {
  const requests: CommunityRequest[] = [];
  return {
    kind: 'ipc',
    requests,
    async requestJson(req) {
      requests.push(req);
      if (!(req.url in routes)) throw new Error(`未打桩的请求: ${req.url}`);
      const hit = routes[req.url];
      if (hit instanceof Error) throw hit;
      return hit;
    },
    async requestText(req) {
      requests.push(req);
      throw new Error(`不该有文本请求: ${req.url}`);
    },
    async requestBinary(req) {
      requests.push(req);
      throw new Error(`不该有二进制请求: ${req.url}`);
    },
  };
}

/** 假持久化：只记「谁被调过、带没带参数」—— 参数表就是「凭据有没有路走到落盘」的证据 */
function fakePersistence(init: { restored?: boolean } = {}) {
  const ops: { op: string; args: unknown[] }[] = [];
  const impl: CommunitySessionPersistence = {
    async restore() {
      ops.push({ op: 'restore', args: [] });
      return init.restored === true;
    },
    async persist() {
      ops.push({ op: 'persist', args: [] });
      return true;
    },
    async clear() {
      ops.push({ op: 'clear', args: [] });
    },
  };
  return { ops, impl };
}

/** 手写假时钟（同 rateLimit 的口径）：退避重试在单测里不真等 */
const noSleep = { sleep: async () => undefined, random: () => 0 };

function makeAccount(
  transport: CommunityTransport,
  persistence: CommunitySessionPersistence,
): CommunityAccount {
  return createCommunityAccount({ transport, persistence, retry: noSleep });
}

describe('票 10 · 中立账号资料（GET /api/user/me 的映射）', () => {
  it('只取展示需要的字段：username 是身份，nickname 缺了就是 null', () => {
    expect(toAccountProfile(ME_OK)).toEqual({
      username: 'envy09',
      nickname: 'Envy',
      email: 'envy09@example.com',
      messageCount: 3,
    });
    expect(toAccountProfile({ result: true, username: ' envy09 ' })).toEqual({
      username: 'envy09',
      nickname: null,
      email: null,
      messageCount: null,
    });
  });

  it('result 非 true / 缺 username → null（能力层翻成 invalid-response，不当成「已登录」）', () => {
    expect(toAccountProfile({ result: false, code: 'LOGIN_REQUIRED' })).toBeNull();
    expect(toAccountProfile({ result: true })).toBeNull();
    expect(toAccountProfile({ result: true, username: '   ' })).toBeNull();
    expect(toAccountProfile(null)).toBeNull();
  });
});

describe('票 10 · 登录成功', () => {
  it('登录载荷只带账号密码；随后的落盘是零入参，会话以 user/me 为准', async () => {
    const transport = fakeTransport({ [LOGIN_URL]: { result: true }, [ME_URL]: ME_OK });
    const persistence = fakePersistence();
    const account = makeAccount(transport, persistence.impl);

    await account.login('envy09', 'hunter2');

    expect(account.getSession()).toEqual({
      signedIn: true,
      account: { username: 'envy09', nickname: 'Envy', email: 'envy09@example.com', messageCount: 3 },
    });

    // 两条请求：登录（POST）→ 校验（GET user/me）
    expect(transport.requests.map((req) => [req.method, req.url])).toEqual([
      ['POST', LOGIN_URL],
      ['GET', ME_URL],
    ]);
    expect(JSON.parse(transport.requests[0].body ?? '{}')).toEqual({ username: 'envy09', password: 'hunter2' });
    // 登录是**写型 POST**：不声明 cacheable（07/14 的口径：写请求不进网关缓存）
    expect(transport.requests[0].cacheable).toBeUndefined();
    // 落盘那次零入参 —— renderer 没有任何一只手能把凭据递给持久化路径
    expect(persistence.ops).toEqual([{ op: 'persist', args: [] }]);
  });

  it('登录成功但落盘失败：会话照用（记不住 ≠ 没登上）', async () => {
    const transport = fakeTransport({ [LOGIN_URL]: { result: true }, [ME_URL]: ME_OK });
    const account = createCommunityAccount({
      transport,
      retry: noSleep,
      persistence: {
        restore: async () => false,
        persist: async () => false,
        clear: async () => undefined,
      },
    });

    await account.login('envy09', 'hunter2');

    expect(account.getSession().signedIn).toBe(true);
  });
});

describe('票 10 · 登录失败不写入任何凭据', () => {
  it('CREDENTIALS_INVALID：不落盘、不查 user/me，本机还把残留清干净', async () => {
    const transport = fakeTransport({
      [LOGIN_URL]: platformError('unauthorized', 'CREDENTIALS_INVALID'),
    });
    const persistence = fakePersistence();
    const account = makeAccount(transport, persistence.impl);

    await expect(account.login('envy09', 'wrong')).rejects.toMatchObject({
      kind: 'unauthorized',
      platformCode: 'CREDENTIALS_INVALID',
    });

    expect(account.getSession()).toEqual({ signedIn: false, account: null });
    // 一次 persist 都没有；反倒 clear 了一次（平台当面拒了凭据 → 本机一份都不留）
    expect(persistence.ops).toEqual([{ op: 'clear', args: [] }]);
    // 失败后不再多打一条 user/me
    expect(transport.requests.map((req) => req.url)).toEqual([LOGIN_URL]);
  });

  it('连不上（不是平台拒的）：同样不落盘，但不动本地既有凭据', async () => {
    const transport = fakeTransport({ [LOGIN_URL]: platformError('offline') });
    const persistence = fakePersistence();
    const account = makeAccount(transport, persistence.impl);

    await expect(account.login('envy09', 'hunter2')).rejects.toMatchObject({ kind: 'offline' });

    expect(account.getSession().signedIn).toBe(false);
    expect(persistence.ops).toEqual([]);
  });
});

describe('票 10 · 启动校验（restore → user/me）', () => {
  it('有持久化会话且 me 通过：直接进登录态，只发这一条请求', async () => {
    const transport = fakeTransport({ [ME_URL]: ME_OK });
    const persistence = fakePersistence({ restored: true });
    const account = makeAccount(transport, persistence.impl);

    await expect(account.start()).resolves.toMatchObject({ signedIn: true });

    expect(transport.requests.map((req) => [req.method, req.url])).toEqual([['GET', ME_URL]]);
    expect(persistence.ops.map((op) => op.op)).toEqual(['restore']);
  });

  it('没有持久化会话：一条请求都不发（不白屏、不打网络）', async () => {
    const transport = fakeTransport({});
    const persistence = fakePersistence();
    const account = makeAccount(transport, persistence.impl);

    await expect(account.start()).resolves.toEqual({ signedIn: false, account: null });

    expect(transport.requests).toEqual([]);
    expect(persistence.ops.map((op) => op.op)).toEqual(['restore']);
  });

  it('user/me 401：会话失效 + 清掉持久化 Cookie，**读能力仍可用**（写能力变灰）', async () => {
    const transport = fakeTransport({ [ME_URL]: platformError('unauthorized', 'LOGIN_REQUIRED') });
    const persistence = fakePersistence({ restored: true });
    const account = makeAccount(transport, persistence.impl);

    await account.start();

    const session = account.getSession();
    expect(session).toEqual({ signedIn: false, account: null });
    expect(persistence.ops.map((op) => op.op)).toEqual(['restore', 'clear']);

    // 失效表现（ADR-0011 §1 / issue 06 Q3）：不弹窗、不白屏 —— 只是写能力灰掉
    expect(capabilitiesFor({ status: 'online', checkedAt: 1 }, session)).toEqual({
      read: true,
      write: false,
      block: 'signed-out',
    });
  });

  it('校验遇离线 / 超时：**不乱清凭据**（留着下次再接），只是这次没登录上', async () => {
    const transport = fakeTransport({ [ME_URL]: platformError('offline') });
    const persistence = fakePersistence({ restored: true });
    const account = makeAccount(transport, persistence.impl);

    await account.start();

    expect(account.getSession().signedIn).toBe(false);
    // 清一条都不会发：一次断网不该把用户的登录态烧掉
    expect(persistence.ops.map((op) => op.op)).toEqual(['restore']);
    // 幂等读走统一退避（3 次尝试），失败后才落定
    expect(transport.requests).toHaveLength(3);
  });

  it('start() 幂等：重复调用不再校验（不轮询、不重复打网络）', async () => {
    const transport = fakeTransport({ [ME_URL]: ME_OK });
    const persistence = fakePersistence({ restored: true });
    const account = makeAccount(transport, persistence.impl);

    const [a, b] = await Promise.all([account.start(), account.start()]);
    await account.start();

    expect(a).toBe(b);
    expect(transport.requests).toHaveLength(1);
    expect(persistence.ops.map((op) => op.op)).toEqual(['restore']);
  });
});

describe('票 10 · 登出与订阅', () => {
  it('登出 = 清本机会话 + 清掉被持久化的 Cookie', async () => {
    const transport = fakeTransport({ [LOGIN_URL]: { result: true }, [ME_URL]: ME_OK });
    const persistence = fakePersistence();
    const account = makeAccount(transport, persistence.impl);

    await account.login('envy09', 'hunter2');
    await account.logout();

    expect(account.getSession()).toEqual({ signedIn: false, account: null });
    expect(persistence.ops.map((op) => op.op)).toEqual(['persist', 'clear']);
  });

  it('订阅只在会话真的变了时通知一次', async () => {
    const transport = fakeTransport({ [LOGIN_URL]: { result: true }, [ME_URL]: ME_OK });
    const persistence = fakePersistence();
    const account = makeAccount(transport, persistence.impl);
    const seen: boolean[] = [];
    const off = account.subscribe((session) => seen.push(session.signedIn));

    await account.start(); // 没有持久化会话 → 未登录（初始态就是未登录，不算变化）
    await account.login('envy09', 'hunter2');
    await account.logout();
    off();
    await account.logout();

    expect(seen).toEqual([true, false]);
  });
});

describe('票 10 · 静态演示版（没有会话桥）', () => {
  it('没有出口时 start() 不发请求、不抛错：退化成「未登录」', async () => {
    resetCommunityAccount();
    try {
      const account = getCommunityAccount();
      // 同一个会话对象（唯一真相）：两次取到的是同一份
      expect(getCommunityAccount()).toBe(account);
      await expect(account.start()).resolves.toEqual({ signedIn: false, account: null });
      await expect(account.login('envy09', 'x')).rejects.toMatchObject({ kind: 'unsupported-runtime' });
    } finally {
      resetCommunityAccount();
    }
  });
});
