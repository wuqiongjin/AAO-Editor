/**
 * 社区素材缓存的回收策略（票 18）：设置里那两个数 → 推给主进程的素材缓存。
 *
 * 只推**回收参数**（多久没用算闲置、总量上限），别的都不推 —— 缓存内容、鲜度（24h 后台刷新）
 * 与「手动清除」都不归设置管（票 14 定案）。静态演示版没有这条桥：静默跳过。
 */
import type { AssetCachePolicy } from '../chart/config/AppSettings';

const DAY_MS = 24 * 60 * 60 * 1000;
const MEGABYTE = 1024 * 1024;

/** 主进程那条 IPC 收的载荷（单位就在这里换：天 → ms，MB → 字节） */
export interface AssetCachePolicyPayload {
  maxAgeMs: number;
  maxBytes: number;
}

export function toAssetCachePolicyPayload(policy: AssetCachePolicy): AssetCachePolicyPayload {
  return {
    maxAgeMs: policy.maxIdleDays * DAY_MS,
    maxBytes: policy.maxMegabytes * MEGABYTE,
  };
}

/** 把当前策略推给主进程；桥不在（静态演示版）就什么也不做 */
export function syncAssetCachePolicy(policy: AssetCachePolicy): void {
  if (typeof window === 'undefined') return;
  const configure = (
    window as unknown as {
      electronAPI?: { assetCache?: { configure?: (payload: AssetCachePolicyPayload) => Promise<unknown> } };
    }
  ).electronAPI?.assetCache?.configure;
  if (configure == null) return;
  void configure(toAssetCachePolicyPayload(policy)).catch(() => undefined);
}
