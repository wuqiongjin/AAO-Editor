/**
 * 诊断包载荷脱敏（ADR-0019 §4 / ADR-0011 §3）。按键名递归剔除，不读凭据存储。
 * 用于 settings 快照与 chart 载荷；electron/diagnosticsExport.cjs 有一份同形实现
 * （渲染进程不能 import electron/），两处的键名表由 tests/static/DiagnosticsExportWiring.test.ts 钉住一致。
 */

const SENSITIVE_KEY = /token|cookie|session|password|authorization|secret|credential|apiKey/i;

export function sanitizeForDiagnostics(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForDiagnostics);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) continue;
      out[key] = sanitizeForDiagnostics(child);
    }
    return out;
  }
  return value;
}
