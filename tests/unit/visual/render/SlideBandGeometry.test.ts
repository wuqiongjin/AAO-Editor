/**
 * issue 09 六轮~八轮锁测：滑条连接带**横截面口径的单一真相**（`slideBandGeometry` = 车道横向 ±half，
 * 端点封口 = 过结点中心的水平线段）+ **八轮 SP 带体扫描线光栅**（发虚/黑条纹回归）。
 *
 * 钉住的不变量（回归史）：
 * - 实绘 / 选中 hover 描边 / 命中三侧同源。四轮-五轮把实绘单独改成**垂直法线**（法向等宽），
 *   另两侧仍是横向 → 端点封口变斜线，戳出端点图标墨迹（用户截图的台阶/豁口）。
 * - 相邻逻辑段在共享结点上必须产生**同一条**封口线段（跨段无台阶）。
 * - 封口宽 = 车道宽 < 端点图标墨迹宽 → 带子"穿进端点里"。
 * - **八轮 #1**：SP 带体横截面 α 是 `|x−cx(y)|/half` 的**连续插值函数**（扫描线光栅，每像素至多
 *   一笔）。七轮及以前的"16 层半透明同心环带逐层 fill"在每条层边界留下暗发丝线（半透明两笔
 *   覆盖同一像素的合成亏缺 ≈ ¼a²），放大 = 成排黑色条纹、常态 = 发虚——中心→亮缘任何内部像素
 *   都不得比邻域更暗（下方"无暗缝"用例锁死）。回折两臂 = 像素内 screen 合成 → 叠亮不相消。
 */
import { describe, it, expect } from 'vitest';
import { ChartGeometry, LANE_WIDTH } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/visual/coords';
import { collectSelectionOutlines, renderSpanBands } from '@/src/visual/render';
import { findItemAt } from '@/src/visual/hitTest';
import { bandPolygon, bandPolygonAt, bandRunAtY, rasterBandRuns, sampleProfileAt, splitBandAtFolds, type BandRaster } from '@/src/visual/slideBandGeometry';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/visual/noteSkin';
import { SLIDE_ICON_SIZE } from '@/src/visual/noteMetrics';
import type { RenderCtx } from '@/src/visual/types';
import type { ChartNote } from '@/src/chart/types';

const BPM = [{ beat: 0, bpm: 120 }];
const SURFACE = { w: 750, h: 900 };
const BEAT_DISPLAY = 4;
const ICONS = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));
const VIEWPORT = { scrollX: 0, scrollY: 0, scale: 1, virtualWidth: 0, virtualHeight: 0 };
const HALF = LANE_WIDTH / 2;

type Conn = { lane: number; beat: number; subBeat?: number; hidden?: boolean };
type Pt = { x: number; y: number };

function harness(notes: ChartNote[]) {
  const geometry = new ChartGeometry(BPM, { endBeat: 100 } , SURFACE);
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

// ───────────────────────── 光栅小工具（sx=sy=1 → 设备像素 = 画布像素） ─────────────────────────

const FLAT_PROFILE = [0.2, 0.4, 0.6, 0.8, 1.0]; // 中心→边缘单调，便于断言连续形状
function raster(pts: Pt[], half: number, profile = FLAT_PROFILE, base = 1): BandRaster | null {
  return rasterBandRuns({
    runs: splitBandAtFolds(pts), half, profile, rgb: [0, 255, 0],
    sx: 1, sy: 1, baseAlpha: base,
  });
}
const alphaAt = (r: BandRaster, x: number, y: number): number => {
  const i = Math.round(x) - r.bxDev;
  const j = Math.round(y) - r.byDev;
  if (i < 0 || j < 0 || i >= r.bw || j >= r.bh) return 0;
  return r.data[(j * r.bw + i) * 4 + 3]! / 255;
};
/** 一行内非零像素的最左/最右列（画布 x）；整行空 → null */
function rowExtent(r: BandRaster, y: number): { x0: number; x1: number } | null {
  let x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < r.bw; i++) {
    if (r.data[(Math.round(y) - r.byDev) * r.bw * 4 + i * 4 + 3] === 0) continue;
    x0 = Math.min(x0, i + r.bxDev); x1 = Math.max(x1, i + r.bxDev);
  }
  return x1 >= x0 ? { x0, x1 } : null;
}

describe('SP 带体扫描线光栅（issue 09 八轮 #1：发虚/黑条纹回归）', () => {
  it('直线竖直带：每一行范围恒等于 cx±half（横截面口径不变）', () => {
    const pts = [0, 10, 20, 30, 40].map((y) => ({ x: 100, y }));
    const r = raster(pts, 15)!;
    expect(r).not.toBeNull();
    for (const y of [5, 15, 25]) {
      const ext = rowExtent(r, y)!;
      expect(ext.x0).toBeGreaterThanOrEqual(100 - 15 - 1);
      expect(ext.x1).toBeLessThanOrEqual(100 + 15 + 1);
      // 半宽外恒空（所见 = 所点的范围口径）
      expect(alphaAt(r, ext.x0 - 2, y)).toBe(0);
      expect(alphaAt(r, ext.x1 + 2, y)).toBe(0);
    }
  });

  it('无暗缝（关键回归）：中心→亮缘剖面单调不减，任何内部像素不比两侧更暗', () => {
    // 七轮"16 层半透明环带逐层 fill"在每条层边界留下 ¼a² 级暗发丝线（放大 = 黑色条纹）；
    // 连续插值 + 每像素至多一笔 → 剖面就是 profile 本身。
    const pts = [0, 12, 25, 40].map((y) => ({ x: 100, y }));
    const r = raster(pts, 15)!;
    const y = 20;
    const alphas: number[] = [];
    for (let x = 100; x <= 115; x++) alphas.push(alphaAt(r, x, y));
    for (let k = 1; k < alphas.length - 1; k++) {
      // 允许边缘 1px 覆盖衰减出现在最外列；此前一律不减
      if (alphas[k]! > 0 && alphas[k]! < alphas[k - 1]! - 1e-6) {
        expect(k).toBeGreaterThanOrEqual(alphas.length - 2);
      }
    }
    // 数值层面 = profile 连续插值（中心 0.2 → 缘 1.0，边缘 1px 覆盖衰减在最末列）
    expect(alphaAt(r, 100, y)).toBeCloseTo(0.2, 1);
    expect(alphaAt(r, 113, y)).toBeGreaterThan(alphaAt(r, 104, y));
    expect(alphaAt(r, 113, y)).toBeGreaterThan(0.85);
    expect(alphaAt(r, 115, y)).toBe(0); // 半宽之外不越界
  });

  it('弯曲带逐行中心 = 折线线性插值（与描边/命中 bandPolygon 顶点同源，不做渲染期平滑）', () => {
    const pts = [{ x: 100, y: 0 }, { x: 110, y: 20 }, { x: 100, y: 40 }];
    const r = raster(pts, 8)!;
    // y=10 → cx=105；y=30 → cx=105（对称弯）
    expect(alphaAt(r, 105, 10)).toBeGreaterThan(0);
    expect(alphaAt(r, 105 - 8 - 2, 10)).toBe(0);
    expect(alphaAt(r, 105 + 8 + 2, 10)).toBe(0);
    // bandRunAtY 线性插值与光栅一致
    expect(bandRunAtY(pts, 10)).toBeCloseTo(105, 6);
    expect(bandRunAtY(pts, 20)).toBeCloseTo(110, 6);
    // 半开行归属：终点行不算（[lo,hi)）
    expect(bandRunAtY(pts, 40)).toBeNull();
  });

  it('回折两臂：逐行各自命中 + 重叠像素 screen 叠亮（不相消成洞）', () => {
    const pts = [{ x: 100, y: 0 }, { x: 100, y: 30 }, { x: 104, y: 10 }]; // 下→上→下（beat 回退）
    const runs = splitBandAtFolds(pts);
    expect(runs.length).toBe(2);
    const r = raster(pts, 6)!;
    // 行 y=15：两臂中心都在 x≈100~102 附近 → 该处非零（旧环带构造在此相消出洞）
    expect(alphaAt(r, 100, 15)).toBeGreaterThan(0);
    // 单臂 vs 双臂：折返重叠区 alpha ≥ 任一臂单独光栅（screen 合成只会更亮）
    const onlyA = raster(runs[0]!, 6)!;
    const solo = alphaAt(onlyA, 100, 15);
    expect(alphaAt(r, 100, 15)).toBeGreaterThanOrEqual(solo);
    expect(alphaAt(r, 100, 15)).toBeLessThanOrEqual(1);
  });

  // issue 116 · 倒流区：同一段时间被来回扫（BPM 翻转），每换一次轨就有一次 Δy = 0 的横跳，
  // 横跳之后立刻反向 —— 切分必须按**非零 dy** 判，否则多条同高平行臂会落在同一个 run 里，
  // 而 `bandRunAtY` 每行只取第一条命中的臂 → 其余臂被静默丢弃（官方画面是 4 根竖条）。
  it('issue 116 · 倒流区「横跳 + 反向」：run 仍按非零 dy 切分，同高的四条平行臂不漏画', () => {
    const Y = (t: number) => t * 20; // 画布 y 由时间给（示意尺度）
    const pts: Pt[] = [
      { x: 120, y: Y(12.8) }, { x: 120, y: Y(4.8) }, { x: 120, y: Y(12.8) }, // lane 6：下→上
      { x: 80, y: Y(12.8) },                                                 // 横跳到 lane 4（Δy = 0）
      { x: 80, y: Y(4.8) }, { x: 80, y: Y(12.8) },                           // lane 4：下→上
      { x: 40, y: Y(12.8) },                                                 // 横跳到 lane 2
      { x: 40, y: Y(4.8) }, { x: 40, y: Y(12.8) },
      { x: 0, y: Y(12.8) },                                                  // 横跳到 lane 0
      { x: 0, y: Y(4.8) }, { x: 0, y: Y(12.8) },
    ];
    const runs = splitBandAtFolds(pts);
    // ① 每个 run 必须 y 单调（非严格：允许 Δy = 0 的横跳段）—— 这是"每行只取一条臂"的前提
    expect(runs.length).toBeGreaterThan(2);
    for (const run of runs) {
      const ys = run.map((p) => p.y);
      const up = ys.every((v, i) => i === 0 || v >= ys[i - 1]!);
      const down = ys.every((v, i) => i === 0 || v <= ys[i - 1]!);
      expect(up || down).toBe(true);
    }
    // ② 同一行上 lane 6/4/2/0 四条臂都要画出来
    const r = raster(pts, 6)!;
    const row = Y(8);
    const arms = [120, 80, 40, 0].filter((x) => alphaAt(r, x, row) > 0);
    expect(arms).toEqual([120, 80, 40, 0]);
  });

  // issue 138 · SP 扫描线必须裁到 clip，否则倒流长条按整条 bbox 光栅（瓦片 768px vs 五千 px）。
  it('issue 138 · clip 后位图高度不超过 clip 窗（含 2px AA 余量）', () => {
    const pts = [{ x: 80, y: 0 }, { x: 80, y: 400 }];
    const r = rasterBandRuns({
      runs: splitBandAtFolds(pts), half: 10, profile: FLAT_PROFILE, rgb: [0, 255, 0],
      sx: 1, sy: 1, baseAlpha: 1,
      clipCss: { minX: 0, minY: 0, maxX: 200, maxY: 20 },
    })!;
    expect(r.bh).toBeLessThanOrEqual(20 + 4 + 2); // clip 高 + padCss×2 + 量化
    expect(alphaAt(r, 80, 10)).toBeGreaterThan(0);
    expect(r.data.length).toBe(r.bw * r.bh * 4);
  });

  it('issue 138 · clip 窗外的折返臂不占位图；窗内四臂仍在', () => {
    const Y = (t: number) => t * 20;
    const pts: Pt[] = [
      { x: 120, y: Y(12.8) }, { x: 120, y: Y(4.8) }, { x: 120, y: Y(12.8) },
      { x: 80, y: Y(12.8) },
      { x: 80, y: Y(4.8) }, { x: 80, y: Y(12.8) },
      { x: 40, y: Y(12.8) },
      { x: 40, y: Y(4.8) }, { x: 40, y: Y(12.8) },
      { x: 0, y: Y(12.8) },
      { x: 0, y: Y(4.8) }, { x: 0, y: Y(12.8) },
    ];
    const row = Y(8);
    const r = rasterBandRuns({
      runs: splitBandAtFolds(pts), half: 6, profile: FLAT_PROFILE, rgb: [0, 255, 0],
      sx: 1, sy: 1, baseAlpha: 1,
      clipCss: { minX: -20, minY: row - 8, maxX: 140, maxY: row + 8 },
    })!;
    expect(r.bh).toBeLessThanOrEqual(16 + 4 + 2);
    expect([120, 80, 40, 0].filter((x) => alphaAt(r, x, row) > 0)).toEqual([120, 80, 40, 0]);
  });

  it('baseAlpha（slideOpacity）逐像素线性生效', () => {
    const pts = [0, 20, 40].map((y) => ({ x: 50, y }));
    const a1 = alphaAt(raster(pts, 10, FLAT_PROFILE, 1)!, 50, 20);
    const a2 = alphaAt(raster(pts, 10, FLAT_PROFILE, 0.5)!, 50, 20);
    expect(a2).toBeCloseTo(a1 * 0.5, 2);
  });

  it('sampleProfileAt：端点恒等 + 单调段内插值不越界', () => {
    expect(sampleProfileAt([0.2, 0.4, 0.6], 0)).toBeCloseTo(0.2, 6);
    expect(sampleProfileAt([0.2, 0.4, 0.6], 1)).toBeCloseTo(0.6, 6);
    expect(sampleProfileAt([0.2, 0.4, 0.6], 0.5)).toBeCloseTo(0.4, 6);
    expect(sampleProfileAt([0.2, 0.4, 0.6], 1.7)).toBeCloseTo(0.6, 6); // 越界钳到边缘
    const skin00 = [0.38, 0.38, 0.39, 0.40, 0.41, 0.43, 0.45, 0.48, 0.52, 0.56, 0.61, 0.67, 0.74, 0.82, 0.89, 0.62, 0.25];
    let prev = 0;
    for (let k = 0; k <= 14; k++) { // 中心→亮缘（frac 0..0.875）必须不减 = 无暗缝
      const a = sampleProfileAt(skin00, k / 16);
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = a;
    }
  });
});

describe('滑条带体横截面口径（issue 09 六轮：实绘 = 描边 = 命中）', () => {
  const SP_CONNS: Conn[] = [
    { lane: 0, beat: 10 },
    { lane: 1, beat: 10.5, hidden: true },
    { lane: 2, beat: 11, hidden: true },
    { lane: 3, beat: 11.5 },
  ];

  it('SP 段带体首末行封口 = 端点结点行上的水平线段 cx±half（端点藏在图标墨迹下）', () => {
    const note = { type: 'Slide', connections: SP_CONNS } as ChartNote;
    const { cents } = harness([note]);
    const pts = cents(SP_CONNS);
    const r = raster(pts, HALF)!;
    // 画布 Y 随拍位递减（越新的拍在越上方）：首连接（beat 10）是 max-Y 端点，末连接是 min-Y。
    // 封口行 = 过端点的水平 cx±half；行覆盖口径 [lo,hi)（终点行归端点图标墨迹）。
    const ys = pts.map((p) => p.y);
    const yLo = Math.min(...ys), yHi = Math.max(...ys);
    const pTop = pts.find((p) => p.y === yLo)!, pBot = pts.find((p) => p.y === yHi)!;
    const run = splitBandAtFolds(pts)[0]!;
    // 上端（min-Y 端点）内侧首行：封口水平 = 行区间恒 cx±half，不斜伸
    const rowY = Math.round(yLo) + 1;
    const firstRow = rowExtent(r, rowY)!;
    expect(firstRow).not.toBeNull();
    const cxTop = bandRunAtY(run, rowY + 0.5)!;
    expect(cxTop).not.toBeNull();
    expect(firstRow.x0).toBeGreaterThanOrEqual(Math.floor(cxTop - HALF) - 1);
    expect(firstRow.x1).toBeLessThanOrEqual(Math.ceil(cxTop + HALF) + 1);
    // 越过任一端点 → 空（封口不外溢成斜线）
    expect(alphaAt(r, pTop.x, yLo - 3)).toBe(0);
    expect(alphaAt(r, pBot.x, yHi + 3)).toBe(0);
  });

  it('SP 段带体与 hover 描边同范围（逐行 bandPolygon 区间，不超出不缺口）', () => {
    const note = { type: 'Slide', connections: SP_CONNS } as ChartNote;
    const { c, cents } = harness([note]);
    const pts = cents(SP_CONNS);
    const r = raster(pts, HALF)!;
    for (let y = Math.ceil(pts[0]!.y); y < Math.floor(pts[3]!.y); y++) {
      // 与描边同一折线的行中心（bandRunAtY 单调用 = bandPolygonAt 逐顶点的行视图）
      const run = splitBandAtFolds(pts)[0]!;
      const cx = bandRunAtY(run, y + 0.5);
      if (cx === null) { expect(rowExtent(r, y)).toBeNull(); continue; }
      const ext = rowExtent(r, y)!;
      expect(ext.x0).toBeGreaterThanOrEqual(Math.floor(cx - HALF) - 1);
      expect(ext.x1).toBeLessThanOrEqual(Math.ceil(cx + HALF) + 1);
    }
    void c;
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

  it('相邻逻辑段在共享结点上封口重合 = 跨段天然连续（SP 光栅行区间 === 普通段平行四边形端行）', () => {
    const conns: Conn[] = [
      { lane: 0, beat: 10 },
      { lane: 1, beat: 10.5, hidden: true },
      { lane: 2, beat: 11 },
      { lane: 4, beat: 13 },
    ];
    const note = { type: 'Slide', connections: conns } as ChartNote;
    const { c, rc, cents } = harness([note]);
    const b = cents(conns)[2]!;
    // SP 段（前三个点）：b（beat 11）是最新拍 = min-Y 上端点。行覆盖 [b.y, p10.y] 且含 b 行，
    // 取 b 内侧一行（round(b.y)+1）的右缘，与下方普通段（B→C）四边形在 B 端行的两角对比。
    const spPts = [cents(conns)[0]!, cents(conns)[1]!, b];
    const r = raster(spPts, HALF)!;
    const extAtB = rowExtent(r, Math.round(b.y) + 1);
    expect(extAtB).not.toBeNull();
    // 普通段（B→C）贴图四边形的 B 端行 = bandPolygon 两角（B 端封口宽恰为车道宽）
    const recB = recorder();
    renderSpanBands(recB.ctx, c, { ...rc, spriteIcon: recB.spriteIcon } as RenderCtx,
      [conns[2]!, conns[3]!] as never, 1);
    const cornersB = recB.corners(recB.draws[0]!)
      .filter(([, y]) => Math.abs(y - b.y) < 1e-6)
      .map(([x]) => x);
    expect(cornersB.length).toBe(2);
    // SP 光栅在 B 端行内的半宽 = HALF（±1px：行范围按非零**列中心**计，天然比连续边缘窄半像素）；
    // 封口中心 ≈ b.x（与普通段 B 端两角中点重合）→ 跨段共享同一条水平封口线
    const halfWidth = (extAtB!.x1 - extAtB!.x0) / 2;
    expect(halfWidth).toBeGreaterThanOrEqual(HALF - 1);
    expect(halfWidth).toBeLessThanOrEqual(HALF + 1);
    expect(extAtB!.x0).toBeLessThanOrEqual(Math.min(...cornersB) + 2);
    expect(extAtB!.x1).toBeGreaterThanOrEqual(Math.max(...cornersB) - 2);
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
    const cs = cents(SP_CONNS);
    const mid = { x: (cs[0]!.x + cs[1]!.x) / 2, y: (cs[0]!.y + cs[1]!.y) / 2 };
    const deps = { geometry: rc.geometry, viewport: VIEWPORT, beatDisplay: BEAT_DISPLAY, notes: [note] };
    expect(findItemAt(mid.x + HALF - 1, mid.y, deps as never)?.kind).toBe('slideRegion');
    expect(findItemAt(mid.x - HALF - 2, mid.y, deps as never)?.kind).not.toBe('slideRegion');
    expect(findItemAt(mid.x + HALF + 2, mid.y, deps as never)?.kind).not.toBe('slideRegion');
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
