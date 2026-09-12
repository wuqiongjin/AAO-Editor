// issue 09 S2 / ADR-0009 §3：曲线工具锁测——按下仲裁（画笔优先）、画笔采样（beat 单调硬约束）、
// 单击矩阵 curve 行（链式放置 / 草稿完整性 / 点段重应用 / 框选同源组合）。
import { describe, it, expect } from 'vitest';
import type { ChartNote, SlideNote } from '../../src/chart/types';
import { ChartGeometry } from '../../src/chart/geometry/ChartGeometry';
import {
  resolvePressIntent, resolveReleaseIntent, penAppendSamples,
} from '../../src/chart/editing/CanvasGesture';
import {
  clickOps, boxSelectOps, curveChainClickOps,
  type CurveConfig, type CurveDraft,
} from '../../src/chart/editing/ToolActionMatrix';
import { effectiveSpanParams, countVisibleNodes } from '../../src/chart/editing/SpanCurve';
import { combineSelectionIntoSlide } from '../../src/chart/editing/SlideCombination';

const CFG: CurveConfig = { family: 'quad', type: 'in', precision: 16 };

/** 单测几何：直接构造 SnapPos/命中，避免真实 geometry 依赖（矩阵是纯调度层） */
const bpmAt0 = { type: 'BPM' as const, beat: 0, bpm: 120 };
const input = (over: Partial<Parameters<typeof clickOps>[0]>) => clickOps({
  tool: 'curve', notes: [bpmAt0], hit: null, pos: null, slideBuffer: null,
  lastBpm: 120, clipboard: [], chartEndBeat: 16, beatDisplay: 4, selectedItems: [],
  curveDraft: null, curveConfig: CFG, ...over,
});

describe('issue 09 · 按下仲裁：曲线工具态 = 画笔优先（ADR-0008 §2 例外的手势侧）', () => {
  const bpm120 = [{ beat: 0, bpm: 120 }];
  const TEST_SURFACE = { w: 750, h: 900 };
  const geometry = new ChartGeometry(bpm120, 100, TEST_SURFACE);
  const viewport = { scrollX: 0, scrollY: 0, scale: 1 };
  const at = (lane: number, beat: number) =>
    geometry.virtualToCanvas(
      geometry.noteVirtualX(lane),
      geometry.noteVirtualY(beat, 0, viewport.scale, 4),
      viewport,
    );
  const base = { shiftKey: false, onMarker: false, viewport, chartEndBeat: 100 };

  it('无 Shift 按下 = 画笔起手（合法落点，音符上也可画）', () => {
    const p = at(3, 2);
    const intent = resolvePressIntent({ ...base, cx: p.x, cy: p.y, armedTool: 'curve', deps: { geometry, viewport, beatDisplay: 4, notes: [] } });
    expect(intent.kind).toBe('pen');
  });

  it('Shift 按下交还既有仲裁：音符上 = 拖拽（移动逃生口不受影响）', () => {
    const notes: ChartNote[] = [{ type: 'Single', beat: 2, lane: 3, subBeat: 0 }];
    const p = at(3, 2);
    const intent = resolvePressIntent({ ...base, cx: p.x, cy: p.y, shiftKey: true, armedTool: 'curve', deps: { geometry, viewport, beatDisplay: 4, notes }, selectedItems: [] });
    expect(intent.kind).toBe('drag');
  });

  it('Shift + 空白 = 框选（Shift+拖保留框选，ADR-0008 §2 例外）', () => {
    const p = at(3, 8); // 空白（无音符）
    const intent = resolvePressIntent({ ...base, cx: p.x, cy: p.y, shiftKey: true, armedTool: 'curve', deps: { geometry, viewport, beatDisplay: 4, notes: [] } });
    expect(intent.kind).toBe('marquee');
  });

  it('起点标记线上按下 = 框选（画笔不起）', () => {
    const p = at(3, 2);
    const intent = resolvePressIntent({ ...base, cx: p.x, cy: p.y, onMarker: true, armedTool: 'curve', deps: { geometry, viewport, beatDisplay: 4, notes: [] } });
    expect(intent.kind).toBe('marquee');
  });
});

describe('issue 09 · 画笔采样（beat 单调 = 数据模型硬约束）', () => {
  it('按步长追加：beat 恰落在 k·step 栅格，lane 线性插值', () => {
    const out = penAppendSamples({ beat: 1, lane: 0 }, { beat: 1.5, lane: 3 }, 0.25);
    expect(out.map((p) => p.beat)).toEqual([1.25, 1.5]);
    expect(out[0]!.lane).toBeCloseTo(1.5, 12);
    expect(out[1]!.lane).toBeCloseTo(3, 12);
  });

  it('光标回退（beat 不前进）→ 不追加（"往下回头画"不可表达）', () => {
    expect(penAppendSamples({ beat: 2, lane: 1 }, { beat: 1.5, lane: 5 }, 0.25)).toEqual([]);
    expect(penAppendSamples({ beat: 2, lane: 1 }, { beat: 2, lane: 5 }, 0.25)).toEqual([]);
  });

  it('lane 钳制 0..6（自由段小数但不越界）', () => {
    const out = penAppendSamples({ beat: 0, lane: 5 }, { beat: 1, lane: 9 }, 0.5);
    expect(out.every((p) => p.lane >= 0 && p.lane <= 6)).toBe(true);
    expect(out.at(-1)!.lane).toBe(6);
  });
});

describe('issue 09 · 松手结算：画笔优先级', () => {
  it('移动过阈值 + 画笔 = commitPen（未被框选/abort 吞掉）', () => {
    const intent = resolveReleaseIntent({
      e: { button: 0 }, start: { x: 0, y: 0, vx: 0, vy: 0 }, moved: true,
      drag: null, box: null, pen: true,
    });
    expect(intent).toBe('commitPen');
  });
  it('未过阈值 + 画笔 = click（回落锚点放置语义）', () => {
    const intent = resolveReleaseIntent({
      e: { button: 0 }, start: { x: 0, y: 0, vx: 0, vy: 0 }, moved: false,
      drag: null, box: null, pen: true,
    });
    expect(intent).toBe('click');
  });
});

describe('issue 09 · 单击矩阵 curve 行（链式放置）', () => {
  it('第一击 = 挂草稿锚点（不落子）+ 清选区', () => {
    const ops = input({ pos: { beat: 1, lane: 2 } });
    expect(ops).toEqual([
      { t: 'setCurveBuffer', draft: { points: [{ beat: 1, lane: 2, subBeat: 0 }], params: {}, noteIndex: null } },
      { t: 'setSelection', items: [] },
    ]);
  });

  it('第二击 = 落子（烘焙 hidden 采样）+ 草稿记录滑条下标；第三次点击 = 同一条上续一段（不新增音符）', () => {
    const afterFirst = input({ pos: { beat: 1, lane: 2 } });
    const draft = (afterFirst[0] as Extract<typeof afterFirst[0], { t: 'setCurveBuffer' }>).draft!;
    const notes: ChartNote[] = [bpmAt0];
    const second = clickOps({
      tool: 'curve', notes, hit: null, pos: { beat: 3, lane: 4 },
      slideBuffer: null, lastBpm: 120, clipboard: [], chartEndBeat: 16, beatDisplay: 4,
      selectedItems: [], curveDraft: draft, curveConfig: CFG,
    });
    const setNotes = second.find((o) => o.t === 'setNotes') as { t: 'setNotes'; notes: ChartNote[] };
    expect(setNotes.notes).toHaveLength(2);
    const slide = setNotes.notes[1] as SlideNote;
    expect(countVisibleNodes(slide.connections)).toBe(2);
    expect(slide.connections.filter((c) => c.hidden)).toHaveLength(31); // 2 拍 × 1/16 → f=32 → 31 点
    expect(effectiveSpanParams(slide)[0]).toEqual({ kind: 'easing', ...CFG });
    const draft2 = (second.find((o) => o.t === 'setCurveBuffer') as { t: 'setCurveBuffer'; draft: CurveDraft }).draft;
    expect(draft2.noteIndex).toBe(1);
    expect(draft2.points).toHaveLength(2);

    // 第三击：替换同一条（音符总数不变），可见结点 3、两段参数齐备
    const third = clickOps({
      tool: 'curve', notes: setNotes.notes, hit: null, pos: { beat: 5, lane: 0 },
      slideBuffer: null, lastBpm: 120, clipboard: [], chartEndBeat: 16, beatDisplay: 4,
      selectedItems: [], curveDraft: draft2, curveConfig: CFG,
    });
    const notes3 = (third.find((o) => o.t === 'setNotes') as { t: 'setNotes'; notes: ChartNote[] }).notes;
    expect(notes3).toHaveLength(2);
    const slide3 = notes3[1] as SlideNote;
    expect(countVisibleNodes(slide3.connections)).toBe(3);
    expect(Object.keys(effectiveSpanParams(slide3))).toEqual(['0', '1']);
  });

  it('草稿引用的滑条已不在（undo）→ 完整性检查重启草稿，本次点击退为第一击', () => {
    const stale: CurveDraft = { points: [{ beat: 1, lane: 2, subBeat: 0 }, { beat: 3, lane: 4, subBeat: 0 }], params: { 0: { kind: 'easing', ...CFG } }, noteIndex: 7 };
    const ops = input({ notes: [bpmAt0], pos: { beat: 5, lane: 1 }, curveDraft: stale });
    expect(ops).toEqual([
      { t: 'setCurveBuffer', draft: { points: [{ beat: 5, lane: 1, subBeat: 0 }], params: {}, noteIndex: null } },
      { t: 'setSelection', items: [] },
    ]);
  });

  it('非法落点点击 = 取消草稿 + 清选区（与滑条锚点取消同语义）', () => {
    const draft: CurveDraft = { points: [{ beat: 1, lane: 2, subBeat: 0 }], params: {}, noteIndex: null };
    const ops = input({ pos: null, curveDraft: draft });
    expect(ops).toEqual([{ t: 'setCurveBuffer', draft: null }, { t: 'setSelection', items: [] }]);
  });

  it('点中段（slideRegion）= 当前配置就地重应用（hidden 重烘焙 + 参数记录），单快照清选区', () => {
    const target: SlideNote = { type: 'Slide', connections: [{ beat: 1, lane: 0 }, { beat: 2, lane: 4 }] };
    const notes: ChartNote[] = [bpmAt0, target];
    const ops = input({
      notes, hit: { kind: 'slideRegion', noteIndex: 1, connIndex: 0 },
      pos: { beat: 9, lane: 0 },
    });
    expect(ops).toHaveLength(2);
    const setNotes = ops[0] as { t: 'setNotes'; notes: ChartNote[] };
    const edited = setNotes.notes[1] as SlideNote;
    expect(edited.connections.filter((c) => c.hidden)).toHaveLength(15);
    expect(effectiveSpanParams(edited)[0]).toEqual({ kind: 'easing', ...CFG });
    expect(ops[1]).toEqual({ t: 'setSelection', items: [] });
  });

  it('框选（Shift+拖）= 与滑条同源组合', () => {
    const notes: ChartNote[] = [
      bpmAt0,
      { type: 'Single', beat: 1, lane: 1, subBeat: 0 },
      { type: 'Single', beat: 2, lane: 2, subBeat: 0 },
    ];
    const ops = boxSelectOps('curve', notes, [{ kind: 'note', noteIndex: 1 }, { kind: 'note', noteIndex: 2 }]);
    const setNotes = ops.find((o) => o.t === 'setNotes') as { t: 'setNotes'; notes: ChartNote[] };
    // 与 combineSelectionIntoSlide 直接调用同源（§4 归一表/排序已另锁）
    const direct = combineSelectionIntoSlide(notes, [{ kind: 'note', noteIndex: 1 }, { kind: 'note', noteIndex: 2 }]);
    expect(setNotes.notes).toEqual(direct.newNotes);
  });
});

describe('issue 09 · curveChainClickOps 边界', () => {
  it('配置恒存在时草稿三击成两段；间隔拍差小于一步的段 = 直线（零 hidden）', () => {
    const notes: ChartNote[] = [bpmAt0];
    const d1: CurveDraft = { points: [{ beat: 1, lane: 0, subBeat: 0 }], params: {}, noteIndex: null };
    const ops = curveChainClickOps(notes, d1, { beat: 1 + 1 / 64, lane: 1, subBeat: 0 }, CFG, 4);
    const setNotes = ops.find((o) => o.t === 'setNotes') as { t: 'setNotes'; notes: ChartNote[] };
    const slide = setNotes.notes[1] as SlideNote;
    expect(slide.connections.filter((c) => c.hidden)).toHaveLength(0);
    expect(slide.connections).toHaveLength(2);
  });
});
