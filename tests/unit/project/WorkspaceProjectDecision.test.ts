// chart-projects 10：进工作台选工程的**定案**（用户 2026-09-27 Q9）。
//
// 不变量：进工作台 = 打开「最近打开且有未完成谱面」的工程；没有未完成工程才新建未命名工程；
// 新建的未命名工程自带一张未完成的空谱面 → 下次再进工作台就是它，
// 直到它也完成且无其他未完成工程才建下一个。
//
// 与同目录 `workspaceProject.test.ts` 的分工：那份锁 03 定下的规则本身，
// 本份锁 10 的**循环**——create → 落回目录 → 再决策命中它 → 它完成 → 再 create。
// 纯函数，不依赖 08 的 DOM 基建。
import { describe, expect, it } from 'vitest';
import {
  createUnnamedProject,
  decideWorkspaceProject,
  type ProjectPickFields,
} from '@/src/project/workspaceProject';

type ChartState = 'unfinished' | 'completed' | 'uploaded';

function pick(id: string, lastOpened: number, charts: ChartState[]): ProjectPickFields {
  return {
    id,
    lastOpened,
    charts: charts.map((state) => ({
      completed: state === 'completed' || state === 'uploaded',
      upload: state === 'uploaded' ? { postId: 1, at: lastOpened } : null,
    })),
  };
}

describe('进工作台选工程 · 定案（issue 10 / 用户 Q9）', () => {
  it('多个未完成工程 → 打开 lastOpened 最大的那个（与输入顺序无关）', () => {
    const projects = [
      pick('recent', 50, ['unfinished']),
      pick('old', 10, ['unfinished']),
      pick('done', 90, ['completed']),
    ];
    expect(decideWorkspaceProject(projects)).toEqual({ action: 'open', projectId: 'recent' });
    expect(decideWorkspaceProject([...projects].reverse())).toEqual({ action: 'open', projectId: 'recent' });
  });

  it('全是已完成 / 已上传 → 新建', () => {
    const projects = [pick('done', 90, ['completed']), pick('up', 80, ['uploaded'])];
    expect(decideWorkspaceProject(projects)).toEqual({ action: 'create' });
  });

  it('新建的未命名工程下次仍被打开：不靠 lastOpened，靠它有一张未完成谱面', () => {
    expect(decideWorkspaceProject([])).toEqual({ action: 'create' });

    const unnamed = createUnnamedProject({ id: 'pNew1', chartId: 'cNew1', now: 1_700_000_000_000 });
    expect(unnamed.charts).toHaveLength(1);
    expect(unnamed.charts[0].completed).toBe(false);
    expect(unnamed.charts[0].upload).toBeNull();

    // 比它更晚打开的工程是已完成的 → 不抢
    const listed = [pick('done', 1_800_000_000_000, ['completed']), unnamed];
    expect(decideWorkspaceProject(listed)).toEqual({ action: 'open', projectId: 'pNew1' });
  });

  it('同一个未命名工程全部谱面完成后，才轮到建下一个', () => {
    const unnamed = createUnnamedProject({ id: 'pNew1', chartId: 'cNew1', now: 1_700_000_000_000 });
    const finished: ProjectPickFields = {
      ...unnamed,
      charts: unnamed.charts.map((c) => ({ ...c, completed: true })),
    };
    expect(decideWorkspaceProject([finished])).toEqual({ action: 'create' });

    const uploaded: ProjectPickFields = {
      ...unnamed,
      charts: unnamed.charts.map((c) => ({ ...c, upload: { postId: 7, at: 1_700_000_001_000 } })),
    };
    expect(decideWorkspaceProject([pick('done', 1_800_000_000_000, ['completed']), uploaded])).toEqual({
      action: 'create',
    });
  });
});
