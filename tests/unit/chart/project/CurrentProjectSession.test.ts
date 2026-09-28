// chart-projects 03 / 20：当前工程会话。ensure 按选工程规则落盘；open 切工程并刷新 lastOpened；
// issue 20 起当前工程跨刷新存活（指针注入内存实现，测试不碰真 localStorage）。
import { describe, expect, it } from 'vitest';
import { ChartProjectStore, type ChartProject, type ChartProjectBackend } from '@/src/chart/project/ChartProject';
import { CurrentProjectSession } from '@/src/chart/project/CurrentProjectSession';
import {
  CURRENT_PROJECT_POINTER_KEY,
  loadCurrentProjectPointer,
  saveCurrentProjectPointer,
  type PointerStorage,
} from '@/src/chart/project/currentProjectPointer';
import { createUnnamedProject } from '@/src/chart/project/workspaceProject';
import type { ChartNote } from '@/src/chart/types';

/** 内存版指针存储。 */
function memPointer(): PointerStorage {
  let data: string | null = null;
  return {
    getItem: (k) => (k === CURRENT_PROJECT_POINTER_KEY ? data : null),
    setItem: (k, v) => { if (k === CURRENT_PROJECT_POINTER_KEY) data = v; },
    removeItem: (k) => { if (k === CURRENT_PROJECT_POINTER_KEY) data = null; },
  };
}

class MemoryBackend implements ChartProjectBackend {
  readonly data = new Map<string, ChartProject>();
  async get(id: string): Promise<ChartProject | null> {
    return this.data.get(id) ?? null;
  }
  async save(project: ChartProject): Promise<void> {
    this.data.set(project.id, project);
  }
  async list(): Promise<ChartProject[]> {
    return [...this.data.values()];
  }
  async delete(id: string): Promise<void> {
    this.data.delete(id);
  }
}

function sessionOf(backend: MemoryBackend, now = 1_700_000_000_000, pointer: PointerStorage | null = null) {
  let n = 0;
  return new CurrentProjectSession(new ChartProjectStore(backend), {
    now: () => now,
    newProjectId: () => `pNew${++n}`,
    newChartId: () => `cNew${n}`,
  }, pointer);
}

const bpm: ChartNote = { type: 'BPM', beat: 0, bpm: 120 };

function saved(overrides: Partial<ChartProject> & Pick<ChartProject, 'id' | 'lastOpened'>): ChartProject {
  return createUnnamedProject({ id: overrides.id, chartId: `c-${overrides.id}`, now: overrides.lastOpened });
}

describe('CurrentProjectSession · ensure', () => {
  it('无工程 → 新建未命名工程并立即落盘', async () => {
    const backend = new MemoryBackend();
    const session = sessionOf(backend);
    const result = await session.ensure();
    expect(result.created).toBe(true);
    expect(result.project.id).toBe('pNew1');
    expect(result.project.name).toBeNull();
    expect(result.chart.diff).toBe(3);
    const stored = await backend.get('pNew1');
    expect(stored).not.toBeNull();
    expect(stored!.charts[0].diff).toBe(3);
    expect(session.projectId).toBe('pNew1');
  });

  it('已有当前工程则不再新建', async () => {
    const backend = new MemoryBackend();
    const session = sessionOf(backend);
    await session.ensure();
    const second = await session.ensure();
    expect(second.created).toBe(false);
    expect(second.project.id).toBe('pNew1');
    expect(backend.data.size).toBe(1);
  });

  it('只有已完成工程 → 新建并落盘', async () => {
    const backend = new MemoryBackend();
    const done = saved({ id: 'done1', lastOpened: 50 });
    done.charts[0].completed = true;
    await backend.save(done);
    const session = sessionOf(backend);
    const result = await session.ensure();
    expect(result.created).toBe(true);
    expect(result.project.id).toBe('pNew1');
    expect(backend.data.size).toBe(2);
  });

  it('并发 ensure 只新建一个工程', async () => {
    const backend = new MemoryBackend();
    const session = sessionOf(backend);
    const [a, b] = await Promise.all([session.ensure(), session.ensure()]);
    expect(a.project.id).toBe(b.project.id);
    expect(backend.data.size).toBe(1);
  });
});

describe('CurrentProjectSession · open', () => {
  it('切到指定工程并记下当前谱面', async () => {
    const backend = new MemoryBackend();
    const src = saved({ id: 'songA', lastOpened: 1 });
    src.charts.push({
      ...src.charts[0],
      id: 'cHard',
      diff: 2,
      notes: [bpm, { type: 'Single', beat: 4, lane: 1 }],
    });
    await backend.save(src);
    const session = sessionOf(backend, 80);
    const result = await session.open('songA', 'cHard');
    expect(result.project.id).toBe('songA');
    expect(result.chart.id).toBe('cHard');
    expect(session.chartId).toBe('cHard');
    expect((await backend.get('songA'))!.lastOpened).toBe(80);
  });
});

describe('CurrentProjectSession · 当前工程跨刷新（issue 20）', () => {
  it('有指针 → 首次 ensure 直接恢复该工程（不选"最近未完成"、不新建）', async () => {
    const backend = new MemoryBackend();
    const done = saved({ id: 'pDone', lastOpened: 10 });
    done.charts[0].completed = true; // 已完成也照样回到它（用户 2026-09-28 定案）
    await backend.save(done);
    await backend.save(saved({ id: 'pOpen', lastOpened: 999 })); // 更近的未完成工程不该被选

    const pointer = memPointer();
    saveCurrentProjectPointer({ projectId: 'pDone', chartId: 'c-pDone' }, pointer);
    const session = sessionOf(backend, 100, pointer);

    expect(session.projectId).toBe('pDone'); // 启动首帧（React 初始化）就有当前工程
    const result = await session.ensure();
    expect(result.created).toBe(false);
    expect(result.project.id).toBe('pDone');
    expect(result.chart.id).toBe('c-pDone');
    expect(backend.data.size).toBe(2); // 没有多建工程
  });

  it('指针指向已删工程 → 清指针并回落既有规则', async () => {
    const backend = new MemoryBackend();
    await backend.save(saved({ id: 'pAlive', lastOpened: 10 }));
    const pointer = memPointer();
    saveCurrentProjectPointer({ projectId: 'pGone', chartId: null }, pointer);

    const session = sessionOf(backend, 100, pointer);
    const result = await session.ensure();

    expect(result.project.id).toBe('pAlive'); // 最近未完成
    // 陈旧指针被真实当前工程改写（回落走的 open 会写指针）
    expect(loadCurrentProjectPointer(pointer)).toEqual({ projectId: 'pAlive', chartId: 'c-pAlive' });
  });

  it('恢复的 chartId 不在工程里 → 回退到该工程的第一张谱面并把指针改写', async () => {
    const backend = new MemoryBackend();
    await backend.save(saved({ id: 'pA', lastOpened: 10 }));
    const pointer = memPointer();
    saveCurrentProjectPointer({ projectId: 'pA', chartId: 'cGhost' }, pointer);

    const result = await sessionOf(backend, 100, pointer).ensure();
    expect(result.chart.id).toBe('c-pA');
    expect(loadCurrentProjectPointer(pointer)).toEqual({ projectId: 'pA', chartId: 'c-pA' });
  });

  it('open / 新建都会写指针；reset 清指针', async () => {
    const backend = new MemoryBackend();
    await backend.save(saved({ id: 'pA', lastOpened: 1 }));
    const pointer = memPointer();
    const session = sessionOf(backend, 50, pointer);

    await session.open('pA');
    expect(loadCurrentProjectPointer(pointer)).toEqual({ projectId: 'pA', chartId: 'c-pA' });

    session.reset();
    expect(loadCurrentProjectPointer(pointer)).toBeNull();

    const created = await sessionOf(new MemoryBackend(), 60, pointer).ensure();
    expect(loadCurrentProjectPointer(pointer)).toEqual({ projectId: created.project.id, chartId: created.chart.id });
  });
});
