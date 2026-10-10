/**
 * 社区平台出口（bestdori-integration 07）。
 *
 * 分层（ADR-0011 §2 + issue 06 Q1）：**主进程是唯一网络出口**，能力层只递「HTTP 事实」，
 * 端点 / 领域转换 / 搜索都住在本目录。这里放三样东西：
 *
 *   1. `CommunityTransport` —— 能力层（08 曲库 / 09 社区帖 / 10 会话 / 11 发布）注入它收发，
 *      单测注入假出口（不碰网络）。它的**唯一实现**是 `electronTransport.ts` 里那条走 IPC 的。
 *   2. 跨进程载荷形状 —— 与主进程实现 `electron/communityNet.cjs` 是同一份契约（改一边要改另一边）。
 *   3. 统一错误域 `CommunityError` —— 离线 / 超时 / 限流 / 未授权 / 平台不支持 / 响应非法，
 *      外加三类网关自保（非 2xx / 载荷被拒 / 缓存写失败）。
 *
 * `CommunityError.message` 只作**诊断**（日志、排查）；界面文案按 `kind` 走 i18n，
 * 不要把 message 当 UI 文案用。
 */

/** 统一错误域（票 07 定案的六类 + 网关自保三类） */
export type CommunityErrorKind =
  /** 连不上（DNS / 拒绝连接 / 系统离线） */
  | 'offline'
  /** 超过本次请求的时限 */
  | 'timeout'
  /** HTTP 429 或平台限流业务码 —— 可退避重试 */
  | 'rate-limited'
  /** HTTP 401/403 或平台 `LOGIN_REQUIRED` / `CREDENTIALS_INVALID` / `USER_INVALID` */
  | 'unauthorized'
  /** 运行环境不提供这个能力：静态演示版 / 浏览器没有出口（ADR-0011 §1）。
   *  命名避开单独一个「平台」——CONTEXT 里「平台」专指社区平台 */
  | 'unsupported-runtime'
  /** 响应不是预期形态：非 JSON 回退页、业务码被平台拒（`REQUEST_INVALID` 等） */
  | 'invalid-response'
  /** 非预期状态码（4xx / 5xx，非限流 / 未授权） */
  | 'http'
  /** 网关发起请求之前就拒了：越界主机、非法方法、renderer 自带凭据头 */
  | 'request-rejected'
  /** 本机素材缓存写不进去（磁盘满 / 权限），社区平台侧没问题（07 起的码名沿用，14 起指缓存） */
  | 'staging-failed';

/**
 * 每类错误的性质，**一处定义**（重试判定在 rateLimit、离线判定在 availability，都来查这张表）：
 * - `retryable`：`'always'` 退避重试；`'server'` 只有 5xx 值得再试；`'never'` 再试也是同一个结果
 * - `offline`：算不算「连不上」（可用性判定只认这一类，其余都说明社区平台答了话）
 */
const KIND_TRAITS: Record<CommunityErrorKind, { retryable: 'always' | 'server' | 'never'; offline: boolean }> = {
  offline: { retryable: 'always', offline: true },
  timeout: { retryable: 'always', offline: true },
  'rate-limited': { retryable: 'always', offline: false },
  http: { retryable: 'server', offline: false },
  unauthorized: { retryable: 'never', offline: false },
  'invalid-response': { retryable: 'never', offline: false },
  'unsupported-runtime': { retryable: 'never', offline: false },
  'request-rejected': { retryable: 'never', offline: false },
  'staging-failed': { retryable: 'never', offline: false },
};

export function isRetryableKind(kind: CommunityErrorKind, httpStatus?: number): boolean {
  const retryable = KIND_TRAITS[kind].retryable;
  if (retryable === 'always') return true;
  return retryable === 'server' && (httpStatus ?? 0) >= 500;
}

export function isOfflineKind(kind: CommunityErrorKind): boolean {
  return KIND_TRAITS[kind].offline;
}

/** 网关回来的结构化错误（跨 IPC 只传这个，不传异常对象） */
export interface CommunityWireError {
  kind: CommunityErrorKind;
  /** 诊断用；界面文案按 kind 走 i18n */
  message: string;
  httpStatus?: number;
  /** 平台业务码（`{"result":false,"code":"…"}`），排查用 */
  platformCode?: string;
}

/** 二进制响应：只有素材缓存里的路径与元数据，没有字节（票 14 起落点是 cache/community/） */
export interface StagedBinary {
  path: string;
  byteLength: number;
  contentType: string | null;
}

/** 主进程网关的返回（成功三种形态 + 失败一种） */
export type CommunityWireResult =
  | { ok: true; responseType: 'json'; status: number; data: unknown }
  | { ok: true; responseType: 'text'; status: number; text: string }
  | ({ ok: true; responseType: 'binary'; status: number } & StagedBinary)
  | { ok: false; error: CommunityWireError };

/** 一次社区请求（renderer → transport）。载荷是「HTTP 事实」，不含领域语义。 */
export interface CommunityRequest {
  /** 只能指向端点半文件里的主机（主进程另有白名单兜底） */
  url: string;
  method?: 'GET' | 'POST';
  /** 附加请求头；`cookie` / `host` / `content-length` 由网关自己算，renderer 不得自带 */
  headers?: Record<string, string>;
  /** POST 的 JSON 文本（序列化在能力层，网关不解释领域） */
  body?: string;
  responseType?: 'json' | 'text' | 'binary';
  timeoutMs?: number;
  /** binary：进素材缓存的文件名建议（网关只取 basename 并短哈希前缀） */
  suggestedName?: string;
}

/**
 * 社区出口。能力层注入它，单测注入假出口。
 * `kind === 'none'` = 这台机器没有出口（静态演示版 / 浏览器），调用一律抛 `unsupported-runtime`。
 */
export interface CommunityTransport {
  readonly kind: 'ipc' | 'none';
  requestJson(req: CommunityRequest): Promise<unknown>;
  requestText(req: CommunityRequest): Promise<string>;
  requestBinary(req: CommunityRequest): Promise<StagedBinary>;
}

/** 统一错误：一个 kind 说清「谁的问题、能不能再试」 */
export class CommunityError extends Error {
  readonly kind: CommunityErrorKind;
  readonly httpStatus?: number;
  readonly platformCode?: string;
  readonly retryable: boolean;

  constructor(message: string, wire: CommunityWireError) {
    super(message);
    this.name = 'CommunityError';
    this.kind = wire.kind;
    this.httpStatus = wire.httpStatus;
    this.platformCode = wire.platformCode;
    this.retryable = isRetryableKind(wire.kind, wire.httpStatus);
  }
}

export function isCommunityError(value: unknown): value is CommunityError {
  return value instanceof CommunityError;
}

/** 连不上（离线 / 超时）—— 可用性只认这一类为「社区平台没答话」 */
export function isOfflineError(value: unknown): boolean {
  return isCommunityError(value) && isOfflineKind(value.kind);
}
