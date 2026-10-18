// issue 19 #4：启动台排序纯函数（四键 + 派生口径 + 并列回退）。
// issue 37：列表显示口径（projectTimeAt）——显示必须与排序键同源。
// issue 40：横幅锚（sortAnchorId）——锚同样跟随排序键，活派生不固化。
import { describe, expect, it } from 'vitest';
import {
  mostRecentlyOpenedId,
  normalizeProjectSortKey,
  projectLastModified,
  projectTimeAt,
  sortAnchorId,
  sortProjects,
} from '@/src/project/projectSort';

const untitled = '未命名工程';

function project(id: string, name: string | null, lastOpened: number, lastModifieds: number[]) {
  return { id, name, lastOpened, charts: lastModifieds.map((n, i) => ({ id: `${id}-c${i}`, lastModified: n })) };
}

// 四个键互有胜负（保证每个键的期望序都不同，测不出"只实现了 lastOpened"的假绿）
const PROJECTS = [
  project('p1', 'Zulu', 200, [500]),
  project('p2', 'Alpha', 300, [100, 100, 100]),
  project('p3', 'Mike', 100, [900, 900]),
];

describe('sortProjects · 四键（issue 19 #4）', () => {
  it('最近打开（默认键）：lastOpened 降序', () => {
    expect(sortProjects(PROJECTS, 'lastOpened', untitled).map((p) => p.id)).toEqual(['p2', 'p1', 'p3']);
  });

  it('最近修改：派生 max(charts.lastModified) 降序', () => {
    expect(sortProjects(PROJECTS, 'lastModified', untitled).map((p) => p.id)).toEqual(['p3', 'p1', 'p2']);
  });

  it('谱面数量：charts.length 降序', () => {
    expect(sortProjects(PROJECTS, 'chartCount', untitled).map((p) => p.id)).toEqual(['p2', 'p3', 'p1']);
  });

  it('工程名称：按显示名升序（未命名按「未命名工程」参与）', () => {
    expect(sortProjects(PROJECTS, 'name', untitled).map((p) => p.id)).toEqual(['p2', 'p3', 'p1']);
    // 两个未命名 → 同名，回退最近打开（不靠 localeCompare 的返回值碰运气）
    const anon = [project('a1', null, 1, []), project('a2', '   ', 2, [])];
    expect(sortProjects(anon, 'name', untitled).map((p) => p.id)).toEqual(['a2', 'a1']);
  });

  it('时间 / 数量并列 → 回退最近打开；再相同按 id，顺序确定', () => {
    const sameOpened = [project('b', 'B', 100, [7]), project('a', 'A', 100, [7])];
    expect(sortProjects(sameOpened, 'lastModified', untitled).map((p) => p.id)).toEqual(['a', 'b']);
    expect(sortProjects(sameOpened, 'chartCount', untitled).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('不改原数组', () => {
    const before = PROJECTS.map((p) => p.id);
    sortProjects(PROJECTS, 'lastModified', untitled);
    expect(PROJECTS.map((p) => p.id)).toEqual(before);
  });
});

describe('projectLastModified / mostRecentlyOpenedId（派生口径）', () => {
  it('projectLastModified 取最大值；无谱面回 0', () => {
    expect(projectLastModified(PROJECTS[2])).toBe(900);
    expect(projectLastModified(project('empty', 'E', 1, []))).toBe(0);
  });

  it('mostRecentlyOpenedId：取 lastOpened 最大者；空列表回 null', () => {
    expect(mostRecentlyOpenedId(PROJECTS)).toBe('p2');
    expect(mostRecentlyOpenedId([])).toBeNull();
  });

  it('normalizeProjectSortKey：白名单外 / 非字符串回落默认', () => {
    expect(normalizeProjectSortKey('chartCount')).toBe('chartCount');
    expect(normalizeProjectSortKey('sideways')).toBe('lastOpened');
    expect(normalizeProjectSortKey(undefined)).toBe('lastOpened');
    expect(normalizeProjectSortKey(3)).toBe('lastOpened');
    expect(normalizeProjectSortKey('nope', 'name')).toBe('name');
  });
});

// 四键各自显示哪个时间戳（issue 37）：时间键 → 该键时间，其余 → lastOpened。
// 撤掉 lastModified 分支（一律回落 lastOpened）→ 第一条红；把 chartCount / name
// 也接到派生时间上 → 第三条红。PROJECTS 里每个工程的两个时间都不同（如 p3：900/100），
// 不存在"两支返回同值所以测不出"的假绿。
describe('projectTimeAt · 列表显示口径跟随排序键（issue 37）', () => {
  it('lastModified 键 → 派生修改时间 max(charts.lastModified)', () => {
    expect(projectTimeAt(PROJECTS[2], 'lastModified')).toBe(900);
    expect(projectTimeAt(PROJECTS[0], 'lastModified')).toBe(500);
  });

  it('lastOpened 键 → lastOpened', () => {
    expect(projectTimeAt(PROJECTS[2], 'lastOpened')).toBe(100);
    expect(projectTimeAt(PROJECTS[0], 'lastOpened')).toBe(200);
  });

  it('chartCount / name 键 → 回落 lastOpened（顺序不像时间序，时间仍显示打开时间）', () => {
    expect(projectTimeAt(PROJECTS[2], 'chartCount')).toBe(100);
    expect(projectTimeAt(PROJECTS[2], 'name')).toBe(100);
  });
});

// 横幅锚（issue 40 定案 A）：时间键取该键的头，其余键回落最近打开。
// 活派生——打开工程把 lastOpened 写成 now，锚要跟着走（曾经的挂载快照 = issue 40 a 根因）。
describe('sortAnchorId · 横幅锚跟随排序键（issue 40）', () => {
  it('lastOpened → 最近打开；lastModified → 最近修改（派生口径）', () => {
    expect(sortAnchorId(PROJECTS, 'lastOpened')).toBe('p2');
    expect(sortAnchorId(PROJECTS, 'lastModified')).toBe('p3');
  });

  it('chartCount / name → 回落最近打开（非时间排序不改 resume 语义，定案 A）', () => {
    expect(sortAnchorId(PROJECTS, 'chartCount')).toBe(mostRecentlyOpenedId(PROJECTS));
    expect(sortAnchorId(PROJECTS, 'name')).toBe(mostRecentlyOpenedId(PROJECTS));
  });

  it('空列表回 null', () => {
    expect(sortAnchorId([], 'lastOpened')).toBeNull();
  });

  it('时间键：锚 = 展示序的头（并列回退 lastOpened → id，逐条同 sortProjects）', () => {
    const tied = [project('b', 'B', 100, [7]), project('a', 'A', 100, [7])];
    for (const key of ['lastOpened', 'lastModified'] as const) {
      expect(sortAnchorId(tied, key)).toBe(sortProjects(tied, key, untitled)[0].id);
    }
    // lastOpened 并列 → 按 id 定（'a'），不是数组首位 'b'：与 mostRecentlyOpenedId 的
    // 「首个最大值」**有意分歧**——锚必须确定且 = 展示序的头，不跟入库次序飘
    expect(sortAnchorId(tied, 'lastOpened')).toBe('a');
    expect(mostRecentlyOpenedId(tied)).toBe('b');
    // 修改时间并列 → 回退最近打开的 y（200 > 100）；不能碰运气取数组首位 x
    const openedTie = [project('x', 'X', 100, [7]), project('y', 'Y', 200, [7])];
    expect(sortAnchorId(openedTie, 'lastModified')).toBe('y');
    expect(sortProjects(openedTie, 'lastModified', untitled)[0].id).toBe('y');
  });
});
