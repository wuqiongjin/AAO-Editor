// issue 70：画布手势仲裁的锁表单测 —— 编排层此前**零覆盖**（这些判定原样内联在
// FinalVirtualCanvas.tsx 里，无法在 node 下断言）。本文件把它们锁成可执行的行为契约。
//
// 语义权威 = ADR-0008。改这里任何一条 = 改 ADR-0008，必须先改文档再改本表。
import { describe, it, expect } from 'vitest';
import { ChartGeometry, LANES, LANE_WIDTH, TRACK_CHROME_TOTAL } from '../../src/chart/geometry/ChartGeometry';
import type { HitTestDeps } from '../../src/visual/hitTest';
import { bpmLabelBox } from '../../src/visual/gutterLabels';
import {
  snapChartPos, hitStartMarkerAt, hitBpmLabelAt,
  resolvePressIntent, resolveReleaseIntent, resolveClickPlan,
  isInsideSurface, clampToSurface, hasMovedBeyondThreshold, marqueeRect,
  canStartMarquee, resolveBoxPlan,
  isPastChartEnd, canPlaceAtCursor, resolveExecNoteCodeHit, freezeGestureCursor,
  penExitCrossing, penCursorAt, resolveEscapeTarget,
  type GutterMeasure, type PenPoint,
} from '../../src/chart/editing/CanvasGesture';
import type { ChartNote, SelectionItem } from '../../src/chart/types';

const bpm120 = [{ beat: 0, bpm: 120 }];
const TEST_SURFACE = { w: 750, h: 900 };
const BEAT_DISPLAY = 4;

/** scale=1 / scrollY=0 的视图；画布坐标 == 虚拟坐标（x 含 trackBgX 偏移） */
function makeDeps(notes: ChartNote[], chartEndBeat = 100) {
  const geometry = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , TEST_SURFACE);
  const viewport = { scrollX: 0, scrollY: 0, scale: 1 };
  const deps: HitTestDeps = { geometry, viewport, beatDisplay: BEAT_DISPLAY, notes };
  /** (lane, beat) → 画布坐标 */
  const at = (lane: number, beat: number, subBeat = 0) =>
    geometry.virtualToCanvas(
      geometry.noteVirtualX(lane),
      geometry.noteVirtualY(beat, subBeat, viewport.scale, BEAT_DISPLAY),
      viewport,
    );
  return { geometry, viewport, deps, at };
}

const single = (lane: number, beat: number): ChartNote => ({ type: 'Single', lane, beat });
const bpmNote = (beat: number, bpm: number): ChartNote => ({ type: 'BPM', beat, bpm });
const flat: GutterMeasure = (_t, fontPx) => 3 * fontPx * 0.62;

// ─────────────────────────── snapChartPos：落点合法性（ADR-0005 §5） ───────────────────────────
describe('snapChartPos 落点合法性', () => {
  const notes: ChartNote[] = [bpmNote(0, 120)];

  it('轨道内合法落点：beat 已量化、rawBeat 保留未量化值（issue 61）', () => {
    const { deps, at } = makeDeps(notes);
    const p = at(2, 50);
    const r = snapChartPos(deps, 100, p.x, p.y);
    expect(r).not.toBeNull();
    expect(r!.lane).toBe(2);
    expect(r!.beat).toBeCloseTo(50, 6);
    expect(r!.rawBeat).toBeCloseTo(50, 6);
  });

  it('轨道外 lane → null（放置不能往轨道外落子）', () => {
    const { geometry, deps, at } = makeDeps(notes);
    const p = at(2, 50);
    // 退到轨道左缘之外（trackBgX 以左）
    const { trackBgX } = geometry.trackGeometry(1);
    expect(snapChartPos(deps, 100, trackBgX - 5, p.y)).toBeNull();
  });

  it('issue 66 §4a：allowOutsideLane=true 时轨道外 lane 照实返回（方向滑键组尾可起拖）', () => {
    const { geometry, deps, at } = makeDeps(notes);
    const p = at(2, 50);
    const { trackBgX } = geometry.trackGeometry(1);
    const r = snapChartPos(deps, 100, trackBgX - 5, p.y, true);
    expect(r).not.toBeNull();
    expect(r!.lane).toBeLessThan(0); // 越界轨号照实给出，供 dLane 相对位移
  });

  it('超出谱面末端 → null（ADR-0005 §5）', () => {
    const { deps, at } = makeDeps(notes, 100);
    const p = at(2, 100);
    // 谱面末端之后一拍（beat 101 > chartEndBeat 100）
    const after = at(2, 101);
    expect(snapChartPos(deps, 100, p.x, p.y)).not.toBeNull();
    expect(snapChartPos(deps, 100, after.x, after.y)).toBeNull();
  });
});

// ─────────────────────────── hitStartMarkerAt：起点标记（ADR-0004 §4） ───────────────────────────
describe('hitStartMarkerAt 起点标记命中', () => {
  const notes: ChartNote[] = [bpmNote(0, 120)];

  it('未设标记 → 恒 false', () => {
    const { deps, at } = makeDeps(notes);
    const p = at(2, 50);
    expect(hitStartMarkerAt(deps, null, p.x, p.y)).toBe(false);
  });

  it('标记线上（左沟槽）→ true', () => {
    const { geometry, viewport, deps } = makeDeps(notes);
    const { trackBgX } = geometry.trackGeometry(1);
    const y = geometry.virtualToCanvas(0, geometry.beatToVirtualY(20, 1), viewport).y;
    expect(hitStartMarkerAt(deps, 20, trackBgX - 10, y)).toBe(true);
  });

  it('偏离标记线 > 10×scale → false', () => {
    const { geometry, viewport, deps } = makeDeps(notes);
    const { trackBgX } = geometry.trackGeometry(1);
    const y = geometry.virtualToCanvas(0, geometry.beatToVirtualY(20, 1), viewport).y;
    expect(hitStartMarkerAt(deps, 20, trackBgX - 10, y + 40)).toBe(false);
  });

  it('轨道内（cx >= trackBgX）→ false（标记只活在左沟槽）', () => {
    const { geometry, viewport, deps } = makeDeps(notes);
    const { trackBgX } = geometry.trackGeometry(1);
    const y = geometry.virtualToCanvas(0, geometry.beatToVirtualY(20, 1), viewport).y;
    expect(hitStartMarkerAt(deps, 20, trackBgX + 20, y)).toBe(false);
  });
});

// ───────────────────── hitBpmLabelAt：BPM 数字命中盒（ADR-0008 §5 修订） ─────────────────────
describe('hitBpmLabelAt BPM 数字文字盒', () => {
  const notes: ChartNote[] = [bpmNote(0, 120), bpmNote(20, 150)];

  /** 把 beat 20 滚到画面中央：屏外 BPM 的盒子会被 bpmLabelBox 钳到边界而互相重叠，
   *  那样的视口测不出"选中哪一条"。 */
  function makeBpmDeps() {
    const geometry = new ChartGeometry(bpm120, { endBeat: 100 } , TEST_SURFACE);
    const scrollY = geometry.beatToVirtualY(20, 1) - TEST_SURFACE.h / 2;
    const viewport = { scrollX: 0, scrollY, scale: 1 };
    const deps: HitTestDeps = { geometry, viewport, beatDisplay: BEAT_DISPLAY, notes };
    const yOf = (beat: number) =>
      geometry.virtualToCanvas(0, geometry.beatToVirtualY(beat, viewport.scale), viewport).y;
    const boxOf = (beat: number) => {
      const { trackStartX } = geometry.trackGeometry(viewport.scale);
      return bpmLabelBox(trackStartX, yOf(beat), '150', 1, TEST_SURFACE.h, flat('150', 21));
    };
    const hit = (cx: number, cy: number) =>
      hitBpmLabelAt({ deps, labelScale: 1, surfaceH: TEST_SURFACE.h, measureWidth: flat }, cx, cy);
    return { geometry, viewport, deps, yOf, boxOf, hit };
  }

  it('命中数字盒内 → 返回该 BPM 的 beat', () => {
    const { boxOf, hit, yOf } = makeBpmDeps();
    const box = boxOf(20);
    expect(box.x1).toBeGreaterThan(20); // 自校验：盒在沟槽内，左侧还有可点的空间
    expect(yOf(20)).toBeGreaterThan(0); // 自校验：目标 BPM 确实在画面内
    expect(hit((box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2)).toBe(20);
  });

  it('2026-09-08 修订：同一高度但落在文字盒**左侧** → null（不是整条水平线）', () => {
    // 旧实现把数字所在的整条水平线都判成命中，导致该高度上左沟槽的双击
    // 永远被吃掉、起点标记手势放不下去。
    const { boxOf, hit } = makeBpmDeps();
    const box = boxOf(20);
    expect(hit(box.x1 - 20, (box.y1 + box.y2) / 2)).toBeNull();
  });

  it('轨道内（cx >= trackBgX）→ null', () => {
    const { geometry, viewport, hit, yOf } = makeBpmDeps();
    const { trackBgX } = geometry.trackGeometry(viewport.scale);
    expect(hit(trackBgX + 5, yOf(20))).toBeNull();
  });

  it('纵向偏离该 BPM 线 → null', () => {
    const { boxOf, hit } = makeBpmDeps();
    const box = boxOf(20);
    expect(hit((box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2 + 60)).toBeNull();
  });
});

// ─────────────────────────── resolvePressIntent：按下 → 拖拽 / 框选（§6） ───────────────────────────
describe('resolvePressIntent 按下意图仲裁', () => {
  const notes: ChartNote[] = [bpmNote(0, 120), single(2, 50), single(3, 52)];

  const press = (over: {
    cx: number; cy: number;
    armedTool?: Parameters<typeof resolvePressIntent>[0]['armedTool'];
    shiftKey?: boolean;
    onMarker?: boolean;
    selectedItems?: SelectionItem[];
  }) => {
    const { deps, at } = makeDeps(notes);
    const p = at(2, 50);
    return resolvePressIntent({
      cx: over.cx ?? p.x,
      cy: over.cy ?? p.y,
      armedTool: over.armedTool ?? null,
      shiftKey: over.shiftKey ?? false,
      onMarker: over.onMarker ?? false,
      deps,
      selectedItems: over.selectedItems ?? [],
      chartEndBeat: 100,
    });
  };

  it('指针态按到单键 → drag，锚点拍位 = 被按住对象的真实拍位', () => {
    const r = press({});
    expect(r.kind).toBe('drag');
    if (r.kind !== 'drag') return;
    expect(r.anchor.anchorBeat).toBeCloseTo(50, 6);
    expect(r.anchor.pressLane).toBe(2);
    expect(r.anchor.items).toEqual([{ kind: 'note', noteIndex: 1 }]);
  });

  it('§6 三轮修订：任意持工具态 Shift+按住音符 = 移动', () => {
    expect(press({ armedTool: 'single', shiftKey: true }).kind).toBe('drag');
  });

  it('持工具态未按 Shift → 框选（防误拖）', () => {
    expect(press({ armedTool: 'single' }).kind).toBe('marquee');
  });

  it('按在起点标记线上 → 框选（标记线上按下不拖音符）', () => {
    expect(press({ onMarker: true }).kind).toBe('marquee');
  });

  it('按到空白 → 框选', () => {
    const { at } = makeDeps(notes);
    const blank = at(6, 90);
    expect(press({ cx: blank.x, cy: blank.y }).kind).toBe('marquee');
  });

  it('按到 BPM 线 → 框选（BPM 不可拖：findItemAt 完全跳过 BPM）', () => {
    const withBpm: ChartNote[] = [bpmNote(0, 120), bpmNote(50, 150)];
    const { deps, at } = makeDeps(withBpm);
    const p = at(6, 50); // 与 BPM 线同高，但该处无键音符
    const r = resolvePressIntent({
      cx: p.x, cy: p.y, armedTool: null, shiftKey: false, onMarker: false,
      deps, selectedItems: [], chartEndBeat: 100,
    });
    expect(r.kind).toBe('marquee');
  });

  it('命中 ∈ 选区且选区 ≥2 → 组拖（items = 整个选区）', () => {
    const sel: SelectionItem[] = [
      { kind: 'note', noteIndex: 1 },
      { kind: 'note', noteIndex: 2 },
    ];
    const r = press({ selectedItems: sel });
    expect(r.kind).toBe('drag');
    if (r.kind !== 'drag') return;
    expect(r.anchor.items).toEqual(sel);
  });

  it('命中 **不在** 选区 → 只拖命中项（选区不跟着走）', () => {
    const sel: SelectionItem[] = [{ kind: 'note', noteIndex: 2 }];
    const r = press({ selectedItems: sel });
    expect(r.kind).toBe('drag');
    if (r.kind !== 'drag') return;
    expect(r.anchor.items).toEqual([{ kind: 'note', noteIndex: 1 }]);
  });

  // issue 104 修法 8（ADR-0010 结论 5）：拖拽的 Δy→Δ拍 换算锚定**被拖元素自己所在的层**
  it('倒流区按到 L2 的音符 → layerSegment = 1，且按下拍位按该层换算（不是最大解那层）', () => {
    // 120 → -240(beat 5) → 120(beat 6.5)：折返带内同一 y 有三层，最大解层是 L3
    const fold = [{ beat: 0, bpm: 120 }, { beat: 5, bpm: -240 }, { beat: 6.5, bpm: 120 }];
    const foldNotes: ChartNote[] = [bpmNote(0, 120), single(2, 5.75)];
    const geometry = new ChartGeometry(fold, { seconds: 2.5 }, TEST_SURFACE);
    const viewport = { scrollX: 0, scrollY: 0, scale: 1 };
    const deps: HitTestDeps = { geometry, viewport, beatDisplay: BEAT_DISPLAY, notes: foldNotes };
    const p = geometry.virtualToCanvas(
      geometry.noteVirtualX(2),
      geometry.noteVirtualY(5.75, 0, 1, BEAT_DISPLAY),
      viewport,
    );
    const r = resolvePressIntent({
      cx: p.x, cy: p.y, armedTool: null, shiftKey: false, onMarker: false,
      deps, selectedItems: [], chartEndBeat: geometry.chartEndBeat,
    });
    expect(r.kind).toBe('drag');
    if (r.kind !== 'drag') return;
    expect(r.anchor.anchorBeat).toBeCloseTo(5.75, 6);
    expect(r.anchor.layerSegment).toBe(1);              // 倒流区段（L2）
    expect(r.anchor.rawPressBeat).toBeCloseTo(5.75, 6); // 层内换算 = 音符自身拍位
    // 反向哨兵：同一画布点的**最大 beat 解**在 L3（6.875），取错层会让拖拽位移按别的斜率走
    expect(geometry.layerBeatFromCanvas(p.y, viewport, 2)).toBeCloseTo(6.875, 6);
  });

  it('按到滑条区域 = 拖拽（issue 09 S3 / ADR-0009 §4 修订：区域可拖 = 拉弓变形，不再退框选）', () => {
    const slideNotes: ChartNote[] = [bpmNote(0, 120), {
      type: 'Slide', connections: [{ beat: 50, lane: 1 }, { beat: 54, lane: 4 }],
    }];
    const { deps, geometry, viewport } = makeDeps(slideNotes);
    // 两结点连线的中点 = 连接带区域
    const a = geometry.virtualToCanvas(geometry.noteVirtualX(1), geometry.noteVirtualY(50, 0, 1, BEAT_DISPLAY), viewport);
    const b = geometry.virtualToCanvas(geometry.noteVirtualX(4), geometry.noteVirtualY(54, 0, 1, BEAT_DISPLAY), viewport);
    const r = resolvePressIntent({
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      armedTool: null, shiftKey: false, onMarker: false,
      deps, selectedItems: [], chartEndBeat: 100,
    });
    expect(r.kind).toBe('drag');
    if (r.kind === 'drag') expect(r.anchor.items).toEqual([{ kind: 'slideRegion', noteIndex: 1, connIndex: 0 }]);
  });
});

// ─────────────────────────── resolveReleaseIntent：抬手优先级表（issue 63） ───────────────────────────
describe('resolveReleaseIntent 抬手结算优先级', () => {
  const start = { x: 10, y: 10, vx: 10, vy: 10 };
  const box = { x1: 0, y1: 0, x2: 20, y2: 20 };
  const drag = { items: [], pressLane: 0, anchorBeat: 0, rawPressBeat: 0 };
  const base = { e: { button: 0 } as { button?: number } | null, start, moved: false, drag: null, box: null };

  it('非左键抬起 → continue（手势继续，不动任何状态）', () => {
    expect(resolveReleaseIntent({ ...base, e: { button: 2 } })).toBe('continue');
  });

  it('e = null（失焦，mouseup 永远不来）→ abort', () => {
    expect(resolveReleaseIntent({ ...base, e: null })).toBe('abort');
  });

  it('无按下起点 → abort', () => {
    expect(resolveReleaseIntent({ ...base, start: null })).toBe('abort');
  });

  it('moved + drag → commitDrag', () => {
    expect(resolveReleaseIntent({ ...base, moved: true, drag })).toBe('commitDrag');
  });

  it('moved + 无 drag + box → commitBox', () => {
    expect(resolveReleaseIntent({ ...base, moved: true, box })).toBe('commitBox');
  });

  it('moved + 无 drag + 无 box → abort（框选被吞但没框 → 无动作）', () => {
    expect(resolveReleaseIntent({ ...base, moved: true })).toBe('abort');
  });

  it('未越过阈值 → click', () => {
    expect(resolveReleaseIntent(base)).toBe('click');
  });
});

// ─────────────────────────── resolveClickPlan：单击去向（§2 / §5） ───────────────────────────
describe('resolveClickPlan 单击去向', () => {
  const notes: ChartNote[] = [bpmNote(0, 120), bpmNote(20, 150), single(2, 50)];

  const plan = (over: {
    armedTool?: Parameters<typeof resolveClickPlan>[0]['armedTool'];
    cx?: number; cy?: number;
    shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean;
    bpmLabelBeat?: number | null;
    onMarker?: boolean;
  }) => {
    const { deps, at } = makeDeps(notes);
    const p = at(2, 50);
    const cx = over.cx ?? p.x;
    const cy = over.cy ?? p.y;
    return resolveClickPlan({
      cx, cy,
      armedTool: over.armedTool ?? null,
      shiftKey: over.shiftKey ?? false,
      ctrlKey: over.ctrlKey ?? false,
      metaKey: over.metaKey ?? false,
      deps,
      notes,
      snap: snapChartPos(deps, 100, cx, cy),
      bpmLabelBeat: over.bpmLabelBeat ?? null,
      onMarker: over.onMarker ?? false,
    });
  };

  it('§5：任何工具态下单击沟槽 BPM 数字 → editBpm（用既有值打开）', () => {
    expect(plan({ armedTool: 'single', bpmLabelBeat: 20 })).toEqual({
      kind: 'editBpm', beat: 20, value: '150',
    });
  });

  it('§5：数字命中但 BPM 已不在谱面（undo）→ 回落，不进编辑', () => {
    expect(plan({ armedTool: 'single', bpmLabelBeat: 99 })).not.toMatchObject({ kind: 'editBpm' });
  });

  it('指针态点中起点标记 → selectMarker', () => {
    expect(plan({ onMarker: true })).toEqual({ kind: 'selectMarker' });
  });

  it('指针态：Shift = 加选、Ctrl/Cmd = 整条滑条', () => {
    expect(plan({ shiftKey: true })).toEqual({ kind: 'selectItem', additive: true, ctrl: false });
    expect(plan({ metaKey: true })).toEqual({ kind: 'selectItem', additive: false, ctrl: true });
    expect(plan({ ctrlKey: true })).toEqual({ kind: 'selectItem', additive: false, ctrl: true });
  });

  it('键型工具：既吃音符命中（issue 88：命中 ∈ 选区 → 整片换型）也吃栅格落点', () => {
    const r = plan({ armedTool: 'flick' });
    expect(r.kind).toBe('runMatrix');
    if (r.kind !== 'runMatrix') return;
    expect(r.hit).toEqual({ kind: 'note', noteIndex: 2 });
    expect(r.pos).not.toBeNull();
  });

  it('Slide 工具：同样吃音符命中（issue 88：命中 ∈ 选区 → 整片组合）', () => {
    const r = plan({ armedTool: 'slide' });
    expect(r.kind).toBe('runMatrix');
    if (r.kind !== 'runMatrix') return;
    expect(r.hit).toEqual({ kind: 'note', noteIndex: 2 });
  });

  it('删除/镜像工具：命中音符才有效', () => {
    const r = plan({ armedTool: 'delete' });
    expect(r.kind).toBe('runMatrix');
    if (r.kind !== 'runMatrix') return;
    expect(r.hit).toEqual({ kind: 'note', noteIndex: 2 });
  });

  it('BPM / 粘贴：不吃音符命中（作用于位置，issue 88 不扩）', () => {
    for (const tool of ['bpm', 'paste'] as const) {
      const r = plan({ armedTool: tool });
      expect(r.kind).toBe('runMatrix');
      if (r.kind !== 'runMatrix') continue;
      expect(r.hit, `${tool} 不该吃音符命中`).toBeNull();
      expect(r.pos).not.toBeNull();
    }
  });

  it('issue 59：BPM 工具命中 BPM 整线（findItemAt 跳过 BPM，走 findBpmLineAt）', () => {
    const { deps, geometry, viewport } = makeDeps(notes);
    const y = geometry.virtualToCanvas(0, geometry.beatToVirtualY(20, 1), viewport).y;
    const x = geometry.trackGeometry(1).trackBgX + 40;
    const r = resolveClickPlan({
      cx: x, cy: y, armedTool: 'bpm',
      shiftKey: false, ctrlKey: false, metaKey: false,
      deps, notes, snap: snapChartPos(deps, 100, x, y),
      bpmLabelBeat: null, onMarker: false,
    });
    expect(r.kind).toBe('runMatrix');
    if (r.kind !== 'runMatrix') return;
    expect(r.hit).toEqual({ kind: 'note', noteIndex: 1 }); // beat 20 的 BPM
  });

  it('音符优先于 BPM 线（findItemAt 先判，未命中才问 BPM）', () => {
    // beat 50 处既有单键也有（无）BPM；此处验证同一 x 下音符命中不被 BPM 抢走
    const withBoth: ChartNote[] = [bpmNote(0, 120), bpmNote(50, 150), single(2, 50)];
    const { deps, geometry, viewport } = makeDeps(withBoth);
    const p = geometry.virtualToCanvas(
      geometry.noteVirtualX(2), geometry.noteVirtualY(50, 0, 1, BEAT_DISPLAY), viewport,
    );
    const r = resolveClickPlan({
      cx: p.x, cy: p.y, armedTool: 'delete',
      shiftKey: false, ctrlKey: false, metaKey: false,
      deps, notes: withBoth, snap: snapChartPos(deps, 100, p.x, p.y),
      bpmLabelBeat: null, onMarker: false,
    });
    expect(r.kind).toBe('runMatrix');
    if (r.kind !== 'runMatrix') return;
    expect(r.hit).toEqual({ kind: 'note', noteIndex: 2 }); // 单键，不是 index 1 的 BPM
  });
});

// ───────────────────── 回归锚：轨道几何常量（上表坐标计算的隐含前提） ─────────────────────
describe('测试前提：轨道几何常量', () => {
  it('7 轨 × LANE_WIDTH = 210，chrome 两侧各 9', () => {
    expect(LANES * LANE_WIDTH).toBe(210);
    expect(TRACK_CHROME_TOTAL).toBe(9);
  });
});

// ─────────────────────────── 框选：阈值 / 渲染面 / 矩形几何（§2 原则 1） ───────────────────────────
describe('框选阈值与渲染面钳制', () => {
  const T = 4; // DRAG_THRESHOLD_PX
  const start = { x: 100, y: 100 };

  it('§2 原则 1：位移 < 阈值 → 仍是单击', () => {
    expect(hasMovedBeyondThreshold(start, { x: 103, y: 102 }, T)).toBe(false);
  });

  it('§2 原则 1：任一轴达到阈值即算拖拽（不需两轴同时）', () => {
    expect(hasMovedBeyondThreshold(start, { x: 104, y: 100 }, T)).toBe(true);
    expect(hasMovedBeyondThreshold(start, { x: 100, y: 96 }, T)).toBe(true);
  });

  it('isInsideSurface 边界含等号（0 与 w/h 都算在内）', () => {
    expect(isInsideSurface(TEST_SURFACE, 0, 0)).toBe(true);
    expect(isInsideSurface(TEST_SURFACE, TEST_SURFACE.w, TEST_SURFACE.h)).toBe(true);
    expect(isInsideSurface(TEST_SURFACE, -1, 10)).toBe(false);
    expect(isInsideSurface(TEST_SURFACE, 10, TEST_SURFACE.h + 1)).toBe(false);
  });

  it('clampToSurface 把越界坐标拉回渲染面（issue 63：矩形不越出画布）', () => {
    expect(clampToSurface(TEST_SURFACE, -50, 9999)).toEqual({ x: 0, y: TEST_SURFACE.h });
    expect(clampToSurface(TEST_SURFACE, 30, 40)).toEqual({ x: 30, y: 40 });
  });
});

describe('marqueeRect 框选矩形', () => {
  const notes: ChartNote[] = [{ type: 'BPM', beat: 0, bpm: 120 }];

  it('bug 32：起点以虚拟坐标锚定 —— 滚动后矩形起点仍对应同一谱面位置（"长截图"）', () => {
    const { geometry, viewport } = makeDeps(notes);
    const v = geometry.canvasToVirtual(200, 300, viewport);
    const base = { start: { vx: v.x, vy: v.y }, curCanvas: { x: 400, y: 500 }, surface: TEST_SURFACE };

    const r1 = marqueeRect({ ...base, deps: { geometry, viewport } });
    const scrolled = { ...viewport, scrollY: viewport.scrollY + 600 };
    const r2 = marqueeRect({ ...base, deps: { geometry, viewport: scrolled } });

    // 画布坐标可以变，但起点反解回的虚拟坐标必须恒等（= 同一拍同一轨）
    const back1 = geometry.canvasToVirtual(r1.x1, r1.y1, viewport);
    const back2 = geometry.canvasToVirtual(r2.x1, r2.y1, scrolled);
    expect(back2.x).toBeCloseTo(back1.x, 6);
    expect(back2.y).toBeCloseTo(back1.y, 6);
  });

  it('起点的画布坐标随滚动平移 —— 这是"滚动时必须重算矩形"的前提（issue 70 既有缺陷）', () => {
    // 用户报的缺陷：框选过程中滚动，矩形钉在画布同一像素位置，起点漂到别的拍，
    // 直到鼠标再动（触发 handlePointerMove 重算）才跳回。
    // 根因：selectionBox 缓存的是画布坐标（派生值），滚动后不重算即失效。
    // 本例钉住"同一起点在不同 scrollY 下画布坐标必须不同"——正因为会变，才不能缓存。
    const { geometry, viewport } = makeDeps(notes);
    const v = geometry.canvasToVirtual(200, 300, viewport);
    const base = { start: { vx: v.x, vy: v.y }, curCanvas: { x: 400, y: 500 }, surface: TEST_SURFACE };

    const r1 = marqueeRect({ ...base, deps: { geometry, viewport } });
    const scrolled = { ...viewport, scrollY: viewport.scrollY + 600 };
    const r2 = marqueeRect({ ...base, deps: { geometry, viewport: scrolled } });

    const es = geometry.effectiveScale(viewport.scale);
    expect(r1.y1 - r2.y1).toBeCloseTo(600 * es, 6); // scrollY +600 → 起点画布 y 上移
    expect(r2.x1).toBeCloseTo(r1.x1, 6);             // 水平不滚动 → x 不变
  });

  it('issue 63：光标端钳进渲染面（光标拖出画布，矩形不越界、松手照常结算）', () => {
    const { geometry, viewport } = makeDeps(notes);
    const v = geometry.canvasToVirtual(200, 300, viewport);
    const r = marqueeRect({
      start: { vx: v.x, vy: v.y },
      curCanvas: { x: 99999, y: -99999 },
      deps: { geometry, viewport }, surface: TEST_SURFACE,
    });
    expect(r.x2).toBeLessThanOrEqual(TEST_SURFACE.w);
    expect(r.y2).toBeGreaterThanOrEqual(0);
  });
});

describe('resolveBoxPlan / canStartMarquee 框选矩阵去向', () => {
  it('指针态 → 建选区；其余工具族 → 交矩阵', () => {
    expect(resolveBoxPlan(null)).toBe('select');
    for (const t of ['single', 'bpm', 'slide', 'delete', 'paste', 'mirror', 'noteCode'] as const) {
      expect(resolveBoxPlan(t)).toBe('runMatrix');
    }
  });

  it('issue 59 §3 / issue 72：「音符代码」与「粘贴」态不启动框选（不画矩形，而不是框了松手无反应）', () => {
    expect(canStartMarquee('noteCode')).toBe(false);
    expect(canStartMarquee('paste')).toBe(false);
    expect(canStartMarquee(null)).toBe(true);
    expect(canStartMarquee('single')).toBe(true);
    expect(canStartMarquee('slide')).toBe(true);
    expect(canStartMarquee('delete')).toBe(true);
    expect(canStartMarquee('mirror')).toBe(true);
    expect(canStartMarquee('bpm')).toBe(true);
  });
});

// ─────────────────────────── 执行键（§3）：末端判据与命中口径 ───────────────────────────
describe('执行键判据', () => {
  it('isPastChartEnd：末端 epsilon 与放置路径同源（1e-6）', () => {
    expect(isPastChartEnd(100, 100)).toBe(false);
    expect(isPastChartEnd(100 + 5e-7, 100)).toBe(false); // 在 epsilon 内
    expect(isPastChartEnd(100.5, 100)).toBe(true);
  });

  it('§3：光标不在画布 → 无事发生（不落子、不清选区）', () => {
    expect(canPlaceAtCursor(null, 100)).toBe(false);
  });

  it('§3：越过谱面末端 → 无事发生', () => {
    expect(canPlaceAtCursor({ beat: 101 }, 100)).toBe(false);
    expect(canPlaceAtCursor({ beat: 50 }, 100)).toBe(true);
  });

  it('issue 59 §2：Ctrl+B 命中口径与「音符代码」工具单击同源（hover 优先，未命中才问 BPM 整线）', () => {
    const notes: ChartNote[] = [bpmNote(0, 120), bpmNote(50, 150), single(2, 50)];
    const { deps, at } = makeDeps(notes);
    const p = at(6, 50); // 与 BPM 线同高、该处无键音符

    // hover 未命中任何音符/滑条 → 回落到整条 BPM 线
    expect(resolveExecNoteCodeHit({ hoverItem: null, hoverPos: { cx: p.x, cy: p.y }, deps }))
      .toEqual({ kind: 'note', noteIndex: 1 });

    // hover 已命中 → 优先级高于 BPM 线，口径与工具单击一致
    const hovered: SelectionItem = { kind: 'note', noteIndex: 2 };
    expect(resolveExecNoteCodeHit({ hoverItem: hovered, hoverPos: { cx: p.x, cy: p.y }, deps }))
      .toEqual(hovered);

    // 光标不在画布 → 无命中
    expect(resolveExecNoteCodeHit({ hoverItem: null, hoverPos: null, deps })).toBeNull();
  });
});

// ─────────── 越界冻结策略（issue 09 验收反馈九轮 #2：手势预览的唯一口径）───────────
describe('freezeGestureCursor 越界冻结', () => {
  const LIVE = { lane: 3, preciseBeat: 20 };
  const FROZEN = { lane: 2, preciseBeat: 18 };

  it('光标合法 → 用 live（无论手势是否进行中）', () => {
    expect(freezeGestureCursor(LIVE, FROZEN, true)).toBe(LIVE);
    expect(freezeGestureCursor(LIVE, FROZEN, false)).toBe(LIVE);
  });

  it('越界 + 有进行中锚点（画笔/拖拽/已挂首击）→ 冻结到最后合法落点（预览保持可见）', () => {
    expect(freezeGestureCursor(null, FROZEN, true)).toBe(FROZEN);
  });

  it('越界 + 纯 hover（无锚点、未起手）→ null（幽灵隐藏 = "这里不能放"的诚实信号）', () => {
    expect(freezeGestureCursor(null, FROZEN, false)).toBeNull();
  });

  it('越界 + 有锚点但从未有过合法落点（frozen=null）→ null（不画幽灵，避免凭空落点）', () => {
    expect(freezeGestureCursor(null, null, true)).toBeNull();
  });

  it('泛型：可承载任意预览形态（画笔采样数组 / 拖拽落点集），口径与坐标无关', () => {
    const samples = [{ beat: 10, lane: 1 }];
    expect(freezeGestureCursor(samples, samples, true)).toBe(samples);
    expect(freezeGestureCursor<number[]>(null, [1, 2], true)).toEqual([1, 2]);
    expect(freezeGestureCursor<number[]>(null, [1, 2], false)).toBeNull();
  });
});

// ─────────── 画笔越界交点（issue 09 十轮 Q1：快甩出轨道笔画停在真实交点，非半路采样点）───────────
describe('penExitCrossing 越界弦求交', () => {
  it('合成 oracle：一维 x<100 合法 → 从界内 50 到界外 200 停在贴边 100 前', () => {
    const oracle = (cx: number): PenPoint | null => (cx < 100 ? { beat: 0, lane: 0 } : null);
    const hit = penExitCrossing(oracle, { x: 50, y: 0 }, { x: 200, y: 0 });
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeGreaterThan(99.9);
    expect(hit!.x).toBeLessThan(100);
  });

  it('inside 非法（连界内锚点都没有）→ null（交回原逻辑，不臆造交点）', () => {
    const oracle = (cx: number): PenPoint | null => (cx >= 100 ? { beat: 0, lane: 0 } : null);
    expect(penExitCrossing(oracle, { x: 50, y: 0 }, { x: 200, y: 0 })).toBeNull();
  });

  it('outside 其实合法（并未越界）→ null（正常路径处理）', () => {
    const oracle = (): PenPoint => ({ beat: 0, lane: 0 });
    expect(penExitCrossing(oracle, { x: 50, y: 0 }, { x: 200, y: 0 })).toBeNull();
  });

  it('真实 penCursorAt 口径：水平甩出右边界 → 停在轨道右墙根、lane 钳到最右 6、beat 不变', () => {
    const { deps, at } = makeDeps([], 100);
    const chartEndBeat = 100;
    const oracle = (cx: number, cy: number) => penCursorAt(deps, chartEndBeat, cx, cy);
    const inside = at(3, 10); // 界内：3 轨、拍 10（合法）
    const outside = { x: inside.x + 1000, y: inside.y }; // 向右甩出轨道（越界 lane）
    expect(oracle(inside.x, inside.y)).not.toBeNull();
    expect(oracle(outside.x, outside.y)).toBeNull();

    const hit = penExitCrossing(oracle, inside, outside);
    expect(hit).not.toBeNull();
    // 交点落回合法位（松手据此落子）
    expect(oracle(hit!.x, hit!.y)).not.toBeNull();
    // 交点在 inside→outside 方向上、未越过 outside
    expect(hit!.x).toBeGreaterThan(inside.x);
    expect(hit!.x).toBeLessThan(outside.x);
    // 关键：笔画补到"墙根"而非停在最后采样点——交点已越过最右轨中心（6 轨）
    expect(hit!.x).toBeGreaterThan(at(6, 10).x);
    // lane 钳到最右合法轨；水平移动 → beat 不变（真拍 10）
    expect(hit!.point.lane).toBe(6);
    expect(hit!.point.beat).toBeCloseTo(10, 1);
  });

  it('终点不敏感于越界幅度/事件密度：轻甩过头 vs 猛甩很远 → 交点几乎同一墙根', () => {
    const { deps, at } = makeDeps([], 100);
    const chartEndBeat = 100;
    const oracle = (cx: number, cy: number) => penCursorAt(deps, chartEndBeat, cx, cy);
    const inside = at(3, 10);
    // 同一起手，两条不同"甩出距离"（模拟不同速度/密度的一次性越界事件）
    const mild = penExitCrossing(oracle, inside, { x: inside.x + 120, y: inside.y })!;
    const wild = penExitCrossing(oracle, inside, { x: inside.x + 5000, y: inside.y })!;
    expect(mild).not.toBeNull();
    expect(wild).not.toBeNull();
    // 二者交点差应远小于甩出距离差（≈ 同一轨道右墙根，与越界多远无关）
    expect(Math.abs(mild.x - wild.x)).toBeLessThan(2);
    expect(mild.point.lane).toBe(6);
    expect(wild.point.lane).toBe(6);
  });
});

describe('issue 109 · resolveEscapeTarget（Esc 五档链 / ADR-0008 §7）', () => {
  const snap = (o: Partial<Parameters<typeof resolveEscapeTarget>[0]> = {}) => ({
    pen: false, drag: false, box: false, rightHeld: false,
    anchor: false, selection: false, tool: false, ...o,
  });

  it('进行中手势四选一 → gesture（画笔 / 拖拽 / 框选按下 / 右键删除预览）', () => {
    expect(resolveEscapeTarget(snap({ pen: true }))).toBe('gesture');
    expect(resolveEscapeTarget(snap({ drag: true }))).toBe('gesture');
    expect(resolveEscapeTarget(snap({ box: true }))).toBe('gesture');
    expect(resolveEscapeTarget(snap({ rightHeld: true }))).toBe('gesture');
  });

  it('一次只吐一档：手势优先于锚点 / 选区 / 工具态（后者留给下一次 Esc）', () => {
    expect(resolveEscapeTarget(snap({ pen: true, anchor: true, selection: true, tool: true }))).toBe('gesture');
    expect(resolveEscapeTarget(snap({ drag: true, selection: true, tool: true }))).toBe('gesture');
  });

  it('无手势 + 有锚点 → anchor', () => {
    expect(resolveEscapeTarget(snap({ anchor: true, selection: true, tool: true }))).toBe('anchor');
  });

  it('无手势无锚点 + 有选区 → selection', () => {
    expect(resolveEscapeTarget(snap({ selection: true, tool: true }))).toBe('selection');
  });

  it('三者皆无 + 有持工具态 → tool', () => {
    expect(resolveEscapeTarget(snap({ tool: true }))).toBe('tool');
  });

  it('全无 → null（Esc 无事发生）', () => {
    expect(resolveEscapeTarget(snap())).toBeNull();
  });
});
