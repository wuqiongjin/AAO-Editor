/**
 * 操作轨迹（ADR-0019 §3 / 票 02）：内存 ring 500，崩溃或导出诊断包时经 logger.trail.append 落盘。
 */
import { logger } from './logger';

export interface TrailEvent {
  ts: string;
  module: string;
  action: string;
  result?: string;
  durationMs?: number;
  meta?: Record<string, unknown>;
}

export interface Trail {
  record(event: Omit<TrailEvent, 'ts'>): void;
  /** 把尚未落盘的条目交给 persist，返回的 Promise 在全部落盘后才 resolve。 */
  flush(): Promise<void>;
  snapshot(): TrailEvent[];
}

export const TRAIL_CAPACITY = 500;

export function serializeTrailEvent(event: TrailEvent): string {
  const row: Record<string, unknown> = {
    ts: event.ts,
    module: event.module,
    action: event.action,
  };
  if (event.result !== undefined) row.result = event.result;
  if (event.durationMs !== undefined) row.durationMs = event.durationMs;
  if (event.meta !== undefined) row.meta = event.meta;
  return JSON.stringify(row);
}

function defaultPersist(event: TrailEvent): unknown {
  // 不 void 掉：logger.trail.append 返回 IPC 调用的 Promise，flush 靠它保序
  return logger.trail.append(event);
}

export function createTrail(deps?: {
  now?: () => Date;
  persist?: (event: TrailEvent) => unknown;
  capacity?: number;
}): Trail {
  const now = deps?.now ?? (() => new Date());
  const persist = deps?.persist ?? defaultPersist;
  const capacity = deps?.capacity ?? TRAIL_CAPACITY;
  const buffer: TrailEvent[] = [];
  let nextFlush = 0;
  // 上一次 flush 的落盘尾巴：进行中再来 flush 就挂到同一条尾巴上，
  // 调用方拿到的 Promise 因此覆盖「本次 + 此前所有」pending 落盘
  let flushing: Promise<void> = Promise.resolve();

  return {
    record(event) {
      buffer.push({ ts: now().toISOString(), ...event });
      while (buffer.length > capacity) {
        buffer.shift();
        nextFlush = Math.max(0, nextFlush - 1);
      }
    },
    flush() {
      const pending: Promise<void>[] = [];
      for (let i = nextFlush; i < buffer.length; i++) {
        try {
          const result = persist(buffer[i]!);
          if (result && typeof (result as Promise<void>).then === 'function') {
            pending.push(result as Promise<void>);
          }
        } catch {
          /* persist 失败不抛 */
        }
      }
      nextFlush = buffer.length;
      // 无等待中的落盘时也返回已 resolve 的 Promise：调用方（exportDiagnostics）统一 await。
      // 单条落盘失败不拖垮整批，也不外溢成未处理 rejection（与同步抛错被吞掉同语义）。
      const mine = Promise.all(pending.map((p) => p.catch(() => undefined))).then(() => undefined);
      flushing = flushing.then(() => mine);
      return flushing;
    },
    snapshot() {
      return buffer.slice();
    },
  };
}

export const trail: Trail = createTrail();
