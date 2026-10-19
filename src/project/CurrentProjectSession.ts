// 当前工程会话（chart-projects 03 / 20）：ensure / open 对存储的命令。
// React 层只订阅 projectId / chartId；真正读写走 ChartProjectStore。
// issue 20：当前工程跨刷新存活 —— 构造时从本机指针恢复 `{ projectId, chartId }`，
// 每次 open / ensure / 新建后写回，reset（删当前工程）清掉。
import {
  ChartProjectStore,
  newChartId,
  newProjectId,
  type ChartProject,
  type ProjectChart,
} from './ChartProject';
import { mutateProject } from './ChartProjectRecord';
import {
  clearCurrentProjectPointer,
  loadCurrentProjectPointer,
  saveCurrentProjectPointer,
  type PointerStorage,
} from './currentProjectPointer';
import {
  createUnnamedProject,
  decideWorkspaceProject,
  pickCurrentChart,
} from './workspaceProject';
import { trail } from '../diagnostics/trail';

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
  /** 当前工程指针的落盘位；`undefined` = 用默认 localStorage，`null` = 显式禁用（测试用） */
  private readonly pointerStorage: PointerStorage | null | undefined;

  constructor(
    store: ChartProjectStore,
    clock: CurrentProjectClock = defaultClock,
    pointerStorage?: PointerStorage | null,
  ) {
    this.store = store;
    this.clock = clock;
    this.pointerStorage = pointerStorage;
    // 恢复上次会话：工程是否还在，等第一次 ensure / open 向存储核对（构造是同步的）
    const restored = loadCurrentProjectPointer(pointerStorage);
    if (restored) {
      this._projectId = restored.projectId;
      this._chartId = restored.chartId;
    }
  }

  private persistPointer(): void {
    if (!this._projectId) return;
    saveCurrentProjectPointer({ projectId: this._projectId, chartId: this._chartId }, this.pointerStorage);
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
        this.persistPointer();
        return { project: existing, chart, created: false };
      }
      // 恢复的工程已不存在（被删 / 换了机器）→ 清指针，回落既有规则
      this._projectId = null;
      this._chartId = null;
      clearCurrentProjectPointer(this.pointerStorage);
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
    this.persistPointer();
    return { project, chart, created: true };
  }

  async open(
    projectId: string,
    chartId?: string,
  ): Promise<{ project: ChartProject; chart: ProjectChart }> {
    // get → 改 lastOpened → save 属记录侧整记录读-改-写，走唯一写入口（06 票）；
    // 会话自身的指针写入仍在下面 persistPointer。
    const now = this.clock.now();
    try {
      const result = await mutateProject({ store: this.store }, projectId, (loaded) => ({ ...loaded, lastOpened: now }));
      if (result.status !== 'saved') throw new Error(`谱面工程不存在: ${JSON.stringify(projectId)}`);
      const project: ChartProject = result.project;
      const chart = pickCurrentChart(project, chartId);
      this._projectId = project.id;
      this._chartId = chart.id;
      this.persistPointer();
      trail.record({ module: 'project', action: 'open', result: 'ok', meta: { projectId: project.id } });
      return { project, chart };
    } catch (err) {
      trail.record({ module: 'project', action: 'open', result: 'fail', meta: { projectId } });
      throw err;
    }
  }

  /** 删除当前工程后卸会话；进工作台会再 ensure。指针一并清掉（issue 20）。 */
  reset(): void {
    this._projectId = null;
    this._chartId = null;
    clearCurrentProjectPointer(this.pointerStorage);
  }
}

/**
 * 切数据根后的会话校验（chart-projects 39）：当前工程 id 不在新目录的列表里 → 该重置。
 *
 * 不重置的后果不是"列表显示旧"这么轻：会话的内存指针还指着**旧根**的工程，
 * 工作台的在飞防抖会把旧根内容写进新目录（38 的激活 flush 先写后读），
 * 且新目录没有这个 id 时工作台状态悬空。同目录重新认领时列表里当然还有它，不会误重置。
 */
export function shouldResetSessionAfterDataRootSwitch(
  projectId: string | null,
  listed: readonly { id: string }[],
): boolean {
  return projectId != null && !listed.some((p) => p.id === projectId);
}
