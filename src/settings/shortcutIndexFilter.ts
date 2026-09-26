// 快捷键页「索引筛选」粗桶（issue 121）。
// 与 ADR-0002 的 category（tooltip 细分组：单键 / 复制 / …）分名、分表，禁止混用。
import { t, type MessageKey } from '../i18n';
import { FUNCTIONS, getDefaultConfig, type FunctionDef, type FunctionId, type ShortcutConfig } from '../chart/config/ShortcutConfig';

export type IndexFilterId = 'all' | 'system' | 'noteTools' | 'editTools' | 'playback' | 'other';

export const INDEX_FILTERS: ReadonlyArray<{ id: IndexFilterId; label: MessageKey }> = [
  { id: 'all', label: 'indexFilter.all' },
  { id: 'system', label: 'indexFilter.system' },
  { id: 'noteTools', label: 'indexFilter.noteTools' },
  { id: 'editTools', label: 'indexFilter.editTools' },
  { id: 'playback', label: 'indexFilter.playback' },
  { id: 'other', label: 'indexFilter.other' },
];

/** tooltip 类别 → 粗桶。未入表的新类别落「其它」。 */
const CATEGORY_TO_BUCKET: Readonly<Record<string, Exclude<IndexFilterId, 'all' | 'other'>>> = {
  layout: 'system',
  mouse: 'noteTools',
  bpm: 'noteTools',
  single: 'noteTools',
  flick: 'noteTools',
  skill: 'noteTools',
  ldirectional: 'noteTools',
  rdirectional: 'noteTools',
  slide: 'noteTools',
  curve: 'noteTools',
  copy: 'editTools',
  paste: 'editTools',
  cut: 'editTools',
  delete: 'editTools',
  mirror: 'editTools',
  noteCode: 'editTools',
  undo: 'editTools',
  redo: 'editTools',
  play: 'playback',
};

export function bucketForCategory(category: string): Exclude<IndexFilterId, 'all'> {
  return CATEGORY_TO_BUCKET[category] ?? 'other';
}

/** 切页六行：进表、只读、归系统。不进 FunctionId 注册表。 */
export const PAGE_SWITCH_ROWS: ReadonlyArray<{ label: MessageKey; combo: string; bucket: 'system' }> = [
  { label: 'pageSwitch.projects', combo: 'Ctrl/⌘+Shift+0', bucket: 'system' },
  { label: 'pageSwitch.workspace', combo: 'Ctrl/⌘+Shift+1', bucket: 'system' },
  { label: 'pageSwitch.audio', combo: 'Ctrl/⌘+Shift+2', bucket: 'system' },
  { label: 'pageSwitch.assets', combo: 'Ctrl/⌘+Shift+3', bucket: 'system' },
  { label: 'pageSwitch.shortcuts', combo: 'Ctrl/⌘+Shift+4', bucket: 'system' },
  { label: 'pageSwitch.settings', combo: 'Ctrl/⌘+Shift+5', bucket: 'system' },
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
    return matchesSearch([t(f.label as MessageKey), t(`tool.cat.${f.category}` as MessageKey), config[f.id]], q);
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
    return matchesSearch([t(row.label), row.combo], q);
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
 * issue 150：非空 onlyIds（搜索可见可改行）时只重置该集合，仍走桶外卸占用逻辑。
 * 切页六行不在配置里。若桶外功能占着本桶出厂键，先卸掉以免一键两功能。
 */
export function restoreDefaultsInFilter(
  cfg: ShortcutConfig,
  filter: IndexFilterId,
  fns: readonly FunctionDef[] = FUNCTIONS,
  defaults: ShortcutConfig = getDefaultConfig(),
  onlyIds?: Iterable<FunctionId>,
): ShortcutConfig {
  const scoped = onlyIds ? new Set(onlyIds) : null;
  if (!scoped) {
    if (filter === 'all') return { ...defaults };
  }
  const ids = scoped ?? new Set(
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
