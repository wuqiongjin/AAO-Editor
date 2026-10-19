/**
 * 渲染进程 logger（ADR-0019 / 票 01）。
 * error / warn / info 双写：console + 结构化 IPC；无桥（浏览器演示）只打 console、不抛。
 * 真正埋点归票 02，这里只提供 trail.append。
 */

export type LogLevel = 'error' | 'warn' | 'info';

export interface LogWritePayload {
  level: LogLevel;
  module: string;
  message: string;
  extra?: unknown;
  ts: string;
}

export interface LogBridge {
  write(payload: LogWritePayload): unknown;
  trail(event: unknown): unknown;
}

export interface Logger {
  error(module: string, message: string, extra?: unknown): void;
  warn(module: string, message: string, extra?: unknown): void;
  info(module: string, message: string, extra?: unknown): void;
  trail: { append(event: unknown): void };
}

function getLogBridge(): LogBridge | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { log?: LogBridge } }).electronAPI;
  return api?.log ?? null;
}

function jsonableExtra(extra: unknown): unknown {
  if (extra === undefined || extra === null) return undefined;
  if (extra instanceof Error) return { message: extra.message, stack: extra.stack };
  try {
    JSON.stringify(extra);
    return extra;
  } catch {
    return String(extra);
  }
}

/** 行格式。主进程 `electron/appLog.cjs` 有一份同形实现（渲染进程不能 import electron/）。 */
export function formatLogLine(
  level: LogLevel,
  module: string,
  message: string,
  extra?: unknown,
  at: Date = new Date(),
): string {
  const prefix = module.startsWith('[') ? module : `[${module}]`;
  let line = `${at.toISOString()} ${level.toUpperCase()} ${prefix} ${message}`;
  const jsonVal = jsonableExtra(extra);
  if (jsonVal !== undefined) line += ` ${JSON.stringify(jsonVal)}`;
  return line;
}

function defaultWrite(payload: LogWritePayload): void {
  const write = getLogBridge()?.write;
  if (!write) return;
  try {
    void write(payload);
  } catch {
    /* 无桥 / 桥挂了都不该把业务打翻 */
  }
}

function defaultTrail(event: unknown): void {
  const trail = getLogBridge()?.trail;
  if (!trail) return;
  try {
    void trail(event);
  } catch {
    /* 无桥 / 桥挂了都不该把业务打翻 */
  }
}

export function createLogger(deps?: {
  now?: () => Date;
  write?: (payload: LogWritePayload) => unknown;
  trail?: (event: unknown) => unknown;
  console?: Pick<Console, 'error' | 'warn' | 'info'>;
}): Logger {
  const now = deps?.now ?? (() => new Date());
  const write = deps?.write ?? defaultWrite;
  const trail = deps?.trail ?? defaultTrail;
  const cons = deps?.console ?? console;

  function emit(level: LogLevel, module: string, message: string, extra?: unknown): void {
    const at = now();
    const line = formatLogLine(level, module, message, extra, at);
    if (level === 'error') cons.error(line);
    else if (level === 'warn') cons.warn(line);
    else cons.info(line);
    const extraVal = jsonableExtra(extra);
    const payload: LogWritePayload = { level, module, message, ts: at.toISOString() };
    if (extraVal !== undefined) payload.extra = extraVal;
    try {
      void write(payload);
    } catch {
      /* write 失败不抛 */
    }
  }

  return {
    error: (module, message, extra) => emit('error', module, message, extra),
    warn: (module, message, extra) => emit('warn', module, message, extra),
    info: (module, message, extra) => emit('info', module, message, extra),
    trail: {
      append(event: unknown) {
        try {
          void trail(event);
        } catch {
          /* trail 失败不抛 */
        }
      },
    },
  };
}

export const logger: Logger = createLogger();
