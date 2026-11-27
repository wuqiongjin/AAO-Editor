// 票 79 · 「谱师署名」的默认来源与落值时机（ADR-0024 §2 / §3）。
//
// 接缝 = 工程目录的纯函数 + 工程记录映射。会话单例靠 vi.mock 替换，不碰 Electron / 网络。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  account: null as null | { username: string; nickname: string | null },
}));

vi.mock('@/src/community/bestdori/account', () => ({
  getCommunityAccount: () => ({ getSession: () => ({ account: session.account }) }),
}));

import { defaultCharterCredit } from '@/src/project/charterCredit';
import { createUnnamedProject } from '@/src/project/workspaceProject';
import {
  addChartToProject,
  createOfficialProject,
  duplicateChartInProject,
  duplicateProject,
  updateChartCharterCredit,
} from '@/src/project/projectCatalog';
import { projectFromStored, storedFromProject } from '@/src/project/ChartProjectRecord';
import type { ChartProject, ProjectChart } from '@/src/project/ChartProject';

const login = (username: string, nickname: string | null = null) => {
  session.account = { username, nickname };
};

describe('票 79 · 默认谱师署名的来源', () => {
  beforeEach(() => { session.account = null; });

  it('未登录 / 会话未就绪 ⇒ 空；登录 ⇒ nickname ?? username', () => {
    expect(defaultCharterCredit()).toBeNull();
    login('alice');
    expect(defaultCharterCredit()).toBe('alice');
    login('alice', '  Alice  ');
    expect(defaultCharterCredit()).toBe('Alice');
  });

  it('导入社区谱不带帖主 charter：默认仍取当前登录账号名', () => {
    login('alice', 'Alice');
    // createOfficialProject 同时是官方 / 社区两支导入的落点（chartImport.ts）
    const built = createOfficialProject({
      id: 'p2', chartId: 'c2', now: 2,
      name: '某社区帖', artist: '某人', source: { type: 'custom' },
      durationSeconds: 100, audioName: 'a.mp3', coverName: null, diff: 3, level: null,
    });
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.chart.charterCredit).toBe('Alice');
  });
});

describe('票 79 · 只在新建谱面那一刻落值', () => {
  beforeEach(() => { session.account = null; });

  it('空白工程 / 新增谱面都落账号名；换账号 / 登出后已有谱面不回写', () => {
    login('alice', 'Alice');
    const p = createUnnamedProject({ id: 'p1', chartId: 'c1', now: 1 });
    expect(p.charts[0].charterCredit).toBe('Alice');

    const added = addChartToProject(p, {
      title: null, diff: 3, level: null, codeText: '',
    }, { chartId: 'c2', now: 2 });
    expect(added.ok).toBe(true);
    if (added.ok) expect(added.chart.charterCredit).toBe('Alice');

    login('bob');
    expect(p.charts[0].charterCredit).toBe('Alice');
    session.account = null;
    expect(p.charts[0].charterCredit).toBe('Alice');
  });

  it('手动填写优先：填了就用填的，清空就是空', () => {
    login('alice', 'Alice');
    const p = createUnnamedProject({ id: 'p1', chartId: 'c1', now: 1 });
    const named = addChartToProject(p, {
      title: null, diff: 3, level: null, codeText: '', charterCredit: '  A、B  ',
    }, { chartId: 'c2', now: 2 });
    if (!named.ok) throw new Error('闸门不该拒空代码');
    expect(named.chart.charterCredit).toBe('A、B');

    const cleared = addChartToProject(p, {
      title: null, diff: 3, level: null, codeText: '', charterCredit: '',
    }, { chartId: 'c3', now: 3 });
    if (!cleared.ok) throw new Error('闸门不该拒空代码');
    expect(cleared.chart.charterCredit).toBeNull();
  });

  it('老谱面（记录里没这个字段）读回为空 ⇒ 只能手填', () => {
    const p = createUnnamedProject({ id: 'p1', chartId: 'c1', now: 1 });
    const legacy = storedFromProject(p) as unknown as Record<string, unknown>;
    legacy.charts = (legacy.charts as ProjectChart[]).map((c) => {
      const rest: ProjectChart = { ...c };
      delete rest.charterCredit;
      return rest;
    });
    const got = projectFromStored(legacy);
    expect(got?.charts[0].charterCredit).toBeNull();
    expect(updateChartCharterCredit(got!, 'c1', '我自己')!.charts[0].charterCredit).toBe('我自己');
  });
});

describe('票 79 · 复制与已上传谱面', () => {
  it('复制谱面 / 复制工程都带走署名', () => {
    const p = updateChartCharterCredit(
      createUnnamedProject({ id: 'p1', chartId: 'c1', now: 1 }), 'c1', 'A、B',
    );
    const chartCopy = duplicateChartInProject(p, 'c1', { chartId: 'c9', now: 3 }, '未命名工程');
    expect(chartCopy?.charts[1].charterCredit).toBe('A、B');
    const projectCopy = duplicateProject(p, { id: 'p9', chartIds: ['c8'], now: 3 });
    expect(projectCopy.charts[0].charterCredit).toBe('A、B');
  });

  it('已上传谱面（本体只读）仍可改谱师署名，且不碰音符', () => {
    const base = createUnnamedProject({ id: 'p1', chartId: 'c1', now: 1 });
    const uploaded: ChartProject = {
      ...base,
      charts: [{ ...base.charts[0], upload: { postId: 42, at: 1 } }],
    };
    const next = updateChartCharterCredit(uploaded, 'c1', '  A、B  ');
    expect(next.charts[0].charterCredit).toBe('A、B');
    expect(next.charts[0].notes).toBe(uploaded.charts[0].notes);
  });
});
