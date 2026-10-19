import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStripped, repoRoot, sourceFiles } from '@/tests/support/source';

const mainSrc = readStripped('electron/main.cjs');
const preloadSrc = readStripped('electron/preload.js');
const FS_IMPORT = /(?:from\s+['"](?:node:)?fs(?:\/promises)?['"]|require\(\s*['"](?:node:)?fs(?:\/promises)?['"]\))/;

describe('票 01 · 日志接线', () => {
  it('main.cjs 注册 appLog IPC，preload 白名单暴露 log.write / log.trail', () => {
    expect(mainSrc).toMatch(/createAppLog\(/);
    expect(mainSrc).toMatch(/registerAppLogIpc\(ipcMain,/);
    expect(preloadSrc).toMatch(/log\s*:/);
    expect(preloadSrc).toMatch(/invoke\(\s*['"]log:write['"]/);
    expect(preloadSrc).toMatch(/invoke\(\s*['"]log:trail['"]/);
    expect(preloadSrc).toMatch(/exposeInMainWorld\(\s*'electronAPI'/);
  });

  it('src/ 无直接 fs 访问（日志经 IPC 汇聚主进程）', () => {
    const offenders = sourceFiles(join(repoRoot, 'src')).filter((rel) => FS_IMPORT.test(readStripped(rel)));
    expect(offenders).toEqual([]);
  });
});
