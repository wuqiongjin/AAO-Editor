// ChartProjectPersistenceMerger（候选 2 / ADR-0005 §6）：谱面持久化防抖纯逻辑。
// 拆出 useChartProjectPersistence 内 800ms 防抖 timer 行为，以便单测边界（多次快速编辑只落盘一次）。
//
// 行为保持：
//   - schedule(project) 安排一次落盘，多次 schedule 重置 timer（仅最后一次落盘）
//   - saveNow(project) 立即落盘 + 取消 pending timer
//   - flush(project) 同 saveNow（语义统一；让调用方语义自洽）
//   - save 失败静默（catch 吞，幂等落盘；下次编辑自然触发重试）
//   - destroy 清 timer + 停止 schedule
export interface ChartProjectPersistenceMergerConfig {
  /** 防抖落盘延迟（默认 800ms，ADR-0005 §6） */
  debounceMs?: number;
  /** 实际落盘副作用（store.save）；测试可注入假实现 */
  save: (project: import('./ChartProject').ChartProject) => Promise<void>;
}

export class ChartProjectPersistenceMerger {
  private readonly debounceMs: number;
  private readonly save: (project: import('./ChartProject').ChartProject) => Promise<void>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(config: ChartProjectPersistenceMergerConfig) {
    this.debounceMs = config.debounceMs ?? 800;
    this.save = config.save;
  }

  /** 安排一次落盘（多次 schedule 重置 timer，仅最后一次落盘） */
  schedule(project: import('./ChartProject').ChartProject): void {
    if (this.destroyed) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.save(project);
    }, this.debounceMs);
  }

  /** 立即落盘（取最新 project） + 取消 pending timer */
  async saveNow(project: import('./ChartProject').ChartProject): Promise<void> {
    if (this.destroyed) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.save(project);
  }

  /** 同 saveNow，语义统一（让"卸载前 flush"路径表达一致） */
  flush(project: import('./ChartProject').ChartProject): Promise<void> {
    return this.saveNow(project);
  }

  /** 是否已销毁（调用方据此重建，避免把 schedule/saveNow 打在死实例上）——issue 64 */
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** 卸载：清 timer + 标记销毁 */
  destroy(): void {
    this.destroyed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
