// 工程启动台排序（issue 19 #4）：键白名单 + 比较器 + 派生口径。
//
// 为什么单独一个模块、而不是塞进 projectCatalog：设置对象（AppSettings）要 import 这里的
// 白名单做归一化，而 projectCatalog 拖着谱面代码转换器那串重依赖；本模块零运行时依赖
// （只用结构类型），谁都能安全地引。
//
// 「最近修改」口径（用户 2026-09-28 拍板）：工程没有自己的修改时间字段，派生 = 各谱面
// `lastModified` 的最大值。代价：改封面 / 工程名称不算"修改"（那些不吃谱面的 lastModified）。

export type ProjectSortKey = 'lastOpened' | 'lastModified' | 'chartCount' | 'name';

export const PROJECT_SORT_KEYS: readonly ProjectSortKey[] = ['lastOpened', 'lastModified', 'chartCount', 'name'];

export function normalizeProjectSortKey(raw: unknown, fallback: ProjectSortKey = 'lastOpened'): ProjectSortKey {
  return PROJECT_SORT_KEYS.includes(raw as ProjectSortKey) ? (raw as ProjectSortKey) : fallback;
}

export interface SortableProject {
  id: string;
  name: string | null;
  lastOpened: number;
  charts: readonly { lastModified: number }[];
}

/** 派生的工程「最近修改」时间；无谱面（不该出现）回 0。 */
export function projectLastModified(project: SortableProject): number {
  let latest = 0;
  for (const chart of project.charts) {
    if (chart.lastModified > latest) latest = chart.lastModified;
  }
  return latest;
}

/** 最近打开的那个工程 id：启动台 hero 的默认选中口径，与显示排序无关（issue 14 Q11 + 19 #4）。 */
export function mostRecentlyOpenedId(projects: readonly SortableProject[]): string | null {
  let best: SortableProject | null = null;
  for (const p of projects) {
    if (!best || p.lastOpened > best.lastOpened) best = p;
  }
  return best?.id ?? null;
}

/**
 * 排序（不改原数组）。四个键方向固定：时间 / 数量降序、名称升序；
 * 并列时回退「最近打开」，再相同按 id —— 保证任何输入下顺序确定。
 * 未命名工程按显示名参与名称排序（与列表显示的文案一致）。
 */
export function sortProjects<T extends SortableProject>(
  projects: readonly T[],
  key: ProjectSortKey,
  untitled: string,
): T[] {
  const displayName = (p: T) => p.name?.trim() || untitled;
  const tie = (a: T, b: T) => b.lastOpened - a.lastOpened || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const out = [...projects];
  out.sort((a, b) => {
    switch (key) {
      case 'lastModified':
        return projectLastModified(b) - projectLastModified(a) || tie(a, b);
      case 'chartCount':
        return b.charts.length - a.charts.length || tie(a, b);
      case 'name':
        return displayName(a).localeCompare(displayName(b), 'zh-CN') || tie(a, b);
      default:
        return b.lastOpened - a.lastOpened || tie(a, b);
    }
  });
  return out;
}
