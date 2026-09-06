// 谱面画布几何（纯逻辑，node 环境可单测）。
// ADR-0003 候选 B：把 FinalVirtualCanvas 里"坐标变换 / 视口剔除 / 音符定位"从组件中
// 抽成可测深厚模块；BPM→虚拟Y 用 BpmTimeline（候选 C）单一实现并缓存，避免每帧全量分段累加。
//
// 坐标系（issue 11）：虚拟坐标（X 原点=轨道内容左缘，Y 自下而上、beat 0 在判定线）↔ 画布坐标。
import type { ChartNote } from '../types';
import { BpmTimeline, type BpmTimelineEvent } from './BpmTimeline';

export const LANES = 7;
export const BEAT_HEIGHT = 220; // 基准节拍高度
export const LANE_WIDTH = 30;
// issue 50：渲染面无默认值。ResizeObserver 必须先回调才能构造 ChartGeometry（语义诚实）。
// 旧的 DEFAULT_SURFACE / CANVAS_WIDTH / CANVAS_HEIGHT 已删除（grep 确认外部无引用）。
export const CANVAS_ASPECT = 5 / 6; // 画布宽高比（FinalVirtualCanvas min 维度算法用）
// 判定线（ADR-0004 §1 + ADR-0006 §2 修订 + issue 50 删除绘制）：不再有视觉判定线；音符越过 chartArea 底边即被判定。
// 轨道外壳/chrome 总宽度（原 12 处魔法表达式 (1+4+1+1+1+1) 收敛；轨道左右各一份）
export const TRACK_CHROME_TOTAL = 1 + 4 + 1 + 1 + 1 + 1;
// 视口剔除的上下左右外扩（虚拟单位）
export const VIEWPORT_PADDING = 200;
// 最小缩放（防止过窄渲染面下 fitWidth 为负导致 scale 非法）
const MIN_SCALE = 0.1;

/** 渲染面尺寸（CSS 像素）：画布缓冲 = surface × dpr（ADR-0006 §1） */
export interface SurfaceSize {
  w: number;
  h: number;
}

export interface GeometryViewport {
  scrollX: number;
  scrollY: number;
  scale: number;
}

export interface GeometryPoint {
  x: number;
  y: number;
}

export interface GeometryBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * 谱面画布几何：构造时预计算 BPM→虚拟Y 像素时间线（仅依赖 BPM 事件与谱面末端，与缩放/滚动无关），
 * 查询用二分缓存；缩放/滚动相关的变换由调用方传入 viewport。
 */
export class ChartGeometry {
  readonly bpmEvents: readonly BpmTimelineEvent[];
  readonly chartEndBeat: number;
  /** 渲染面尺寸（CSS 像素），ADR-0006 §1：随容器变化 */
  readonly surface: SurfaceSize;
  /** BPM→虚拟像素时间线：每拍 BEAT_HEIGHT*120/bpm 像素 */
  readonly timeline: BpmTimeline;
  /** 谱面末端的真实 BPM 像素高度 */
  readonly chartEndVirtualY: number;
  /** 纵向比例（issue 39 #5）：每小节纵向高度的标量，0.5..2.0；默认 1 */
  readonly verticalRatio: number;

  constructor(bpmEvents: readonly BpmTimelineEvent[], chartEndBeat: number, surface: SurfaceSize, verticalRatio = 1) {
    this.bpmEvents = bpmEvents;
    this.chartEndBeat = chartEndBeat;
    this.surface = surface;
    this.verticalRatio = verticalRatio;
    this.timeline = new BpmTimeline(bpmEvents, (bpm) => (BEAT_HEIGHT * verticalRatio * 120) / bpm);
    this.chartEndVirtualY = this.timeline.positionOfBeat(chartEndBeat);
  }

  /**
   * 实际生效缩放（ADR-0006 §1 Q4=A）：用户 zoom 与"轨道不超出画布宽"的钳制取小。
   * 保证 7 轨水平居中时始终完整可见、不变形；渲染面过窄时自动收缩。
   */
  effectiveScale(scale: number): number {
    const fitWidth = (this.surface.w - TRACK_CHROME_TOTAL * 2) / (LANES * LANE_WIDTH);
    return Math.max(MIN_SCALE, Math.min(scale, fitWidth));
  }

  /** 轨道水平居中几何（唯一实现；trackBgX = 轨道内容左缘 = 虚拟X原点，见 issue 11） */
  trackGeometry(scale: number): { totalTrackWidth: number; trackStartX: number; trackBgX: number; trackBgWidth: number } {
    const es = this.effectiveScale(scale);
    const totalTrackWidth = LANES * LANE_WIDTH * es + TRACK_CHROME_TOTAL * 2;
    const trackStartX = (this.surface.w - totalTrackWidth) / 2;
    const trackBgX = trackStartX + TRACK_CHROME_TOTAL;
    const trackBgWidth = LANES * LANE_WIDTH * es;
    return { totalTrackWidth, trackStartX, trackBgX, trackBgWidth };
  }

  /** 缩放时的虚拟边界（ADR-0004 §3：总高随谱面末端自适应，滚动到顶时末端正好落在判定线；判定线=渲染面底边） */
  scaledVirtualBounds(scale: number): GeometryBounds {
    const es = this.effectiveScale(scale);
    const totalVirtualHeight = this.chartEndVirtualY + this.surface.h / es;
    const totalVirtualWidth = LANES * LANE_WIDTH + TRACK_CHROME_TOTAL * 2;
    return { minY: 0, maxY: totalVirtualHeight, minX: 0, maxX: totalVirtualWidth };
  }

  /** 谱面总虚拟高度（chartEndVirtualY + 渲染面高折回虚拟单位） */
  totalVirtualHeight(scale: number): number {
    return this.chartEndVirtualY + this.surface.h / this.effectiveScale(scale);
  }

  /** beat → 虚拟Y（自下而上翻转：beat 0 在判定线=渲染面底边） */
  beatToVirtualY(beat: number, scale: number): number {
    return this.chartEndVirtualY + this.surface.h / this.effectiveScale(scale) - this.timeline.positionOfBeat(beat);
  }

  /** 虚拟Y → beat（与 beatToVirtualY 互逆） */
  virtualYToBeat(virtualY: number, scale: number): number {
    return this.timeline.beatOfPosition(this.chartEndVirtualY + this.surface.h / this.effectiveScale(scale) - virtualY);
  }

  /** 虚拟坐标 → 画布坐标（CSS 像素） */
  virtualToCanvas(virtualX: number, virtualY: number, viewport: GeometryViewport): GeometryPoint {
    const { trackBgX } = this.trackGeometry(viewport.scale);
    const es = this.effectiveScale(viewport.scale);
    return {
      x: trackBgX + (virtualX - viewport.scrollX) * es,
      y: (virtualY - viewport.scrollY) * es,
    };
  }

  /** 画布坐标（CSS 像素） → 虚拟坐标 */
  canvasToVirtual(canvasX: number, canvasY: number, viewport: GeometryViewport): GeometryPoint {
    const { trackBgX } = this.trackGeometry(viewport.scale);
    const es = this.effectiveScale(viewport.scale);
    return {
      x: (canvasX - trackBgX) / es + viewport.scrollX,
      y: canvasY / es + viewport.scrollY,
    };
  }

  /**
   * Ctrl+滚轮缩放锚定（纯逻辑，供单测）：保持鼠标下的谱面位置不动，返回新 scrollY（已钳制到可滚范围）。
   * 锚必须落在 pos 空间（BPM 时间线像素，缩放不变量）：pos = C(es) − virtualY，C(es) = chartEndVirtualY + surface.h/es。
   * 不能直接保 virtualY 不动——其原点 C(es) 本身随缩放变化，会让整幅内容每 tick 平移 surface.h·(k−1) px，
   * 且在滚动端点处越界后被钳制拉回：即"起始线/首拍 BPM 线缩放时漂移后回弹"的根因。
   */
  zoomAnchorScrollY(mouseCanvasY: number, oldScale: number, oldScrollY: number, newScale: number): number {
    const es1 = this.effectiveScale(oldScale);
    const es2 = this.effectiveScale(newScale);
    const virtualMouseY = mouseCanvasY / es1 + oldScrollY;
    const posMouse = this.chartEndVirtualY + this.surface.h / es1 - virtualMouseY;
    const raw = this.chartEndVirtualY + this.surface.h / es2 - posMouse - mouseCanvasY / es2;
    // 与 imperative setScrollY 的钳制一致：scrollY ∈ [minY, maxY − 视口高] = [0, chartEndVirtualY]
    return Math.max(0, Math.min(this.chartEndVirtualY, raw));
  }

  /** 视口可见范围（虚拟坐标，含外扩 padding） */
  viewportBounds(viewport: GeometryViewport): GeometryBounds {
    const es = this.effectiveScale(viewport.scale);
    const padding = VIEWPORT_PADDING / es;
    const sb = this.scaledVirtualBounds(viewport.scale);
    return {
      minX: Math.max(sb.minX, viewport.scrollX - padding),
      maxX: Math.min(sb.maxX, viewport.scrollX + this.surface.w / es + padding),
      minY: Math.max(sb.minY, viewport.scrollY - padding),
      maxY: Math.min(sb.maxY, viewport.scrollY + this.surface.h / es + padding),
    };
  }

  /** lane → 音符中心虚拟X */
  noteVirtualX(lane: number): number {
    return lane * LANE_WIDTH + LANE_WIDTH / 2;
  }

  /** beat(+subBeat) → 音符中心虚拟Y */
  noteVirtualY(beat: number, subBeat: number, scale: number, beatDisplay: number): number {
    const preciseBeat = beat + (subBeat > 0 ? subBeat / beatDisplay : 0);
    return this.beatToVirtualY(preciseBeat, scale);
  }

  /** 画布坐标 → lane/beat（用于命中与圈选）；轨道外/负拍返回 null */
  laneBeatFromCanvas(cx: number, cy: number, viewport: GeometryViewport, beatDisplay: number): { lane: number; preciseBeat: number } | null {
    const { trackBgX } = this.trackGeometry(viewport.scale);
    const es = this.effectiveScale(viewport.scale);
    const relativeX = cx - trackBgX;
    const lane = Math.floor(relativeX / (LANE_WIDTH * es));
    const virtualY = viewport.scrollY + cy / es;
    const beat = this.virtualYToBeat(virtualY, viewport.scale);
    if (lane >= 0 && lane < LANES && beat >= 0) {
      const nearestSubBeat = Math.round(beat * beatDisplay);
      return { lane, preciseBeat: nearestSubBeat / beatDisplay };
    }
    return null;
  }

  /** 排序索引缓存（issue 10 性能）：见 ensureNoteIndex */
  private noteIndex: {
    notes: readonly ChartNote[];
    beatDisplay: number;
    points: { beat: number; index: number }[];
    spans: { index: number; minBeat: number; maxBeat: number }[];
  } | null = null;

  /** 构建音符排序索引（O(n log n)，按 notes 引用 + beatDisplay 缓存）；视口剔除由此降为 O(log n + 可见数) */
  private ensureNoteIndex(notes: readonly ChartNote[], beatDisplay: number) {
    if (this.noteIndex && this.noteIndex.notes === notes && this.noteIndex.beatDisplay === beatDisplay) {
      return this.noteIndex;
    }
    const points: { beat: number; index: number }[] = [];
    const spans: { index: number; minBeat: number; maxBeat: number }[] = [];
    notes.forEach((note, index) => {
      if (note.type === 'Slide' || note.type === 'Long') {
        let minBeat = Infinity, maxBeat = -Infinity;
        for (const cn of note.connections) {
          const sb = cn.subBeat || 0;
          const b = cn.beat + (sb > 0 ? sb / beatDisplay : 0);
          if (b < minBeat) minBeat = b;
          if (b > maxBeat) maxBeat = b;
        }
        spans.push({ index, minBeat, maxBeat });
      } else if (note.type === 'Single' || note.type === 'LDirectional' || note.type === 'RDirectional') {
        const sb = note.subBeat || 0;
        points.push({ beat: note.beat + (sb > 0 ? sb / beatDisplay : 0), index });
      } else if (note.type === 'BPM') {
        points.push({ beat: note.beat, index });
      }
    });
    points.sort((a, b) => a.beat - b.beat);
    this.noteIndex = { notes, beatDisplay, points, spans };
    return this.noteIndex;
  }

  noteVirtualPoints(note: ChartNote, scale: number, beatDisplay: number): GeometryPoint[] {
    if (note.type === 'Single' || note.type === 'LDirectional' || note.type === 'RDirectional') {
      return [{ x: this.noteVirtualX(note.lane), y: this.noteVirtualY(note.beat, note.subBeat || 0, scale, beatDisplay) }];
    }
    if (note.type === 'Slide' || note.type === 'Long') {
      return note.connections.map((c) => ({
        x: this.noteVirtualX(c.lane),
        y: this.noteVirtualY(c.beat, c.subBeat || 0, scale, beatDisplay),
      }));
    }
    if (note.type === 'BPM') {
      return [{ x: this.noteVirtualX(0), y: this.noteVirtualY(note.beat, 0, scale, beatDisplay) }];
    }
    return [];
  }

  /** 视口剔除：只返回可见区域内的音符（含 index 供选中/编辑用）。点音符走排序索引二分，滑条走区间扫描。 */
  visibleNotes(notes: readonly ChartNote[], viewport: GeometryViewport, beatDisplay: number, boundsOverride?: GeometryBounds): { note: ChartNote; index: number }[] {
    const idx = this.ensureNoteIndex(notes, beatDisplay);
    const bounds = boundsOverride ?? this.viewportBounds(viewport);
    // 视口虚拟Y范围 → beat 窗口（virtualY 自上而下递减 ↔ beat 递增，与 noteVirtualY 精确互逆）
    const loBeat = this.virtualYToBeat(bounds.maxY, viewport.scale);
    const hiBeat = this.virtualYToBeat(bounds.minY, viewport.scale);
    const visible: { note: ChartNote; index: number }[] = [];

    // 点音符：二分找下界，顺序扫描到窗口上界
    const pts = idx.points;
    let lo = 0, hi = pts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].beat < loBeat) lo = mid + 1; else hi = mid;
    }
    for (let i = lo; i < pts.length && pts[i].beat <= hiBeat; i++) {
      const { index } = pts[i];
      const note = notes[index]!;
      // X 校验保持与旧实现一致（轨道水平不滚动，恒在界内；BPM 无 lane 也按 lane0 校验）
      const lane = note.type === 'Single' || note.type === 'LDirectional' || note.type === 'RDirectional' ? note.lane : 0;
      const x = this.noteVirtualX(lane);
      if (x >= bounds.minX && x <= bounds.maxX) visible.push({ note, index });
    }

    // 跨度音符（滑条/长条）：任一端点或整体区间与 beat 窗口相交即可见
    for (const s of idx.spans) {
      if (s.maxBeat < loBeat || s.minBeat > hiBeat) continue;
      visible.push({ note: notes[s.index]!, index: s.index });
    }
    return visible;
  }
}