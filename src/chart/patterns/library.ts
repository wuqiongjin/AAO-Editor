// 片段库的内存视图操作（issue 185 / 164 定案 §3）：
// 排序、搜索、改名、删除都只产出**新数组**，落盘一律交给 `PatternStore.saveAll`
// （唯一写入口在 `usePatternLibrary`，这里不碰存储）。
import { createPattern } from './naming';
import { patternBeatSpan, patternNoteCount } from './stats';
import type { Pattern, PatternPayload } from './types';

export type PatternSortKey = 'createdAt' | 'name' | 'noteCount' | 'beatSpan';
export type PatternSortDirection = 'asc' | 'desc';

export interface PatternSortPreference {
  key: PatternSortKey;
  direction: PatternSortDirection;
}

export const DEFAULT_PATTERN_SORT: PatternSortPreference = {
  key: 'createdAt',
  direction: 'desc',
};

export const PATTERN_SORT_KEYS: readonly PatternSortKey[] = ['createdAt', 'name', 'noteCount', 'beatSpan'];
export const PATTERN_SORT_DIRECTIONS: readonly PatternSortDirection[] = ['asc', 'desc'];

export function normalizePatternSortKey(raw: unknown, fallback: PatternSortKey = 'createdAt'): PatternSortKey {
  return PATTERN_SORT_KEYS.includes(raw as PatternSortKey) ? (raw as PatternSortKey) : fallback;
}

export function normalizePatternSortDirection(raw: unknown, fallback: PatternSortDirection = 'desc'): PatternSortDirection {
  return PATTERN_SORT_DIRECTIONS.includes(raw as PatternSortDirection) ? (raw as PatternSortDirection) : fallback;
}

export function normalizePatternSort(raw: unknown, fallback: PatternSortPreference = DEFAULT_PATTERN_SORT): PatternSortPreference {
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as Record<string, unknown>;
  return {
    key: normalizePatternSortKey(obj.key, fallback.key),
    direction: normalizePatternSortDirection(obj.direction, fallback.direction),
  };
}

/** 片段是否处于置顶态（issue 191）。 */
export function isPatternPinned(pattern: Pattern): boolean {
  return typeof pattern.pinnedAt === 'number' && Number.isFinite(pattern.pinnedAt);
}

/** 剥掉本地置顶偏好（issue 191）：取消置顶、读脏数据、分享导出共用。 */
export function stripPatternPinned(pattern: Pattern): Pattern {
  if ('pinnedAt' in pattern) {
    const copy = { ...pattern };
    delete (copy as { pinnedAt?: number }).pinnedAt;
    return copy;
  }
  return pattern;
}

/**
 * 片段基线排序（issue 185 / 191 存储基线）：
 * - 置顶组始终在最前；
 * - 置顶组内按 `pinnedAt` 倒序（最近置顶的更靠上），同值按 `createdAt` 倒序，再同按 id 全序；
 * - 未置顶组按 `createdAt` 倒序（最新在最上），同值按 id 全序。
 * 供存储加载与落盘保持一致。纯函数，不修改原数组。
 */
export function sortPatternsNewestFirst(patterns: readonly Pattern[]): Pattern[] {
  return [...patterns].sort((a, b) => {
    const aPinned = isPatternPinned(a);
    const bPinned = isPatternPinned(b);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    if (aPinned && bPinned && a.pinnedAt !== b.pinnedAt) {
      return b.pinnedAt! - a.pinnedAt!;
    }
    return (b.createdAt - a.createdAt) || a.id.localeCompare(b.id);
  });
}

/**
 * 片段多维排序（issue 192）：
 * - 置顶组始终在最前；
 * - 组内按当前排序键 / 方向排（全序，主键相同时按 a.id.localeCompare(b.id) 兜底）；
 * - 名称排序用 Intl.Collator（按指定 locale 或当前界面语言、numeric: true、sensitivity: 'base'）；
 * - 音符数 / 拍数复用 stats 派生函数；
 * - 纯函数，不修改原数组。
 */
export function sortPatterns(
  patterns: readonly Pattern[],
  sort: PatternSortPreference = DEFAULT_PATTERN_SORT,
  locale?: string,
): Pattern[] {
  if (patterns.length <= 1) return [...patterns];

  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });

  // 避免在比较过程中重复计算音符数 / 拍数
  let noteCountCache: Map<string, number> | null = null;
  let beatSpanCache: Map<string, number> | null = null;

  const getNoteCount = (p: Pattern): number => {
    if (!noteCountCache) noteCountCache = new Map();
    let val = noteCountCache.get(p.id);
    if (val === undefined) {
      val = patternNoteCount(p);
      noteCountCache.set(p.id, val);
    }
    return val;
  };

  const getBeatSpan = (p: Pattern): number => {
    if (!beatSpanCache) beatSpanCache = new Map();
    let val = beatSpanCache.get(p.id);
    if (val === undefined) {
      val = patternBeatSpan(p);
      beatSpanCache.set(p.id, val);
    }
    return val;
  };

  return [...patterns].sort((a, b) => {
    const aPinned = isPatternPinned(a);
    const bPinned = isPatternPinned(b);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;

    let primary = 0;
    switch (sort.key) {
      case 'name':
        primary = collator.compare(a.name, b.name);
        break;
      case 'noteCount':
        primary = getNoteCount(a) - getNoteCount(b);
        break;
      case 'beatSpan':
        primary = getBeatSpan(a) - getBeatSpan(b);
        break;
      case 'createdAt':
      default:
        primary = a.createdAt - b.createdAt;
        break;
    }

    if (primary !== 0) {
      return sort.direction === 'desc' ? -primary : primary;
    }

    // 全序兜底：同主键按 id 字典序升序
    return a.id.localeCompare(b.id);
  });
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
 * 批量删除（不可变，issue 193）：
 * - id 集合为空 / 库为空 / 没有任何匹配 → 返回 null（不产生无意义落盘）；
 * - 命中时产出新数组；一次操作只走一次整库 commit。
 */
export function removePatternsFromLibrary(
  patterns: readonly Pattern[],
  idsToRemove: ReadonlySet<string> | readonly string[],
): Pattern[] | null {
  const idSet = idsToRemove instanceof Set ? idsToRemove : new Set(idsToRemove);
  if (idSet.size === 0 || patterns.length === 0) return null;
  const next = patterns.filter((pattern) => !idSet.has(pattern.id));
  if (next.length === patterns.length) return null;
  return next;
}

/**
 * 置顶 / 取消置顶（不可变，issue 191）：
 * - id 不存在 → 返回 null（不写盘）；
 * - 状态未改变（已置顶时再置顶、未置顶时再取消）→ 返回 null（不产生无意义整库落盘）；
 * - 置顶：记录 `pinnedAt: now ?? Date.now()`；
 * - 取消置顶：删除 `pinnedAt` 字段。
 */
export function setPatternPinnedInLibrary(
  patterns: readonly Pattern[],
  id: string,
  pinned: boolean,
  now?: number,
): Pattern[] | null {
  const index = patterns.findIndex((pattern) => pattern.id === id);
  if (index < 0) return null;
  const current = patterns[index]!;
  if (pinned === isPatternPinned(current)) return null;

  const next = [...patterns];
  next[index] = pinned ? { ...current, pinnedAt: now ?? Date.now() } : stripPatternPinned(current);
  return next;
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
