// 谱面画布几何（纯逻辑，node 环境可单测）。
// ADR-0003 候选 B：把 FinalVirtualCanvas 里"坐标变换 / 视口剔除 / 音符定位"从组件中
// 抽成可测深厚模块；BPM→虚拟Y 用 BpmTimeline（候选 C）单一实现并缓存，避免每帧全量分段累加。
//
// 坐标系（issue 11）：虚拟坐标（X 原点=轨道内容左缘，Y 自下而上、beat 0 在判定线）↔ 画布坐标。
import type { ChartNote } from '../types';
import { trueBeat } from '../editing/ChartEndBounds';
import { BpmTimeline, type BpmBeatRange, type BpmBeatSolution, type BpmTimelineEvent } from './BpmTimeline';

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
 * 谱面末端（= 画布高度）的两种声明轴（issue 104 修法 1）：
 * - `{ seconds }` = **应用侧唯一口径**（ADR-0005 谱面长度第一性是秒）：画布高度 = 秒 × 像素密度，
 *   **不经任何反查**（倒流区里「秒 → 拍」多值，只有秒域是唯一的）；拍域末端由**最大 beat 解**派生。
 * - `{ endBeat }` = 拍域声明（测试/工具用）：高度 = `positionOfBeat(endBeat)`（正向映射），
 *   拍域末端就是给的这一拍——倒流区内它未必是"该高度的最大解"，这正是调用方声明的原意。
 */
export type ChartLengthSpec = { seconds: number } | { endBeat: number };

/**
 * 拍位吸附到当前细分网格（issue 61 的唯一量化口径）：
 * `beatDisplay` = 一拍分几份（1/8 吸附 → 8），0/负数按 1 处理（只吸整拍）。
 */
export function quantizeBeat(beat: number, beatDisplay: number): number {
  const bd = beatDisplay > 0 ? beatDisplay : 1;
  return Math.round(beat * bd) / bd;
}

/**
 * **一份共享的"方向滑键占用轨道"口径**（issue 62）：锚点轨 = `lane`，沿 sign 方向再占 `length-1` 条
 * （`LDirectional` 向左、`RDirectional` 向右；`length` 钳到 1..3，与 `noteSkin.dirGroup` 同口径）。
 * 越出轨道的轨号照实返回，由调用方各自判定：命中/框选「有就算」，拖拽越界「整组出界即非法」。
 * 消费点：`noteVirtualPoints`（框选）/ `hitTest.findItemAt`（点选·hover·拖拽候选）/
 * `NoteDragging`（落点越界）——四处必须同一份，否则又会出现"框不到箭头端"的分裂口径。
 */
export function directionalLanes(
  lane: number,
  type: 'LDirectional' | 'RDirectional',
  length: number,
): number[] {
  const sign = type === 'LDirectional' ? -1 : 1;
  const len = Math.min(Math.max(Math.round(length) || 1, 1), 3);
  const out: number[] = [];
  for (let k = 0; k < len; k++) out.push(lane + sign * k);
  return out;
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
  /** 谱面长度（秒）——画布高度的第一性来源（ADR-0005）；也是"末端是否变化"的身份（缓存/重建判定用） */
  readonly chartLengthSeconds: number;
  /** 纵向比例（issue 39 #5）：每小节纵向高度的标量，0.5..2.0；默认 1 */
  readonly verticalRatio: number;
  /**
   * 布局坐标的像素密度（虚拟 px / 秒，issue 104 修法 1/5）：
   * `perBeat ÷ 每拍秒数 = BEAT_HEIGHT·verticalRatio·(120/bpm) ÷ (60/bpm) = 2·BEAT_HEIGHT·verticalRatio`
   * ——**与 bpm 无关**（倒流区里也一样），故「秒 ↔ 布局坐标」是同一个常数的线性映射，
   * 画布高度、hover 秒读数、播放滚动全部直接用它，不经过任何反查。
   */
  readonly virtualPxPerSecond: number;

  constructor(
    bpmEvents: readonly BpmTimelineEvent[],
    chartLength: ChartLengthSpec,
    surface: SurfaceSize,
    verticalRatio = 1,
  ) {
    this.bpmEvents = bpmEvents;
    this.surface = surface;
    this.verticalRatio = verticalRatio;
    this.virtualPxPerSecond = 2 * BEAT_HEIGHT * verticalRatio;
    this.timeline = new BpmTimeline(bpmEvents, (bpm) => (BEAT_HEIGHT * verticalRatio * 120) / bpm);
    if ('seconds' in chartLength) {
      // 谱面长度（秒）第一性：高度 = 秒 × 像素密度，不经 secondsToBeat（ADR-0010 结论 4）
      this.chartLengthSeconds = chartLength.seconds;
      this.chartEndVirtualY = chartLength.seconds * this.virtualPxPerSecond;
      const end = this.timeline.maxBeatSolutionOf(this.chartEndVirtualY);
      this.chartEndBeat = end.beat;
    } else {
      this.chartEndVirtualY = this.timeline.positionOfBeat(chartLength.endBeat);
      this.chartEndBeat = chartLength.endBeat;
      this.chartLengthSeconds = this.chartEndVirtualY / this.virtualPxPerSecond;
    }
  }

  /** 布局坐标基线上的"画布顶部"常量：C(es) = chartEndVirtualY + surface.h / es（见 noteLayerCache 注释） */
  private baseline(scale: number): number {
    return this.chartEndVirtualY + this.surface.h / this.effectiveScale(scale);
  }

/**
 * 实际生效缩放（ADR-0006 §1 Q4=A）：用户 zoom 与"轨道不超出画布宽"的钳制取小。
 * 保证 7 轨水平居中时始终完整可见、不变形；渲染面过窄时自动收缩。
 * 外框 chrome 随缩放缩放（issue 51 修订：与 renderGrid 的边条绘制一致），fitWidth 分母含 chrome。
 */
effectiveScale(scale: number): number {
  const fitWidth = this.surface.w / (LANES * LANE_WIDTH + 2 * TRACK_CHROME_TOTAL);
  return Math.max(MIN_SCALE, Math.min(scale, fitWidth));
}

/** 轨道水平居中几何（唯一实现；trackBgX = 轨道内容左缘 = 虚拟X原点，见 issue 11）。
 *  外框 chrome 随缩放缩放（issue 51 修订）：预留（本函数）与 renderGrid 边条绘制（×es）一致，
 *  否则高倍下边条越过 trackStartX 侵入左沟槽、轨道整体偏心 (9es−9)/2 px。 */
trackGeometry(scale: number): { totalTrackWidth: number; trackStartX: number; trackBgX: number; trackBgWidth: number } {
  const es = this.effectiveScale(scale);
  const totalTrackWidth = (LANES * LANE_WIDTH + 2 * TRACK_CHROME_TOTAL) * es;
  const trackStartX = (this.surface.w - totalTrackWidth) / 2;
  const trackBgX = trackStartX + TRACK_CHROME_TOTAL * es;
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

  /** 布局坐标（pos）→ 虚拟Y（自下而上翻转：pos 0 = 谱面起点，在判判定线=渲染面底边的上方） */
  virtualYOfPos(pos: number, scale: number): number {
    return this.baseline(scale) - pos;
  }

  /** 虚拟Y → 布局坐标（pos = 谱面起点起算的秒 × 像素密度；**线性直读，不经 BPM 反查**） */
  posOfVirtualY(virtualY: number, scale: number): number {
    return this.baseline(scale) - virtualY;
  }

  /** beat → 虚拟Y（自下而上翻转：beat 0 在判定线=渲染面底边） */
  beatToVirtualY(beat: number, scale: number): number {
    return this.virtualYOfPos(this.timeline.positionOfBeat(beat), scale);
  }

  /**
   * 虚拟Y → **秒**（issue 104 修法 3）：布局轴直读。判定线处 / hover 读数一律用它——
   * 倒流区里「y → 拍」多值，但「y → 秒」恒单值（时间轴是布局轴本身）。
   */
  virtualYToSeconds(virtualY: number, scale: number): number {
    return this.posOfVirtualY(virtualY, scale) / this.virtualPxPerSecond;
  }

  /**
   * 秒 → **最大 beat 解**（issue 134 / ADR-0010 结论 5）：布局轴 pos = 秒 × virtualPxPerSecond，
   * 与 `virtualYToBeat` 同取解口径；HUD 不再旁路 `AudioTiming.secondsToBeat`。
   */
  beatOfSeconds(seconds: number): number {
    return this.timeline.maxBeatSolutionOf(seconds * this.virtualPxPerSecond).beat;
  }

  /** 秒 → 最大 beat 解所在 BPM 段序号（顶栏当前区间 BPM 与 beatOfSeconds 同解） */
  segmentIndexOfSeconds(seconds: number): number {
    return this.timeline.maxBeatSolutionOf(seconds * this.virtualPxPerSecond).segmentIndex;
  }

  /**
   * 虚拟Y → **全部拍解**（各层各一个，ADR-0010 结论 5）。需要"拍"的地方必须显式选解：
   * 空白处新增取 `maxBeatSolutionOf`（= `virtualYToBeat`），拖拽锚定被拖元素的层（`layerBeatFromCanvas`）。
   */
  virtualYSolutions(virtualY: number, scale: number): BpmBeatSolution[] {
    return this.timeline.beatSolutionsOf(this.posOfVirtualY(virtualY, scale));
  }

  /** 虚拟Y → beat：**最大 beat 解**（无更具体上下文时的默认取解口径，见 virtualYSolutions） */
  virtualYToBeat(virtualY: number, scale: number): number {
    return this.timeline.maxBeatSolutionOf(this.posOfVirtualY(virtualY, scale)).beat;
  }

  /** 画布 Y → **指定层（BPM 段）内**的拍位：拖拽的 Δy→Δ拍 锚定被拖元素自己所在的层（ADR-0010 结论 5） */
  layerBeatFromCanvas(cy: number, viewport: GeometryViewport, layerSegment: number): number {
    const es = this.effectiveScale(viewport.scale);
    return this.timeline.beatInSegment(layerSegment, this.posOfVirtualY(viewport.scrollY + cy / es, viewport.scale));
  }

  /** 布局坐标范围 ↔ 视口边界（issue 104 修法 4：剔除一律按元素的布局坐标，不再从 beat 反推） */
  posRangeOfBounds(bounds: GeometryBounds, scale: number): { posMin: number; posMax: number } {
    const c = this.baseline(scale);
    return { posMin: c - bounds.maxY, posMax: c - bounds.minY };
  }

  /** 当前视口的布局坐标范围（viewportBounds 已含 VIEWPORT_PADDING 外扩） */
  posRange(viewport: GeometryViewport): { posMin: number; posMax: number } {
    return this.posRangeOfBounds(this.viewportBounds(viewport), viewport.scale);
  }

  /** 视口布局坐标范围覆盖的**可见拍区间集合**（网格/子节拍枚举用；倒流区里是多段） */
  visibleBeatRanges(viewport: GeometryViewport): BpmBeatRange[] {
    const { posMin, posMax } = this.posRange(viewport);
    return this.timeline.beatRangesForPositionRange(posMin, posMax);
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

  /**
   * 画布坐标 → lane/beat（用于命中与圈选）；负拍返回 null。
   * 倒流区里「y → 拍」多值：此处取 **最大 beat 解**（ADR-0010 结论 5，与制谱器编辑器逐操作等价），
   * 即"空白处新增/光标读数"的默认口径；拖拽的层内换算走 `layerBeatFromCanvas`。
   *  `preciseBeat` = 吸附到当前 `beatDisplay` 网格后的拍位；`rawBeat` = **未量化**拍位
   *  （拖拽需要它做"抓取偏移"，见 issue 61：量化对象必须是被拖对象的落点，不是光标）。
   *
   * @param allowOutsideLane 默认 false = **轨道外 lane 返回 null**（放置语义：不能往轨道外落子）。
   *   issue 66 §4a：方向滑键的组尾本就可以合法溢出到轨道外（视觉可见、点选/框选都命中），
   *   但拖拽起手若按在那截上，旧实现因 lane 越界返回 null → 建不了拖拽锚点 → 变成框选（拖不动）。
   *   拖拽路径传 `true`：`lane` 允许越界（照实返回越界轨号），`beat` 范围校验**始终保留**
   *   （不能拖到负拍 / 谱面末端之外）。越界 lane 只用于算相对位移 `dLane = cur.lane - pressLane`，
   *   落点是否真的越界由 `planDragMove` 按"根轨在界内即合法"裁决（§4b）。
   */
  laneBeatFromCanvas(
    cx: number,
    cy: number,
    viewport: GeometryViewport,
    beatDisplay: number,
    allowOutsideLane = false,
  ): { lane: number; preciseBeat: number; rawBeat: number } | null {
    const { trackBgX } = this.trackGeometry(viewport.scale);
    const es = this.effectiveScale(viewport.scale);
    const relativeX = cx - trackBgX;
    const lane = Math.floor(relativeX / (LANE_WIDTH * es));
    const virtualY = viewport.scrollY + cy / es;
    const beat = this.virtualYToBeat(virtualY, viewport.scale);
    if (beat < 0) return null;
    if (!allowOutsideLane && (lane < 0 || lane >= LANES)) return null;
    return { lane, preciseBeat: quantizeBeat(beat, beatDisplay), rawBeat: beat };
  }

  /**
   * 排序索引缓存（issue 10 性能；issue 104 改按**布局坐标**索引）：见 ensureNoteIndex。
   * 索引键必须是布局坐标（pos）而不是拍：倒流区里 pos 随 beat 非单调，按 beat 二分求不出
   * 可见集（折返带上"该画的没画"）。pos 对每件元素是单值/区间，剔除仍可二分。
   */
  private noteIndex: {
    notes: readonly ChartNote[];
    beatDisplay: number;
    points: { pos: number; index: number }[];
    spans: { index: number; posMin: number; posMax: number }[];
  } | null = null;

  /** 构建音符排序索引（O(n log n)，按 notes 引用 + beatDisplay 缓存）；视口剔除由此降为 O(log n + 可见数） */
  private ensureNoteIndex(notes: readonly ChartNote[], beatDisplay: number) {
    if (this.noteIndex && this.noteIndex.notes === notes && this.noteIndex.beatDisplay === beatDisplay) {
      return this.noteIndex;
    }
    const points: { pos: number; index: number }[] = [];
    const spans: { index: number; posMin: number; posMax: number }[] = [];
    notes.forEach((note, index) => {
      if (note.type === 'Slide' || note.type === 'Long') {
        let minBeat = Infinity, maxBeat = -Infinity;
        for (const cn of note.connections) {
          const b = trueBeat(cn.beat, cn.subBeat, beatDisplay);
          if (b < minBeat) minBeat = b;
          if (b > maxBeat) maxBeat = b;
        }
        // 区间极值走时间轴的**正向**分段线性求值（折返的峰值也在区间内，pos 区间是精确覆盖）
        const r = this.timeline.positionRangeOfBeats(minBeat, maxBeat);
        spans.push({ index, posMin: r.min, posMax: r.max });
      } else if (note.type === 'Single' || note.type === 'LDirectional' || note.type === 'RDirectional') {
        points.push({ pos: this.timeline.positionOfBeat(trueBeat(note.beat, note.subBeat, beatDisplay)), index });
      } else if (note.type === 'BPM') {
        points.push({ pos: this.timeline.positionOfBeat(note.beat), index });
      }
    });
    // 同 pos 保持原序（稳定）：绘制顺序的确定性不依赖引擎实现
    points.sort((a, b) => (a.pos - b.pos) || (a.index - b.index));
    this.noteIndex = { notes, beatDisplay, points, spans };
    return this.noteIndex;
  }

  noteVirtualPoints(note: ChartNote, scale: number, beatDisplay: number): GeometryPoint[] {
    if (note.type === 'Single') {
      return [{ x: this.noteVirtualX(note.lane), y: this.noteVirtualY(note.beat, note.subBeat || 0, scale, beatDisplay) }];
    }
    if (note.type === 'LDirectional' || note.type === 'RDirectional') {
      // issue 62：方向键是**一整组**（锚点轨 + 沿方向再占 length-1 条）。旧实现只返回根点，
      // 于是框住箭头端不算入选——与"选中/hover 描边 = 整组一个矩形"（issue 56 A4 修订）自相矛盾。
      const y = this.noteVirtualY(note.beat, note.subBeat || 0, scale, beatDisplay);
      return directionalLanes(note.lane, note.type, note.length).map(lane => ({ x: this.noteVirtualX(lane), y }));
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

  /** 视口剔除：只返回可见区域内的音符（含 index 供选中/编辑用）。点音符走 pos 排序索引二分，滑条走区间扫描。 */
  visibleNotes(notes: readonly ChartNote[], viewport: GeometryViewport, beatDisplay: number, boundsOverride?: GeometryBounds): { note: ChartNote; index: number }[] {
    const idx = this.ensureNoteIndex(notes, beatDisplay);
    const bounds = boundsOverride ?? this.viewportBounds(viewport);
    // 视口虚拟Y范围 → **布局坐标**窗口（issue 104 修法 4：正向直读，不经"秒 → 拍"反查）。
    // 倒流区里同一 pos 会被多个拍经过，用 beat 窗口剔除必然漏画折返带上那一层。
    const { posMin, posMax } = this.posRangeOfBounds(bounds, viewport.scale);
    // issue 85：**先滑条/长条、后点音符** —— 输出顺序即绘制顺序（后画的在上），
    // 故键型音符（单键/方向键）恒画在 Slide 的段与结点之上，压在连接带下的音符不再被盖住。
    // 命中侧 `findItemAt` 用同一套图层优先级择优（键型 > 滑条结点 > 滑条段，同级取后放置者），
    // 二者严格同序（旧实现是点音符在前 → Slide 恒盖住其它音符，且命中按正序取，与绘制相反）。
    const visible: { note: ChartNote; index: number }[] = [];

    // 跨度音符（滑条/长条）：pos 区间与窗口相交即可见
    for (const s of idx.spans) {
      if (s.posMax < posMin || s.posMin > posMax) continue;
      visible.push({ note: notes[s.index]!, index: s.index });
    }

    // 点音符：按 pos 二分找下界，顺序扫描到窗口上界
    const pts = idx.points;
    let lo = 0, hi = pts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].pos < posMin) lo = mid + 1; else hi = mid;
    }
    for (let i = lo; i < pts.length && pts[i].pos <= posMax; i++) {
      const { index } = pts[i];
      const note = notes[index]!;
      // X 校验保持与旧实现一致（轨道水平不滚动，恒在界内；BPM 无 lane 也按 lane0 校验）
      const lane = note.type === 'Single' || note.type === 'LDirectional' || note.type === 'RDirectional' ? note.lane : 0;
      const x = this.noteVirtualX(lane);
      if (x >= bounds.minX && x <= bounds.maxX) visible.push({ note, index });
    }

    return visible;
  }
}