import { describe, expect, it } from 'vitest';
import { sanitizeSettingsForDiagnostics } from '@/src/diagnostics/sanitizeSettings';

describe('票 04 · 诊断包设置脱敏', () => {
  it('剔除 token / cookie / 会话 / 授权 / secret / credential / apiKey 字段，保留其余', () => {
    const dirty = {
      theme: 'dark',
      communityToken: 'abc',
      cookie: 'sid=1',
      nested: {
        session: { id: 's1' },
        volume: 0.5,
        authorization: 'Bearer x',
      },
        apiKey: 'k',
      secret: 1,
      credential: 'y',
      items: [{ token: 't', name: 'ok' }],
    };

    expect(sanitizeSettingsForDiagnostics(dirty)).toEqual({
      theme: 'dark',
      nested: { volume: 0.5 },
      items: [{ name: 'ok' }],
    });
  });
});
