// issue 09 S2 / ADR-0009 §3：曲线工具锁测——按下仲裁（画笔优先）、画笔采样（beat 单调硬约束）、
// 单击矩阵 curve 行（链式放置 / 草稿完整性 / 点段重应用 / 框选同源组合）。
import { describe, it, expect } from 'vitest';
import type { ChartNote, SlideNote } from '../../src/chart/types';
import { ChartGeometry } from '../../src/chart/geometry/ChartGeometry';
import {
  resolvePressIntent, resolveReleaseIntent, penAppendSamples,
  penMaxBeatsForCanvasDy, resolvePenStroke, finalizePenStrokeCommit,
} from '../../src/chart/editing/CanvasGesture';

/** issue 112：松手落子 = 轨迹裁决 + 网格吸附（预览不走此路径） */
function commitPenStroke(
  start: { beat: number; lane: number },
  samples: { beat: number; lane: number }[],
  dir: 0 | 1 | -1,
  release: { beat: number; lane: number },
  beatDisplay: number,
) {
  const raw = resolvePenStroke(start, samples, dir, release);
  return raw ? finalizePenStrokeCommit(start, raw, beatDisplay) : null;
}
import {
  clickOps, boxSelectOps, curveChainClickOps, execCurveOps, placeSpanWithCombination,
  type CurveConfig, type CurveDraft,
} from '../../src/chart/editing/ToolActionMatrix';
import { effectiveSpanParams, countVisibleNodes, smoothPenLanes } from '../../src/chart/editing/SpanCurve';
import { shapeTemplateById } from '../../src/chart/editing/ShapeTemplates';
import { mirrorNote } from '../../src/chart/editing/NoteEditing';
import { mirrorLane } from '../../src/chart/editing/NoteEditing';
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

describe('issue 09 · 画笔采样（beat 单调 = 数据模型硬约束；方向锁定）', () => {
  it('按步长追加：beat 恰落在 k·step 栅格，lane 线性插值（首采样锁定正向）', () => {
    const { samples: out, dir } = penAppendSamples({ beat: 1, lane: 0 }, { beat: 1.5, lane: 3 }, 0.25, 0);
    expect(out.map((p) => p.beat)).toEqual([1.25, 1.5]);
    expect(out[0]!.lane).toBeCloseTo(1.5, 12);
    expect(out[1]!.lane).toBeCloseTo(3, 12);
    expect(dir).toBe(1);
  });

  it('方向锁定后光标回退 → 不追加（中途回头不可表达，验收 #4）', () => {
    expect(penAppendSamples({ beat: 2, lane: 1 }, { beat: 1.5, lane: 5 }, 0.25, 1).samples).toEqual([]);
    expect(penAppendSamples({ beat: 2, lane: 1 }, { beat: 2, lane: 5 }, 0.25, 1).samples).toEqual([]);
  });

  it('倒向笔画（验收 #4）：首采样锁 -1，采样 beat 降序；未落首采样前不锁方向', () => {
    const { samples: out, dir } = penAppendSamples({ beat: 2, lane: 0 }, { beat: 1.5, lane: 3 }, 0.25, 0);
    expect(dir).toBe(-1);
    expect(out.map((p) => p.beat)).toEqual([1.75, 1.5]);
    expect(out[0]!.lane).toBeCloseTo(1.5, 12);
    // 已锁倒向后，向前移动不采样
    expect(penAppendSamples({ beat: 1.5, lane: 3 }, { beat: 2, lane: 1 }, 0.25, -1).samples).toEqual([]);
    // 尚未落采样（|delta| < step）→ 方向保持未定
    expect(penAppendSamples({ beat: 1, lane: 0 }, { beat: 1.1, lane: 2 }, 0.25, 0)).toEqual({ samples: [], dir: 0 });
  });

  it('lane 钳制 0..6（自由段小数但不越界）', () => {
    const { samples: out } = penAppendSamples({ beat: 0, lane: 5 }, { beat: 1, lane: 9 }, 0.5, 0);
    expect(out.every((p) => p.lane >= 0 && p.lane <= 6)).toBe(true);
    expect(out.at(-1)!.lane).toBe(6);
  });
});

describe('issue 106 · 画笔禁止回头（回头不追加 / 回头不改变产出 / 跨层不补点）', () => {
  it('落子终点取「松手吸附拍位」与「最远采样点」中更靠前者 —— 回头不缩短产出', () => {
    const samples = [{ beat: 2.5, lane: 0.2 }, { beat: 3, lane: 0.4 }];
    // 画到 3 拍后手回退到 2.6 拍再松手 → 终点仍是 3（产出不受回头影响）
    expect(resolvePenStroke({ beat: 2, lane: 0 }, samples, 1, { beat: 2.6, lane: 0.9 }))
      .toEqual({
        from: { beat: 2, lane: 0 },
        to: { beat: 3, lane: 0.4 },
        middles: [{ beat: 2.5, lane: 0.2 }],
      });
    // 未回头：松手吸附拍位即终点（放置栅格口径不变）
    expect(resolvePenStroke({ beat: 2, lane: 0 }, samples, 1, { beat: 3.5, lane: 1 })!.to)
      .toEqual({ beat: 3.5, lane: 1 });
  });

  it('上→下 松手越过起点：不再落出非单调点序（旧 fwd 分支漏洞）', () => {
    // 从 5 拍向下画到 3 拍（采样降序），手越过起点回到 6 拍后松手
    const s = resolvePenStroke({ beat: 5, lane: 0 },
      [{ beat: 4.5, lane: 0.3 }, { beat: 3, lane: 0.6 }], -1, { beat: 6, lane: 2 });
    expect(s).not.toBeNull();
    expect(s!.from).toEqual({ beat: 3, lane: 0.6 });   // 低拍端
    expect(s!.to).toEqual({ beat: 5, lane: 0 });       // 高拍端 = 起点
    expect(s!.middles.map((p) => p.beat)).toEqual([4.5]); // 越过起点的松手点不参与
    // 产出 beat 恒单调（升序）
    expect(s!.middles.every((p) => p.beat > s!.from.beat && p.beat < s!.to.beat)).toBe(true);
  });

  it('下→上 松手落在起点之下：按最远点落子（旧实现整笔作废）', () => {
    const s = resolvePenStroke({ beat: 2, lane: 0 },
      [{ beat: 2.5, lane: 0.3 }, { beat: 3, lane: 0.6 }], 1, { beat: 1.5, lane: 2 });
    expect(s).toEqual({
      from: { beat: 2, lane: 0 },
      to: { beat: 3, lane: 0.6 },
      middles: [{ beat: 2.5, lane: 0.3 }],
    });
  });

  it('倒画端点互换、中间采样统一升序；同拍（无净位移）→ 不落子', () => {
    expect(resolvePenStroke({ beat: 5, lane: 0 },
      [{ beat: 4.5, lane: 0.3 }, { beat: 4, lane: 0.6 }], -1, { beat: 4.2, lane: 1 }))
      .toEqual({
        from: { beat: 4, lane: 0.6 },
        to: { beat: 5, lane: 0 },
        middles: [{ beat: 4.5, lane: 0.3 }],
      });
    expect(resolvePenStroke({ beat: 2, lane: 0 }, [], 0, { beat: 2, lane: 3 })).toBeNull();
    // 纯函数：不改入参
    const samples = [{ beat: 2.5, lane: 0.2 }, { beat: 3, lane: 0.4 }];
    resolvePenStroke({ beat: 2, lane: 0 }, samples, 1, { beat: 3.5, lane: 1 });
    expect(samples).toEqual([{ beat: 2.5, lane: 0.2 }, { beat: 3, lane: 0.4 }]);
  });

  it('跨层跳变步：|Δbeat| 超出「本帧 Δy 上限」→ 只接当前光标、不插值补点', () => {
    // 常规帧：Δy 与 Δbeat 自洽（1 拍 ≈ 220px）→ 照常按拍栅格插值
    expect(penAppendSamples({ beat: 3.49, lane: 0 }, { beat: 4.5, lane: 0 }, 0.5, 1, 1.2)
      .samples.map((p) => p.beat)).toEqual([3.99, 4.49]);
    // 跨层帧：拍号跳 3 拍而 Δy 上限只有 0.5 拍 → 只接当前光标（不补 48 个手没画过的点）
    expect(penAppendSamples({ beat: 3.49, lane: 2 }, { beat: 6.5, lane: 2 }, 0.0625, 1, 0.5))
      .toEqual({ samples: [{ beat: 6.5, lane: 2 }], dir: 1 });
  });

  it('跨层判据（penMaxBeatsForCanvasDy）：折返带边界跳号被识别，正常移动不误判', () => {
    // ADR-0010 附录 B 最小复现：120 → -120（beat 5）→ 120（beat 6.5）
    const geometry = new ChartGeometry(
      [{ beat: 0, bpm: 120 }, { beat: 5, bpm: -120 }, { beat: 6.5, bpm: 120 }], 16, { w: 750, h: 900 });
    const deps = { geometry, viewport: { scrollX: 0, scrollY: 0, scale: 1 } };
    // 跨层：两端几乎同一个 y（Δy = 2px）却跳了 3 拍 → 上限远小于 3
    expect(penMaxBeatsForCanvasDy(deps, 6.5, 2)).toBeLessThan(0.1);
    // 正常：1 拍 ≈ 220 画布 px → 同样 y 位移的上限必须容得下 1 拍（不误判成跨层）
    expect(penMaxBeatsForCanvasDy(deps, 3.5, 220)).toBeGreaterThan(1);
  });
});

describe('issue 112 · 松手落子方案 B（预览仍走 resolvePenStroke，不经网格量化）', () => {
  it('半格门槛 / 保底吸附 / beatDisplay 联动 / 终点整轨', () => {
    const start = { beat: 2, lane: 0 };
    // 预览：未过半格仍有轨迹（不落子规则不作用于预览）
    expect(resolvePenStroke(start, [], 1, { beat: 2.1, lane: 0 })).not.toBeNull();
    // 松手：位移 0.1 拍 < 半格 0.125 → 取消
    expect(commitPenStroke(start, [], 1, { beat: 2.1, lane: 0 }, 4)).toBeNull();
    const s = commitPenStroke(start, [], 1, { beat: 2.15, lane: 2.7 }, 4);
    expect(s).not.toBeNull();
    expect(s!.to.beat).toBe(2.25);
    expect(s!.to.beat).toBe(start.beat + 0.25);
    expect(s!.to.lane).toBe(3);
    for (const bd of [1, 2, 4, 8, 16] as const) {
      const half = 0.5 / bd;
      const step = 1 / bd;
      expect(commitPenStroke({ beat: 1, lane: 0 }, [], 1, { beat: 1 + half - 0.02, lane: 0 }, bd)).toBeNull();
      const ok = commitPenStroke({ beat: 1, lane: 0 }, [], 1, { beat: 1 + half + 0.02, lane: 0 }, bd);
      expect(ok!.to.beat).toBeCloseTo(1 + step, 12);
    }
    expect(commitPenStroke({ beat: 1, lane: 0 }, [], 1, { beat: 1.6, lane: 0 }, 1)!.to.beat).toBe(2);
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

  it('第二击 = 落子（烘焙 hidden 采样）+ **清空草稿**（验收补充：放置即收工，不残留续段态）', () => {
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
    // 落子后草稿清空：下一击永远是新锚点（可直接重叠放置，无需 Esc）
    const buf = second.find((o) => o.t === 'setCurveBuffer') as { t: 'setCurveBuffer'; draft: CurveDraft | null };
    expect(buf.draft).toBeNull();

    // 第三击 = 新锚点（不新增音符、不续段）
    const third = clickOps({
      tool: 'curve', notes: setNotes.notes, hit: null, pos: { beat: 5, lane: 0 },
      slideBuffer: null, lastBpm: 120, clipboard: [], chartEndBeat: 16, beatDisplay: 4,
      selectedItems: [], curveDraft: null, curveConfig: CFG,
    });
    expect(third).toEqual([
      { t: 'setCurveBuffer', draft: { points: [{ beat: 5, lane: 0, subBeat: 0 }], params: {}, noteIndex: null } },
      { t: 'setSelection', items: [] },
    ]);
  });

  it('倒放置（先点后拍再点前拍）= 排序后成条，缓动按排序正向烘焙（验收 #4）', () => {
    const afterFirst = input({ pos: { beat: 3, lane: 4 } }); // 先点后拍
    const draft = (afterFirst[0] as Extract<typeof afterFirst[0], { t: 'setCurveBuffer' }>).draft!;
    const second = input({ notes: [bpmAt0], pos: { beat: 1, lane: 2 }, curveDraft: draft }); // 再点前拍
    const setNotes = second.find((o) => o.t === 'setNotes') as { t: 'setNotes'; notes: ChartNote[] };
    const slide = setNotes.notes[1] as SlideNote;
    expect(slide.connections[0]!.beat).toBe(1);
    expect(slide.connections.at(-1)!.beat).toBe(3);
    expect(slide.connections.filter((c) => c.hidden)).toHaveLength(31);
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

describe('issue 09 S4 · 曲线工具 × 模板（templateId 优先）', () => {
  const TPL: CurveConfig = { family: 'sine', type: 'inOut', precision: 16, templateId: 's-curve' };

  it('第二击落子 = 按模板点列烘焙，参数记 SpanTemplateParam（缓动字段被忽略）', () => {
    const afterFirst = input({ pos: { beat: 1, lane: 2 }, curveConfig: TPL });
    const draft = (afterFirst[0] as Extract<typeof afterFirst[0], { t: 'setCurveBuffer' }>).draft!;
    const ops = input({ notes: [bpmAt0], pos: { beat: 3, lane: 2 }, curveDraft: draft, curveConfig: TPL });
    const setNotes = ops.find((o) => o.t === 'setNotes') as { t: 'setNotes'; notes: ChartNote[] };
    const slide = setNotes.notes[1] as SlideNote;
    const hiddens = slide.connections.filter((c) => c.hidden);
    expect(hiddens.length).toBe(shapeTemplateById('s-curve')!.points.length);
    // S 形：off 过零两处（t=0.5 处 lane 回到弦上）；两端 off=0
    expect(effectiveSpanParams(slide)[0]).toEqual({ kind: 'template', templateId: 's-curve' });
  });

  it('点已有段 = 应用当前模板（与缓动同一条重应用路径）', () => {
    const target: SlideNote = { type: 'Slide', connections: [{ beat: 1, lane: 0 }, { beat: 3, lane: 0 }] };
    const ops = input({
      notes: [bpmAt0, target],
      hit: { kind: 'slideRegion', noteIndex: 1, connIndex: 0 },
      pos: { beat: 9, lane: 0 },
      curveConfig: TPL,
    });
    const setNotes = ops[0] as { t: 'setNotes'; notes: ChartNote[] };
    const edited = setNotes.notes[1] as SlideNote;
    expect(effectiveSpanParams(edited)[0]).toEqual({ kind: 'template', templateId: 's-curve' });
    expect(edited.connections.filter((c) => c.hidden).length).toBe(shapeTemplateById('s-curve')!.points.length);
  });
});

describe('issue 09 三轮 · 画笔起手任意位置（重叠绘制起点）', () => {
  it('按在音符/段上（无 Shift）= 画笔起手（重叠绘制起点可重叠；单击语义归 click 路径）', () => {
    const bpm120 = [{ beat: 0, bpm: 120 }];
    const geometry = new ChartGeometry(bpm120, 100, { w: 750, h: 900 });
    const viewport = { scrollX: 0, scrollY: 0, scale: 1 };
    const notes: ChartNote[] = [{ type: 'Single', beat: 2, lane: 3, subBeat: 0 }];
    const p = geometry.virtualToCanvas(
      geometry.noteVirtualX(3),
      geometry.noteVirtualY(2, 0, viewport.scale, 4),
      viewport,
    );
    const intent = resolvePressIntent({
      cx: p.x, cy: p.y, armedTool: 'curve', shiftKey: false, onMarker: false,
      deps: { geometry, viewport, beatDisplay: 4, notes },
      selectedItems: [], chartEndBeat: 100,
    });
    expect(intent.kind).toBe('pen');
  });
});

describe('issue 09 三轮 · 两击组合对标普通滑条（端点相接自动合并）', () => {
  const CFG2: CurveConfig = { family: 'sine', type: 'out', precision: 16 };

  it('A→B 放置后，以 B 为锚点再放 B→C → 合并成一条 A→B→C（普通滑条同规则）', () => {
    // 第一条：A(beat1,lane2) → B(beat3,lane4)
    const first = input({ pos: { beat: 1, lane: 2 } });
    const draft = (first[0] as Extract<typeof first[0], { t: 'setCurveBuffer' }>).draft!;
    const placed = input({ notes: [bpmAt0], pos: { beat: 3, lane: 4 }, curveDraft: draft });
    const notesAfter1 = (placed.find((o) => o.t === 'setNotes') as { t: 'setNotes'; notes: ChartNote[] }).notes;
    expect(notesAfter1).toHaveLength(2); // BPM + A→B
    // 第二条：锚点 B(beat3,lane4) → C(beat5,lane0)（换一套缓动配置，验证两段参数各归各）
    const secondAnchor = input({ notes: notesAfter1, pos: { beat: 3, lane: 4 }, curveConfig: CFG2 });
    const draft2 = (secondAnchor[0] as Extract<typeof secondAnchor[0], { t: 'setCurveBuffer' }>).draft!;
    const second = input({ notes: notesAfter1, pos: { beat: 5, lane: 0 }, curveDraft: draft2, curveConfig: CFG2 });
    const notesAfter2 = (second.find((o) => o.t === 'setNotes') as { t: 'setNotes'; notes: ChartNote[] }).notes;
    // 仍是 2 个音符：BPM + 一条合并后的 A→B→C（不新增独立滑条）
    expect(notesAfter2).toHaveLength(2);
    const merged = notesAfter2[1] as SlideNote;
    const visible = merged.connections.filter((c) => !c.hidden);
    expect(visible.map((c) => [c.beat, c.lane])).toEqual([[1, 2], [3, 4], [5, 0]]);
    // 两段参数齐备：span0 = 第一条的配置、span1 = 第二条的配置
    expect(effectiveSpanParams(merged)[0]).toEqual({ kind: 'easing', ...CFG });
    expect(effectiveSpanParams(merged)[1]).toEqual({ kind: 'easing', ...CFG2 });
    // 两段都烘焙了 hidden 采样
    expect(merged.connections.filter((c) => c.hidden).length).toBeGreaterThan(0);
  });

  it('级联合并：A→B 与 C→D 同时存在，放 B→C → 一步合成 A→B→C→D', () => {
    const notes: ChartNote[] = [
      bpmAt0,
      { type: 'Slide', connections: [{ beat: 1, lane: 2, subBeat: 0 }, { beat: 2, lane: 4, subBeat: 0 }] },
      { type: 'Slide', connections: [{ beat: 3, lane: 1, subBeat: 0 }, { beat: 4, lane: 0, subBeat: 0 }] },
    ];
    const anchor = input({ notes, pos: { beat: 2, lane: 4 } });
    const draft = (anchor[0] as Extract<typeof anchor[0], { t: 'setCurveBuffer' }>).draft!;
    const ops = input({ notes, pos: { beat: 3, lane: 1 }, curveDraft: draft });
    const notesAfter = (ops.find((o) => o.t === 'setNotes') as { t: 'setNotes'; notes: ChartNote[] }).notes;
    const slides = notesAfter.filter((n) => n.type === 'Slide') as SlideNote[];
    expect(slides).toHaveLength(1);
    const visible = slides[0]!.connections.filter((c) => !c.hidden);
    expect(visible.map((c) => c.beat)).toEqual([1, 2, 3, 4]);
  });

  it('端点不相接 = 独立新滑条（重叠位置合法，普通滑条同口径）', () => {
    const existing: SlideNote = { type: 'Slide', connections: [{ beat: 1, lane: 2, subBeat: 0 }, { beat: 2, lane: 3, subBeat: 0 }] };
    const notes: ChartNote[] = [bpmAt0, existing];
    const anchor = input({ notes, pos: { beat: 4, lane: 0 } });
    const draft = (anchor[0] as Extract<typeof anchor[0], { t: 'setCurveBuffer' }>).draft!;
    const ops = input({ notes, pos: { beat: 5, lane: 1 }, curveDraft: draft });
    const notesAfter = (ops.find((o) => o.t === 'setNotes') as { t: 'setNotes'; notes: ChartNote[] }).notes;
    expect(notesAfter.filter((n) => n.type === 'Slide')).toHaveLength(2);
  });

  it('合并方向无关：先放后段 C→B（倒点排序），再以 B 为锚点接 A→B → 合并 A→B→C', () => {
    // 第一条：倒着放 C(3,lane1) → B(2,lane4)：排序成 B→C
    const first = input({ pos: { beat: 3, lane: 1 } });
    const draft = (first[0] as Extract<typeof first[0], { t: 'setCurveBuffer' }>).draft!;
    const placed = input({ notes: [bpmAt0], pos: { beat: 2, lane: 4 }, curveDraft: draft });
    const notesAfter1 = (placed.find((o) => o.t === 'setNotes') as { t: 'setNotes'; notes: ChartNote[] }).notes;
    // 第二条：A(1,lane2) → B(2,lane4)：链尾接既有滑条头
    const anchor = input({ notes: notesAfter1, pos: { beat: 1, lane: 2 } });
    const draft2 = (anchor[0] as Extract<typeof anchor[0], { t: 'setCurveBuffer' }>).draft!;
    const second = input({ notes: notesAfter1, pos: { beat: 2, lane: 4 }, curveDraft: draft2 });
    const notesAfter2 = (second.find((o) => o.t === 'setNotes') as { t: 'setNotes'; notes: ChartNote[] }).notes;
    const slides = notesAfter2.filter((n) => n.type === 'Slide') as SlideNote[];
    expect(slides).toHaveLength(1);
    const visible = slides[0]!.connections.filter((c) => !c.hidden);
    expect(visible.map((c) => c.beat)).toEqual([1, 2, 3]);
  });
});

describe('issue 09 S3 补 · 镜像 = 解析段缓动型翻转（ADR-0009 §4 真镜像）', () => {
  it('In↔Out / In-Out↔Out-In（族不变）；模板段与无参数段不动', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 1, lane: 0, subBeat: 0 },
        { beat: 2, lane: 6, subBeat: 0, hidden: true },
        { beat: 3, lane: 3, subBeat: 0 },
      ],
      spanParams: {
        visibleCount: 2,
        bySpan: {
          0: { kind: 'easing', family: 'quad', type: 'in', precision: 16 },
          1: { kind: 'easing', family: 'sine', type: 'outIn', precision: 32 },
        },
      },
    }];
    const out = mirrorNote(notes[0]!) as SlideNote;
    // 点集镜像
    expect(out.connections.every(c => c.lane === mirrorLane((notes[0] as SlideNote).connections.find(x => x.beat === c.beat)!.lane))).toBe(true);
    // 参数型翻转、族/精度不变
    expect(out.spanParams?.bySpan[0]).toEqual({ kind: 'easing', family: 'quad', type: 'out', precision: 16 });
    expect(out.spanParams?.bySpan[1]).toEqual({ kind: 'easing', family: 'sine', type: 'inOut', precision: 32 });
    // 模板段原样
    const withTpl: ChartNote[] = [{
      type: 'Slide',
      connections: [{ beat: 1, lane: 0, subBeat: 0 }, { beat: 2, lane: 6, subBeat: 0 }],
      spanParams: { visibleCount: 2, bySpan: { 0: { kind: 'template', templateId: 's-curve' } } },
    }];
    const out2 = mirrorNote(withTpl[0]!) as SlideNote;
    expect(out2.spanParams?.bySpan[0]).toEqual({ kind: 'template', templateId: 's-curve' });
  });
});

// ───────────────────────── issue 09 验收反馈轮（2026-09-13） ─────────────────────────

describe('issue 09 验收 #4 · 两击直放：倒放置排序 / 同位取消', () => {
  it('首段倒点（先点后拍再点前拍）= 排序后成条，缓动按排序正向烘焙（对标滑条两击）', () => {
    const anchor: CurveDraft = { points: [{ beat: 3, lane: 4, subBeat: 0 }], params: {}, noteIndex: null };
    const ops = curveChainClickOps([bpmAt0], anchor, { beat: 1, lane: 2, subBeat: 0 }, CFG, 4);
    const setNotes = ops.find((o) => o.t === 'setNotes') as { t: 'setNotes'; notes: ChartNote[] };
    const slide = setNotes.notes[1] as SlideNote;
    // connections 升序（排序生效），hidden 照常烘焙（2 拍 × 1/16 → 31 点）
    expect(slide.connections[0]!.beat).toBe(1);
    expect(slide.connections.at(-1)!.beat).toBe(3);
    expect(slide.connections.filter((c) => c.hidden)).toHaveLength(31);
    // 放置即收工：草稿清空（验收补充：不残留续段态）
    const buf = ops.find((o) => o.t === 'setCurveBuffer') as { t: 'setCurveBuffer'; draft: CurveDraft | null };
    expect(buf.draft).toBeNull();
  });

  it('与锚点同拍位（不看 lane）= 取消草稿（对标滑条两击同位取消）', () => {
    const anchor: CurveDraft = { points: [{ beat: 3, lane: 4, subBeat: 0 }], params: {}, noteIndex: null };
    const ops = curveChainClickOps([bpmAt0], anchor, { beat: 3, lane: 1, subBeat: 0 }, CFG, 4);
    expect(ops).toEqual([
      { t: 'setCurveBuffer', draft: null },
      { t: 'setSelection', items: [] },
    ]);
  });
});

describe('issue 09 验收 #7 · 曲线框选 = 组合 + 全部段应用（curveBoxOps）', () => {
  it('组合后对产物滑条每个逻辑段应用当前配置（多段全被覆盖）', () => {
    const notes: ChartNote[] = [
      bpmAt0,
      { type: 'Single', beat: 1, lane: 1, subBeat: 0 },
      { type: 'Single', beat: 2, lane: 2, subBeat: 0 },
      { type: 'Single', beat: 3, lane: 0, subBeat: 0 },
    ];
    const ops = boxSelectOps('curve', notes,
      [{ kind: 'note', noteIndex: 1 }, { kind: 'note', noteIndex: 2 }, { kind: 'note', noteIndex: 3 }],
      [], CFG, 4);
    const setNotes = ops.find((o) => o.t === 'setNotes') as { t: 'setNotes'; notes: ChartNote[] };
    const slide = setNotes.notes.find((n) => n.type === 'Slide') as SlideNote;
    expect(slide).toBeTruthy();
    // 组合出的 2 段全部拿到参数（3 可见结点 → 2 段）
    expect(Object.keys(effectiveSpanParams(slide)).sort()).toEqual(['0', '1']);
    expect(slide.connections.filter((c) => c.hidden).length).toBeGreaterThan(0);
    // 单快照 + 清选区
    expect(ops.some((o) => o.t === 'setSelection' && o.items.length === 0)).toBe(true);
  });

  it('无可组合（单条已有滑条被框）= 退化为纯批量应用（整条每段覆盖，含已有缓动段）', () => {
    const target: SlideNote = {
      type: 'Slide',
      connections: [
        { beat: 1, lane: 0 }, { beat: 2, lane: 3, hidden: true }, { beat: 3, lane: 0 },
      ],
      spanParams: { visibleCount: 2, bySpan: { 0: { kind: 'easing', family: 'sine', type: 'inOut', precision: 32 } } },
    };
    const notes: ChartNote[] = [bpmAt0, target];
    const ops = boxSelectOps('curve', notes,
      [{ kind: 'slideRegion', noteIndex: 1, connIndex: 0 }], [], CFG, 4);
    const setNotes = ops.find((o) => o.t === 'setNotes') as { t: 'setNotes'; notes: ChartNote[] };
    const edited = setNotes.notes[1] as SlideNote;
    expect(effectiveSpanParams(edited)[0]).toEqual({ kind: 'easing', ...CFG });
    expect(edited.connections.filter((c) => c.hidden)).toHaveLength(31); // 2 拍 × 1/16
  });

  it('框内既无可组合来源也无滑条 = 无事发生（空 op）', () => {
    const notes: ChartNote[] = [bpmAt0, { type: 'Single', beat: 1, lane: 1, subBeat: 0 }];
    expect(boxSelectOps('curve', notes, [{ kind: 'note', noteIndex: 1 }], [], CFG, 4)).toEqual([]);
  });
});

describe('issue 09 验收 #9 · 执行-曲线（execCurveOps，Shift+W）', () => {
  it('选区 ≥2 = 组合 + 全部段应用（与框选同源）', () => {
    const notes: ChartNote[] = [
      bpmAt0,
      { type: 'Single', beat: 1, lane: 1, subBeat: 0 },
      { type: 'Single', beat: 2, lane: 2, subBeat: 0 },
    ];
    const ops = execCurveOps({
      notes, selectedItems: [{ kind: 'note', noteIndex: 1 }, { kind: 'note', noteIndex: 2 }],
      cursor: { beat: 2, lane: 2 }, chartEndBeat: 16, beatDisplay: 4,
      lastBpm: 120, clipboard: [], curveDraft: null, curveConfig: CFG, hit: null,
    });
    const setNotes = ops.find((o) => o.t === 'setNotes') as { t: 'setNotes'; notes: ChartNote[] };
    const slide = setNotes.notes.find((n) => n.type === 'Slide') as SlideNote;
    expect(Object.keys(effectiveSpanParams(slide))).toEqual(['0']);
  });

  it('无选区 + 光标在空白 = 与单击同源（挂锚点/续段，共用 curveDraft）', () => {
    const ops = execCurveOps({
      notes: [bpmAt0], selectedItems: [], cursor: { beat: 2, lane: 3 }, chartEndBeat: 16, beatDisplay: 4,
      lastBpm: 120, clipboard: [], curveDraft: null, curveConfig: CFG, hit: null,
    });
    expect(ops).toEqual([
      { t: 'setCurveBuffer', draft: { points: [{ beat: 2, lane: 3, subBeat: 0 }], params: {}, noteIndex: null } },
      { t: 'setSelection', items: [] },
    ]);
  });

  it('无选区 + 光标悬停在段上 = 重应用当前配置（与点段单击同语义）', () => {
    const target: SlideNote = { type: 'Slide', connections: [{ beat: 1, lane: 0 }, { beat: 2, lane: 4 }] };
    const ops = execCurveOps({
      notes: [bpmAt0, target], selectedItems: [], cursor: { beat: 9, lane: 0 }, chartEndBeat: 16, beatDisplay: 4,
      lastBpm: 120, clipboard: [], curveDraft: null, curveConfig: CFG,
      hit: { kind: 'slideRegion', noteIndex: 1, connIndex: 0 },
    });
    const setNotes = ops.find((o) => o.t === 'setNotes') as { t: 'setNotes'; notes: ChartNote[] };
    const edited = setNotes.notes[1] as SlideNote;
    expect(effectiveSpanParams(edited)[0]).toEqual({ kind: 'easing', ...CFG });
  });

  it('光标不在画布（cursor=null）= 无事发生（§3 惯例，不清选区）', () => {
    expect(execCurveOps({
      notes: [bpmAt0], selectedItems: [], cursor: null, chartEndBeat: 16, beatDisplay: 4,
      lastBpm: 120, clipboard: [], curveDraft: null, curveConfig: CFG, hit: null,
    })).toEqual([]);
  });
});

describe('issue 09 验收 #5 · 画笔平滑（smoothPenLanes）', () => {
  it('beat 栅格与首尾端点保持不动，只动中间 lane', () => {
    const pts = [
      { beat: 1, lane: 0 }, { beat: 1.25, lane: 6 }, { beat: 1.5, lane: 0 }, { beat: 1.75, lane: 6 }, { beat: 2, lane: 0 },
    ];
    const out = smoothPenLanes(pts);
    expect(out.map((p) => p.beat)).toEqual(pts.map((p) => p.beat));
    expect(out[0]!.lane).toBe(0);
    expect(out.at(-1)!.lane).toBe(0);
  });

  it('锯齿被抹平：平滑后中间点的极值向邻域收敛（|lane| 变小）', () => {
    const pts = [
      { beat: 1, lane: 0 }, { beat: 1.25, lane: 6 }, { beat: 1.5, lane: 0 }, { beat: 1.75, lane: 6 }, { beat: 2, lane: 0 },
    ];
    const out = smoothPenLanes(pts);
    expect(Math.abs(out[1]!.lane)).toBeLessThan(6);
    expect(Math.abs(out[2]!.lane)).toBeGreaterThan(0);
  });

  it('直线轨迹平滑后不变（平滑不引入形变）', () => {
    const pts = [
      { beat: 1, lane: 0 }, { beat: 1.25, lane: 1.5 }, { beat: 1.5, lane: 3 }, { beat: 1.75, lane: 4.5 }, { beat: 2, lane: 6 },
    ];
    const out = smoothPenLanes(pts);
    out.forEach((p, i) => expect(p.lane).toBeCloseTo(pts[i]!.lane, 12));
  });

  it('lane 钳制 0..6；点数 <3 原样返回', () => {
    const pts = [{ beat: 1, lane: 0 }, { beat: 1.5, lane: 9 }, { beat: 2, lane: 0 }];
    const out = smoothPenLanes(pts);
    expect(out[1]!.lane).toBeLessThanOrEqual(6);
    expect(smoothPenLanes([{ beat: 1, lane: 2 }])).toHaveLength(1);
  });
});

describe('issue 09 四轮 · 画笔落子自动组合（placeSpanWithCombination）', () => {
  it('A→B 存在，画笔从 B 画到 C（自由段无参数）→ 合并 A→B→C；既有段参数按签名保留，新段为自由段', () => {
    // 既有：A(1,2) → B(3,4)，缓动段
    const existing: SlideNote = {
      type: 'Slide',
      connections: [
        { beat: 1, lane: 2, subBeat: 0 },
        ...Array.from({ length: 5 }, (_, k) => ({ beat: 1.5 + k * 0.25, lane: 2 + (k + 1) * 0.4, hidden: true as const })),
        { beat: 3, lane: 4, subBeat: 0 },
      ],
      spanParams: { visibleCount: 2, bySpan: { 0: { kind: 'easing', ...CFG } } },
    };
    const notes: ChartNote[] = [bpmAt0, existing];
    // 画笔：B(3,4) → C(5,0)，途中 3 个采样（自由段，param=null）
    const hidden = [
      { beat: 3.5, lane: 3, hidden: true as const },
      { beat: 4, lane: 2, hidden: true as const },
      { beat: 4.5, lane: 1, hidden: true as const },
    ];
    const result = placeSpanWithCombination(notes, { beat: 3, lane: 4 }, { beat: 5, lane: 0 }, hidden, null, 4);
    const slides = result.filter((n) => n.type === 'Slide') as SlideNote[];
    expect(slides).toHaveLength(1);
    const merged = slides[0]!;
    const visible = merged.connections.filter((c) => !c.hidden);
    expect(visible.map((c) => [c.beat, c.lane])).toEqual([[1, 2], [3, 4], [5, 0]]);
    // 既有段参数按签名保留；新段（B→C）无参数 = 自由段
    const params = effectiveSpanParams(merged);
    expect(params[0]).toEqual({ kind: 'easing', ...CFG });
    expect(params[1]).toBeUndefined();
    // 画笔采样点在位
    expect(merged.connections.filter((c) => c.hidden)).toHaveLength(3 + 5);
  });

  it('端点不相接 = 独立新画笔滑条', () => {
    const existing: SlideNote = { type: 'Slide', connections: [{ beat: 1, lane: 2, subBeat: 0 }, { beat: 2, lane: 3, subBeat: 0 }] };
    const result = placeSpanWithCombination(
      [bpmAt0, existing], { beat: 4, lane: 0 }, { beat: 5, lane: 1 },
      [{ beat: 4.5, lane: 0.5, hidden: true }], null, 4,
    );
    expect(result.filter((n) => n.type === 'Slide')).toHaveLength(2);
  });
});
