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
  /**
   * error / warn / info 返回桥调用的结果（Electron 下是 Promise，主进程写完才 resolve）；
   * 无桥（浏览器演示）时返回 undefined。需要保序的调用方可以 await（见 exportDiagnostics）。
   */
  error(module: string, message: string, extra?: unknown): unknown;
  warn(module: string, message: string, extra?: unknown): unknown;
  info(module: string, message: string, extra?: unknown): unknown;
  /** 返回桥调用的结果（Electron 下是 Promise，主进程写完才 resolve）；无桥时 undefined。 */
  trail: { append(event: unknown): unknown };
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

function defaultWrite(payload: LogWritePayload): unknown {
  const write = getLogBridge()?.write;
  if (!write) return undefined;
  try {
    // 不 void 掉：回传桥调用结果，需要保序的调用方可以 await（见 exportDiagnostics）
    return write(payload);
  } catch {
    /* 无桥 / 桥挂了都不该把业务打翻 */
    return undefined;
  }
}

function defaultTrail(event: unknown): unknown {
  const trail = getLogBridge()?.trail;
  if (!trail) return undefined;
  try {
    // 不 void 掉：返回的 Promise 让 trail.flush() 能等到主进程落盘
    return trail(event);
  } catch {
    /* 无桥 / 桥挂了都不该把业务打翻 */
    return undefined;
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

  function emit(level: LogLevel, module: string, message: string, extra?: unknown): unknown {
    const at = now();
    const line = formatLogLine(level, module, message, extra, at);
    if (level === 'error') cons.error(line);
    else if (level === 'warn') cons.warn(line);
    else cons.info(line);
    const extraVal = jsonableExtra(extra);
    const payload: LogWritePayload = { level, module, message, ts: at.toISOString() };
    if (extraVal !== undefined) payload.extra = extraVal;
    try {
      return write(payload);
    } catch {
      /* write 失败不抛 */
      return undefined;
    }
  }

  return {
    error: (module, message, extra) => emit('error', module, message, extra),
    warn: (module, message, extra) => emit('warn', module, message, extra),
    info: (module, message, extra) => emit('info', module, message, extra),
    trail: {
      append(event: unknown) {
        try {
          return trail(event);
        } catch {
          /* trail 失败不抛 */
          return undefined;
        }
      },
    },
  };
}

export const logger: Logger = createLogger();
