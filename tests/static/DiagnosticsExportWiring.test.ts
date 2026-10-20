import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStripped, repoRoot, sourceFiles } from '@/tests/support/source';

const ASSEMBLER_FILES = [
  'src/diagnostics/sanitizeDiagnosticsPayload.ts',
  'src/diagnostics/exportDiagnostics.ts',
  'electron/diagnosticsExport.cjs',
];

const CREDENTIAL_LEAK = /community-session\.bin|safeStorage|cookieJar|communitySession/i;

describe('票 04 · 诊断包接线与凭据红线', () => {
  it('main 注册 diagnostics IPC，preload 白名单暴露 diagnostics.export', () => {
    const mainSrc = readStripped('electron/main.cjs');
    const preloadSrc = readStripped('electron/preload.js');
    expect(mainSrc).toMatch(/registerDiagnosticsExportIpc\(/);
    expect(preloadSrc).toMatch(/diagnostics\s*:/);
    expect(preloadSrc).toMatch(/invoke\(\s*['"]diagnostics:export['"]/);
  });

  it('组包代码不引用凭据存储键、不读 community-session.bin', () => {
    for (const rel of ASSEMBLER_FILES) {
      expect(readStripped(rel), rel).not.toMatch(CREDENTIAL_LEAK);
    }
  });

  it('渲染 / 主进程两份脱敏键名表逐字一致，且覆盖 password', () => {
    const keyOf = (rel: string): string => {
      const m = readStripped(rel).match(/const SENSITIVE_KEY = (\/[^/\n]+\/[a-z]*);/);
      expect(m, rel).not.toBeNull();
      return m![1]!;
    };
    const renderer = keyOf('src/diagnostics/sanitizeDiagnosticsPayload.ts');
    const main = keyOf('electron/diagnosticsExport.cjs');
    expect(renderer).toBe(main);
    expect(renderer).toMatch(/password/);
  });

  it('组包代码不 import 凭据模块', () => {
    const forbidden = /community\/sessionPersistence|communitySession\.cjs|bestdori\/account/;
    for (const rel of ASSEMBLER_FILES) {
      expect(readStripped(rel), rel).not.toMatch(forbidden);
      const imports = [...readStripped(rel).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      expect(imports.filter((spec) => /session|credential|account/i.test(spec)), rel).toEqual([]);
    }
  });

  it('src/ 诊断组装不直接碰 fs', () => {
    const FS_IMPORT = /(?:from\s+['"](?:node:)?fs(?:\/promises)?['"]|require\(\s*['"](?:node:)?fs(?:\/promises)?['"]\))/;
    const offenders = sourceFiles(join(repoRoot, 'src/diagnostics')).filter((rel) =>
      FS_IMPORT.test(readStripped(rel)),
    );
    expect(offenders).toEqual([]);
  });
});
