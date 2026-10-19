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
  flush(): void;
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

function defaultPersist(event: TrailEvent): void {
  logger.trail.append(event);
}

export function createTrail(deps?: {
  now?: () => Date;
  persist?: (event: TrailEvent) => void;
  capacity?: number;
}): Trail {
  const now = deps?.now ?? (() => new Date());
  const persist = deps?.persist ?? defaultPersist;
  const capacity = deps?.capacity ?? TRAIL_CAPACITY;
  const buffer: TrailEvent[] = [];
  let nextFlush = 0;

  return {
    record(event) {
      buffer.push({ ts: now().toISOString(), ...event });
      while (buffer.length > capacity) {
        buffer.shift();
        nextFlush = Math.max(0, nextFlush - 1);
      }
    },
    flush() {
      for (let i = nextFlush; i < buffer.length; i++) {
        try {
          persist(buffer[i]!);
        } catch {
          /* persist 失败不抛 */
        }
      }
      nextFlush = buffer.length;
    },
    snapshot() {
      return buffer.slice();
    },
  };
}

export const trail: Trail = createTrail();
