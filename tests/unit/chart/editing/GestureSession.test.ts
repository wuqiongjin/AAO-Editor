// issue 113：进行中手势的序列锁测（node，无 DOM）。
// 接缝 = GestureSession 公开接口 begin → move ×N → end / cancel / onViewportChange。
// 判定表（CanvasGesture / NoteDragging / ToolActionMatrix）本票不碰，此处只锁编排产物 ops。
import { describe, it, expect, vi } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import {
  GestureSession,
  PEN_HOLD_MS,
  type GestureSessionHost,
  type GestureWorld,
  type GestureEndInput,
} from '@/src/chart/editing/GestureSession';
import { DEFAULT_CURVE_CONFIG } from '@/src/chart/editing/CurveTool';
import type { ChartNote } from '@/src/chart/types';
import type { ViewportState } from '@/src/visual/types';

const bpm120 = [{ beat: 0, bpm: 120 }];
const SURFACE = { w: 750, h: 900 };
const BEAT_DISPLAY = 4;

const single = (lane: number, beat: number): ChartNote => ({ type: 'Single', lane, beat });
const bpmNote = (beat: number, bpm: number): ChartNote => ({ type: 'BPM', beat, bpm });

function makeGeometry(notes: ChartNote[], chartEndBeat = 100) {
  const geometry = new ChartGeometry(bpm120, { endBeat: chartEndBeat }, SURFACE);
  const viewport: ViewportState = {
    scrollX: 0, scrollY: 0, scale: 1,
    virtualWidth: 0, virtualHeight: 0,
  };
  const at = (lane: number, beat: number, subBeat = 0) =>
    geometry.virtualToCanvas(
      geometry.noteVirtualX(lane),
      geometry.noteVirtualY(beat, subBeat, viewport.scale, BEAT_DISPLAY),
      viewport,
    );
  const virt = (cx: number, cy: number) => geometry.canvasToVirtual(cx, cy, viewport);
  return { geometry, viewport, at, virt, chartEndBeat: geometry.chartEndBeat };
}

function makeHost() {
  const setCursor = vi.fn();
  const attachWindow = vi.fn();
  const detachWindow = vi.fn();
  const timeouts: { id: number; fn: () => void; ms: number }[] = [];
  let nextId = 1;
  const host: GestureSessionHost = {
    setCursor,
    attachWindow,
    detachWindow,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timeouts.push({ id, fn, ms });
      return id;
    },
    clearTimeout: (id) => {
      const i = timeouts.findIndex((t) => t.id === id);
      if (i >= 0) timeouts.splice(i, 1);
    },
  };
  const flush = (ms: number) => {
    for (const t of [...timeouts]) {
      if (t.ms <= ms) {
        host.clearTimeout(t.id);
        t.fn();
      }
    }
  };
  return { host, setCursor, attachWindow, detachWindow, flush };
}

function worldOf(
  notes: ChartNote[],
  extra: Partial<GestureWorld> = {},
): { world: GestureWorld; at: (lane: number, beat: number) => { x: number; y: number }; virt: (cx: number, cy: number) => { x: number; y: number } } {
  const { geometry, viewport, at, virt, chartEndBeat } = makeGeometry(notes);
  const world: GestureWorld = {
    notes,
    selectedItems: [],
    armedTool: null,
    beatDisplay: BEAT_DISPLAY,
    chartEndBeat,
    geometry,
    viewport,
    surface: SURFACE,
    clipboard: [],
    slideBuffer: null,
    curveDraft: null,
    curveConfig: DEFAULT_CURVE_CONFIG,
    lastBpm: 120,
    noteSize: 1,
    hitStartMarker: () => false,
    hitBpmLabel: () => null,
    ...extra,
  };
  return { world, at, virt };
}

function press(session: GestureSession, p: { x: number; y: number }, virt: (cx: number, cy: number) => { x: number; y: number }, extra: Partial<{ button: number; shiftKey: boolean }> = {}) {
  const v = virt(p.x, p.y);
  return session.begin({
    x: p.x, y: p.y, vx: v.x, vy: v.y,
    button: extra.button ?? 0,
    shiftKey: extra.shiftKey ?? false,
  });
}

function up(p: { x: number; y: number }, extra: Partial<GestureEndInput> = {}): GestureEndInput {
  return {
    x: p.x, y: p.y,
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    ...extra,
  };
}

describe('GestureSession · snapshot 出口', () => {
  it('构造时五个渲染镜像均为空闲', () => {
    const { host } = makeHost();
    const s = new GestureSession(host);
    const snap = s.getSnapshot();
    expect(snap.dragGhost).toBeNull();
    expect(snap.penPreview).toBeNull();
    expect(snap.penActive).toBe(false);
    expect(snap.selectionBox).toBeNull();
    expect(snap.rightButtonHeld).toBe(false);
  });

  it('subscribe 在 snapshot 变化时回调', () => {
    const { host } = makeHost();
    const s = new GestureSession(host);
    const { world } = worldOf([bpmNote(0, 120)]);
    s.bindWorld(world);
    const seen: boolean[] = [];
    s.subscribe((snap) => seen.push(snap.rightButtonHeld));
    s.begin({ x: 10, y: 10, vx: 10, vy: 10, button: 2, shiftKey: false });
    expect(seen.at(-1)).toBe(true);
  });
});

describe('GestureSession · 单击通路（不变量 1）', () => {
  it('指针态点空白 → 清选区', () => {
    const notes = [bpmNote(0, 120), single(2, 50)];
    const { world, at, virt } = worldOf(notes, {
      selectedItems: [{ kind: 'note', noteIndex: 1 }],
    });
    const { host } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    const p = at(5, 10);
    press(s, p, virt);
    const r = s.end(up(p));
    expect(r.ops).toEqual([
      { t: 'setMarkerSelected', selected: false },
      { t: 'setSelection', items: [] },
    ]);
  });

  it('指针态点音符 → 选中该音符', () => {
    const notes = [bpmNote(0, 120), single(2, 50)];
    const { world, at, virt } = worldOf(notes);
    const { host } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    const p = at(2, 50);
    press(s, p, virt);
    const r = s.end(up(p));
    expect(r.ops).toContainEqual({ t: 'setMarkerSelected', selected: false });
    expect(r.ops).toContainEqual({ t: 'setSelection', items: [{ kind: 'note', noteIndex: 1 }] });
  });

  it('键型工具单击空白 → 放置该键并清选区', () => {
    const notes = [bpmNote(0, 120)];
    const { world, at, virt } = worldOf(notes, { armedTool: 'single' });
    const { host } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    const p = at(2, 50);
    press(s, p, virt);
    const r = s.end(up(p));
    const setNotes = r.ops.find((op) => op.t === 'setNotes');
    expect(setNotes).toBeDefined();
    if (setNotes?.t !== 'setNotes') throw new Error('expected setNotes');
    expect(setNotes.notes.some((n) => n.type === 'Single' && n.lane === 2 && n.beat === 50)).toBe(true);
    expect(r.ops).toContainEqual({ t: 'setSelection', items: [] });
  });
});

describe('GestureSession · 拖拽阈值 4px（不变量 6）', () => {
  it('位移 <4px 仍走单击，不进入拖拽', () => {
    const notes = [bpmNote(0, 120), single(2, 50)];
    const { world, at, virt } = worldOf(notes);
    const { host } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    const p = at(2, 50);
    press(s, p, virt);
    s.move({ x: p.x + 3, y: p.y });
    expect(s.getSnapshot().dragGhost).toBeNull();
    const r = s.end(up({ x: p.x + 3, y: p.y }));
    expect(r.ops).toContainEqual({ t: 'setSelection', items: [{ kind: 'note', noteIndex: 1 }] });
    expect(r.ops.some((op) => op.t === 'setNotes')).toBe(false);
  });
});

// issue 141：阈值按「按下意图」分档 —— 拖拽/画笔 4px（跟手），框选 8px。
// 4px 时持工具态放音符手一抖就越线 → 松手走 commitBox，那一击的放置被吃掉（用户报的手感问题）。
describe('GestureSession · 框选阈值 8px（issue 141）', () => {
  it('持键型工具空白按下、位移 5px 松手 → 仍按**按下点**放置音符（不是框选）', () => {
    const notes = [bpmNote(0, 120)];
    const { world, at, virt } = worldOf(notes, { armedTool: 'single' });
    const { host } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    const p = at(3, 60);
    press(s, p, virt);
    s.move({ x: p.x + 5, y: p.y });
    expect(s.getSnapshot().selectionBox).toBeNull();
    const r = s.end(up({ x: p.x + 5, y: p.y }));
    const setNotes = r.ops.find((op) => op.t === 'setNotes');
    expect(setNotes).toBeDefined();
    if (setNotes?.t !== 'setNotes') throw new Error('expected setNotes');
    // 落点必须仍是**按下点** at(3, 60) —— 不是松手位置，也不是被框选吃掉
    const placed = setNotes.notes.find((n) => n.type === 'Single' && n.lane === 3) as { beat: number } | undefined;
    expect(placed?.beat).toBe(60);
    expect(setNotes.notes.filter((n) => n.type === 'Single')).toHaveLength(1);
  });

  it('位移 8px → 进入框选，且不再放置音符', () => {
    const notes = [bpmNote(0, 120)];
    const { world, at, virt } = worldOf(notes, { armedTool: 'single' });
    const { host } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    const p = at(3, 60);
    press(s, p, virt);
    s.move({ x: p.x + 8, y: p.y });
    expect(s.getSnapshot().selectionBox).not.toBeNull();
    const r = s.end(up({ x: p.x + 8, y: p.y }));
    expect(r.ops.some((op) => op.t === 'setNotes')).toBe(false);
  });

  it('指针态按住音符 → 仍 4px 起手（拖拽不被框选阈值拖迟钝）', () => {
    const notes = [bpmNote(0, 120), single(2, 50)];
    const { world, at, virt } = worldOf(notes);
    const { host } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    const p = at(2, 50);
    press(s, p, virt);
    s.move({ x: p.x + 5, y: p.y });
    // 5px 已被拖拽通路消费 → 走拖拽（有幽灵），不是框选
    expect(s.getSnapshot().selectionBox).toBeNull();
    expect(s.getSnapshot().dragGhost).toBeNull(); // 位移未跨拍 → 幽灵为空，但意图已是拖拽
    s.end(up({ x: p.x + 5, y: p.y }));
  });
});

describe('GestureSession · 拖拽通路（不变量 7 / 8）', () => {
  it('按下快照提交：音符沿拍轴拖一拍后落在新拍', () => {
    const notes = [bpmNote(0, 120), single(2, 50)];
    const { world, at, virt } = worldOf(notes);
    const { host, attachWindow, detachWindow } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    const p0 = at(2, 50);
    const p1 = at(2, 51);
    press(s, p0, virt);
    expect(attachWindow).toHaveBeenCalledTimes(1);
    s.move(p1);
    expect(s.getSnapshot().dragGhost).not.toBeNull();
    const r = s.end(up(p1));
    expect(detachWindow).toHaveBeenCalled();
    const setNotes = r.ops.find((op) => op.t === 'setNotes');
    expect(setNotes).toBeDefined();
    if (setNotes?.t !== 'setNotes') throw new Error('expected setNotes');
    const moved = setNotes.notes.find((n) => n.type === 'Single') as { beat: number; lane: number } | undefined;
    expect(moved?.beat).toBe(51);
    expect(moved?.lane).toBe(2);
  });
});

describe('GestureSession · 框选通路（不变量 5 / 18）', () => {
  it('框选覆盖音符 → 选区含该音符', () => {
    const notes = [bpmNote(0, 120), single(2, 50)];
    const { world, at, virt } = worldOf(notes);
    const { host } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    const a = at(1, 48);
    const b = at(4, 52);
    press(s, a, virt);
    s.move(b);
    expect(s.getSnapshot().selectionBox).not.toBeNull();
    const r = s.end(up(b));
    expect(r.ops).toContainEqual({ t: 'setMarkerSelected', selected: false });
    const sel = r.ops.find((op) => op.t === 'setSelection');
    expect(sel).toEqual({ t: 'setSelection', items: [{ kind: 'note', noteIndex: 1 }] });
  });

  it('滚动后重算：矩形起点锁在虚拟坐标（bug 32）', () => {
    const notes = [bpmNote(0, 120), single(2, 50)];
    const { world, at, virt } = worldOf(notes);
    const { host } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    const a = at(1, 48);
    const b = at(4, 52);
    press(s, a, virt);
    s.move(b);
    const before = s.getSnapshot().selectionBox!;
    const scrolled = { ...world.viewport, scrollY: world.viewport.scrollY + 200 };
    s.bindWorld({ ...world, viewport: scrolled });
    s.onViewportChange(scrolled, world.geometry, world.surface);
    const after = s.getSnapshot().selectionBox!;
    // 起点按虚拟坐标锚定 → 画布 y 随 scrollY 变；光标端是画布坐标且钳在渲染面，滚动不改
    expect(after.y1).not.toBeCloseTo(before.y1, 5);
    expect(after.y2).toBeCloseTo(before.y2, 5);
  });
});

describe('GestureSession · Slide 两击（不变量 10）', () => {
  it('第一击挂锚点，第二击落一条滑条', () => {
    const notes = [bpmNote(0, 120)];
    const { world, at, virt } = worldOf(notes, { armedTool: 'slide' });
    const { host } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    const a = at(2, 40);
    press(s, a, virt);
    const first = s.end(up(a));
    const buf = first.ops.find((op) => op.t === 'setSlideBuffer');
    expect(buf).toMatchObject({ t: 'setSlideBuffer', point: { beat: 40, lane: 2 } });

    const point = buf && buf.t === 'setSlideBuffer' ? buf.point : null;
    s.bindWorld({ ...world, slideBuffer: point });
    const b = at(4, 48);
    press(s, b, virt);
    const second = s.end(up(b));
    const setNotes = second.ops.find((op) => op.t === 'setNotes');
    expect(setNotes).toBeDefined();
    if (setNotes?.t !== 'setNotes') throw new Error('expected setNotes');
    expect(setNotes.notes.some((n) => n.type === 'Slide')).toBe(true);
  });
});

describe('GestureSession · Esc ②档（不变量 13 / 19）', () => {
  it('取消拖拽：end 不再提交，选区/工具态无 op', () => {
    const notes = [bpmNote(0, 120), single(2, 50)];
    const { world, at, virt } = worldOf(notes, {
      selectedItems: [{ kind: 'note', noteIndex: 1 }],
      armedTool: 'single',
    });
    const { host, detachWindow } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    const p0 = at(2, 50);
    const p1 = at(2, 51);
    press(s, p0, virt);
    s.move(p1);
    const c = s.cancel();
    expect(c.consumed).toBe(true);
    expect(c.ops).toEqual([]);
    expect(detachWindow).toHaveBeenCalled();
    expect(s.getSnapshot().dragGhost).toBeNull();
    const after = s.end(up(p1));
    expect(after.ops).toEqual([]);
    expect(s.getSnapshot().selectionBox).toBeNull();
  });

  it('取消后 move 不再推进幽灵（作废到下一次按下）', () => {
    const notes = [bpmNote(0, 120), single(2, 50)];
    const { world, at, virt } = worldOf(notes);
    const { host } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    const p0 = at(2, 50);
    const p1 = at(2, 51);
    const p2 = at(2, 52);
    press(s, p0, virt);
    s.move(p1);
    s.cancel();
    s.move(p2);
    expect(s.getSnapshot().dragGhost).toBeNull();
    expect(s.end(up(p2)).ops).toEqual([]);
  });

  it('无进行中手势时 cancel 不消费', () => {
    const { world } = worldOf([bpmNote(0, 120)]);
    const { host } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    expect(s.cancel().consumed).toBe(false);
    expect(s.escapeGestureFlags()).toEqual({
      pen: false, drag: false, box: false, rightHeld: false,
    });
  });

  it('按下未抬起时 escapeGestureFlags.box 为真，cancel 仍只消费手势', () => {
    const notes = [bpmNote(0, 120), single(2, 50)];
    const { world, at, virt } = worldOf(notes);
    const { host } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    press(s, at(2, 50), virt);
    expect(s.escapeGestureFlags().box).toBe(true);
    expect(s.cancel().consumed).toBe(true);
    expect(s.escapeGestureFlags()).toEqual({
      pen: false, drag: false, box: false, rightHeld: false,
    });
  });
});

describe('GestureSession · 画笔编排', () => {
  it('曲线工具拖过阈值后落一条自由段', () => {
    const notes = [bpmNote(0, 120)];
    const { world, at, virt } = worldOf(notes, { armedTool: 'curve' });
    const { host, flush, setCursor } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    const a = at(2, 40);
    const b = at(3, 48);
    press(s, a, virt);
    expect(s.getSnapshot().penActive).toBe(false);
    flush(PEN_HOLD_MS);
    expect(s.getSnapshot().penActive).toBe(true);
    expect(setCursor).toHaveBeenCalled();
    s.move(b);
    expect(s.getSnapshot().penPreview).not.toBeNull();
    const r = s.end(up(b));
    const setNotes = r.ops.find((op) => op.t === 'setNotes');
    expect(setNotes).toBeDefined();
    if (setNotes?.t !== 'setNotes') throw new Error('expected setNotes');
    expect(setNotes.notes.some((n) => n.type === 'Slide')).toBe(true);
  });

  it('离开曲线工具清画笔预览', () => {
    const notes = [bpmNote(0, 120)];
    const { world, at, virt } = worldOf(notes, { armedTool: 'curve' });
    const { host } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    const a = at(2, 40);
    const b = at(3, 48);
    press(s, a, virt);
    s.move(b);
    s.onToolChange('single');
    expect(s.getSnapshot().penPreview).toBeNull();
    expect(s.getSnapshot().penActive).toBe(false);
  });
});

describe('GestureSession · 曲线点选区内', () => {
  it('选区 ≥2 单击选区内音符 → 组合+刷缓动，不挂锚点、不清选区于按下', () => {
    const notes = [bpmNote(0, 120), single(1, 1), single(2, 2)];
    const { world, at, virt } = worldOf(notes, {
      armedTool: 'curve',
      selectedItems: [{ kind: 'note', noteIndex: 1 }, { kind: 'note', noteIndex: 2 }],
    });
    const { host } = makeHost();
    const s = new GestureSession(host);
    s.bindWorld(world);
    const p = at(1, 1);
    const down = press(s, p, virt);
    expect(down.ops.some((op) => op.t === 'setSelection')).toBe(false);
    const r = s.end(up(p));
    expect(r.ops.some((op) => op.t === 'setCurveBuffer')).toBe(false);
    const setNotes = r.ops.find((op) => op.t === 'setNotes');
    expect(setNotes).toBeDefined();
    if (setNotes?.t !== 'setNotes') throw new Error('expected setNotes');
    const slide = setNotes.notes.find((n) => n.type === 'Slide') as Extract<ChartNote, { type: 'Slide' }> | undefined;
    expect(slide).toBeTruthy();
    expect(slide!.spanParams?.bySpan[0]).toMatchObject({ kind: 'easing', family: 'sine', type: 'in' });
  });
});
