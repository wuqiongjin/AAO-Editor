// 工程启动台排序（issue 19 #4）：键白名单 + 比较器 + 派生口径 + 列表显示口径（issue 37）
// + 横幅锚口径（issue 40）。
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

/**
 * 列表显示哪个工程时间戳（issue 37）：时间键显示该键的时间，其余键回落 lastOpened。
 *
 * 为什么单列一个函数：卡片副行 / hero / 详情左栏三处显示必须与排序键**同源**——
 * 排序键可以是派生的「最近修改」，而显示若写死 lastOpened，「最近修改」排序下
 * 顺序按 max(charts.lastModified) 排、眼睛看到的是「上次打开」，二者对不上。
 * 模型保证工程恒有 ≥1 谱面（见 projectLastModified 注释），故不回落 0。
 */
export function projectTimeAt(project: SortableProject, key: ProjectSortKey): number {
  switch (key) {
    case 'lastModified':
      return projectLastModified(project);
    default:
      return project.lastOpened;
  }
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
 * 横幅锚（issue 40 定案 A）：当前排序键下 hero 该展示哪个工程。
 *
 * 口径 = 排序键的「头」，且与 `projectTimeAt` 同一套回落：时间键取该键最大值
 * （`lastModified` 走派生），其余键回落「最近打开」（issue 19 #4：非时间排序不改
 * resume 语义）。并列回退与 `sortProjects` 逐条一致（该键 → lastOpened → id），
 * 因此时间键下锚恒等于展示序的第一个。
 *
 * 并列末级按 id（不是"首个最大值"）是**有意为之**：`mostRecentlyOpenedId` 取数组序里
 * 第一个最大值，会跟着 store 的入库次序飘；锚必须确定、且必须等于展示序的头（列表并列
 * 本就按 id 排）。二者在 `lastOpened` 并列时可能不同——单测「时间键：锚 = 展示序的头」
 * 把这点钉死（含与 mostRecentlyOpenedId 的分歧断言）。
 *
 * 为什么必须是活函数、而不是组件里算一次的默认值：打开工程会把 `lastOpened` 写成
 * now（`CurrentProjectSession.open` → `mutateProject`），锚要跟着列表重排走。曾经的
 * 写法把「最近打开」在挂载时固化成 state，保活页从工作台回来读到快照——打开新工程后
 * 横幅滞留老工程（issue 40 a）正是这么来的。
 */
export function sortAnchorId(projects: readonly SortableProject[], key: ProjectSortKey): string | null {
  let best: SortableProject | null = null;
  for (const p of projects) {
    if (!best || anchorBeats(p, best, key)) best = p;
  }
  return best?.id ?? null;
}

/** 与 sortProjects 同构的单项比较：锚度量 → lastOpened → id（保证锚 = 展示序的头）。 */
function anchorBeats(a: SortableProject, b: SortableProject, key: ProjectSortKey): boolean {
  const byMetric = projectTimeAt(a, key) - projectTimeAt(b, key);
  if (byMetric !== 0) return byMetric > 0;
  const byOpened = a.lastOpened - b.lastOpened;
  if (byOpened !== 0) return byOpened > 0;
  return a.id < b.id;
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
