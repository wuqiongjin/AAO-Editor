/**
 * 账号与会话能力（票 10；issue 06 能力 9–10）：登录 / 登出 / 会话、当前用户。
 *
 * 定案（issues/04 + 06 Q3，ADR-0011 §3）：
 *   - **内置登录直传**：`POST /api/user/login`（JSON `{username, password}`），成功后站点给的
 *     `token` Cookie 由**主进程**收下（07 的内存 jar），本能力只递 URL 与载荷；
 *   - **密码不落盘**：它只活在这一次请求的载荷里 —— 不进状态、不进持久化、不进日志
 *     （`tests/static/CommunityCredentialBoundary.test.ts` 把这条钉住）；
 *   - **会话唯一真相**：本模块持**一个**会话对象（`getCommunityAccount()` 是那个单例），
 *     登录成功与启动时各查一次 `GET /api/user/me` 校验；
 *   - **失效表现**（ADR-0011 §1）：平台不认这份 Cookie 时**就地转未登录** —— 写能力变灰、
 *     读能力一样可用，不弹窗、不白屏（界面文案按 `availability.capabilitiesFor` 的矩阵走）；
 *   - **登出** = 清本机会话 + 删那份被持久化的 Cookie（两件事都在主进程，见 sessionPersistence）。
 *
 * 「我自己的作品列表」不在这里：它是 `post/list` 带 `username`，同一条端点、同一套缓存，
 * 所以住在 `posts.ts`（`fetchMyPostsPage`），本模块只负责给出那个 `username`（`account.username`）。
 *
 * Cookie 的值**永远不进 renderer**：本模块连读都读不到，只知道「登录态是真是假」。
 */
import { createCommunityTransport } from '../electronTransport';
import { withRetry, type RetryDeps, type RetryNotice } from '../rateLimit';
import { createSessionPersistence, type CommunitySessionPersistence } from '../sessionPersistence';
import { invalidResponse, isCommunityError, type CommunityTransport } from '../transport';
import {
  BESTDORI_JSON_TIMEOUT_MS,
  BESTDORI_RETRY_POLICY,
  bestdoriHeaders,
  userLoginUrl,
  userMeUrl,
} from './endpoints';
import { toAccountProfile, type AccountProfile } from './mapping';

/**
 * 会话快照（唯一真相的对外形态）。
 *
 * `signedIn` 与 `availability.capabilitiesFor(state, session)` 的入参**同形** ——
 * 直接把这份快照递给它就能算出「读可用 / 写变灰」，不需要再转一道。
 */
export interface CommunityAccountSession {
  signedIn: boolean;
  /** 未登录时恒为 null（校验通过才有资料）；`username` 是身份，展示用 `nickname` */
  account: AccountProfile | null;
  /**
   * 本机把这份登录**记没记住**（票 39 Q6）：`login()` 落盘 / `start()` 恢复的成败。
   * 未登录（没登上 / 已登出）恒为 null —— 界面那句「本机不会记住登录状态」的唯一数据来源，
   * 不开第四条 IPC（「本机能不能加密」由 `persist()` 的布尔回答，见 sessionPersistence）。
   */
  remembered: boolean | null;
  /**
   * 上一份会话**是被平台拒掉的**（`user/me` 401 ⇒ 就地失效，票 39 Q17 / Q20）：
   * 界面据此把账号行写成「登录状态已失效，请重新登录」而不是「登录」。
   * 这一位必须由能力层给：`{signedIn, account}` 里「本来就没登录」与「刚被平台踢掉」
   * 长得一模一样，界面自己分不开（票 39 对账第 4 条之后新加的机制，见票内 Comments）。
   */
  expired: boolean;
}

export interface CommunityAccount {
  getSession(): CommunityAccountSession;
  /** 订阅会话变化（只在真的变了时通知一次 —— 不按请求次数抖动界面） */
  subscribe(listener: (session: CommunityAccountSession) => void): () => void;
  /**
   * 启动校验（幂等）：恢复持久化 Cookie → 有则查一次 `GET /api/user/me`。
   * 没有持久化会话时**一条请求都不发**；校验出结论后不再重跑（不轮询 —— 与 availability 同口径）。
   * 离线导致没校验上时**保留** Cookie（用户手动登录或下次启动再接），不把登录态烧掉。
   */
  start(): Promise<CommunityAccountSession>;
  /** 登录：成功后置会话并把手里的 Cookie 加密落盘；失败**不写入任何凭据**（平台当面拒时还会清干净） */
  login(username: string, password: string): Promise<CommunityAccountSession>;
  /** 登出：清本机会话与被持久化的 Cookie */
  logout(): Promise<void>;
}

export interface CommunityAccountOptions {
  transport: CommunityTransport;
  /** 会话 Cookie 的持久化接缝；省略 = 走主进程 safeStorage（静态演示版退化成不持久化） */
  persistence?: CommunitySessionPersistence;
  /** 退避重试的观察口（复用 rateLimit 的 RetryNotice 口径） */
  onRetry?: (notice: RetryNotice) => void;
  /** 退避重试的时间与随机数（单测用手写假时钟，同 rateLimit 的口径） */
  retry?: RetryDeps;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 平台明确说「这份凭据不认」——网关把 HTTP 401/403 与业务码
 * `LOGIN_REQUIRED` / `CREDENTIALS_INVALID` / `USER_INVALID` 都翻成 `unauthorized`（票 07）。
 * 它与「没网 / 超时」必须分得开：前者要**清凭据**，后者要**留着凭据**。
 */
function isSessionRejected(error: unknown): boolean {
  return isCommunityError(error) && error.kind === 'unauthorized';
}

export function createCommunityAccount(options: CommunityAccountOptions): CommunityAccount {
  const { transport, onRetry, retry } = options;
  const persistence = options.persistence ?? createSessionPersistence();

  let state: CommunityAccountSession = { signedIn: false, account: null, remembered: null, expired: false };
  const listeners = new Set<(session: CommunityAccountSession) => void>();
  /** 幂等闸：`start()` 只跑一次（校验出结论就不再重来；离线那次也不例外，见上面的口径） */
  let started: Promise<CommunityAccountSession> | null = null;

  function publish(next: CommunityAccountSession) {
    if (
      next.signedIn === state.signedIn
      && next.account === state.account
      && next.remembered === state.remembered
      && next.expired === state.expired
    ) return;
    state = next;
    for (const listener of [...listeners]) listener(state);
  }

  /** 未登录的落定：`expired` 只有「恢复来的那份 Cookie 被平台拒了」这一种情形为 true */
  const settleSignedOut = (expired = false) => publish({ signedIn: false, account: null, remembered: null, expired });
  const settleSignedIn = (account: AccountProfile, remembered: boolean) =>
    publish({ signedIn: true, account, remembered, expired: false });

  /**
   * 登出 / 会话失效的唯一出口：先清持久化（清不掉也要把内存态落定），再转未登录。
   * `expired` 只有 `user/me` 401 那条路会给 true —— 平台当面拒了凭据（登录失败）不是「失效」，
   * 那是「没登上」，账号行照旧写「登录」。
   */
  async function clearSession(expired = false): Promise<void> {
    try {
      await persistence.clear();
    } catch {
      // 清不掉不是「还登录着」的理由：内存态照转未登录，下次启动再清一次
    }
    settleSignedOut(expired);
  }

  /** `GET /api/user/me`：会话校验（登录成功与启动各一次；幂等读，走统一退避） */
  async function verify(): Promise<AccountProfile> {
    const raw = await withRetry(
      () => transport.requestJson({
        url: userMeUrl(),
        method: 'GET',
        headers: bestdoriHeaders(),
        timeoutMs: BESTDORI_JSON_TIMEOUT_MS,
      }),
      { policy: BESTDORI_RETRY_POLICY, onRetry, deps: retry },
    );
    const profile = toAccountProfile(raw);
    if (!profile) throw invalidResponse('当前用户不是预期形态');
    return profile;
  }

  async function runStart(): Promise<CommunityAccountSession> {
    let restored = false;
    try {
      restored = await persistence.restore();
    } catch {
      restored = false; // 读不回来 =. 没有会话；不打网络、不报错（不白屏）
    }
    if (!restored) {
      settleSignedOut();
      return state;
    }
    try {
      // 恢复成功 ⇒ 本机记住了这份登录（`remembered` 的另一半来自 login 时的落盘）
      settleSignedIn(await verify(), true);
    } catch (error) {
      // 401 → 平台已不认这份 Cookie：清干净（= 登出）并标失效（界面要说「登录状态已失效」）；
      // 连不上 / 超时 → 只是这次没校验上，留着 Cookie，绝不因为一次断网把登录态烧掉
      if (isSessionRejected(error)) await clearSession(true);
      else settleSignedOut();
    }
    return state;
  }

  return {
    getSession: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start() {
      if (!started) started = runStart();
      return started;
    },

    async login(username: string, password: string): Promise<CommunityAccountSession> {
      // 登录是**写型 POST**：不套退避（07 的口径：写路径的超时意味着「服务端可能已经收了」，
      // 重发只会多造一次登录），超时/5xx 由界面提示用户重按。
      // 密码只出现在下面这一行载荷里：调用栈出去就没了，不进状态、不进持久化。
      const raw = await transport.requestJson({
        url: userLoginUrl(),
        method: 'POST',
        headers: { ...bestdoriHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
        timeoutMs: BESTDORI_JSON_TIMEOUT_MS,
      }).catch(async (error: unknown) => {
        // 平台当面拒了凭据（`{"result":false,"code":"CREDENTIALS_INVALID"}` 已被网关翻成 unauthorized）：
        // 本机一份**都不留** —— 「失败不写入任何凭据」是这条实现，不是「没调用 persist()」那句约定。
        // 注意：这不是「会话失效」（`expired` 留给 user/me 401 那条路），账号行照旧写「登录」
        if (isSessionRejected(error)) await clearSession();
        throw error;
      });

      // 成功形态 = HTTP 200 + `{"result":true}`（`{result:false, code}` 走不到这里，已被网关翻成错误）
      if (!isPlainObject(raw) || raw.result !== true) throw invalidResponse('登录响应不是预期形态');

      // 先把它加密落盘（主进程从自己的 jar 快照做，renderer 连 Cookie 值都拿不到），
      // 再按「登录成功各查一次 me」校验；落盘失败不算登录失败（内存会话照用），
      // 但**要记下来**：界面据此说一句「本机不会记住登录状态」（票 39 Q6）
      let remembered = false;
      try {
        remembered = (await persistence.persist()) === true;
      } catch {
        // 同上：这是「记不住登录状态」，不是「没登上」
        remembered = false;
      }

      try {
        settleSignedIn(await verify(), remembered);
      } catch (error) {
        if (isSessionRejected(error)) await clearSession(true);
        throw error;
      }
      return state;
    },

        /** 登出 = 清本机（不标失效：主动登出之后的账号行是「登录」，不是「已失效」） */
        logout: () => clearSession(),
        };
}

/** 能力层持的**唯一**会话对象（issue 06 Q3）；全应用共用这一份，别各建各的 */
let shared: CommunityAccount | null = null;

export function getCommunityAccount(): CommunityAccount {
  if (!shared) shared = createCommunityAccount({ transport: createCommunityTransport() });
  return shared;
}

/** 单测用：丢掉那份单例（下次 `getCommunityAccount()` 重新建，读新的桥） */
export function resetCommunityAccount(): void {
  shared = null;
}
