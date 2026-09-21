// ADR-0008 画布手势仲裁 —— 纯模块（无 React / 无 DOM / 可单测）。
//
// 从 FinalVirtualCanvas 抽出的三张判定表 + 三处坐标/命中换算：
//   按下 → 走「拖拽」还是「框选」       resolvePressIntent
//   松开 → 提交拖拽/框选/单击/作废      resolveReleaseIntent
//   单击 → 就地编辑/选标记/选音符/交矩阵 resolveClickPlan
//   换算   snapChartPos / hitStartMarkerAt / hitBpmLabelAt
//
// issue 61 / 63 / 65② / 66 的缺陷全部落在这几张表里——它们是"操作逻辑"真正的 bug 面，
// 而在此之前没有一个测试能碰它们（编排层原样内联在 1048 行的组件里）。
//
// 语义权威 = ADR-0008。本模块**不发明语义**，只把组件内的判定顺序锁成可断言的形式，
// 让后续"整改画布操作"有回归网（issue 70）。改这里的任何一条 = 改 ADR-0008。
import type { BpmNote, ChartNote, SelectionItem } from '../types';
import type { HitTestDeps } from '../../visual/hitTest';
import { findBpmLineAt, findItemAt } from '../../visual/hitTest';
import { draggableFromItems, itemTrueBeat } from './NoteDragging';
import { isPastChartEnd } from './ChartEndBounds';
import { sameSelectionItem, type MatrixTool } from './ToolActionMatrix';
import { GUTTER_LABEL_FONT_PX, bpmLabelBox } from '../../visual/gutterLabels';
import { LANE_WIDTH } from '../geometry/ChartGeometry';

/** 沟槽文字宽度测量（画布侧注入：带 canvas ctx 精确测量；测试侧注入等宽估算）。 */
export type GutterMeasure = (text: string, fontPx: number) => number;

/** 画布落点（snapChartPos 的产物）。rawBeat 只有拖拽用（issue 61：量化对象是落点，不是光标）。 */
export interface ChartPos {
    beat: number;
    lane: number;
    rawBeat: number;
}

/** 几何/视口子集：三处换算都只需要这两个（命中另需 notes/beatDisplay/noteSize）。 */
type GeometryView = Pick<HitTestDeps, 'geometry' | 'viewport'>;

/**
 * 放置/执行的合法落点：轨道内 ∧ beat≥0 ∧ 不超谱面末端（ADR-0005 §5）；非法 → null（§1「该位置非法则无事发生」）。
 *
 * @param allowOutsideLane 仅**拖拽**路径传 true（issue 66 §4a）：方向滑键组尾可合法溢出到轨道外，
 *   按在那截上也要能起拖 —— 否则 lane 越界 → null → 建不了拖拽锚点 → 手势退化成框选。
 *   越界 lane 只参与 `dLane = cur.lane − pressLane` 的相对位移，落点是否合法由
 *   `planDragMove` 按"根轨在界内即合法"（§4b）裁决；beat 范围校验始终保留。
 */
export function snapChartPos(
    deps: Pick<HitTestDeps, 'geometry' | 'viewport' | 'beatDisplay'>,
    chartEndBeat: number,
    cx: number,
    cy: number,
    allowOutsideLane = false,
): ChartPos | null {
    const pos = deps.geometry.laneBeatFromCanvas(cx, cy, deps.viewport, deps.beatDisplay, allowOutsideLane);
    if (!pos) return null;
    if (isPastChartEnd(pos.preciseBeat, chartEndBeat)) return null;
    return { beat: pos.preciseBeat, lane: pos.lane, rawBeat: pos.rawBeat };
}

/**
 * 越界冻结策略（issue 09 验收反馈九轮，**手势预览的唯一口径**）：
 *
 * 光标移出轨道（轨外 lane / 越过谱面末端 / 移出画布）时，**进行中的手势**（有已确认锚点、
 * 拖拽中、画笔中）的预览应**冻结在最后合法落点**、保持可见，而不是整条消失——消失会让用户
 * 以为"画丢了"（八轮 #2 的画笔即此病）。反之，**纯 hover**（未起手、无锚点）越界 → null，
 * 幽灵隐藏，作为"这里不能放"的诚实信号（不能让用户以为空白处也能落子）。
 *
 * 三侧共用此函数：① 画笔草稿（组件冻结采样、`renderToolPreview` 越界仍画）② 链式/两击放置的
 * live 预览 ③ 拖拽幽灵。未来若要改成"钳到边缘跟随"等其它口径，**只改这一处**。
 */
export function freezeGestureCursor<T>(
    live: T | null,
    frozen: T | null,
    gestureActive: boolean,
): T | null {
    if (live !== null) return live;
    return gestureActive ? frozen : null;
}

/** 左沟槽命中起点标记线（ADR-0004 §4；与音符命中路径无关）。 */
export function hitStartMarkerAt(
    deps: GeometryView,
    markerBeat: number | null,
    cx: number,
    cy: number,
): boolean {
    if (markerBeat === null) return false;
    const { trackBgX } = deps.geometry.trackGeometry(deps.viewport.scale);
    if (cx >= trackBgX) return false;
    const markerVirtualY = deps.geometry.beatToVirtualY(markerBeat, deps.viewport.scale);
    const markerCanvasY = deps.geometry.virtualToCanvas(0, markerVirtualY, deps.viewport).y;
    return Math.abs(cy - markerCanvasY) < 10 * deps.viewport.scale;
}

/**
 * §5 手势仲裁：左沟槽 BPM 数字命中（返回该 BPM 的 beat）。
 * 命中区 = **数字自身的文字盒**（`bpmLabelBox`），不是整条水平线——否则该高度上左沟槽的
 * 双击永远被判为"数字命中"、起点标记手势放不下去（2026-09-08 修订）。
 * 沟槽宽度不足、绘制时整体隐藏（`box.x1 < 0`）的数字同样不可命中。
 */
export function hitBpmLabelAt(
    input: {
        deps: Pick<HitTestDeps, 'geometry' | 'viewport' | 'notes'>;
        labelScale: number;
        surfaceH: number;
        measureWidth: GutterMeasure;
    },
    cx: number,
    cy: number,
): number | null {
    const { geometry, viewport, notes } = input.deps;
    const { trackBgX, trackStartX } = geometry.trackGeometry(viewport.scale);
    if (cx >= trackBgX) return null;
    const fontPx = Math.round(GUTTER_LABEL_FONT_PX * input.labelScale);
    for (const n of notes) {
        if (n.type !== 'BPM') continue;
        const y = geometry.virtualToCanvas(0, geometry.beatToVirtualY(n.beat, viewport.scale), viewport).y;
        const text = String((n as BpmNote).bpm);
        const box = bpmLabelBox(trackStartX, y, text, input.labelScale, input.surfaceH, input.measureWidth(text, fontPx));
        if (box.x1 < 0) continue;
        if (cx >= box.x1 && cx <= box.x2 && cy >= box.y1 && cy <= box.y2) return n.beat;
    }
    return null;
}

/** §6 拖拽锚点快照（按下时的状态，提交时必须用它而不是已清空的 ref——issue 55 三轮修复）。 */
export interface DragAnchor {
    items: SelectionItem[];
    pressLane: number;
    anchorBeat: number;
    rawPressBeat: number;
    /**
     * 被拖元素所在的**层**（BPM 段序号，issue 104 修法 8 / ADR-0010 结论 5）：
     * 拖拽的 Δy→Δ拍 换算锚定这一层——倒流区里各层的"每拍像素"不同，
     * 取光标处的最大解层会让位移按别的层的斜率换算（拖 1 格跳 2 拍）。
     * `rawPressBeat` 与后续 `rawCurBeat` 都按本层换算，二者同层才可比。
     */
    layerSegment: number;
}

export type PressIntent =
    | { kind: 'drag'; anchor: DragAnchor }
    | { kind: 'marquee' }
    // issue 09 S2（ADR-0009 §3）：曲线工具态空白按下（无 Shift）= 画笔起手
    | { kind: 'pen'; start: ChartPos };

/**
 * §6 按下意图仲裁：这一次按下是「拖拽移动」还是「框选」。
 * 任一步不合法都退回框选（防误拖），不产生半截拖拽态。
 * 例外（issue 09 S2；2026-09-13 三轮扩订）：曲线工具态无 Shift 按下 = **画笔起手（任意位置）**——
 * 起点可落在已有音符/段上（重叠绘制）；**命中 ∈ 当前选区除外**（issue 137：不启画笔，松手未拖走
 * clickOps 整片组合 + 刷缓动，与 Slide / 曲线 Shift+框选对齐）。单击点选区外仍挂锚点/点段重应用。
 * Shift 交还既有仲裁（Shift+音符 = 移动逃生口、Shift+拖 = 框选）。
 */
export function resolvePressIntent(input: {
    cx: number;
    cy: number;
    armedTool: MatrixTool | null;
    shiftKey: boolean;
    /** 按在起点标记线上（标记线上按下不拖音符） */
    onMarker: boolean;
    deps: HitTestDeps;
    selectedItems: readonly SelectionItem[];
    chartEndBeat: number;
}): PressIntent {
    const marquee: PressIntent = { kind: 'marquee' };
    // ADR-0009 §3：曲线工具态无 Shift 按下 = 画笔起手（合法落点即起）；选区内命中让给单击整片
    if (input.armedTool === 'curve' && !input.shiftKey) {
        if (input.onMarker) return marquee;
        const hit = findItemAt(input.cx, input.cy, input.deps);
        if (hit && input.selectedItems.some(it => sameSelectionItem(it, hit))) return marquee;
        const start = snapChartPos(input.deps, input.chartEndBeat, input.cx, input.cy);
        return start ? { kind: 'pen', start } : marquee;
    }
    // §6（三轮修订）：指针态音符上拖拽 = 移动；**任意持工具态 Shift+按住音符 = 移动**；
    // 其余持工具态拖拽 = 框选（防误拖）。
    if (!(input.armedTool === null || input.shiftKey)) return marquee;
    if (input.onMarker) return marquee;

    const hit = findItemAt(input.cx, input.cy, input.deps);
    if (!hit) return marquee;
    // 命中 ∈ 选区且选区 ≥2 → 组拖（共用同一 delta），否则单拖命中项
    const inSelection = input.selectedItems.some(it => sameSelectionItem(it, hit));
    const source = inSelection && input.selectedItems.length >= 2 ? input.selectedItems : [hit];
    const items = draggableFromItems(input.deps.notes, source);
    if (items.length === 0) return marquee; // BPM/System/区域等非可拖对象 → 退回框选

    // issue 66 §4a：允许轨道外起手（方向滑键组尾溢出那截）
    const p = snapChartPos(input.deps, input.chartEndBeat, input.cx, input.cy, true);
    if (!p) return marquee;

    // issue 61：量化基准取**被按住那件对象**的真实拍位（按到滑条区域等不可拖条目时回退集合首件）
    const anchor = items.some(it => sameSelectionItem(it, hit)) ? hit : items[0]!;
    const anchorBeat = itemTrueBeat(input.deps.notes, anchor, input.deps.beatDisplay);
    if (anchorBeat === null) return marquee;

    // issue 104 修法 8：Δy→Δ拍 锚定**被拖元素所在的层**（BPM 段序号）——按下点的未量化拍位
    // 也按该层换算，与拖拽中的换算同层（倒流区里「同一个 y」各层的拍不同，跨层相减会算错位移）
    const layerSegment = input.deps.geometry.timeline.segmentIndexAtBeat(anchorBeat);
    const rawPressBeat = input.deps.geometry.layerBeatFromCanvas(input.cy, input.deps.viewport, layerSegment);

    return {
        kind: 'drag',
        anchor: { items, pressLane: p.lane, anchorBeat, rawPressBeat, layerSegment },
    };
}

/**
 * 松开结算的优先级表（issue 63：window 接管后 e 可能是 null = 失焦等异常收尾）。
 * - `continue`  非左键抬起：手势继续，不动任何状态（调用方直接 return，不清理）
 * - `abort`     只收手势态，不触发任何动作
 * - `commitDrag` / `commitBox` / `click` 各自消费调用方**已捕获**的快照
 */
export type ReleaseIntent = 'continue' | 'abort' | 'commitDrag' | 'commitBox' | 'commitPen' | 'click';

export function resolveReleaseIntent(input: {
    /** null = 失焦等异常收尾（mouseup 永远不来） */
    e: { button?: number } | null;
    start: { x: number; y: number; vx: number; vy: number } | null;
    /** 是否已越过拖拽阈值（区分单击与框选/拖拽） */
    moved: boolean;
    drag: DragAnchor | null;
    box: { x1: number; y1: number; x2: number; y2: number } | null;
    /** issue 09 S2：画笔进行中（曲线工具态空白拖动） */
    pen?: boolean;
}): ReleaseIntent {
    if (input.e && input.e.button !== 0) return 'continue';
    if (!input.start || !input.e || input.e.button !== 0) return 'abort';
    if (input.moved) {
        if (input.drag) return 'commitDrag';
        if (input.pen) return 'commitPen';
        return input.box ? 'commitBox' : 'abort';
    }
    return 'click';
}

/**
 * 单击路径需要"命中音符"的工具集合（issue 88 扩订）。
 * - 动作族 + 音符代码：本来就要命中（空白 = 清选区 / 无效果）；
 * - 键型 + Slide：新增 —— 命中项 ∈ 选区时要整片执行（批量换型 / 组合），需要先拿到命中项。
 * BPM / 粘贴不在此列：二者作用于**位置**，与"点中了哪个音符"无关。
 */
const NEEDS_HIT: ReadonlySet<MatrixTool> = new Set<MatrixTool>([
  'single', 'flick', 'skill', 'ldirectional', 'rdirectional', 'slide', 'curve', 'delete', 'mirror', 'noteCode',
]);

/** §2 单击矩阵在画布侧的四种去向（语义行仍在 ToolActionMatrix，本表只决定"去问谁"）。 */
export type ClickPlan =
    /** §5：任何工具态下单击沟槽 BPM 数字 = 就地编辑 */
    | { kind: 'editBpm'; beat: number; value: string }
    /** 指针态点中起点标记线：选中标记、清空音符选区（ADR-0004 §4 互斥） */
    | { kind: 'selectMarker' }
    /** 指针态：选中该目标（Shift 加选 / Ctrl 整条滑条）/ 空白清空 */
    | { kind: 'selectItem'; additive: boolean; ctrl: boolean }
    /** 交给语义矩阵：`hit` 已按"音符优先 → BPM 整线"的次序归一 */
    | { kind: 'runMatrix'; hit: SelectionItem | null; pos: ChartPos | null };

export function resolveClickPlan(input: {
    cx: number;
    cy: number;
    armedTool: MatrixTool | null;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    deps: HitTestDeps;
    notes: readonly ChartNote[];
    /** snapChartPos(cx, cy) 的结果（放置口径：轨道外非法） */
    snap: ChartPos | null;
    /** hitBpmLabelAt 的结果；命中但 BPM 已不在谱面（undo）时回落 */
    bpmLabelBeat: number | null;
    onMarker: boolean;
}): ClickPlan {
    if (input.bpmLabelBeat !== null) {
        const beat = input.bpmLabelBeat;
        const n = input.notes.find(
            nt => nt.type === 'BPM' && Math.abs(nt.beat - beat) < 1e-9,
        ) as BpmNote | undefined;
        if (n) return { kind: 'editBpm', beat, value: String(n.bpm) };
    }
    if (input.armedTool === null) {
        if (input.onMarker) return { kind: 'selectMarker' };
        return { kind: 'selectItem', additive: input.shiftKey, ctrl: input.ctrlKey || input.metaKey };
    }
    // 动作族（删除/镜像）/「音符代码」需要音符命中（空白 = 无效果不清选区）；其余行只吃栅格落点。
    // 复制/剪切已按 §2.1 退出工具轴（不 arm），故不在其中。
    // **issue 88 扩订**：键型与 Slide 也要判"命中项 ∈ 选区 → 整片执行"，故同样需要命中。
    const tool = input.armedTool;
    const needHit = NEEDS_HIT.has(tool);
    const hit = needHit ? findItemAt(input.cx, input.cy, input.deps) : null;
    // issue 59：BPM 线视觉上横跨轨道、画在音符层之下，而 findItemAt 完全跳过 BPM。
    // 故对**需要对 BPM 表态的四态**补一条整线命中：音符优先（findItemAt 先判），不进 hover。
    // 四态缺一都会让 clickOps 里对应的矩阵行变成不可达的死分支（锁表单测也会变假绿）。
    const needsBpmLine = tool === 'bpm' || tool === 'delete' || tool === 'mirror' || tool === 'noteCode';
    const bpmLineHit = hit === null && needsBpmLine
        ? findBpmLineAt(input.cx, input.cy, input.deps)
        : null;
    return { kind: 'runMatrix', hit: bpmLineHit ?? hit, pos: input.snap };
}

// ─────────────────────────────── 画笔（issue 09 S2 / ADR-0009 §3） ───────────────────────────────

/** 画笔轨迹点：beat 单调递增（真拍位十进制），lane 连续小数 0..6（自由段 lane 不吸附） */
export interface PenPoint { beat: number; lane: number }

/**
 * 画笔光标读数：rawBeat（未量化真拍）+ **连续 lane**（音符中心 = (lane+0.5)·LANE_WIDTH，
 * 与 `getNoteVirtualX` 同构反推）；轨道外/越过谱面末端 → null（画笔在界内采样）。
 */
export function penCursorAt(
    deps: Pick<HitTestDeps, 'geometry' | 'viewport' | 'beatDisplay'>,
    chartEndBeat: number,
    cx: number,
    cy: number,
): PenPoint | null {
    const p = snapChartPos(deps, chartEndBeat, cx, cy);
    if (!p) return null;
    const { trackBgX } = deps.geometry.trackGeometry(deps.viewport.scale);
    const es = deps.geometry.effectiveScale(deps.viewport.scale);
    const lane = clampLane((cx - trackBgX) / (LANE_WIDTH * es) - 0.5);
    return { beat: p.rawBeat, lane };
}

const clampLane = (v: number) => Math.min(Math.max(v, 0), 6);

/**
 * 画笔采样（ADR-0009 §3「拖动画笔 = 轨迹实时采样」/ §7「画笔禁止回头」，issue 106 定案）：
 * 从上一采样点起按固定拍步长追加点，lane 在上一采样点与当前光标间线性插值。
 * **采样序列 beat 严格单调是数据模型硬约束**：
 * - 方向在**第一次真正落采样**时锁定（`dir` 0=未定 → ±1）；此后**回头不追加**（"往回描"不产出点）；
 * - 倒向笔画（从高拍向低拍）产出**降序**采样，落子时由 `resolvePenStroke` 反转为升序段；
 * - **回头不改变产出**：笔迹形态由 `resolvePenStroke` 按"锁定方向上最靠前者"裁决，光标回退期间
 *   本函数返回空数组、`pen.last` 不动（旧文「恢复同向时从折返点续采」已废止）；
 * - `maxBeatsThisFrame`（可选，来自 `penMaxBeatsForCanvasDy`）：**跨折返带边界**时不插值补点，
 *   只把当前光标接为下一个采样点——那段 beat 跳过了画布 y 上根本不存在的区间（ADR-0010 附录 B）。
 */
export function penAppendSamples(
    last: PenPoint,
    cursor: PenPoint,
    stepBeat: number,
    dir: 0 | 1 | -1,
    maxBeatsThisFrame = Number.POSITIVE_INFINITY,
): { samples: PenPoint[]; dir: 1 | -1 } {
    const delta = cursor.beat - last.beat;
    if (stepBeat <= 0 || Math.abs(delta) <= 1e-9) {
        return { samples: [], dir: dir === 0 ? 1 : (dir as 1 | -1) };
    }
    const locked: 1 | -1 = dir !== 0 ? dir : delta > 0 ? 1 : -1;
    if (dir !== 0 && (delta > 0 ? 1 : -1) !== dir) return { samples: [], dir: dir as 1 | -1 };
    // 跨层跳变步：不补中间点（issue 106 修法 6）——补的话画布上会凭空多出一段手没画过的尖峰。
    // 判据要带上一个 step 的余量：`delta` 是"距上一个已落采样点"的位移（慢速绘制时它天然带
    // 最多一个 step 的滞后），而 `maxBeatsThisFrame` 只覆盖"本帧的 Δ 画布 y"——不加余量会把
    // 慢速绘制误判成跨层（那样每帧接一个 off-grid 点，采样栅格就废了）。
    if (Math.abs(delta) > maxBeatsThisFrame + stepBeat) {
        return { samples: [{ beat: cursor.beat, lane: clampLane(cursor.lane) }], dir: locked };
    }
    const n = Math.floor(Math.abs(delta) / stepBeat + 1e-9);
    const out: PenPoint[] = [];
    for (let k = 1; k <= n; k++) {
        const beat = last.beat + locked * k * stepBeat;
        const t = (beat - last.beat) / delta;
        out.push({ beat, lane: clampLane(last.lane + (cursor.lane - last.lane) * t) });
    }
    // 第一步采样落地才锁方向——此前的小幅抖动不主导整笔方向
    if (out.length === 0) return { samples: [], dir: dir as 1 | -1 };
    return { samples: out, dir: locked };
}

/**
 * 画笔跨层判据（issue 106 修法 6 定）：把"本帧画布 Δy"换算成"在光标所在层最多能跨多少拍"。
 * 折返带边界处拍号会跳 2~4 拍，而两端画布位置几乎同一个 y → `|Δbeat|` 远超该上限；
 * 快速甩笔的 Δy 同样大、上限也大 → 不会被误判成跨层（那种情况的插值补点合法且必要）。
 * `slack` 吸收离散采样与跨 BPM 段的斜率变化（3 足以容下同帧内 2.5 倍以内的 BPM 变化）。
 */
export function penMaxBeatsForCanvasDy(
    deps: Pick<HitTestDeps, 'geometry' | 'viewport'>,
    beat: number,
    canvasDy: number,
    slack = 3,
): number {
    const timeline = deps.geometry.timeline;
    if (timeline.segmentCount === 0) return Number.POSITIVE_INFINITY; // 无 BPM 事件 → 无从判定，不拦
    // 所在段的**每拍画布像素**取时间轴的层接口（issue 104：`.segments` 不再被调用点直接翻找）；
    // 倒流区 perBeat 为负，取模即其量值。不用探针差分：探针正好跨段边界时会取到两段的混合斜率
    // 甚至约 0（漏判）。
    const pxPerBeat = Math.max(
        1e-6,
        Math.abs(timeline.perBeatOfSegment(timeline.segmentIndexAtBeat(beat))) * deps.geometry.effectiveScale(deps.viewport.scale),
    );
    return (Math.abs(canvasDy) / pxPerBeat) * slack;
}

/**
 * 画笔落子裁决（issue 106 定案「回头不改变产出」）：
 * 笔迹 = 起点 → 终点，终点取「松手吸附拍位」与「锁定方向上最远采样点」中**更靠前者**——
 * 因此回头（手退回来）既不缩短也不延长产出；画过头只能 undo 重画，或落子后用指针拖端点。
 * 返回统一**升序**的 `{ from, middles, to }`（`buildPenSlide` 口径），倒向笔画端点互换；
 * 拍位无净位移（同拍）→ null（不落子）。纯函数，不改入参。
 */
export function resolvePenStroke(
    start: PenPoint,
    samples: readonly PenPoint[],
    dir: 0 | 1 | -1,
    release: PenPoint,
): { from: PenPoint; to: PenPoint; middles: PenPoint[] } | null {
    const eps = 1e-9;
    const last = samples.length > 0 ? samples[samples.length - 1] : null;
    const forward = dir !== 0 ? dir > 0 : release.beat >= start.beat;
    const far: PenPoint = !last
        ? release
        : forward
            ? (release.beat > last.beat ? release : last)
            : (release.beat < last.beat ? release : last);
    const lo: PenPoint = forward ? { beat: start.beat, lane: start.lane } : far;
    const hi: PenPoint = forward ? far : { beat: start.beat, lane: start.lane };
    if (hi.beat - lo.beat <= eps) return null;
    const middles = samples
        .filter((s) => s.beat > lo.beat + eps && s.beat < hi.beat - eps)
        .sort((a, b) => a.beat - b.beat);
    return { from: lo, to: hi, middles };
}

/**
 * 画笔松手落子专用（issue 112 方案 B）：在 `resolvePenStroke` 轨迹上施加半格门槛、网格吸附与终点整轨。
 * 实时预览不走此函数，避免终点量化导致预览「跳格」。
 */
export function finalizePenStrokeCommit(
    start: PenPoint,
    stroke: { from: PenPoint; to: PenPoint; middles: PenPoint[] },
    beatDisplay: number,
): { from: PenPoint; to: PenPoint; middles: PenPoint[] } | null {
    const eps = 1e-9;
    const grid = beatDisplay > 0 ? beatDisplay : 1;
    const halfGrid = 0.5 / grid;
    const gridStep = 1 / grid;
    const forward = Math.abs(stroke.from.beat - start.beat) < eps
        && Math.abs(stroke.from.lane - start.lane) < eps;
    const far = forward ? stroke.to : stroke.from;
    const dist = Math.abs(far.beat - start.beat);
    if (dist < halfGrid - eps) return null;
    let endBeat = Math.round(far.beat * grid) / grid;
    endBeat = forward
        ? Math.max(endBeat, start.beat + gridStep)
        : Math.min(endBeat, start.beat - gridStep);
    const end: PenPoint = { beat: endBeat, lane: clampLane(Math.round(far.lane)) };
    const lo: PenPoint = forward ? stroke.from : end;
    const hi: PenPoint = forward ? end : stroke.to;
    if (hi.beat - lo.beat <= eps) return null;
    const middles = stroke.middles
        .filter((s) => s.beat > lo.beat + eps && s.beat < hi.beat - eps)
        .sort((a, b) => a.beat - b.beat);
    return { from: lo, to: hi, middles };
}

/** 落点吸附后的拍位（松手端点用：可见端点吸附放置栅格） */
export function penReleaseBeat(
    deps: Pick<HitTestDeps, 'geometry' | 'viewport' | 'beatDisplay'>,
    chartEndBeat: number,
    cx: number,
    cy: number,
): number | null {
    const p = snapChartPos(deps, chartEndBeat, cx, cy);
    return p ? p.beat : null;
}

/**
 * 画笔越界交点（issue 09 十轮，Q1）：从界内画布点 `inside` 沿**画布直线**（= 两次 mousemove
 * 之间画笔的真实路径）走到界外画布点 `outside`，二分求"仍在轨道内部的最远画布点"及其合法读数。
 *
 * 快甩出轨道时，最后一次**界内**事件采样落在边界之前一截（离散采样的固有滞后），笔画看起来
 * "停在半路"。这里把那条被 `penCursorAt` 判为 null 而整段丢弃的连线补到真实交点：
 * - **终点**由解析求交得出，不再敏感于 mousemove 事件密度（一次事件甩过头也停在墙根）；
 * - **界内中途弦的曲率**仍是直线近似（画布直线），与既有采样同口径，非本次消除对象。
 *
 * 合法性**只认注入的 `oracle`**（组件传 `penCursorAt`）——轨道边界 / 负拍 / 越谱末的单一真相仍是
 * `snapChartPos → laneBeatFromCanvas`，本函数不另立几何，改判定只需改 `oracle` 一处。
 *
 * @returns `inside` 非法 / `outside` 其实合法（未越界）→ null（交回正常路径）；否则返回交点
 *   画布坐标 + 该处合法 `PenPoint`（lane 已 `clampLane`、beat 未量化真拍，与 `penCursorAt` 同型）。
 */
export function penExitCrossing(
    oracle: (cx: number, cy: number) => PenPoint | null,
    inside: { x: number; y: number },
    outside: { x: number; y: number },
    iterations = 24,
): { x: number; y: number; point: PenPoint } | null {
    const start = oracle(inside.x, inside.y);
    if (!start) return null; // 连"界内锚点"都非法 → 无从求交，交回原逻辑
    if (oracle(outside.x, outside.y)) return null; // 其实没越界
    let lo = 0;
    let hi = 1; // lo 恒合法、hi 恒非法（合法域为凸矩形 → 单一交点）
    let bestX = inside.x;
    let bestY = inside.y;
    let best = start;
    for (let i = 0; i < iterations; i++) {
        const t = (lo + hi) / 2;
        const cx = inside.x + (outside.x - inside.x) * t;
        const cy = inside.y + (outside.y - inside.y) * t;
        const p = oracle(cx, cy);
        if (p) {
            lo = t;
            bestX = cx;
            bestY = cy;
            best = p;
        } else {
            hi = t;
        }
    }
    return { x: bestX, y: bestY, point: best };
}

// ─────────────────────────────── 框选：阈值 / 矩形 / 去向 ───────────────────────────────

/** 渲染面边界（CSS 像素） */
export interface SurfaceBounds { w: number; h: number }

/** 画布坐标是否落在渲染面内（issue 63：window 接管后光标可能在画布外） */
export const isInsideSurface = (s: SurfaceBounds, x: number, y: number) =>
    x >= 0 && y >= 0 && x <= s.w && y <= s.h;

/** 把画布坐标钳进渲染面（框选矩形不越出画布） */
export const clampToSurface = (s: SurfaceBounds, x: number, y: number) => ({
    x: Math.min(Math.max(x, 0), s.w),
    y: Math.min(Math.max(y, 0), s.h),
});

/** §2 原则 1：按下后移动 ≥ 阈值 = 拖拽/框选；< 阈值 = 单击（阈值沿用 4px） */
export function hasMovedBeyondThreshold(
    start: { x: number; y: number },
    cur: { x: number; y: number },
    thresholdPx: number,
): boolean {
    return Math.abs(cur.x - start.x) >= thresholdPx || Math.abs(cur.y - start.y) >= thresholdPx;
}

/**
 * 框选矩形（画布坐标）。
 * bug 32：起点以**虚拟坐标**锚定谱面时刻/轨道 —— 拖拽过程中即使滚动，起点对应的拍点也不漂移
 * （"长截图"式选区）；光标端再钳进渲染面（issue 63：画布外松手也照常结算，所见即所得）。
 */
export function marqueeRect(input: {
    start: { vx: number; vy: number };
    curCanvas: { x: number; y: number };
    deps: GeometryView;
    surface: SurfaceBounds;
}): { x1: number; y1: number; x2: number; y2: number } {
    const { geometry, viewport } = input.deps;
    const p1 = geometry.virtualToCanvas(input.start.vx, input.start.vy, viewport);
    const cur = geometry.canvasToVirtual(input.curCanvas.x, input.curCanvas.y, viewport);
    const p2c = geometry.virtualToCanvas(cur.x, cur.y, viewport);
    const p2 = clampToSurface(input.surface, p2c.x, p2c.y);
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

/** §2 框选矩阵在画布侧的两种去向：指针行 = 建选区（+ 标记互斥），其余工具族 = 交矩阵 */
export type BoxPlan = 'select' | 'runMatrix';

export function resolveBoxPlan(armedTool: MatrixTool | null): BoxPlan {
    return armedTool === null ? 'select' : 'runMatrix';
}

/**
 * 「音符代码」（issue 59 §3）与「粘贴」（issue 72）态**不启动框选**（按下拖拽根本不画框选矩形），
 * 而不是"框了松手无反应" —— 二者都不是对既有音符/选区做功的工具：
 * 音符代码不改谱面；粘贴作用于**位置**（把剪贴板组放到光标处），选中既有音符对它毫无意义。
 * 注意：Shift+按住音符 = 移动（§6 全局逃生口）不受此限，那条分支在拖拽侧先行返回。
 */
export function canStartMarquee(armedTool: MatrixTool | null): boolean {
    return armedTool !== 'noteCode' && armedTool !== 'paste';
}

// ─────────────────────────────── 执行键（§3） ───────────────────────────────

/**
 * 越过谱面末端的判据（ADR-0005 §5）：放置 / 执行键 / 粘贴 / 拖拽**共用同一 epsilon**，
 * 不得各写一份 —— 唯一实现已移至 `ChartEndBounds`（本模块再导出，保持既有 import 不变）。
 */

/**
 * §3 键型执行键：光标不在画布 / 越过谱面末端 → **无事发生**
 * （不落子、也不清选区 —— 与 §2 原则 6 的"清选区"是两回事，别混）。
 * 声明为类型守卫：调用方 `if (!canPlaceAtCursor(...)) return;` 之后光标即可当非空用。
 */
export function canPlaceAtCursor(
    cursor: { beat: number } | null,
    chartEndBeat: number,
): cursor is { beat: number } {
    return cursor !== null && !isPastChartEnd(cursor.beat, chartEndBeat);
}

export { CHART_END_EPS, isPastChartEnd, groupMaxBeat } from './ChartEndBounds';

/**
 * issue 59 §2（Ctrl+B 执行键）：命中口径与「音符代码」工具单击**完全一致** ——
 * hover 命中的音符/滑条优先，未命中再按整条 BPM 线判。
 * 两处口径必须同源，否则键盘与鼠标会在同一位置上打开不同对象。
 */
export function resolveExecNoteCodeHit(input: {
    hoverItem: SelectionItem | null;
    hoverPos: { cx: number; cy: number } | null;
    deps: HitTestDeps;
}): SelectionItem | null {
    return input.hoverItem
        ?? (input.hoverPos ? findBpmLineAt(input.hoverPos.cx, input.hoverPos.cy, input.deps) : null);
}
/** Esc 五档链的**唯一裁决处**（ADR-0008 §7 / issue 109）：一次只吐一档，先到先吃。 */
export type EscapeTarget = 'gesture' | 'anchor' | 'selection' | 'tool' | null;

/**
 * Esc 依序消费：① 弹窗（capture 层自消费，不进本函数）→ ② **进行中手势** → ③ 锚点 →
 * ④ 选区 → ⑤ 持工具态。
 *
 * - **进行中手势（active gesture）** = 画笔 / 拖拽移动（含拖带捏形）/ 框选矩形 / 右键删除预览。
 *   只要它在，锚点、选区、工具态**一律不动** —— 一次 Esc 只取消一层。
 * - 取消手势后**保持工具态与选区**（Esc = 撤销这次操作，不是退出工具），并作废到 mouseup
 *   （期间 move/up 短路，否则"被取消的这一笔"会变成另一次手势，见 issue 109 症状 2）。
 */
export function resolveEscapeTarget(snap: {
    /** 画笔进行中 */
    pen: boolean;
    /** 拖拽移动 / 拖带捏形进行中 */
    drag: boolean;
    /** 按下后未抬起（含框选矩形进行中 / 单击起手） */
    box: boolean;
    /** 右键按住的删除预览中 */
    rightHeld: boolean;
    /** 有待连接滑条锚点或曲线链式草稿 */
    anchor: boolean;
    /** 有选区或起点标记选中 */
    selection: boolean;
    /** 有持工具态 */
    tool: boolean;
}): EscapeTarget {
    if (snap.pen || snap.drag || snap.box || snap.rightHeld) return 'gesture';
    if (snap.anchor) return 'anchor';
    if (snap.selection) return 'selection';
    if (snap.tool) return 'tool';
    return null;
}
