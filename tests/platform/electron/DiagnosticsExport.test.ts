import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  diagnosticsArchiveName,
  planDiagnosticsEntries,
  registerDiagnosticsExportIpc,
} from '@/electron/diagnosticsExport.cjs';
import { tmpDir } from '@/tests/support/fs';

const NOW = new Date(2026, 9, 19, 16, 5, 7);

function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
  return {
    handlers,
    ipcMain: {
      handle: (channel: string, listener: (event: unknown, payload?: unknown) => unknown) => {
        handlers.set(channel, listener);
      },
    } as { handle: (channel: string, listener: Function) => void },
  };
}

describe('票 04 · 诊断包文件名与清单', () => {
  it('本地时区时间戳文件名', () => {
    expect(diagnosticsArchiveName(NOW)).toBe('aao-diagnostics-20261019-160507.zip');
  });

  it('无轨迹时清单仍含 env / settings / 错误日志；谱面仅在有 chart 时出现', () => {
    expect(
      planDiagnosticsEntries({
        logNames: ['errors-20261019.log'],
        hasChart: false,
      }).map((e: { path: string }) => e.path),
    ).toEqual(['env.json', 'settings.json', 'logs/errors-20261019.log']);

    expect(
      planDiagnosticsEntries({
        logNames: ['errors-20261018.log', 'trail-20261019.jsonl'],
        hasChart: true,
      }).map((e: { path: string }) => e.path),
    ).toEqual([
      'env.json',
      'settings.json',
      'logs/errors-20261018.log',
      'logs/trail-20261019.jsonl',
      'chart/project.json',
    ]);
  });
});

describe('票 04 · 主进程组包 IPC', () => {
  it('无轨迹文件时导出仍成功；zip 含版本 / 环境 / 错误日志 / 脱敏设置，默认无谱面', async () => {
    const userData = tmpDir('aao-diag-export-');
    const outFile = join(userData, 'out.zip');
    try {
      const logs = join(userData, 'logs');
      mkdirSync(logs, { recursive: true });
      writeFileSync(join(logs, 'errors-20261019.log'), 'boom\n');
      writeFileSync(join(logs, 'readme.txt'), 'ignore me\n');
      writeFileSync(join(logs, 'errors-20261012.log'), 'too old\n');

      const { handlers, ipcMain } = fakeIpcMain();
      registerDiagnosticsExportIpc(ipcMain, {
        logsDir: () => logs,
        dataRoot: () => join(userData, 'data'),
        versions: {
          app: '0.1.0',
          electron: '38.1.2',
          chrome: '1',
          node: '22',
          os: 'win32 10.0',
        },
        now: () => NOW,
        showSaveDialog: async () => ({ canceled: false, filePath: outFile }),
      });

      const exportFn = handlers.get('diagnostics:export');
      const result = await exportFn?.(
        { sender: {} },
        {
          pageId: 'settings',
          projectId: 'p1',
          settings: {
            theme: 'dark',
            communityToken: 'abc',
            passwordHash: 'nope',
            nested: { cookie: 'x', volume: 1 },
          },
        },
      );
      expect(result).toEqual({ cancelled: false });

      const zip = await JSZip.loadAsync(readFileSync(outFile));
      expect(Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()).toEqual([
        'env.json',
        'logs/errors-20261019.log',
        'settings.json',
      ]);

      const env = JSON.parse(await zip.file('env.json')!.async('string')) as Record<string, unknown>;
      expect(env).toMatchObject({
        exportedAt: NOW.toISOString(),
        appVersion: '0.1.0',
        electron: '38.1.2',
        os: 'win32 10.0',
        dataRoot: join(userData, 'data'),
        pageId: 'settings',
        projectId: 'p1',
      });

      const settings = JSON.parse(await zip.file('settings.json')!.async('string')) as Record<string, unknown>;
      expect(settings).toEqual({ theme: 'dark', nested: { volume: 1 } });
      expect(await zip.file('logs/errors-20261019.log')!.async('string')).toBe('boom\n');
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('没有错误日志时导出仍成功，包内不放 logs 占位', async () => {
    const userData = tmpDir('aao-diag-empty-logs-');
    const outFile = join(userData, 'out.zip');
    try {
      const logs = join(userData, 'logs');
      const { handlers, ipcMain } = fakeIpcMain();
      registerDiagnosticsExportIpc(ipcMain, {
        logsDir: () => logs,
        dataRoot: () => join(userData, 'data'),
        versions: { app: '0.1.0', electron: '1', chrome: '1', node: '1', os: 'test' },
        now: () => NOW,
        showSaveDialog: async () => ({ canceled: false, filePath: outFile }),
      });
      await handlers.get('diagnostics:export')?.({ sender: {} }, { pageId: 'settings', projectId: null, settings: {} });
      const zip = await JSZip.loadAsync(readFileSync(outFile));
      expect(Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()).toEqual([
        'env.json',
        'settings.json',
      ]);
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('勾选谱面后包内出现 chart/project.json；取消对话框不写文件', async () => {
    const userData = tmpDir('aao-diag-chart-');
    const outFile = join(userData, 'out.zip');
    try {
      const logs = join(userData, 'logs');
      mkdirSync(logs, { recursive: true });

      const { handlers, ipcMain } = fakeIpcMain();
      registerDiagnosticsExportIpc(ipcMain, {
        logsDir: () => logs,
        dataRoot: () => 'D:\\data',
        versions: { app: '0.1.0', electron: '1', chrome: '1', node: '1', os: 'test' },
        now: () => NOW,
        showSaveDialog: async () => ({ canceled: false, filePath: outFile }),
      });

      await handlers.get('diagnostics:export')?.(
        { sender: {} },
        {
          pageId: 'workspace',
          projectId: 'p2',
          settings: { theme: 'light' },
          chart: { id: 'p2', charts: [] },
        },
      );
      const zip = await JSZip.loadAsync(readFileSync(outFile));
      expect(JSON.parse(await zip.file('chart/project.json')!.async('string'))).toEqual({
        id: 'p2',
        charts: [],
      });

      const { handlers: handlers2, ipcMain: ipc2 } = fakeIpcMain();
      registerDiagnosticsExportIpc(ipc2, {
        logsDir: () => logs,
        dataRoot: () => 'D:\\data',
        versions: { app: '0.1.0', electron: '1', chrome: '1', node: '1', os: 'test' },
        now: () => NOW,
        showSaveDialog: async () => ({ canceled: true }),
      });
      const cancelled = await handlers2.get('diagnostics:export')?.({ sender: {} }, { settings: {} });
      expect(cancelled).toEqual({ cancelled: true });
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });
});
