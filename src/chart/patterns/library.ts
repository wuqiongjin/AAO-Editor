// 片段库的内存视图操作（issue 185 / 164 定案 §3）：
// 排序、搜索、改名、删除都只产出**新数组**，落盘一律交给 `PatternStore.saveAll`
// （唯一写入口在 `usePatternLibrary`，这里不碰存储）。
import { createPattern } from './naming';
import type { Pattern, PatternPayload } from './types';

/**
 * 收藏时间倒序（最新在最上）。同一毫秒内的两条按 id 定序 ——
 * 排序必须是全序，否则每次渲染都可能换位。
 */
export function sortPatternsNewestFirst(patterns: readonly Pattern[]): Pattern[] {
  return [...patterns].sort((a, b) => (b.createdAt - a.createdAt) || a.id.localeCompare(b.id));
}

/** 名字子串过滤（不区分大小写）；空查询 / 全空白 = 不过滤（返回全部，含顺序） */
export function filterPatternsByName(patterns: readonly Pattern[], query: string): Pattern[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...patterns];
  return patterns.filter((pattern) => pattern.name.toLowerCase().includes(q));
}

/**
 * 改名的规范化：首尾空白去掉；**空名（或纯空白）拒绝**，返回 null。
 * 超长不截断 —— 名字是标签，存原文，显示时由 CSS 省略（164 定案 §3）。
 */
export function normalizePatternName(raw: string): string | null {
  const name = raw.trim();
  return name === '' ? null : name;
}

/**
 * 改名（不可变）：id 不存在 / 新名被拒绝 → 返回 null（调用方据此不写盘）。
 * 名字没变也返回 null —— 不产生一次无意义的整库落盘。
 */
export function renamePatternInLibrary(
  patterns: readonly Pattern[],
  id: string,
  rawName: string,
): Pattern[] | null {
  const name = normalizePatternName(rawName);
  if (name === null) return null;
  const index = patterns.findIndex((pattern) => pattern.id === id);
  if (index < 0) return null;
  if (patterns[index]!.name === name) return null;
  const next = [...patterns];
  next[index] = { ...next[index]!, name };
  return next;
}

/** 删除（不可变）：id 不存在 → 返回 null（不写盘）；不建撤销栈（164 定案 §3） */
export function removePatternFromLibrary(patterns: readonly Pattern[], id: string): Pattern[] | null {
  const index = patterns.findIndex((pattern) => pattern.id === id);
  if (index < 0) return null;
  return patterns.filter((_, i) => i !== index);
}

/**
 * 新片段的**唯一追加口径**：领 id / 起名（`createPattern`）后接在库尾。
 * 排序不在这里做 —— 落盘顺序不是语义，界面按 `sortPatternsNewestFirst` 排。
 * 存储门面（`PatternStore.add`）与 React 接缝（`usePatternLibrary`）共用这一份，不各写一遍。
 */
export function appendNewPattern(
  patterns: readonly Pattern[],
  payload: PatternPayload,
  now?: number,
): { patterns: Pattern[]; pattern: Pattern } {
  const pattern = createPattern(payload, patterns, now);
  return { patterns: [...patterns, pattern], pattern };
}

/**
 * 卡片徽标 / 胶囊摘要的**唯一口径**：起点生效 BPM + 峰值（issue 186 二轮定案）。
 *
 * 为什么取**峰值**而不是末值：`120 → 180 → 120` 按末值会读成"120 → 120"（像没变化），
 * 按峰值读成"120 → 180" —— 信息不丢，且首尾不同（最常见）时两者结果一致。
 * 峰值 = 与起点**差值绝对值最大**的那条事件值（取到它才算"这段里的速度跨度"）。
 *
 * `peak === null` = 跨度内没有任何改变速度的事件（只有起点一个值）。
 * 负值（倒流区，ADR-0010）不另设标记 —— 由显示侧给负的那个数字上危险色表达。
 */
export interface PatternBpmRange {
  /** 起点生效 BPM（片段第一枚音符所在处的速度） */
  start: number;
  /** 与起点差值最大的那条事件值；`null` = 跨度内没有改速事件（只有起点一个值） */
  peak: number | null;
}

export function patternBpmRange(pattern: Pattern): PatternBpmRange {
  const { startBpm, events } = pattern.bpmContext;
  let peak: number | null = null;
  let widest = 0;
  for (const event of events) {
    const delta = Math.abs(event.bpm - startBpm);
    if (delta > widest) {
      widest = delta;
      peak = event.bpm;
    }
  }
  return { start: startBpm, peak };
}
