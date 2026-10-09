/**
 * 可用性探测与降级口径（票 07 能力 15；ADR-0011 §1「静态演示版 / 离线不白屏、不循环报错」）。
 *
 * 这里**不做轮询**：只有两个入口 —— 显式 `check()`（启动 / 用户点重试）与真实请求的成败回报
 * `reportSuccess()` / `reportFailure()`。「不循环报错」是构造上保证的，不靠调用方自觉。
 *
 * 在线判定：**社区平台答了话就算在线**（业务错误、限流、未授权都算）；只有「连不上 / 超时」才是离线。
 * 出口自己坏了（`unsupported-runtime`：通道没注册 / 主进程异常 / 静态演示版）归到 `unsupported`。
 */
import { isCommunityError, isOfflineError } from './transport';

export type CommunityAvailability = 'unknown' | 'online' | 'offline' | 'unsupported';

export interface CommunityAvailabilityState {
  status: CommunityAvailability;
  /** 最近一次判定的时刻（now()）；'unknown' / 'unsupported' 时为 null */
  checkedAt: number | null;
}

/** 能力被挡住的原因：运行环境没出口 / 离线 / 没登录（写能力） */
export type CommunityCapabilityBlock = 'unsupported-runtime' | 'offline' | 'signed-out';

export interface CommunityCapabilities {
  read: boolean;
  write: boolean;
  /** 被挡住的原因；两档都可用时为 null */
  block: CommunityCapabilityBlock | null;
}

function statusForError(error: unknown): CommunityAvailability {
  if (isOfflineError(error)) return 'offline';
  // 没有出口（静态演示版 / 通道坏了）不是「离线」，也不该乐观当在线
  if (isCommunityError(error) && error.kind === 'unsupported-runtime') return 'unsupported';
  return 'online';
}

/**
 * 降级矩阵（ADR-0011 §1 + issue 06 Q3）：
 * - 静态演示版（无出口）：读也提示不可用（该能力根本不提供）；
 * - 离线：读能力提示不可用，写能力一并灰掉；
 * - 在线：读可用；写看会话（未登录 = 灰掉，**不弹窗打断**）；
 * - unknown（还没探过）：乐观放读 —— 第一次真实请求失败就会转 offline。
 */
export function capabilitiesFor(
  state: CommunityAvailabilityState,
  session: { signedIn: boolean },
): CommunityCapabilities {
  if (state.status === 'unsupported') {
    return { read: false, write: false, block: 'unsupported-runtime' };
  }
  if (state.status === 'offline') {
    return { read: false, write: false, block: 'offline' };
  }
  if (!session.signedIn) return { read: true, write: false, block: 'signed-out' };
  return { read: true, write: true, block: null };
}

export interface AvailabilityMonitorOptions {
  /** 有没有出口（`transport.kind === 'ipc'`）；false = 静态演示版，永远 'unsupported' */
  supported: boolean;
  /** 探一次：成功 = 在线；抛 CommunityError('offline' | 'timeout') = 离线。不传则 check() 不改状态 */
  probe?: () => Promise<unknown>;
  now?: () => number;
}

export interface AvailabilityMonitor {
  getState(): CommunityAvailabilityState;
  subscribe(listener: (state: CommunityAvailabilityState) => void): () => void;
  check(): Promise<CommunityAvailabilityState>;
  /** 一次真实请求成功后回报 */
  reportSuccess(): void;
  /** 一次真实请求失败后回报（「连不上 / 超时」= 离线；没有出口 = unsupported；其余 = 仍在线） */
  reportFailure(error: unknown): void;
}

export function createAvailabilityMonitor(options: AvailabilityMonitorOptions): AvailabilityMonitor {
  const now = options.now ?? Date.now;
  let state: CommunityAvailabilityState = options.supported
    ? { status: 'unknown', checkedAt: null }
    : { status: 'unsupported', checkedAt: null };
  const listeners = new Set<(state: CommunityAvailabilityState) => void>();

  function publish(next: CommunityAvailabilityState) {
    if (next.status === state.status && next.checkedAt === state.checkedAt) return;
    state = next;
    for (const listener of [...listeners]) listener(state);
  }

  /** 判定出的状态落到 state；'unsupported' 的 checkedAt 恒为 null（没探过，也探不了） */
  function settle(status: CommunityAvailability) {
    publish(status === 'unsupported' ? { status, checkedAt: null } : { status, checkedAt: now() });
  }

  async function check(): Promise<CommunityAvailabilityState> {
    if (!options.supported) {
      settle('unsupported');
      return state;
    }
    if (!options.probe) return state;
    try {
      await options.probe();
      settle('online');
    } catch (error) {
      settle(statusForError(error));
    }
    return state;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    check,
    reportSuccess() {
      if (!options.supported) return;
      settle('online');
    },
    reportFailure(error) {
      if (!options.supported) return;
      settle(statusForError(error));
    },
  };
}
