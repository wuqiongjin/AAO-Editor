/**
 * 登录失败的**中立翻译层**（票 39 Q43 / Q44）。
 *
 * 为什么要有这一层：网关（`electron/communityNet.cjs`）把平台的业务码翻成统一错误域的 `kind` +
 * `platformCode`，而**界面不该认识平台码** —— 那是平台实现细节（与 `mapping.ts` 同一条纪律：
 * 「平台形状 → 中立领域对象」，只不过这里翻的是失败而不是资料）。
 *
 * 分工（Q44）：
 *   - **平台 → 中立**住这里（这是「怎么读平台的答复」，属平台适配）；
 *   - **中立 → 文案**住界面（`community.account.err.*` 取 i18n；弹窗的版式是产品自己的）；
 *   - **不**为假想平台造注册表 / 插件（issues/06 Q1「留缝不建框架」）：将来真有第二个社区，
 *     加一个同形的映射件即可，弹窗一行都不用改。
 *
 * 口径（Q43：只**翻译平台给的原因**，不做本地失败计数 / 本地封禁）：
 *   - `CREDENTIALS_INVALID`（含 401 没带码）→ `credentials`（账密错）；
 *   - `USER_INVALID` → `account-unavailable`（Q46：保留单独一档，措辞不解释原因；
 *     真机若证明它触发不出来 / 与账密错分不开 ⇒ 并回通用句，见票内 Fog 第 3 条与 backstop）；
 *   - `RATE_LIMITED` / `TOO_MANY_*` → `rate-limited`（平台码已在网关侧并进 `kind`）；
 *   - 连不上 / 超时 → `offline`；没有出口（静态演示版）→ `unsupported`；其余 → `unknown`。
 */
import { isCommunityError } from '../transport';

/** 登录失败的六档（界面按它取 i18n 文案，一档一句） */
export type LoginFailure =
  /** 账号或密码不对（平台当面拒了凭据） */
  | 'credentials'
  /** 账号本身暂时不可用（`USER_INVALID`；不解释原因） */
  | 'account-unavailable'
  /** 平台在限流，等会儿再试 */
  | 'rate-limited'
  /** 连不上 / 超时 */
  | 'offline'
  /** 运行环境不提供这个能力（静态演示版 / 通道坏了） */
  | 'unsupported'
  /** 其余（5xx、形态不对、网关自保拒绝…）—— 通用失败句 */
  | 'unknown';

/**
 * `unauthorized` 这一档里的平台码 → 中立类型（表里没有的码按「账密错」处理：
 * 登录 POST 上出现 401，绝大多数就是凭据不行；`LOGIN_REQUIRED` 不会出现在这条路径上）。
 */
const UNAUTHORIZED: Record<string, LoginFailure> = {
  USER_INVALID: 'account-unavailable',
};

export function loginFailureOf(error: unknown): LoginFailure {
  if (!isCommunityError(error)) return 'unknown';
  switch (error.kind) {
    case 'offline':
    case 'timeout':
      return 'offline';
    case 'rate-limited':
      return 'rate-limited';
    case 'unsupported-runtime':
      return 'unsupported';
    case 'unauthorized':
      return UNAUTHORIZED[error.platformCode ?? ''] ?? 'credentials';
    default:
      return 'unknown';
  }
}
