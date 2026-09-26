// chart-projects 03：当前工程会话。ensure 按选工程规则落盘；open 切工程并刷新 lastOpened。
import { describe, expect, it } from 'vitest';
import { ChartProjectStore, type ChartProject, type ChartProjectBackend } from '@/src/chart/project/ChartProject';
import { CurrentProjectSession } from '@/src/chart/project/CurrentProjectSession';
import { createUnnamedProject } from '@/src/chart/project/workspaceProject';
import type { ChartNote } from '@/src/chart/types';

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

function sessionOf(backend: MemoryBackend, now = 1_700_000_000_000) {
  let n = 0;
  return new CurrentProjectSession(new ChartProjectStore(backend), {
    now: () => now,
    newProjectId: () => `pNew${++n}`,
    newChartId: () => `cNew${n}`,
  });
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
