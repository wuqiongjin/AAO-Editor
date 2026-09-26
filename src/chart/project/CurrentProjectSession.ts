// 当前工程会话（chart-projects 03）：ensure / open 对存储的命令。
// React 层只订阅 projectId / chartId；真正读写走 ChartProjectStore。
import {
  ChartProjectStore,
  newChartId,
  newProjectId,
  type ChartProject,
  type ProjectChart,
} from './ChartProject';
import {
  createUnnamedProject,
  decideWorkspaceProject,
  pickCurrentChart,
} from './workspaceProject';

export interface CurrentProjectClock {
  now: () => number;
  newProjectId: () => string;
  newChartId: () => string;
}

const defaultClock: CurrentProjectClock = {
  now: () => Date.now(),
  newProjectId,
  newChartId,
};

export class CurrentProjectSession {
  private _projectId: string | null = null;
  private _chartId: string | null = null;
  private ensureInFlight: Promise<{
    project: ChartProject;
    chart: ProjectChart;
    created: boolean;
  }> | null = null;
  private readonly store: ChartProjectStore;
  private readonly clock: CurrentProjectClock;

  constructor(store: ChartProjectStore, clock: CurrentProjectClock = defaultClock) {
    this.store = store;
    this.clock = clock;
  }

  get projectId(): string | null {
    return this._projectId;
  }

  get chartId(): string | null {
    return this._chartId;
  }

  async ensure(): Promise<{ project: ChartProject; chart: ProjectChart; created: boolean }> {
    if (this.ensureInFlight) return this.ensureInFlight;
    const pending = this.ensureOnce();
    this.ensureInFlight = pending;
    try {
      return await pending;
    } finally {
      if (this.ensureInFlight === pending) this.ensureInFlight = null;
    }
  }

  private async ensureOnce(): Promise<{ project: ChartProject; chart: ProjectChart; created: boolean }> {
    if (this._projectId) {
      const existing = await this.store.get(this._projectId);
      if (existing) {
        const chart = pickCurrentChart(existing, this._chartId);
        this._chartId = chart.id;
        return { project: existing, chart, created: false };
      }
      this._projectId = null;
      this._chartId = null;
    }
    const listed = await this.store.list();
    const decision = decideWorkspaceProject(listed);
    if (decision.action === 'open') {
      const opened = await this.open(decision.projectId);
      return { ...opened, created: false };
    }
    const project = createUnnamedProject({
      id: this.clock.newProjectId(),
      chartId: this.clock.newChartId(),
      now: this.clock.now(),
    });
    await this.store.save(project);
    const chart = pickCurrentChart(project);
    this._projectId = project.id;
    this._chartId = chart.id;
    return { project, chart, created: true };
  }

  async open(
    projectId: string,
    chartId?: string,
  ): Promise<{ project: ChartProject; chart: ProjectChart }> {
    const loaded = await this.store.get(projectId);
    if (!loaded) throw new Error(`谱面工程不存在: ${JSON.stringify(projectId)}`);
    const now = this.clock.now();
    const project: ChartProject = { ...loaded, lastOpened: now };
    await this.store.save(project);
    const chart = pickCurrentChart(project, chartId);
    this._projectId = project.id;
    this._chartId = chart.id;
    return { project, chart };
  }
}
