import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppLog, planLogRotation, registerAppLogIpc } from '@/electron/appLog.cjs';
import { tmpDir } from '@/tests/support/fs';

const MB = 1024 * 1024;
const NOW = new Date('2026-10-19T12:00:00.000Z');

describe('票 01 · 日志轮转策略', () => {
  it('跨天写新文件，不删未满 7 天的旧文件', () => {
    expect(
      planLogRotation({
        files: [{ name: 'errors-20261018.log', size: 100 }],
        now: NOW,
        entryBytes: 20,
        track: 'errors',
      }),
    ).toEqual({
      writeName: 'errors-20261019.log',
      deleteNames: [],
    });
  });

  it('当天文件加上新条目超过 5MB 时开同日 -2', () => {
    expect(
      planLogRotation({
        files: [{ name: 'errors-20261019.log', size: 5 * MB - 4 }],
        now: NOW,
        entryBytes: 10,
        track: 'errors',
      }),
    ).toEqual({
      writeName: 'errors-20261019-2.log',
      deleteNames: [],
    });
  });

  it('当天文件为空且本条已超过 5MB：仍写入该空文件', () => {
    expect(
      planLogRotation({
        files: [{ name: 'trail-20261019.jsonl', size: 0 }],
        now: NOW,
        entryBytes: 6 * MB,
        track: 'trail',
      }),
    ).toEqual({
      writeName: 'trail-20261019.jsonl',
      deleteNames: [],
    });
  });

  it('超过 7 天的文件先删（10-12 删、10-13 留）', () => {
    expect(
      planLogRotation({
        files: [
          { name: 'errors-20261012.log', size: 100 },
          { name: 'errors-20261013.log', size: 100 },
          { name: 'trail-20261012.jsonl', size: 50 },
        ],
        now: NOW,
        entryBytes: 10,
        track: 'errors',
      }),
    ).toEqual({
      writeName: 'errors-20261019.log',
      deleteNames: ['errors-20261012.log', 'trail-20261012.jsonl'],
    });
  });

  it('目录合计超过 50MB 时从最旧文件删，不删即将写入的那份', () => {
    expect(
      planLogRotation({
        files: [
          { name: 'errors-20261013.log', size: 40 * MB },
          { name: 'trail-20261014.jsonl', size: 9 * MB },
          { name: 'errors-20261019.log', size: 1 * MB },
        ],
        now: NOW,
        entryBytes: 512,
        track: 'errors',
      }),
    ).toEqual({
      writeName: 'errors-20261019.log',
      deleteNames: ['errors-20261013.log'],
    });

    expect(
      planLogRotation({
        files: [{ name: 'errors-20261019.log', size: 0 }],
        now: NOW,
        entryBytes: 51 * MB,
        track: 'errors',
      }),
    ).toEqual({
      writeName: 'errors-20261019.log',
      deleteNames: [],
    });
  });

  it('logs 目录里的非日志文件计入 50MB，但不被删', () => {
    expect(
      planLogRotation({
        files: [
          { name: 'readme.txt', size: 48 * MB },
          { name: 'errors-20261013.log', size: 3 * MB },
        ],
        now: NOW,
        entryBytes: 512,
        track: 'errors',
      }),
    ).toEqual({
      writeName: 'errors-20261019.log',
      deleteNames: ['errors-20261013.log'],
    });
  });
});

function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
  return {
    handlers,
    ipcMain: {
      handle: (channel: string, listener: (event: unknown, payload?: unknown) => unknown) => {
        handlers.set(channel, listener);
      },
    },
  };
}

function makeLog(userData: string) {
  const { handlers, ipcMain } = fakeIpcMain();
  const appLog = createAppLog({ userData, now: () => NOW });
  registerAppLogIpc(ipcMain, appLog);
  return { handlers, appLog };
}

describe('票 01 · 主进程落盘 sink', () => {
  it('log:write 写成 errors-YYYYMMDD.log，行格式为人读文本', async () => {
    const userData = tmpDir('aao-log-write-');
    try {
      const { handlers } = makeLog(userData);
      const write = handlers.get('log:write');
      expect(typeof write).toBe('function');
      await write?.(null, {
        level: 'error',
        module: 'chart-project',
        message: '落盘失败',
        extra: { status: 1 },
        ts: NOW.toISOString(),
      });
      expect(readFileSync(join(userData, 'logs', 'errors-20261019.log'), 'utf8')).toBe(
        '2026-10-19T12:00:00.000Z ERROR [chart-project] 落盘失败 {"status":1}\n',
      );
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('log:trail 追加一行 JSONL；主进程 write 不经 IPC 也能落盘', async () => {
    const userData = tmpDir('aao-log-trail-');
    try {
      const { handlers, appLog } = makeLog(userData);
      const trail = handlers.get('log:trail');
      await trail?.(null, { ts: NOW.toISOString(), module: 'preview', action: 'export-start' });
      expect(readFileSync(join(userData, 'logs', 'trail-20261019.jsonl'), 'utf8')).toBe(
        '{"ts":"2026-10-19T12:00:00.000Z","module":"preview","action":"export-start"}\n',
      );
      appLog.write({ level: 'warn', module: 'projectStore', message: '解析失败' });
      expect(readFileSync(join(userData, 'logs', 'errors-20261019.log'), 'utf8')).toBe(
        '2026-10-19T12:00:00.000Z WARN [projectStore] 解析失败\n',
      );
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('行内 ts 只进文本，切文件与删旧用墙钟', async () => {
    const userData = tmpDir('aao-log-clock-');
    try {
      const { handlers } = makeLog(userData);
      await handlers.get('log:write')?.(null, {
        level: 'error',
        module: 'preview',
        message: '昨日残留',
        ts: '2026-10-18T23:00:00.000Z',
      });
      expect(readFileSync(join(userData, 'logs', 'errors-20261019.log'), 'utf8')).toBe(
        '2026-10-18T23:00:00.000Z ERROR [preview] 昨日残留\n',
      );
      expect(existsSync(join(userData, 'logs', 'errors-20261018.log'))).toBe(false);
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('真文件超过 5MB 后写下一条进 -2，并删掉满 7 天的旧文件', async () => {
    const userData = tmpDir('aao-log-rotate-');
    try {
      const logs = join(userData, 'logs');
      mkdirSync(logs, { recursive: true });
      writeFileSync(join(logs, 'errors-20261019.log'), Buffer.alloc(5 * MB - 4, 97));
      writeFileSync(join(logs, 'errors-20261012.log'), 'old\n');
      const { handlers } = makeLog(userData);
      await handlers.get('log:write')?.(null, { level: 'info', module: 'i18n', message: 'ok', ts: NOW.toISOString() });
      expect(existsSync(join(logs, 'errors-20261012.log'))).toBe(false);
      expect(existsSync(join(logs, 'errors-20261019-2.log'))).toBe(true);
      expect(readFileSync(join(logs, 'errors-20261019-2.log'), 'utf8')).toBe(
        '2026-10-19T12:00:00.000Z INFO [i18n] ok\n',
      );
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('同一天连续写入：体积在扫描缓存里累积，跨过 5MB 才开 -2（不依赖重扫）', async () => {
    const userData = tmpDir('aao-log-cache-');
    try {
      const logs = join(userData, 'logs');
      mkdirSync(logs, { recursive: true });
      // 预留 5MB-50：第一条（40B）留本报，第二条必然越界 —— 只有缓存体积被正确累积才会开 -2
      const head = Buffer.alloc(5 * MB - 50, 97);
      writeFileSync(join(logs, 'errors-20261019.log'), head);
      const { handlers } = makeLog(userData);
      const write = handlers.get('log:write');
      const payload = { level: 'info', module: 'i18n', message: 'ok', ts: NOW.toISOString() };
      const line = '2026-10-19T12:00:00.000Z INFO [i18n] ok\n';
      expect(line).toHaveLength(40);

      await write?.(null, payload);
      expect(existsSync(join(logs, 'errors-20261019-2.log'))).toBe(false);

      await write?.(null, payload);
      expect(existsSync(join(logs, 'errors-20261019-2.log'))).toBe(true);
      expect(readFileSync(join(logs, 'errors-20261019.log'), 'utf8')).toBe(
        `${head.toString('latin1')}${line}`,
      );
      expect(readFileSync(join(logs, 'errors-20261019-2.log'), 'utf8')).toBe(line);
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });
});
