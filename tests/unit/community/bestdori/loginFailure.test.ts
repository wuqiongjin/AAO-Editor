// 票 39（Q43 / Q44）：平台码 → 中立失败类型。
//
// 这一层存在的理由就是「界面不认识平台码」：网关（票 07）已经把平台的业务码翻成 `kind` +
// `platformCode`，这里再把它们收成六档中立类型，界面只按类型取 i18n。
// 六档的界面文案由 tests/dom/pages/AccountBar.test.tsx 锁（那里跑的是真弹窗）。
import { describe, expect, it } from 'vitest';
import { loginFailureOf } from '@/src/community/bestdori/loginFailure';
import { CommunityError, type CommunityErrorKind } from '@/src/community/transport';

function wire(kind: CommunityErrorKind, platformCode?: string): CommunityError {
  return new CommunityError(`fake ${kind}`, { kind, message: `fake ${kind}`, platformCode });
}

describe('票 39 · 登录失败的中立翻译', () => {
  it('账密错那一档：`CREDENTIALS_INVALID`，以及 401 但没带平台码', () => {
    expect(loginFailureOf(wire('unauthorized', 'CREDENTIALS_INVALID'))).toBe('credentials');
    // 登录 POST 上的 401 绝大多数就是凭据不行（`LOGIN_REQUIRED` 不会出现在这条路径上）
    expect(loginFailureOf(wire('unauthorized'))).toBe('credentials');
    expect(loginFailureOf(wire('unauthorized', 'LOGIN_REQUIRED'))).toBe('credentials');
  });

  it('账号不可用单独一档（Q46：保留但措辞不解释原因）', () => {
    expect(loginFailureOf(wire('unauthorized', 'USER_INVALID'))).toBe('account-unavailable');
  });

  it('连不上与限流各归各的（平台给的码已经在网关侧并进 kind）', () => {
    expect(loginFailureOf(wire('offline'))).toBe('offline');
    expect(loginFailureOf(wire('timeout'))).toBe('offline');
    for (const code of ['RATE_LIMITED', 'TOO_MANY_REQUESTS', 'TOO_MANY_POSTS', 'TOO_MANY_UPLOADS']) {
      expect(loginFailureOf(wire('rate-limited', code)), code).toBe('rate-limited');
    }
  });

  it('没有出口 → 不可用；其余（5xx / 形态不对 / 网关自保 / 非统一错误）→ 通用', () => {
    expect(loginFailureOf(wire('unsupported-runtime'))).toBe('unsupported');
    expect(loginFailureOf(wire('http'))).toBe('unknown');
    expect(loginFailureOf(wire('invalid-response'))).toBe('unknown');
    expect(loginFailureOf(wire('request-rejected'))).toBe('unknown');
    expect(loginFailureOf(wire('staging-failed'))).toBe('unknown');
    expect(loginFailureOf(new Error('裸异常'))).toBe('unknown');
    expect(loginFailureOf(undefined)).toBe('unknown');
  });
});
