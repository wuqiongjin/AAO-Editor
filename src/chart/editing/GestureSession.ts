// 画布「进行中手势」深模块（issue 113）：生命周期 + 状态所有权 + 视口变化重算。
// 判定表（CanvasGesture / NoteDragging / ToolActionMatrix）一行不动；本类只编排。
// React 层通过 subscribe(snapshot) 拿五个渲染镜像，通过 begin/move/end/cancel 拿 ops。
import type { ChartNote, SelectionItem, SlideNote } from '../types';
import type { ChartGeometry, SurfaceSize } from '../geometry/ChartGeometry';
import type { HitTestDeps } from '../../visual/hitTest';
import { computeBpmLinesInBox, computeItemsInBox, findBpmLineAt, findItemAt } from '../../visual/hitTest';
import type { ViewportState, SelectionBox } from '../../visual/types';
import { planDragMove, dragDeltaBeat, type DragDelta } from './NoteDragging';
import {
  actionOnTargetsOps,
  boxSelectOps,
  clickOps,
  pointerClickSelection,
  resolveActionTargets,
  type MatrixOp,
  type MatrixTool,
  type SlidePoint,
} from './ToolActionMatrix';
import { placeSpanWithCombination, type CurveConfig, type CurveDraft } from './CurveTool';
import { buildPenSlide } from './SpanCurve';
import {
  snapChartPos,
  resolvePressIntent,
  resolveReleaseIntent,
  resolveClickPlan,
  hasMovedBeyondThreshold,
  marqueeRect,
  canStartMarquee,
  resolveBoxPlan,
  penCursorAt,
  penAppendSamples,
  penExitCrossing,
  penMaxBeatsForCanvasDy,
  resolvePenStroke,
  finalizePenStrokeCommit,
  nextBpmGutterAction,
  type DragAnchor,
  type BpmGutterHit,
} from './CanvasGesture';

/** 画笔光标（验收反馈 #6）：内联 data-uri SVG（铅笔、笔尖为热点） */
export const PEN_CURSOR = `url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='24'%20height='24'%3E%3Cpath%20d='M3%2021%20L5.5%2014.5%20L17%203%20L21%207%20L9.5%2018.5%20Z'%20fill='%23ffe082'%20stroke='%23333'%20stroke-width='1.5'%20stroke-linejoin='round'/%3E%3Cpath%20d='M3%2021%20L5.5%2014.5%20L9.5%2018.5%20Z'%20fill='%23333'/%3E%3C/svg%3E") 3 21, crosshair`;

/** 画笔视觉激活的按住时长（验收反馈 #6：单击不该闪画笔态） */
export const PEN_HOLD_MS = 200;

const DRAG_THRESHOLD_PX = 4;
/**
 * 框选阈值（issue 141）：拖拽移动仍是 4px（要跟手），**框选抬到 8px**。
 * 4px 时持工具态放音符手一抖就越线，松手走 commitBox → 那一击的放置被吃掉（框内有音符时还会变成批量换型）。
 */
const MARQUEE_THRESHOLD_PX = 8;

export type GestureOp =
  | MatrixOp
  | { t: 'closeBpmEditor' }
  | { t: 'setBpmExpansion'; key: number | null };

export interface GestureSnapshot {
  dragGhost: ChartNote[] | null;
  penPreview: SlideNote | null;
  penActive: boolean;
  selectionBox: SelectionBox | null;
  rightButtonHeld: boolean;
  cursorStyle: string;
}

export interface GestureResult {
  ops: GestureOp[];
  preview: GestureSnapshot;
  /** cancel()：本档是否消费了 Esc */
  consumed?: boolean;
}

export interface GestureWorld {
  notes: ChartNote[];
  selectedItems: SelectionItem[];
  armedTool: MatrixTool | null;
  beatDisplay: number;
  chartEndBeat: number;
  geometry: ChartGeometry;
  viewport: ViewportState;
  surface: SurfaceSize;
  clipboard: ChartNote[];
  slideBuffer: SlidePoint | null;
  curveDraft: CurveDraft | null;
  curveConfig: CurveConfig;
  lastBpm: number;
  noteSize: number;
  hitStartMarker: (cx: number, cy: number) => boolean;
  hitBpmGutter: (cx: number, cy: number) => BpmGutterHit | null;
  expandedBpmGroupKey: number | null;
}

export interface GestureBeginInput {
  x: number;
  y: number;
  vx: number;
  vy: number;
  button: number;
  shiftKey: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export interface GestureMoveInput {
  x: number;
  y: number;
}

export interface GestureEndInput {
  x: number;
  y: number;
  button?: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface GestureSessionHost {
  setCursor: (style: string) => void;
  attachWindow: () => void;
  detachWindow: () => void;
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

type PenState = {
  start: SlidePoint;
  samples: { beat: number; lane: number }[];
  last: { beat: number; lane: number };
  dir: 0 | 1 | -1;
  lastValid: { x: number; y: number };
  exitFrozen: boolean;
};

const emptySnapshot = (): GestureSnapshot => ({
  dragGhost: null,
  penPreview: null,
  penActive: false,
  selectionBox: null,
  rightButtonHeld: false,
  cursorStyle: '',
});

export type GestureSessionListener = (snapshot: GestureSnapshot) => void;

/**
 * 进行中手势的单一所有者。不持有 React state；外部 subscribe + applyOps。
 * 内核只保留一份「当前手势输入位置（px）」。
 */
export class GestureSession {
  private host: GestureSessionHost;
  private world: GestureWorld | null = null;
  private listeners = new Set<GestureSessionListener>();
  private snap: GestureSnapshot = emptySnapshot();

  private start: { x: number; y: number; vx: number; vy: number } | null = null;
  private moved = false;
  private cancelled = false;
  /** 手势进行中最后一次输入的画布坐标（拖拽/框选/画笔共用这一份） */
  private pointerPx: { x: number; y: number } | null = null;

  private drag: DragAnchor | null = null;
  private dragFrozen: { notes: ChartNote[]; items: SelectionItem[] } | null = null;
  private pen: PenState | null = null;
  private penHoldTimer: number | null = null;

  constructor(host: GestureSessionHost) {
    this.host = host;
  }

  bindWorld(world: GestureWorld): void {
    this.world = world;
  }

  subscribe(listener: GestureSessionListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getSnapshot(): GestureSnapshot {
    return this.snap;
  }

  /** Esc 快照的手势四旗（②档）；③–⑤ 由 Editor 另填，本会话不伪造。 */
  escapeGestureFlags(): { pen: boolean; drag: boolean; box: boolean; rightHeld: boolean } {
    return {
      pen: this.pen !== null,
      drag: this.drag !== null,
      box: this.start !== null,
      rightHeld: this.snap.rightButtonHeld,
    };
  }

  /** 左键已按下、window 正在接管手势 */
  isPressed(): boolean {
    return this.start !== null;
  }

  destroy(): void {
    this.clearPenTimer();
    this.host.detachWindow();
  }

  begin(input: GestureBeginInput): GestureResult {
    this.cancelled = false;
    if (input.button === 2) {
      // issue 158：右键也记按下点 + 接管 window，才能过 8px 起框；不启拖拽。
      this.clearPenTimer();
      this.start = { x: input.x, y: input.y, vx: input.vx, vy: input.vy };
      this.moved = false;
      this.pointerPx = { x: input.x, y: input.y };
      this.drag = null;
      this.dragFrozen = null;
      this.pen = null;
      this.patchSnap({
        rightButtonHeld: true,
        selectionBox: null,
        dragGhost: null,
        penPreview: null,
        penActive: false,
      });
      this.host.attachWindow();
      return this.result();
    }
    if (input.button !== 0) {
      return this.result();
    }
    this.clearPenTimer();
    this.patchSnap({ dragGhost: null, penPreview: null, penActive: false, selectionBox: null });
    this.start = { x: input.x, y: input.y, vx: input.vx, vy: input.vy };
    this.moved = false;
    this.pointerPx = { x: input.x, y: input.y };
    this.drag = null;
    this.dragFrozen = null;
    const ops = this.beginDragCandidate(input.x, input.y, input.shiftKey);
    this.host.attachWindow();
    return this.result(ops);
  }

  move(input: GestureMoveInput): GestureResult {
    const w = this.requireWorld();
    this.pointerPx = { x: input.x, y: input.y };
    if (this.cancelled) return this.result();
    if (this.snap.rightButtonHeld) return this.moveRightMarquee(input);
    if (!this.start) return this.result();
    // issue 141：阈值按**按下意图**分档 —— 拖拽 / 画笔 4px（要跟手），框选 8px（防手抖吃掉放置那一击）。
    // `pen` 在 `beginDragCandidate` 里按下即置位，故此处能据此分档（不用等到画笔视觉激活）。
    const threshold = this.drag || this.pen ? DRAG_THRESHOLD_PX : MARQUEE_THRESHOLD_PX;
    if (!hasMovedBeyondThreshold(this.start, { x: input.x, y: input.y }, threshold)) {
      return this.result();
    }
    this.moved = true;
    if (this.drag) {
      this.host.setCursor('grabbing');
      this.patchSnap({ cursorStyle: 'grabbing' });
      const d = this.dragDelta(input.x, input.y, this.drag);
      if (d && (d.dBeat !== 0 || d.dLane !== 0)) {
        const r = planDragMove(w.notes, this.drag.items, d, {
          chartEndBeat: w.chartEndBeat,
          beatDisplay: w.beatDisplay,
        });
        if (r.ok) {
          const ghost = r.ghost;
          this.patchSnap({
            dragGhost: d.dBeat === 0 && d.dLane === 0 || !ghost || ghost.length === 0 ? null : ghost,
          });
          this.dragFrozen = { notes: r.notes, items: r.items };
        }
      }
      return this.result();
    }
    if (this.pen) {
      this.activatePenVisual();
      this.samplePen(input.x, input.y);
      return this.result();
    }
    const ops: GestureOp[] = [];
    if (w.slideBuffer !== null) ops.push({ t: 'setSlideBuffer', point: null });
    if (!canStartMarquee(w.armedTool)) return this.result(ops);
    this.patchSnap({
      selectionBox: marqueeRect({
        start: this.start,
        curCanvas: { x: input.x, y: input.y },
        deps: { geometry: w.geometry, viewport: w.viewport },
        surface: w.surface,
      }),
    });
    return this.result(ops);
  }

  end(e: GestureEndInput | null): GestureResult {
    if (this.cancelled) {
      this.cancelled = false;
      return this.result();
    }
    if (this.snap.rightButtonHeld) {
      if (!e || e.button === 2) return this.commitRightUp(e);
      return this.result();
    }
    const start = this.start;
    const moved = this.moved;
    const box = this.snap.selectionBox;
    const drag = this.drag;
    const pen = this.pen;
    const intent = resolveReleaseIntent({
      e, start, moved, drag, box, pen: pen !== null,
    });
    if (intent === 'continue') return this.result();

    this.start = null;
    this.drag = null;
    this.pen = null;
    this.pointerPx = null;
    this.moved = false;
    this.clearPenTimer();
    this.host.setCursor('');
    this.patchSnap({
      dragGhost: null,
      penPreview: null,
      penActive: false,
      selectionBox: null,
      cursorStyle: '',
    });
    this.host.detachWindow();

    if (intent === 'abort' || !start || !e) return this.result();

    if (intent === 'commitPen' && pen) return this.result(this.commitPen(pen, e));
    if (intent === 'commitDrag' && drag) return this.result(this.commitDrag(drag, e));
    if (intent === 'commitBox' && box) return this.result(this.commitBox(box));
    if (intent === 'click') {
      const w = this.requireWorld();
      const p = w.geometry.virtualToCanvas(start.vx, start.vy, w.viewport);
      return this.result(this.clickAt(p.x, p.y, e));
    }
    return this.result();
  }

  cancel(): GestureResult {
    const g = this.escapeGestureFlags();
    if (!g.pen && !g.drag && !g.box && !g.rightHeld) return { ...this.result(), consumed: false };
    this.cancelled = true;
    this.pen = null;
    this.drag = null;
    this.dragFrozen = null;
    this.start = null;
    this.moved = false;
    this.pointerPx = null;
    this.clearPenTimer();
    this.host.setCursor('');
    this.patchSnap({
      dragGhost: null,
      penPreview: null,
      penActive: false,
      selectionBox: null,
      rightButtonHeld: false,
      cursorStyle: '',
    });
    this.host.detachWindow();
    return { ...this.result(), consumed: true };
  }

  onViewportChange(viewport: ViewportState, geometry: ChartGeometry, surface: SurfaceSize): GestureResult {
    if (this.world) {
      this.world = { ...this.world, viewport, geometry, surface };
    }
    const w = this.world;
    if (!w || !this.start || !this.moved) return this.result();
    const cursor = this.pointerPx;
    if (cursor && !this.drag) {
      this.patchSnap({
        selectionBox: marqueeRect({
          start: { vx: this.start.vx, vy: this.start.vy },
          curCanvas: cursor,
          deps: { geometry, viewport },
          surface,
        }),
      });
      return this.result();
    }
    const drag = this.drag;
    if (!drag || !cursor) return this.result();
    const d = this.dragDelta(cursor.x, cursor.y, drag);
    if (!d || (d.dBeat === 0 && d.dLane === 0)) return this.result();
    const r = planDragMove(w.notes, drag.items, d, {
      chartEndBeat: w.chartEndBeat,
      beatDisplay: w.beatDisplay,
    });
    if (r.ok) {
      const ghost = r.ghost;
      this.patchSnap({
        dragGhost: d.dBeat === 0 && d.dLane === 0 || !ghost || ghost.length === 0 ? null : ghost,
      });
      this.dragFrozen = { notes: r.notes, items: r.items };
    }
    return this.result();
  }

  onToolChange(armedTool: MatrixTool | null): GestureResult {
    if (armedTool !== 'curve') {
      this.pen = null;
      this.clearPenTimer();
      const dropPenCursor = this.snap.cursorStyle === PEN_CURSOR;
      if (this.snap.penPreview || this.snap.penActive || dropPenCursor) {
        if (dropPenCursor) this.host.setCursor('');
        this.patchSnap({
          penPreview: null,
          penActive: false,
          cursorStyle: dropPenCursor ? '' : this.snap.cursorStyle,
        });
      }
    }
    return this.result();
  }

  private commitRightUp(e: GestureEndInput | null): GestureResult {
    const box = this.snap.selectionBox;
    this.start = null;
    this.moved = false;
    this.pointerPx = null;
    this.host.setCursor('');
    this.patchSnap({
      rightButtonHeld: false,
      selectionBox: null,
      cursorStyle: '',
    });
    this.host.detachWindow();
    if (!e) return this.result();
    if (!this.insideSurface(e.x, e.y)) return this.result();
    const w = this.requireWorld();
    if (box) {
      const boxDeps = {
        geometry: w.geometry,
        viewport: w.viewport,
        beatDisplay: w.beatDisplay,
        notes: w.notes,
      };
      const items = computeItemsInBox(box, boxDeps);
      const bpmInBox = computeBpmLinesInBox(box, boxDeps);
      return this.result(boxSelectOps('delete', w.notes, items, bpmInBox, w.curveConfig, w.beatDisplay));
    }
    const hit = findItemAt(e.x, e.y, this.hitDeps()) ?? findBpmLineAt(e.x, e.y, this.hitDeps());
    if (!hit) return this.result();
    return this.result([
      ...actionOnTargetsOps('delete', w.notes, resolveActionTargets(hit, w.selectedItems)),
      { t: 'setSlideBuffer', point: null },
      { t: 'closeBpmEditor' },
    ]);
  }

  /** 右键框选：过 8px 起框；不走 canStartMarquee（粘贴/音符代码左键例外不套右键）。 */
  private moveRightMarquee(input: GestureMoveInput): GestureResult {
    if (!this.start) return this.result();
    if (!hasMovedBeyondThreshold(this.start, { x: input.x, y: input.y }, MARQUEE_THRESHOLD_PX)) {
      return this.result();
    }
    this.moved = true;
    const w = this.requireWorld();
    this.patchSnap({
      selectionBox: marqueeRect({
        start: this.start,
        curCanvas: { x: input.x, y: input.y },
        deps: { geometry: w.geometry, viewport: w.viewport },
        surface: w.surface,
      }),
    });
    return this.result();
  }

  private beginDragCandidate(cx: number, cy: number, shiftKey: boolean): GestureOp[] {
    const w = this.requireWorld();
    const intent = resolvePressIntent({
      cx, cy, armedTool: w.armedTool, shiftKey,
      onMarker: w.hitStartMarker(cx, cy),
      deps: this.hitDeps(),
      selectedItems: w.selectedItems,
      chartEndBeat: w.chartEndBeat,
    });
    const ops: GestureOp[] = [];
    if (intent.kind === 'drag') {
      this.drag = intent.anchor;
      this.dragFrozen = null;
    }
    if (intent.kind === 'pen') {
      if (w.selectedItems.length > 0) ops.push({ t: 'setSelection', items: [] });
      this.pen = {
        start: { beat: intent.start.beat, lane: intent.start.lane, subBeat: 0 },
        samples: [],
        last: { beat: intent.start.beat, lane: intent.start.lane },
        dir: 0,
        lastValid: { x: cx, y: cy },
        exitFrozen: false,
      };
      this.patchSnap({ penPreview: null });
      this.penHoldTimer = this.host.setTimeout(() => this.activatePenVisual(), PEN_HOLD_MS);
    }
    return ops;
  }

  private samplePen(mouseX: number, mouseY: number): void {
    const w = this.requireWorld();
    const pen = this.pen;
    if (!pen) return;
    const step = 1 / w.curveConfig.precision;
    const oracle = (cx: number, cy: number) =>
      penCursorAt({ geometry: w.geometry, viewport: w.viewport, beatDisplay: w.beatDisplay }, w.chartEndBeat, cx, cy);
    const prevCanvasY = pen.lastValid.y;
    const cur = oracle(mouseX, mouseY);
    let target = cur;
    if (target) {
      pen.exitFrozen = false;
      pen.lastValid = { x: mouseX, y: mouseY };
    } else if (!pen.exitFrozen) {
      const hit = penExitCrossing(oracle, pen.lastValid, { x: mouseX, y: mouseY });
      if (hit) {
        pen.exitFrozen = true;
        target = hit.point;
        pen.lastValid = { x: hit.x, y: hit.y };
      }
    }
    if (!target) return;
    const maxBeats = penMaxBeatsForCanvasDy(
      { geometry: w.geometry, viewport: w.viewport }, target.beat, Math.abs(mouseY - prevCanvasY));
    const { samples: appended, dir } = penAppendSamples(pen.last, target, step, pen.dir, maxBeats);
    pen.dir = dir;
    for (const s of appended) {
      pen.samples.push(s);
      pen.last = s;
    }
    const far = pen.samples.at(-1);
    const stroke = far
      ? resolvePenStroke(pen.start, pen.samples, pen.dir, { beat: far.beat, lane: far.lane })
      : null;
    this.patchSnap({
      penPreview: stroke ? buildPenSlide(stroke.from, stroke.middles, stroke.to) : null,
    });
  }

  private commitPen(pen: PenState, e: GestureEndInput): GestureOp[] {
    const w = this.requireWorld();
    let release = this.snapPos(e.x, e.y);
    if (!release) release = this.snapPos(pen.lastValid.x, pen.lastValid.y);
    if (!release) return [];
    const raw = resolvePenStroke(pen.start, pen.samples, pen.dir, { beat: release.beat, lane: release.lane });
    const stroke = raw ? finalizePenStrokeCommit(pen.start, raw, w.beatDisplay) : null;
    if (!stroke) return [];
    const samples = stroke.middles.map((s) => ({ beat: s.beat, lane: s.lane, hidden: true as const }));
    const notes = placeSpanWithCombination(w.notes, stroke.from, stroke.to, samples, null, w.beatDisplay);
    const ops: GestureOp[] = [{ t: 'setNotes', notes }];
    if (w.curveDraft) ops.push({ t: 'setCurveBuffer', draft: null });
    return ops;
  }

  private commitDrag(drag: DragAnchor, e: GestureEndInput): GestureOp[] {
    const w = this.requireWorld();
    const d = this.dragDelta(e.x, e.y, drag);
    const frozen = this.dragFrozen;
    this.dragFrozen = null;
    if (!d && frozen) {
      return [
        { t: 'setNotes', notes: frozen.notes },
        { t: 'setSelection', items: frozen.items },
      ];
    }
    if (d && (d.dBeat !== 0 || d.dLane !== 0)) {
      const r = planDragMove(w.notes, drag.items, d, {
        chartEndBeat: w.chartEndBeat,
        beatDisplay: w.beatDisplay,
      });
      if (r.ok) {
        return [
          { t: 'setNotes', notes: r.notes },
          { t: 'setSelection', items: r.items },
        ];
      }
    }
    return [];
  }

  private commitBox(box: SelectionBox): GestureOp[] {
    const w = this.requireWorld();
    const boxDeps = {
      geometry: w.geometry,
      viewport: w.viewport,
      beatDisplay: w.beatDisplay,
      notes: w.notes,
    };
    const items = computeItemsInBox(box, boxDeps);
    if (resolveBoxPlan(w.armedTool) === 'select') {
      return [{ t: 'setSelection', items }];
    }
    const bpmInBox = w.armedTool === 'delete' ? computeBpmLinesInBox(box, boxDeps) : [];
    return boxSelectOps(w.armedTool as MatrixTool, w.notes, items, bpmInBox, w.curveConfig, w.beatDisplay);
  }

  private clickAt(cx: number, cy: number, e: GestureEndInput): GestureOp[] {
    const w = this.requireWorld();
    const gutterHit = w.hitBpmGutter(cx, cy);
    const expansion = nextBpmGutterAction(gutterHit);
    const plan = resolveClickPlan({
      cx, cy, armedTool: w.armedTool,
      shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
      deps: this.hitDeps(),
      notes: w.notes,
      snap: this.snapPos(cx, cy),
      bpmGutterHit: gutterHit,
      onMarker: w.hitStartMarker(cx, cy),
    });
    const ops: GestureOp[] = [];
    if (expansion.expandedKey !== w.expandedBpmGroupKey) {
      ops.push({ t: 'setBpmExpansion', key: expansion.expandedKey });
    }
    if (plan.kind === 'expandBpmSummary' || plan.kind === 'keepBpmExpansion') {
      return ops;
    }
    if (plan.kind === 'editBpm') {
      ops.push({ t: 'openBpmEditor', beat: plan.beat, value: plan.value });
      return ops;
    }
    if (plan.kind === 'ignoreMarker') {
      return ops;
    }
    if (plan.kind === 'selectItem') {
      return [
        ...ops,
        { t: 'setSelection', items: pointerClickSelection(w.selectedItems, findItemAt(cx, cy, this.hitDeps()), plan.additive, plan.ctrl) },
      ];
    }
    return [
      ...ops,
      ...clickOps({
        tool: w.armedTool as MatrixTool,
        notes: w.notes,
        hit: plan.hit,
        pos: plan.pos,
        slideBuffer: w.slideBuffer,
        lastBpm: w.lastBpm,
        clipboard: w.clipboard,
        chartEndBeat: w.chartEndBeat,
        beatDisplay: w.beatDisplay,
        selectedItems: w.selectedItems,
        curveDraft: w.curveDraft,
        curveConfig: w.curveConfig,
      }),
    ];
  }

  private dragDelta(mx: number, my: number, drag: DragAnchor | null): DragDelta | null {
    if (!drag) return null;
    const w = this.requireWorld();
    const cur = this.snapPos(mx, my, true);
    if (!cur) return null;
    const rawCurBeat = w.geometry.layerBeatFromCanvas(my, w.viewport, drag.layerSegment);
    return {
      dBeat: dragDeltaBeat({
        anchorBeat: drag.anchorBeat,
        rawPressBeat: drag.rawPressBeat,
        rawCurBeat,
        beatDisplay: w.beatDisplay,
      }),
      dLane: cur.lane - drag.pressLane,
      grabBeat: drag.rawPressBeat,
    };
  }

  private snapPos(cx: number, cy: number, allowOutsideLane = false) {
    const w = this.requireWorld();
    return snapChartPos(
      { geometry: w.geometry, viewport: w.viewport, beatDisplay: w.beatDisplay },
      w.chartEndBeat, cx, cy, allowOutsideLane,
    );
  }

  private hitDeps(): HitTestDeps {
    const w = this.requireWorld();
    return {
      geometry: w.geometry,
      viewport: w.viewport,
      beatDisplay: w.beatDisplay,
      notes: w.notes,
      noteSize: w.noteSize,
    };
  }

  private insideSurface(x: number, y: number): boolean {
    const w = this.requireWorld();
    return x >= 0 && y >= 0 && x < w.surface.w && y < w.surface.h;
  }

  private activatePenVisual(): void {
    this.clearPenTimer();
    if (this.snap.penActive) return;
    this.host.setCursor(PEN_CURSOR);
    this.patchSnap({ penActive: true, cursorStyle: PEN_CURSOR });
  }

  private clearPenTimer(): void {
    if (this.penHoldTimer !== null) {
      this.host.clearTimeout(this.penHoldTimer);
      this.penHoldTimer = null;
    }
  }

  private patchSnap(partial: Partial<GestureSnapshot>): void {
    this.snap = { ...this.snap, ...partial };
    for (const l of this.listeners) l(this.snap);
  }

  private result(ops: GestureOp[] = []): GestureResult {
    return { ops, preview: this.snap };
  }

  private requireWorld(): GestureWorld {
    if (!this.world) throw new Error('GestureSession.bindWorld() 必须在 begin/move/end 之前调用');
    return this.world;
  }
}
