/**
 * issue 09 验收反馈六轮锁测：滑条连接带**横截面口径的单一真相**（`slideBandGeometry` = 车道横向 ±half，
 * 端点封口 = 过结点中心的水平线段）。
 *
 * 钉住的不变量（回归史）：
 * - 实绘 / 选中 hover 描边 / 命中三侧同源。四轮-五轮把实绘单独改成**垂直法线**（法向等宽），
 *   另两侧仍是横向 → 端点封口变斜线，纵向伸出 `half·cosθ` 戳出端点图标墨迹（用户截图的台阶/豁口），
 *   且"亮起的轮廓"与"画出的带子"不是同一个形状。
 * - 相邻逻辑段在共享结点上必须产生**同一条**封口线段（跨段无台阶，靠口径一致性而非角平分线法线）。
 * - 封口宽 = 车道宽 < 端点图标墨迹宽 → 带子看起来"穿进端点里"。
 */
import { describe, it, expect } from 'vitest';
import { ChartGeometry, LANE_WIDTH } from '../../src/chart/geometry/ChartGeometry';
import { makeCoords } from '../../src/visual/coords';
import { collectSelectionOutlines, renderSpanBands } from '../../src/visual/render';
import { findItemAt } from '../../src/visual/hitTest';
import { bandPolygon, bandPolygonAt, splitBandAtFolds } from '../../src/visual/slideBandGeometry';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '../../src/visual/noteSkin';
import { SLIDE_ICON_SIZE } from '../../src/visual/noteMetrics';
import type { RenderCtx } from '../../src/visual/types';
import type { ChartNote, SlideNote } from '../../src/chart/types';

const BPM = [{ beat: 0, bpm: 120 }];
const SURFACE = { w: 750, h: 900 };
const BEAT_DISPLAY = 4;
const ICONS = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));
const VIEWPORT = { scrollX: 0, scrollY: 0, scale: 1, virtualWidth: 0, virtualHeight: 0 };
const HALF = LANE_WIDTH / 2;

type Conn = { lane: number; beat: number; subBeat?: number; hidden?: boolean };
type Pt = { x: number; y: number };

function harness(notes: ChartNote[]) {
  const geometry = new ChartGeometry(BPM, 100, SURFACE);
  const c = makeCoords(geometry, VIEWPORT, BEAT_DISPLAY, notes);
  const rc = {
    geometry,
    viewport: VIEWPORT,
    surface: SURFACE,
    dpr: 1,
    beatDisplay: BEAT_DISPLAY,
    chartEndBeat: 100,
    notes,
    selectedItems: [],
    slideBuffer: null,
    hoverPos: null,
    hoverItem: null,
    clipboard: [],
    markerBeat: null,
    markerSelected: false,
    armedTool: null,
    rightButtonHeld: false,
    spriteIcon: { render: () => undefined, renderDecorator: () => undefined },
    noteIcons: ICONS,
    display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: false, colorAssist: false },
  } as unknown as RenderCtx;
  const cents = (conns: Conn[]): Pt[] => conns.map((cn) =>
    c.virtualToCanvas(c.getNoteVirtualX(cn.lane), c.getNoteVirtualY(cn.beat, cn.subBeat || 0)));
  return { c, rc, cents };
}

/** 记录 fill 路径与 spriteIcon.render 调用（含当帧 transform）的假 2D 上下文 */
function recorder() {
  const paths: [number, number][][] = [];
  const draws: { matrix: number[]; props: Record<string, number> }[] = [];
  let cur: [number, number][] | null = null;
  let matrix = [1, 0, 0, 1, 0, 0];
  const ctx = {
    globalAlpha: 1, fillStyle: '', lineJoin: '',
    save() {}, restore() {},
    beginPath() { cur = []; },
    closePath() {},
    moveTo(x: number, y: number) { cur = cur ?? []; cur.push([x, y]); },
    lineTo(x: number, y: number) { (cur ??= []).push([x, y]); },
    fill() { if (cur && cur.length) paths.push(cur); cur = null; },
    transform(a: number, b: number, cc: number, d: number, e: number, f: number) { matrix = [a, b, cc, d, e, f]; },
    clip() {},
    setLineDash() {},
  } as unknown as CanvasRenderingContext2D;
  const spriteIcon = {
    render: (_c: CanvasRenderingContext2D, props: Record<string, number>) => {
      draws.push({ matrix: [...matrix], props });
    },
    renderDecorator: () => undefined,
  };
  /** 把一次 sprite 绘制的目标矩形（中心 + 宽高）按当帧矩阵变换到画布坐标 */
  const corners = (d: { matrix: number[]; props: Record<string, number> }): [number, number][] => {
    const [a, b, c1, d1, e, f] = d.matrix;
    const w = d.props.canvasWidth / 2, h = d.props.canvasHeight / 2;
    const cx = d.props.canvasX, cy = d.props.canvasY;
    return [[cx - w, cy - h], [cx + w, cy - h], [cx + w, cy + h], [cx - w, cy + h]]
      .map(([x, y]) => [a * x + c1 * y + e, b * x + d1 * y + f] as [number, number]);
  };
  return { ctx, paths, draws, corners, spriteIcon };
}

/** 结点行上（y === node.y）所有顶点的 x 范围 = 该端点封口线段 */
function capAt(paths: [number, number][][], node: Pt): { x0: number; x1: number } | null {
  let x0 = Infinity, x1 = -Infinity;
  for (const p of paths) {
    for (const [x, y] of p) {
      if (Math.abs(y - node.y) > 1e-6) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    }
  }
  return x1 > x0 ? { x0, x1 } : null;
}

const SP_CONNS: Conn[] = [
  { lane: 0, beat: 10 },
  { lane: 1, beat: 10.5, hidden: true },
  { lane: 2, beat: 11, hidden: true },
  { lane: 3, beat: 11.5 },
];

describe('滑条带体横截面口径（issue 09 六轮：实绘 = 描边 = 命中）', () => {
  it('SP 段实绘：每条填充路径在两端结点行上都闭合为水平封口（封口不会转成斜线）', () => {
    const note = { type: 'Slide', connections: SP_CONNS } as ChartNote;
    const { c, rc, cents } = harness([note]);
    const rec = recorder();
    const rc2 = { ...rc, spriteIcon: rec.spriteIcon } as RenderCtx;
    renderSpanBands(rec.ctx, c, rc2, (note as SlideNote).connections, 1);
    expect(rec.paths.length).toBeGreaterThan(0);
    const [p0, pLast] = [cents(SP_CONNS)[0]!, cents(SP_CONNS)[3]!];
    for (const p of rec.paths) {
      // 子路径首尾顶点同处起点结点行 → closePath 的封口是水平线
      expect(p[0]![1]).toBeCloseTo(p0.y, 6);
      expect(p[p.length - 1]![1]).toBeCloseTo(p0.y, 6);
    }
    // 两端封口都在结点行内、不越过车道列
    const capA = capAt(rec.paths, p0)!;
    const capB = capAt(rec.paths, pLast)!;
    expect(capA.x0).toBeCloseTo(p0.x - HALF, 6);
    expect(capA.x1).toBeCloseTo(p0.x + HALF, 6);
    expect(capB.x0).toBeCloseTo(pLast.x - HALF, 6);
    expect(capB.x1).toBeCloseTo(pLast.x + HALF, 6);
  });

  it('SP 段实绘 = 共享口径多边形（与 hover 描边/命中同一 bandPolygon，取最宽层）', () => {
    const note = { type: 'Slide', connections: SP_CONNS } as ChartNote;
    const { c, rc, cents } = harness([note]);
    const rec = recorder();
    renderSpanBands(rec.ctx, c, { ...rc, spriteIcon: rec.spriteIcon } as RenderCtx, (note as SlideNote).connections, 1);
    // 最宽层的左右 extremes 必须逐端点等于 bandRails(pts, half)（细分只加内部点，不改两端结点）
    const centsEnds = cents(SP_CONNS);
    const poly = bandPolygon([centsEnds[0]!, centsEnds[3]!], HALF);
    const widest = rec.paths.reduce((a, b) => (b.length > a.length ? b : a));
    const xs = widest.map((p) => p[0]);
    const polyXs = poly.map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(Math.min(...polyXs) - 1e-6);
    expect(Math.max(...xs)).toBeLessThanOrEqual(Math.max(...polyXs) + 1e-6);
    // 逐层等比收窄：所有顶点的 x 相对中心线的偏移 ≤ half
    for (const p of rec.paths) {
      for (const [x, y] of p) {
        const onRow = centsEnds.find((q) => Math.abs(q.y - y) < 1e-6);
        if (onRow) expect(Math.abs(x - onRow.x)).toBeLessThanOrEqual(HALF + 1e-6);
      }
    }
  });

  it('普通滑条单段实绘：剪切贴图铺满的平行四边形 === bandPolygon（不再旋转映射）', () => {
    const conns: Conn[] = [{ lane: 0, beat: 10 }, { lane: 3, beat: 12 }];
    const note = { type: 'Slide', connections: conns } as ChartNote;
    const { c, rc, cents } = harness([note]);
    const rec = recorder();
    renderSpanBands(rec.ctx, c, { ...rc, spriteIcon: rec.spriteIcon } as RenderCtx, conns as never, 1);
    expect(rec.draws).toHaveLength(1);
    const got = rec.corners(rec.draws[0]!).map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);
    const want = bandPolygon(cents(conns), HALF).map((p) => [Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6]);
    // 同一四边形（顶点序可不同）
    expect(got.slice().sort()).toEqual(want.slice().sort());
  });

  it('相邻逻辑段在共享结点上封口重合 = 跨段天然连续（无需角平分线法线）', () => {
    // A→B 缓动段（含 hidden）+ B→C 普通段：两段共用结点 B
    const conns: Conn[] = [
      { lane: 0, beat: 10 },
      { lane: 1, beat: 10.5, hidden: true },
      { lane: 2, beat: 11 },
      { lane: 4, beat: 13 },
    ];
    const note = { type: 'Slide', connections: conns } as ChartNote;
    const { c, rc, cents } = harness([note]);
    const b = cents(conns)[2]!;
    const recA = recorder();
    renderSpanBands(recA.ctx, c, { ...rc, spriteIcon: recA.spriteIcon } as RenderCtx,
      [{ ...conns[0]! }, { ...conns[1]! }, { ...conns[2]! }] as never, 1);
    const recB = recorder();
    renderSpanBands(recB.ctx, c, { ...rc, spriteIcon: recB.spriteIcon } as RenderCtx,
      [{ ...conns[2]! }, { ...conns[3]! }] as never, 1);
    const capA = capAt(recA.paths, b)!;          // SP 段在 B 的封口（路径末端）
    const cornersB = recB.corners(recB.draws[0]!) // 普通段在 B 的封口 = 平行四边形一端
      .filter(([x, y]) => Math.abs(y - b.y) < 1e-6)
      .map(([x]) => x);
    const capB = { x0: Math.min(...cornersB), x1: Math.max(...cornersB) };
    expect(capA.x0).toBeCloseTo(capB.x0, 6);
    expect(capA.x1).toBeCloseTo(capB.x1, 6);
    expect(capB.x1 - capB.x0).toBeCloseTo(LANE_WIDTH, 6);
  });

  it('封口宽 = 车道宽 < 端点图标墨迹宽 → 带子藏在端点图标下', () => {
    expect(2 * HALF).toBe(LANE_WIDTH);
    expect(LANE_WIDTH).toBeLessThan(SLIDE_ICON_SIZE);
  });

  it('hover/选中描边与命中区同口径（描边 quad === bandPolygonAt；带外一点不命中）', () => {
    const note = { type: 'Slide', connections: SP_CONNS } as ChartNote;
    const { c, rc, cents } = harness([note]);
    const rcSel = { ...rc, notes: [note], selectedItems: [{ kind: 'note', noteIndex: 0 }] } as RenderCtx;
    const out = collectSelectionOutlines(c, rcSel, [{ note, index: 0 }]).filter((o) => o.shape === 'quad');
    expect(out).toHaveLength(1);
    const quad = (out[0] as unknown as { points: [number, number][] }).points;
    expect(quad).toEqual(bandPolygonAt(cents(SP_CONNS), HALF));
    // 命中区同口径：段中部（远离任何结点）在车道列内 → 命中该段；越过左右轨 → 不命中
    const cs = cents(SP_CONNS);
    const mid = { x: (cs[0]!.x + cs[1]!.x) / 2, y: (cs[0]!.y + cs[1]!.y) / 2 };
    const deps = { geometry: rc.geometry, viewport: VIEWPORT, beatDisplay: BEAT_DISPLAY, notes: [note] };
    expect(findItemAt(mid.x + HALF - 1, mid.y, deps as never)?.kind).toBe('slideRegion');
    expect(findItemAt(mid.x - HALF - 2, mid.y, deps as never)?.kind).not.toBe('slideRegion');
    expect(findItemAt(mid.x + HALF + 2, mid.y, deps as never)?.kind).not.toBe('slideRegion');
    // 端点封口整段落在端点图标的命中盒内（结点优先于段）→ 封口必然被图标盖住
    expect(findItemAt(cs[0]!.x + HALF - 1, cs[0]!.y, deps as never)?.kind).toBe('slideNode');
    expect(findItemAt(cs[0]!.x - HALF + 1, cs[0]!.y, deps as never)?.kind).toBe('slideNode');
  });
});

describe('回折切分 splitBandAtFolds（issue 09 验收反馈 #1：自叠环带抵消出黑线）', () => {
  const P = (x: number, y: number) => ({ x, y });

  it('单调中心线 → 原样一段（与改动前逐像素一致）', () => {
    const pts = [P(0, 0), P(1, 10), P(2, 20), P(3, 30)];
    expect(splitBandAtFolds(pts)).toEqual([pts]);
  });

  it('两次采样不折返（2 点段）→ 原样一段', () => {
    const pts = [P(0, 30), P(0, 0)];
    expect(splitBandAtFolds(pts)).toEqual([pts]);
  });

  it('dy 变号 → 在反转点切开，相邻段共享该点（无缝）', () => {
    const pts = [P(0, 0), P(0, 10), P(0, 20), P(1, 12), P(2, 4)];
    const runs = splitBandAtFolds(pts);
    expect(runs.length).toBe(2);
    expect(runs[0]).toEqual([pts[0], pts[1], pts[2]]);
    expect(runs[1]).toEqual([pts[2], pts[3], pts[4]]);
    // 共享反转点 = 两条 run 的接缝零间隙
    expect(runs[0]!.at(-1)).toEqual(runs[1]![0]);
  });

  it('多次折返（导入谱合法）→ 每段内部 dy 同号', () => {
    const pts = [P(0, 0), P(0, 10), P(0, 20), P(0, 10), P(0, 0), P(0, 8)];
    const runs = splitBandAtFolds(pts);
    expect(runs.length).toBe(3);
    for (const r of runs) {
      const ds = r.slice(1).map((p, i) => Math.sign(p.y - r[i]!.y)).filter((s) => s !== 0);
      expect(new Set(ds).size).toBe(1);
    }
  });

  it('水平抖动（dy=0 段）不改变方向锁、不产生多余切分', () => {
    const pts = [P(0, 0), P(1, 0), P(2, 10), P(3, 10), P(4, 20)];
    expect(splitBandAtFolds(pts)).toEqual([pts]);
  });
});

describe('连接带实绘与描边/命中同顶点（issue 09 验收反馈 #2：SP 带体不再超出 hover 轮廓）', () => {
  it('SP 段实绘最外环 = bandPolygonAt(cents) 逐顶点相等（实绘不再做渲染期细分平滑）', () => {
    const note = { type: 'Slide', connections: SP_CONNS } as ChartNote;
    const { rc, cents } = harness([note]);
    const rec = recorder();
    rc.spriteIcon = rec.spriteIcon as RenderCtx['spriteIcon'];
    renderSpanBands(rec.ctx, makeCoords(rc.geometry, rc.viewport, rc.beatDisplay, [note]), rc, SP_CONNS as never);
    const expected = bandPolygonAt(cents(SP_CONNS), HALF).map(([x, y]) => [x, y] as [number, number]);
    // 最外软环（最后几层 fill 之一）必须与描边多边形**逐顶点相等**；
    // 细分平滑存在时拱出弦线 → 必不相等。
    const match = rec.paths.some((p) =>
      p.length >= expected.length &&
      expected.every(([x, y], i) => p[i] && Math.abs(p[i]![0] - x) < 1e-6 && Math.abs(p[i]![1] - y) < 1e-6));
    expect(match).toBe(true);
  });
});

describe('回折（拍位倒退）SP 段带体（issue 09 验收反馈 #1：重叠处黑线）', () => {
  // 画布 y ∝ 拍位：dy 变号 = 时间轴回折 → 带体自叠
  const FOLD: Conn[] = [
    { lane: 2, beat: 10 },
    { lane: 3, beat: 11, hidden: true },
    { lane: 4, beat: 12, hidden: true },
    { lane: 3, beat: 11.5, hidden: true },  // 折返（beat 倒退，导入谱合法）
    { lane: 2, beat: 11 },
  ];

  it('dy 变号的段被拆成多条独立环带路径（单次 fill 内不自叠 → 无环绕抵消黑线）', () => {
    const note = { type: 'Slide', connections: FOLD } as ChartNote;
    const { c, rc } = harness([note]);
    const rec = recorder();
    rc.spriteIcon = rec.spriteIcon as RenderCtx['spriteIcon'];
    renderSpanBands(rec.ctx, c, rc, FOLD as never);
    expect(rec.paths.length).toBeGreaterThan(0);
    // 每条记录的路径 = 单条 run 的环带：其顶点 y 序列不回折
    for (const p of rec.paths) {
      const ds = p.slice(1).map((pt, i) => Math.sign(pt[1] - p[i]![1])).filter((v) => v !== 0);
      expect(new Set(ds).size).toBeLessThanOrEqual(2); // 外轨正序 + 内轨逆序（同段）→ 至多两向
    }
  });

  it('拆条带生效：回折段 fill 路径数 > 同首段单调路径（run 独立环带）', () => {
    const mono = FOLD.slice(0, 4); // 同前 4 点但去掉折返 → 单一 run
    const mNote = { type: 'Slide', connections: mono } as ChartNote;
    const recM = recorder();
    const { c: cm, rc: rcm } = harness([mNote]);
    rcm.spriteIcon = recM.spriteIcon as RenderCtx['spriteIcon'];
    renderSpanBands(recM.ctx, cm, rcm, mono as never);
    const fNote = { type: 'Slide', connections: FOLD } as ChartNote;
    const recF = recorder();
    const { c: cf, rc: rcf } = harness([fNote]);
    rcf.spriteIcon = recF.spriteIcon as RenderCtx['spriteIcon'];
    renderSpanBands(recF.ctx, cf, rcf, FOLD as never);
    expect(recF.paths.length).toBeGreaterThan(recM.paths.length);
  });
});
