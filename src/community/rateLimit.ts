/**
 * 退避重试（票 07）。
 *
 * 分工：主进程只做**单次**请求 + 硬限流（最小间隔、单飞队列、单次超时），
 * 退避重试住在这里 —— 时间与随机数可注入，单测用手写假时钟，不碰 `vi.useFakeTimers`（本仓惯例）。
 *
 * 数值口径照 `scripts/lib/bestdori-http.mjs`（那份脚本 import 了 node:fs / process，只能作参照、不可复用）：
 * 最多 3 次、800ms × 2^(n-1) + 抖动。具体数值由平台模块给（见 bestdori/endpoints.ts）。
 */
import { isCommunityError } from './transport';

export interface RetryPolicy {
  /** 含首次在内的总尝试次数 */
  maxAttempts: number;
  /** 第 n 次重试前的基数：baseDelayMs × 2^(n-1) */
  baseDelayMs: number;
  /** 抖动上限（毫秒）—— 同一时刻的多条请求不要一起回来 */
  jitterMs: number;
}

export interface RetryDeps {
  sleep(ms: number): Promise<void>;
  random(): number;
}

export const defaultRetryDeps: RetryDeps = {
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  random: Math.random,
};

/** 第 attempt 次重试（attempt 从 1 起 = 首次失败后的下一次）前等多久 */
export function backoffDelayMs(
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  return policy.baseDelayMs * 2 ** (attempt - 1) + random() * policy.jitterMs;
}

export interface RetryNotice {
  /** 第几次尝试失败（1 = 首次） */
  attempt: number;
  delayMs: number;
  error: unknown;
}

export interface WithRetryOptions {
  policy: RetryPolicy;
  deps?: RetryDeps;
  /** 每次决定重试时回调一次（08/09 拿来出「网络不稳，正在重试」的提示） */
  onRetry?: (notice: RetryNotice) => void;
}

/**
 * 重试「可退避」的错误（连不上 / 超时 / 限流 / 5xx）；其余错误立即抛出：
 * 未授权、响应非法、载荷被网关拒 —— 再试一百次也是同一个结果。
 *
 * 只给**幂等**请求用（读路径）。非幂等的写路径（11 的发布 / 上传）不要整段套上它：
 * 超时与 5xx 都可能「服务端其实已经收了」，重试等于重复发帖。写路径要么不重试，
 * 要么只在「确实没发出去」的失败上重试 —— 由 11 落地时定。
 */
export async function withRetry<T>(run: () => Promise<T>, options: WithRetryOptions): Promise<T> {
  const policy = options.policy;
  const deps = options.deps ?? defaultRetryDeps;
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      const retryable = isCommunityError(error) && error.retryable;
      if (!retryable || attempt >= policy.maxAttempts) throw error;
      const delayMs = backoffDelayMs(attempt, policy, deps.random);
      options.onRetry?.({ attempt, delayMs, error });
      await deps.sleep(delayMs);
    }
  }
  throw lastError;
}
