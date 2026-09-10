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
import { sameSelectionItem, type MatrixTool } from './ToolActionMatrix';
import { GUTTER_LABEL_FONT_PX, bpmLabelBox } from '../../visual/gutterLabels';

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
}

export type PressIntent = { kind: 'drag'; anchor: DragAnchor } | { kind: 'marquee' };

/**
 * §6 按下意图仲裁：这一次按下是「拖拽移动」还是「框选」。
 * 任一步不合法都退回框选（防误拖），不产生半截拖拽态。
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

    return {
        kind: 'drag',
        anchor: { items, pressLane: p.lane, anchorBeat, rawPressBeat: p.rawBeat },
    };
}

/**
 * 松开结算的优先级表（issue 63：window 接管后 e 可能是 null = 失焦等异常收尾）。
 * - `continue`  非左键抬起：手势继续，不动任何状态（调用方直接 return，不清理）
 * - `abort`     只收手势态，不触发任何动作
 * - `commitDrag` / `commitBox` / `click` 各自消费调用方**已捕获**的快照
 */
export type ReleaseIntent = 'continue' | 'abort' | 'commitDrag' | 'commitBox' | 'click';

export function resolveReleaseIntent(input: {
    /** null = 失焦等异常收尾（mouseup 永远不来） */
    e: { button?: number } | null;
    start: { x: number; y: number; vx: number; vy: number } | null;
    /** 是否已越过拖拽阈值（区分单击与框选/拖拽） */
    moved: boolean;
    drag: DragAnchor | null;
    box: { x1: number; y1: number; x2: number; y2: number } | null;
}): ReleaseIntent {
    if (input.e && input.e.button !== 0) return 'continue';
    if (!input.start || !input.e || input.e.button !== 0) return 'abort';
    if (input.moved) {
        if (input.drag) return 'commitDrag';
        return input.box ? 'commitBox' : 'abort';
    }
    return 'click';
}

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
    // 动作族（删除/镜像）与「音符代码」才需要音符命中（空白 = 无效果不清选区）；其余行只吃栅格落点。
    // 复制/剪切已按 §2.1 退出工具轴（不 arm），故不在其中。
    const tool = input.armedTool;
    const needHit = tool === 'delete' || tool === 'mirror' || tool === 'noteCode';
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

/** 越过谱面末端的判据（ADR-0005 §5）：放置与执行键**共用同一 epsilon**，不得各写一份 */
export const CHART_END_EPS = 1e-6;

export function isPastChartEnd(beat: number, chartEndBeat: number): boolean {
    return beat > chartEndBeat + CHART_END_EPS;
}

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
