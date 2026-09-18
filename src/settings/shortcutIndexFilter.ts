// 快捷键页「索引筛选」粗桶（issue 121）。
// 与 ADR-0002 的 category（tooltip 细分组：单键 / 复制 / …）分名、分表，禁止混用。
import { FUNCTIONS, getDefaultConfig, type FunctionDef, type ShortcutConfig } from '../chart/config/ShortcutConfig';

export type IndexFilterId = 'all' | 'system' | 'noteTools' | 'editTools' | 'playback' | 'other';

export const INDEX_FILTERS: ReadonlyArray<{ id: IndexFilterId; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'system', label: '系统' },
  { id: 'noteTools', label: '音符工具' },
  { id: 'editTools', label: '编辑工具' },
  { id: 'playback', label: '播放' },
  { id: 'other', label: '其它' },
];

/** tooltip 类别 → 粗桶。未入表的新类别落「其它」。 */
const CATEGORY_TO_BUCKET: Readonly<Record<string, Exclude<IndexFilterId, 'all' | 'other'>>> = {
  布局: 'system',
  鼠标: 'noteTools',
  BPM: 'noteTools',
  单键: 'noteTools',
  滑键: 'noteTools',
  技能: 'noteTools',
  左滑: 'noteTools',
  右滑: 'noteTools',
  滑条: 'noteTools',
  曲线: 'noteTools',
  复制: 'editTools',
  粘贴: 'editTools',
  剪切: 'editTools',
  删除: 'editTools',
  镜像: 'editTools',
  音符代码: 'editTools',
  撤销: 'editTools',
  重做: 'editTools',
  播放: 'playback',
};

export function bucketForCategory(category: string): Exclude<IndexFilterId, 'all'> {
  return CATEGORY_TO_BUCKET[category] ?? 'other';
}

/** 切页五行：进表、只读、归系统。不进 FunctionId 注册表。 */
export const PAGE_SWITCH_ROWS: ReadonlyArray<{ label: string; combo: string; bucket: 'system' }> = [
  { label: '切换到工作台', combo: 'Ctrl/⌘+Shift+1', bucket: 'system' },
  { label: '切换到音频', combo: 'Ctrl/⌘+Shift+2', bucket: 'system' },
  { label: '切换到素材', combo: 'Ctrl/⌘+Shift+3', bucket: 'system' },
  { label: '切换到快捷键', combo: 'Ctrl/⌘+Shift+4', bucket: 'system' },
  { label: '切换到设置', combo: 'Ctrl/⌘+Shift+5', bucket: 'system' },
];

function matchesSearch(haystacks: Array<string | null | undefined>, q: string): boolean {
  if (!q) return true;
  return haystacks.some((h) => h != null && h.toLowerCase().includes(q));
}

export function filterFunctions(
  fns: readonly FunctionDef[],
  filter: IndexFilterId,
  query: string,
  config: ShortcutConfig,
): FunctionDef[] {
  const q = query.trim().toLowerCase();
  return fns.filter((f) => {
    if (filter !== 'all' && bucketForCategory(f.category) !== filter) return false;
    return matchesSearch([f.label, f.category, config[f.id]], q);
  });
}

export function filterPageSwitchRows(
  rows: typeof PAGE_SWITCH_ROWS,
  filter: IndexFilterId,
  query: string,
): Array<(typeof PAGE_SWITCH_ROWS)[number]> {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter !== 'all' && row.bucket !== filter) return false;
    return matchesSearch([row.label, row.combo], q);
  });
}

/** 表空：桶里本来就没有条目，还是当前搜索筛没了。空桶优先于搜索空。 */
export function shortcutTableEmptyKind(
  bucketHits: number,
  visibleHits: number,
): 'none' | 'empty-bucket' | 'empty-search' {
  if (visibleHits > 0) return 'none';
  if (bucketHits === 0) return 'empty-bucket';
  return 'empty-search';
}

/**
 * 「恢复默认」跟当前索引筛选：全部 = 整表出厂；其它桶只重置该桶可改 FunctionId。
 * 切页五行不在配置里。若桶外功能占着本桶出厂键，先卸掉以免一键两功能。
 */
export function restoreDefaultsInFilter(
  cfg: ShortcutConfig,
  filter: IndexFilterId,
  fns: readonly FunctionDef[] = FUNCTIONS,
  defaults: ShortcutConfig = getDefaultConfig(),
): ShortcutConfig {
  if (filter === 'all') return { ...defaults };
  const ids = new Set(
    fns.filter((f) => bucketForCategory(f.category) === filter).map((f) => f.id),
  );
  if (ids.size === 0) return { ...cfg };
  const next = { ...cfg };
  const defaultKeys = new Set<string>();
  for (const id of ids) {
    const b = defaults[id];
    if (b) defaultKeys.add(b);
  }
  for (const f of fns) {
    if (ids.has(f.id)) continue;
    const b = next[f.id];
    if (b && defaultKeys.has(b)) next[f.id] = null;
  }
  for (const id of ids) next[id] = defaults[id];
  return next;
}
