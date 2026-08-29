// 渲染面尺寸合并状态机（候选 2 / issue 36 / issue 38）：
// 提取自 Editor.tsx 内 70 行的 ResizeObserver burst/stream/trail 合并逻辑。
// 抽成纯逻辑以便在 node 环境单测——不再依赖 React / DOM，Editor 套个薄 hook 即可复用。
//
// 关键不变量（保留 issue 36 / 38 修订）：
//   1) 退化尺寸（w<=0 或 h<=0，例如 display:none）直接跳过，不提交、不推进突发/尾随状态
//      ——切回工作台页时真实容器尺寸会覆盖，提交会触发轨道横向拉宽一帧再回归。
//   2) 已生效值（key 一致）不重复提交。
//   3) 与上一回调间隔 ≥ SPARSE_GAP_MS 视为新的独立离散事件，立即应用最新值。
//   4) 连续回调持续 ≥ STREAM_MS 定性为持续缩放流，不再逐条应用，交由尾部结算最新值。
//   5) 事件/流停止后 TRAIL_MS 结算一次最新值。
import { DEFAULT_SURFACE, type SurfaceSize } from './ChartGeometry';

export interface SurfaceSizeMergerConfig {
  /** 与上一回调间隔 ≥ 此值视为新的独立离散事件（默认 100ms） */
  sparseGapMs?: number;
  /** 密集持续 ≥ 此值定性为连续缩放流（默认 150ms） */
  streamMs?: number;
  /** 事件/流停止后结算一次最新值的等待时间（默认 150ms） */
  trailMs?: number;
  /** 退化尺寸阈值（任一维度 ≤ 此值即跳过；默认 0） */
  degenerateThreshold?: number;
  /** 时间源（默认 performance.now，可注入以单测） */
  now?: () => number;
  /** 提交副作用（默认 console.log；接入时改为 setState） */
  onCommit?: (value: SurfaceSize) => void;
}

const DEFAULT_CONFIG: Required<Omit<SurfaceSizeMergerConfig, 'now' | 'onCommit'>> = {
  sparseGapMs: 100,
  streamMs: 150,
  trailMs: 150,
  degenerateThreshold: 0,
};

export class SurfaceSizeMerger {
  private readonly sparseGapMs: number;
  private readonly streamMs: number;
  private readonly trailMs: number;
  private readonly degenerateThreshold: number;
  private readonly now: () => number;
  private readonly onCommit: (value: SurfaceSize) => void;

  // 状态机
  private lastCommittedKey = '';
  private lastCommitted: SurfaceSize = DEFAULT_SURFACE;
  private lastValue: SurfaceSize = { w: 0, h: 0 };
  private lastCallbackAt = 0;
  private burstStartAt = 0;
  private trailTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(config: SurfaceSizeMergerConfig = {}) {
    this.sparseGapMs = config.sparseGapMs ?? DEFAULT_CONFIG.sparseGapMs;
    this.streamMs = config.streamMs ?? DEFAULT_CONFIG.streamMs;
    this.trailMs = config.trailMs ?? DEFAULT_CONFIG.trailMs;
    this.degenerateThreshold = config.degenerateThreshold ?? DEFAULT_CONFIG.degenerateThreshold;
    this.now = config.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.onCommit = config.onCommit ?? (() => {});
  }

  /** 当前已提交值（state machine 的对外可读状态，供 hook 初次渲染用） */
  getCommitted(): SurfaceSize {
    return this.lastCommitted;
  }

  /** 喂入一次 ResizeObserver 回调（已做 contentRect 提取的尺寸，单测可直接传） */
  feed(raw: { w: number; h: number }): void {
    if (this.destroyed) return;
    const next = { w: Math.round(raw.w), h: Math.round(raw.h) };
    const key = `${next.w}x${next.h}`;
    // 退化尺寸：跳过、不推进状态
    if (next.w <= this.degenerateThreshold || next.h <= this.degenerateThreshold) return;
    // 已生效：忽略
    if (key === this.lastCommittedKey) return;
    this.lastValue = next;
    const now = this.now();
    const dense = now - this.lastCallbackAt < this.sparseGapMs;
    if (!dense) this.burstStartAt = now;
    // 前沿：离散事件或突发早期 → 立即应用最新值
    if (!dense || now - this.burstStartAt < this.streamMs) {
      this.commit(next);
    }
    this.lastCallbackAt = now;
    // 持续流停止后由尾随结算最新值
    if (this.trailTimer !== null) clearTimeout(this.trailTimer);
    this.trailTimer = setTimeout(() => {
      this.trailTimer = null;
      this.commit(this.lastValue);
    }, this.trailMs);
  }

  /** 手动 flush 尾随值（卸载/手动立即结算） */
  flush(): void {
    if (this.trailTimer !== null) {
      clearTimeout(this.trailTimer);
      this.trailTimer = null;
      this.commit(this.lastValue);
    }
  }

  /** 卸载：清尾随 timer + 标记销毁 */
  destroy(): void {
    this.destroyed = true;
    if (this.trailTimer !== null) {
      clearTimeout(this.trailTimer);
      this.trailTimer = null;
    }
  }

  private commit(value: SurfaceSize): void {
    const key = `${value.w}x${value.h}`;
    if (key === this.lastCommittedKey) return;
    this.lastCommittedKey = key;
    this.lastCommitted = value;
    this.onCommit(value);
  }
}
