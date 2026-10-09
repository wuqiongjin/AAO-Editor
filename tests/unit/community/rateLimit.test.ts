// 票 07：退避重试的算法与「哪些错误值得重试」。
// 用注入的假时钟（手写 sleep 记录 + 固定 random），不依赖 vi.useFakeTimers（本仓惯例，
// 照 tests/unit/chart/editing/DebouncedTask.test.ts）；替身住在 tests/support/communityRetry.ts。
import { describe, expect, it } from 'vitest';
import { backoffDelayMs, withRetry } from '@/src/community/rateLimit';
import { CommunityError, type CommunityErrorKind } from '@/src/community/transport';
import { makeRetryClock as fakeClock, RETRY_POLICY as POLICY } from '@/tests/support/communityRetry';

function failure(kind: CommunityErrorKind, httpStatus?: number): CommunityError {
  return new CommunityError(`失败（${kind}）`, { kind, message: `失败（${kind}）`, httpStatus });
}

describe('票 07 · 退避曲线', () => {
  it('第 n 次重试 = base × 2^(n-1) + 抖动', () => {
    expect(backoffDelayMs(1, POLICY, () => 0)).toBe(800);
    expect(backoffDelayMs(2, POLICY, () => 0)).toBe(1600);
    expect(backoffDelayMs(3, POLICY, () => 0)).toBe(3200);
    expect(backoffDelayMs(1, POLICY, () => 0.5)).toBe(925);
  });
});

describe('票 07 · 值得重试的错误才重试', () => {
  it('429 按退避重试后成功（第三次拿到结果）', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw failure('rate-limited', 429);
        return 'ok';
      },
      { policy: POLICY, deps: clock.deps },
    );

    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(clock.waits).toEqual([925, 1725]);
  });

  it('超时同样退避重试，用尽次数后抛出原错误（统一错误域）', async () => {
    const clock = fakeClock();
    let calls = 0;
    const run = () =>
      withRetry(
        async () => {
          calls += 1;
          throw failure('timeout');
        },
        { policy: POLICY, deps: clock.deps },
      );

    await expect(run()).rejects.toMatchObject({ kind: 'timeout', retryable: true });
    expect(calls).toBe(3);
    expect(clock.waits).toHaveLength(2);
  });

  it('值得重试的用尽次数（3），不值得的只试一次', async () => {
    const cases: [CommunityError, number][] = [
      [failure('offline'), 3],
      [failure('timeout'), 3],
      [failure('rate-limited', 429), 3],
      [failure('http', 503), 3],
      [failure('http', 404), 1],
      [failure('unauthorized', 401), 1],
      [failure('invalid-response'), 1],
      [failure('request-rejected'), 1],
      [failure('unsupported-runtime'), 1],
      [failure('staging-failed'), 1],
    ];

    for (const [error, expectedCalls] of cases) {
      const clock = fakeClock();
      let calls = 0;
      await expect(
        withRetry(
          async () => {
            calls += 1;
            throw error;
          },
          { policy: POLICY, deps: clock.deps },
        ),
      ).rejects.toBe(error);
      expect(calls, `${error.kind}${error.httpStatus ?? ''}`).toBe(expectedCalls);
    }
  });

  it('非统一错误域的异常（程序 bug）不重试，原样抛出', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new TypeError('boom');
        },
        { policy: POLICY, deps: fakeClock().deps },
      ),
    ).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });

  it('每次决定重试时报一次（attempt / 延迟 / 错误），供 08-09 出提示', async () => {
    const notices: number[] = [];
    let calls = 0;
    await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw failure('offline');
        return null;
      },
      { policy: POLICY, deps: fakeClock().deps, onRetry: (notice) => notices.push(notice.attempt) },
    );
    expect(notices).toEqual([1, 2]);
  });
});
