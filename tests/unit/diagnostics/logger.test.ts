import { describe, expect, it } from 'vitest';
import { createLogger, formatLogLine } from '@/src/diagnostics/logger';

const AT = new Date('2026-10-19T07:32:00.000Z');

describe('票 01 · 日志行格式', () => {
  it('ISO 时间戳 + 级别 + 模块前缀 + 消息', () => {
    expect(formatLogLine('error', 'chart-project', '谱面工程落盘失败', undefined, AT)).toBe(
      '2026-10-19T07:32:00.000Z ERROR [chart-project] 谱面工程落盘失败',
    );
  });

  it('warn / info 级别大写；模块已带括号时不叠括号', () => {
    expect(formatLogLine('warn', '[preview]', '仿真场音频解码失败', undefined, AT)).toBe(
      '2026-10-19T07:32:00.000Z WARN [preview] 仿真场音频解码失败',
    );
    expect(formatLogLine('info', 'i18n', 'missing key "foo"', undefined, AT)).toBe(
      '2026-10-19T07:32:00.000Z INFO [i18n] missing key "foo"',
    );
  });

  it('有 extra 时在消息后追加 JSON；Error 只留 message / stack', () => {
    expect(formatLogLine('error', 'community', '登录失败', { status: 401 }, AT)).toBe(
      '2026-10-19T07:32:00.000Z ERROR [community] 登录失败 {"status":401}',
    );
    const err = new Error('disk full');
    err.stack = 'Error: disk full\n    at x';
    expect(formatLogLine('error', 'chart-project', '落盘失败', err, AT)).toBe(
      '2026-10-19T07:32:00.000Z ERROR [chart-project] 落盘失败 {"message":"disk full","stack":"Error: disk full\\n    at x"}',
    );
  });
});

describe('票 01 · 渲染进程 logger', () => {
  it('error/warn/info 把结构化载荷交给 write，无桥也不抛', () => {
    const writes: unknown[] = [];
    const log = createLogger({
      now: () => AT,
      write: (payload) => writes.push(payload),
      console: { error() {}, warn() {}, info() {} },
    });
    const err = new Error('boom');
    err.stack = 'Error: boom';
    log.error('preview', '导出视频失败', err);
    log.warn('i18n', 'missing key "foo"');
    log.info('community', 'ready', { ok: true });
    expect(writes).toEqual([
      {
        level: 'error',
        module: 'preview',
        message: '导出视频失败',
        extra: { message: 'boom', stack: 'Error: boom' },
        ts: '2026-10-19T07:32:00.000Z',
      },
      {
        level: 'warn',
        module: 'i18n',
        message: 'missing key "foo"',
        ts: '2026-10-19T07:32:00.000Z',
      },
      {
        level: 'info',
        module: 'community',
        message: 'ready',
        extra: { ok: true },
        ts: '2026-10-19T07:32:00.000Z',
      },
    ]);
    expect(() => createLogger({ now: () => AT, console: { error() {}, warn() {}, info() {} } }).error('x', 'y')).not.toThrow();
  });

  it('trail.append 把事件交给 trail，无桥不抛', () => {
    const events: unknown[] = [];
    const log = createLogger({
      now: () => AT,
      trail: (event) => events.push(event),
      console: { error() {}, warn() {}, info() {} },
    });
    log.trail.append({ ts: AT.toISOString(), module: 'preview', action: 'export-start' });
    expect(events).toEqual([{ ts: AT.toISOString(), module: 'preview', action: 'export-start' }]);
    expect(() => createLogger({ console: { error() {}, warn() {}, info() {} } }).trail.append({ a: 1 })).not.toThrow();
  });
});
