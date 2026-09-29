// issue 19 #4：启动台排序纯函数（四键 + 派生口径 + 并列回退）。
import { describe, expect, it } from 'vitest';
import {
  mostRecentlyOpenedId,
  normalizeProjectSortKey,
  projectLastModified,
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
