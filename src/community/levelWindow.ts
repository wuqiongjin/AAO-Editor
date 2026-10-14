/**
 * 等级窗口归一化（票 38 #2 收敛）：官方曲库（`bestdori/songs.ts`）与社区帖（`bestdori/posts.ts`）
 * 客户端筛选各写一份的 `hasLo/hasHi → lo/hi` 归一化逐字相同，上收为纯函数，两处调用。
 *
 * 口径（行为等价重构，从原实现一字未改地搬过来）：
 *   - 窗口只在**任一边填了有限数字**时生效；缺省（undefined / null）与 NaN / ±Infinity 都算「没填」；
 *   - 只填一边 = 另一边取同值（`levelMin: 28` ⇒ `[28, 28]`）；
 *   - 两边都填时左右填反按数值 min/max，不硬夹；
 *   - 两边都没填回 `{ lo: null, hi: null }` = 窗口不生效。
 *
 * 现状陷阱（tests/unit/community/levelWindow.test.ts 逐值锁住，重构时不顺手「修好」）：
 * `??` 只拦 null / undefined —— 一边 NaN 一边有效时 NaN 会穿透 `??`，
 * `Math.min/max(NaN, …)` 让 lo / hi 都变成 NaN；调用方按「不是 null 就当生效」处理。
 */
export interface LevelWindowFilter {
  levelMin?: number | null;
  levelMax?: number | null;
}

/** 归一化后的等级窗口；`lo` / `hi` 为 null = 该窗口不生效 */
export function normalizeLevelWindow(
  filter: LevelWindowFilter,
): { lo: number | null; hi: number | null } {
  const hasLo = typeof filter.levelMin === 'number' && Number.isFinite(filter.levelMin);
  const hasHi = typeof filter.levelMax === 'number' && Number.isFinite(filter.levelMax);
  const lo = hasLo || hasHi
    ? Math.min(filter.levelMin ?? filter.levelMax as number, filter.levelMax ?? filter.levelMin as number)
    : null;
  const hi = lo == null
    ? null
    : Math.max(filter.levelMin ?? filter.levelMax as number, filter.levelMax ?? filter.levelMin as number);
  return { lo, hi };
}
