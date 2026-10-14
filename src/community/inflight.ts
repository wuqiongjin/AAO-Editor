/**
 * 并发去重（票 38 #1 收敛）：同一 key 的在飞请求只发一次 —— 后来的直接搭前一个的 promise。
 * songs.ts（官方封面）与 posts.ts（帖内封面）各持一张 inflight 表，去重内核是同一套：
 *   get 命中即还 → 否则 `start()` 发起 → 塞表 → 结束（成功或失败）后按身份核对清坑
 *   （`get(key) === promise` 才删：只清自己那份，不误删失败后立刻重试塞进去的新请求）。
 * key 与产物类型由调用方定（官方按封面 URL、社区按 postId），差异留在调用方，这里只管去重本身。
 */
export function dedupInflight<K, T>(
  map: Map<K, Promise<T>>,
  key: K,
  start: () => Promise<T>,
): Promise<T> {
  const inflight = map.get(key);
  if (inflight) return inflight;
  const promise = start().finally(() => {
    if (map.get(key) === promise) map.delete(key);
  });
  map.set(key, promise);
  return promise;
}
