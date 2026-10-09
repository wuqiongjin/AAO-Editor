// 社区能力层（src/community/）的共享测试替身。
// 本仓惯例：退避重试用手写假时钟，**不用 `vi.useFakeTimers`**
// （照 tests/unit/chart/editing/DebouncedTask.test.ts 的注入式口径）。
import type { RetryDeps, RetryPolicy } from '@/src/community/rateLimit';

/**
 * 退避策略：与 `src/community/bestdori/endpoints.ts` 的平台常量同值
 * （那边由 `tests/unit/community/bestdori/endpoints.test.ts` 锁死具体数值）。
 */
export const RETRY_POLICY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 800, jitterMs: 250 };

/** 假时钟：sleep 只记账不真等；random 固定，让退避延迟可预测 */
export function makeRetryClock(randomValue = 0.5): { deps: RetryDeps; waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    deps: {
      sleep: async (ms) => {
        waits.push(ms);
      },
      random: () => randomValue,
    },
  };
}
