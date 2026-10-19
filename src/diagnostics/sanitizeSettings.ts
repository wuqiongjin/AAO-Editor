/** 诊断包设置快照脱敏（ADR-0019 §4 / ADR-0011 §3）。按键名剔除，不读凭据存储。 */

const SENSITIVE_KEY = /token|cookie|session|authorization|secret|credential|apiKey/i;

export function sanitizeSettingsForDiagnostics(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSettingsForDiagnostics);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) continue;
      out[key] = sanitizeSettingsForDiagnostics(child);
    }
    return out;
  }
  return value;
}
