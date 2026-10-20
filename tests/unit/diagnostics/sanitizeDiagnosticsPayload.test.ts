import { describe, expect, it } from 'vitest';
import { sanitizeForDiagnostics } from '@/src/diagnostics/sanitizeDiagnosticsPayload';

describe('票 04 · 诊断包载荷脱敏', () => {
  it('剔除 token / cookie / 会话 / 授权 / secret / credential / apiKey 字段，保留其余', () => {
    const dirty = {
      theme: 'dark',
      communityToken: 'abc',
      cookie: 'sid=1',
      nested: {
        session: { id: 's1' },
        volume: 0.5,
        authorization: 'Bearer x',
        password: 'hunter2',
        passwordHash: 'nope',
      },
      apiKey: 'k',
      secret: 1,
      credential: 'y',
      items: [{ token: 't', name: 'ok' }],
    };

    expect(sanitizeForDiagnostics(dirty)).toEqual({
      theme: 'dark',
      nested: { volume: 0.5 },
      items: [{ name: 'ok' }],
    });
  });

  it('同样作用于 chart 载荷：谱面文档里的凭据类键也被剔除', () => {
    expect(
      sanitizeForDiagnostics({ id: 'p2', charts: [], communityToken: 'leak-me', nested: { cookie: 'x' } }),
    ).toEqual({ id: 'p2', charts: [], nested: {} });
  });
});
