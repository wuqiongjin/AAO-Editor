import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

describe('票 02 · 操作轨迹接线', () => {
  it('AppShell.setActivePage 记录页面切换', () => {
    const src = readStripped('src/layouts/AppShell.tsx');
    expect(src).toMatch(/trail\.record\(/);
    expect(src).toMatch(/module:\s*['"]nav['"]/);
    expect(src).toMatch(/action:\s*['"]page['"]/);
  });

  it('CrashBoundary.componentDidCatch 与 exportDiagnostics 组包前 flush', () => {
    const crash = readStripped('src/diagnostics/CrashBoundary.tsx');
    expect(crash).toMatch(/componentDidCatch[\s\S]*trail\.flush\(/);
    const exp = readStripped('src/diagnostics/exportDiagnostics.ts');
    expect(exp).toMatch(/trail\.flush\(/);
    expect(exp.search(/trail\.flush\(/)).toBeLessThan(exp.search(/bridge\.export\(/));
  });

  it('工程打开 / 显式保存各至少一处 record', () => {
    const session = readStripped('src/project/CurrentProjectSession.ts');
    expect(session).toMatch(/trail\.record\(/);
    expect(session).toMatch(/action:\s*['"]open['"]/);
    const persist = readStripped('src/project/useChartProjectPersistence.ts');
    expect(persist).toMatch(/action:\s*['"]save['"]/);
    expect(persist).toMatch(/const saveNow = useCallback[\s\S]*trail\.record\(/);
    expect(persist).not.toMatch(/ensureMerger\(\)\.schedule\([^)]*\)[\s\S]{0,40}trail\.record/);
  });

  it('视频导出起止在 useVideoExport.start', () => {
    const src = readStripped('src/pages/preview/useVideoExport.ts');
    expect(src).toMatch(/action:\s*['"]export-start['"]/);
    expect(src).toMatch(/action:\s*['"]export-end['"]/);
  });
});
