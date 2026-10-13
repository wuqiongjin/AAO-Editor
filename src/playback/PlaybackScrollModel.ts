// 播放滚动模型（架构深化评审候选 1，2026-08-29）：把「判定线此刻对应第几秒」这条命脉
// 从 2 组件 + 2 纯模块 + ref 协议 收敛为单一深模块。
//
// 之前（Before）：
//   - Editor.tsx 拥有 RAF 循环 / 滚动条 onScroll / 两个重锚 effect / 4 个滚动 ref；
//   - FinalVirtualCanvas.tsx 经 imperative ref 暴露 6 个 秒↔scrollY 数学方法；
//   - 数学本身散在 ChartGeometry（beat↔virtualY）与 AudioTiming（秒↔beat）。
// 理解「此刻第几秒」要跳 4 个文件，且无法脱离 DOM/RAF/ref 单测。
//
// 现在（After）：
//   - 本模块 = 唯一实现 seconds↔scrollY↔滚动条 映射 + 按秒重锚状态机 + 有效缩放钳制；
//   - Editor 只把本模块的结果【应用到 DOM】（scrollTop）与【让画布跟随】（setScrollY）；
//   - FinalVirtualCanvas 的 imperative handle 收窄到 setScrollY + 起点标记（无秒↔scrollY 数学）。
//
// 坐标系不变量（ADR-0004 §1 + ADR-0006 §2 + ADR-0010 结论 3/4）：
//   判定线 = 画布【底边】= 虚拟 Y surface.h/scale（渲染面底边）。
//   scrollY ∈ [0, chartEndVirtualY]：
//     scrollY = 0            → 判定线处 = 谱面末端（最顶端）
//     scrollY = chartEndY    → 判定线处 = beat 0（最底端）
//   **issue 104 修法 5：秒 ↔ scrollY 改为纯线性**（`scrollY = chartEndVirtualY − 秒 × 像素密度`），
//   不再借道「秒 → 拍 → 像素」——倒流区里「秒 → 拍」多值，借道必然取到错层的拍（滚动会跳）。
//   像素密度 = `geometry.virtualPxPerSecond`（与 bpm 无关的常数），故两条映射严格互逆。
//
// 纯逻辑：只依赖注入的 ChartGeometry + 用户缩放 scale，node 环境可单测。
import type { ChartGeometry } from '../chart/geometry/ChartGeometry';

export interface ReAnchorTarget {
  /** 画布虚拟 scrollY（判定线处=锚点秒）。 */
  scrollY: number;
  /** 滚动条 DOM scrollTop（scrollY 经滚动范围映射到 [0, maxScroll]）。 */
  scrollTop: number;
}

/** 谱面实际可滚范围（ADR-0004 §3 修订：滚动条只覆盖谱面长度，无空白）。 */
export interface ScrollRange {
  top: number;
  bottom: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class PlaybackScrollModel {
  private geometry: ChartGeometry;
  private scale: number;

  // 按秒重锚状态机（issue 24 三段式，从 Editor 的 4 个 ref 收敛）：
  private initialized = false;      // 首次虚拟高度就绪并初始滚动后才允许重锚
  private playing = false;          // 播放中 RAF 独占滚动，重锚让位
  private anchorSeconds = 0;        // 「判定线处秒数」实时锚点
  private pendingAnchorKey: string | null = null; // 待重锚标记（chartEndKey）
  private lastChartEndKey: string | null = null;  // 最近注入的末端 key（issue 166 RC-1：置位与几何同帧）

  constructor(geometry: ChartGeometry, scale: number) {
    this.geometry = geometry;
    this.scale = scale;
  }

  /**
   * 谱面/时长/渲染面/缩放变化时注入新几何与缩放（同实例，状态机状态保留）。
   *
   * issue 166 RC-1：**置位待重锚与几何注入同帧**。此前置位挂在消费方的 effect 上，而子画布
   * 的上报（"几何已新 + scrollY 仍旧"）实测会抢在它前面执行 —— 那时 pending 还是 null，
   * `noteScrollObserved` 便把锚点从 0 刷成了 `(新末端 − 旧scrollY) / 密度` 秒
   * （冷启动 30s → 120s 实测刷成 90s），随后的按秒重锚就"忠实"地把视图钉在这个假秒数上。
   * @param chartEndKey 末端变化源 key；给值时按"与上次不同"置位待重锚（幂等）
   */
  configure(geometry: ChartGeometry, scale: number, chartEndKey?: string): void {
    this.geometry = geometry;
    this.scale = scale;
    if (chartEndKey != null && chartEndKey !== this.lastChartEndKey) {
      this.lastChartEndKey = chartEndKey;
      this.noteChartEndChange(chartEndKey);
    }
  }

  // ---------------- 三域互映：seconds ↔ scrollY ↔ scrollTop ----------------

  /** 谱面末端虚拟高度 = 可滚 scrollY 上限（= 原 getVirtualHeight / getMaxScrollY 的钳制上界）。 */
  maxCanvasScrollY(): number {
    return this.geometry.chartEndVirtualY;
  }

  /** 判定线=画布底边：scrollY=0 时判定线在末端，scrollY=chartEndY 时判定线在 beat0。 */
  scrollYForSeconds(seconds: number): number {
    const raw = this.geometry.chartEndVirtualY - seconds * this.geometry.virtualPxPerSecond;
    return clamp(raw, 0, this.maxCanvasScrollY());
  }

  /** scrollY → 判定线处秒数（与 scrollYForSeconds 互逆，纯线性）。 */
  secondsForScrollY(scrollY: number): number {
    const clamped = clamp(scrollY, 0, this.maxCanvasScrollY());
    const density = this.geometry.virtualPxPerSecond;
    if (!(density > 0)) return 0; // 退化几何（纵向比例 0）→ 不给 NaN/Infinity
    return (this.geometry.chartEndVirtualY - clamped) / density;
  }

  /**
   * 秒 → { 画布 scrollY, 滚动条 scrollTop }（issue 75：RAF 循环与 `seek()` **共用同一口径**）。
   * 此前 `seek()` 只推画布、不同步 DOM scrollTop，两个真相源分裂（画布=B、滚动条=A），
   * 下一次滚动事件便用陈旧的 A 位 scrollTop 反算 scrollY → 画布跳回旧位置。
   */
  scrollTargetForSeconds(seconds: number, maxScroll: number): ReAnchorTarget {
    const scrollY = this.scrollYForSeconds(seconds);
    return { scrollY, scrollTop: this.canvasScrollYToScrollTop(scrollY, maxScroll) };
  }

  /** 谱面实际可滚范围（top=末端、bottom=起点，无空白）。 */
  scrollRange(): ScrollRange {
    const bottom = this.maxCanvasScrollY();
    return { top: 0, bottom };
  }

  /** 虚拟总高（scrollHeight 基准，Editor 的 .virtual-content 高度）。 */
  virtualHeight(): number {
    return this.geometry.totalVirtualHeight(this.scale);
  }

  /** 滚动条 DOM scrollTop → 画布虚拟 scrollY（ADR-0004 §3 修订：按谱面实际范围线性映射）。 */
  scrollTopToCanvasScrollY(scrollTop: number, maxScroll: number): number {
    if (maxScroll <= 0) return 0;
    const { top, bottom } = this.scrollRange();
    if (scrollTop >= maxScroll - 1) return bottom; // 末 1px 与 seek(0) 同为 chartEnd
    const span = Math.max(1, bottom - top);
    const ratio = clamp(scrollTop / maxScroll, 0, 1);
    return top + ratio * span;
  }

  /** 画布虚拟 scrollY → 滚动条 DOM scrollTop（scrollTopToCanvasScrollY 互逆）。 */
  canvasScrollYToScrollTop(scrollY: number, maxScroll: number): number {
    if (maxScroll <= 0) return 0;
    const { top, bottom } = this.scrollRange();
    const span = Math.max(1, bottom - top);
    const ratio = clamp((scrollY - top) / span, 0, 1);
    return ratio * maxScroll;
  }

  // ---------------- 有效缩放钳制（issue 38 / ADR-0006 Q4=A） ----------------

  /** 有效缩放 = min(用户 scale, fitWidth(surface.w))，委托 ChartGeometry 单一实现。 */
  effectiveScale(): number {
    return this.geometry.effectiveScale(this.scale);
  }

  // ---------------- 按秒重锚状态机（issue 24） ----------------

  markInitialized(): void { this.initialized = true; }
  setPlaying(v: boolean): void { this.playing = v; }
  /** 当前锚点秒数（供诊断/回写）。 */
  getAnchorSeconds(): number { return this.anchorSeconds; }

  /**
   * issue 166：「打开 / 恢复谱面 → 视口归零到 beat 0」的模型侧落点。
   * 与按秒重锚的语义相反（重锚 = 保留当前秒，ADR/issue 24 定案），故这里直接把锚点归 0
   * 并**丢弃**待重锚 —— 否则重锚会用（被污染或过期的）旧锚点把视图拉回非开头位置。
   */
  resetAnchorToStart(): void {
    this.anchorSeconds = 0;
    this.pendingAnchorKey = null;
  }

  /** 谱面末端变化源（时长/BPM/surface）变化时置位待重锚。
   *  未初始化或播放中不置位（播放中 RAF 独占滚动）。 */
  noteChartEndChange(chartEndKey: string): void {
    if (!this.initialized || this.playing) return;
    this.pendingAnchorKey = chartEndKey;
  }

  /** 正常浏览/缩放/播放时滚动观察：非待重锚期据此刷新锚点秒数。
   *  待重锚期（pending）时【跳过】——新几何下的 scrollY 不能覆盖旧锚点（否则跳尾）。 */
  noteScrollObserved(scrollY: number): void {
    if (this.pendingAnchorKey == null) {
      this.anchorSeconds = this.secondsForScrollY(scrollY);
    }
  }

  /** virtualHeight 就绪后消费待重锚项：按锚点秒重算 scrollY 与 scrollTop 并清 pending。
   *  返回 null = 无待重锚 / 播放中 / maxScroll 未就绪。
   *  重锚后同步锚点（读回新几何下的实际秒），避免后续观察读到漂移值。 */
  takePendingReAnchor(maxScroll: number): ReAnchorTarget | null {
    if (!this.initialized || this.playing) return null;
    const pending = this.pendingAnchorKey;
    if (pending == null) return null;
    this.pendingAnchorKey = null;
    if (maxScroll <= 0) return null; // 与现实现一致：清 pending 但本次跳过
    const scrollY = this.scrollYForSeconds(this.anchorSeconds);
    const scrollTop = this.canvasScrollYToScrollTop(scrollY, maxScroll);
    this.anchorSeconds = this.secondsForScrollY(scrollY);
    return { scrollY, scrollTop };
  }
}
