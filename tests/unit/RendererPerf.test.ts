// issue 10 性能测试：密集音符（3000-5000）下缩放流畅性保障。
// node 环境用 stub ctx 计量 JS 侧开销与调用次数（真实光栅化由浏览器 ?perf=1 基线覆盖）。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChartGeometry, LANES, LANE_WIDTH } from '../../src/chart/geometry/ChartGeometry';
import { renderChart, visibleBeatRange } from '../../src/visual/render';
import { findItemAt } from '../../src/visual/hitTest';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '../../src/visual/noteSkin';
import {
  drawNotesLayer, resetNoteLayerCache, tileIndexRange, tileBlitRect, posRangeOf,
  TILE_PX, __setTileCanvasFactoryForTests,
} from '../../src/visual/noteLayerCache';
import { resetStaticLayerCache, __setStaticCanvasFactoryForTests } from '../../src/visual/staticLayerCache';
import { makeCoords } from '../../src/visual/coords';
import { planDragMove } from '../../src/chart/editing/NoteDragging';
import { countNotesUpToBeat } from '../../src/chart/editing/NoteEditing';
import { getBpmEvents, secondsToBeat } from '../../src/audio/AudioTiming';
import type { RenderCtx } from '../../src/visual/types';
import type { ChartNote, SelectionItem } from '../../src/chart/types';

const bpm120 = [{ beat: 0, bpm: 120 }];
const SURFACE = { w: 750, h: 900 };
const BEAT_DISPLAY = 4;

/** 生成密集谱面：n 个音符散布在 [0, chartEndBeat]，含单键/方向键/滑条/BPM */
function makeDenseNotes(n: number, chartEndBeat: number): ChartNote[] {
  const notes: ChartNote[] = [];
  for (let i = 0; i < n; i++) {
    const beat = Math.round((i / n) * chartEndBeat * 4) / 4;
    const lane = i % LANES;
    const kind = i % 10;
    if (kind === 0 && i > 0 && beat + 2 <= chartEndBeat) {
      notes.push({
        type: 'Slide',
        connections: [
          { lane, beat },
          { lane: (lane + 3) % LANES, beat: beat + 1 },
          { lane: (lane + 6) % LANES, beat: beat + 2 },
        ],
      } as ChartNote);
    } else if (kind === 1) {
      notes.push({ type: 'LDirectional', lane, beat, subBeat: 0, length: (i % 3) + 1 } as ChartNote);
    } else if (kind === 2) {
      notes.push({ type: 'RDirectional', lane, beat, subBeat: 0, length: (i % 3) + 1 } as ChartNote);
    } else if (kind === 3 && i > 0) {
      notes.push({ type: 'BPM', beat, bpm: 120 } as ChartNote);
    } else {
      notes.push({ type: 'Single', lane, beat, subBeat: i % 4 === 3 ? 2 : 0, flick: i % 7 === 0 } as ChartNote);
    }
  }
  return notes;
}

/** 旧版 O(n) 全量扫描语义（作为二分实现的对照基准） */
function bruteForceVisible(g: ChartGeometry, notes: ChartNote[], viewport: { scrollX: number; scrollY: number; scale: number }, beatDisplay: number): Set<number> {
  const bounds = g.viewportBounds(viewport);
  const out = new Set<number>();
  notes.forEach((note, index) => {
    let visible = false;
    if (note.type === 'Single' || note.type === 'LDirectional' || note.type === 'RDirectional') {
      const y = g.noteVirtualY(note.beat, note.subBeat || 0, viewport.scale, beatDisplay);
      visible = y >= bounds.minY && y <= bounds.maxY;
    } else if (note.type === 'Slide' || note.type === 'Long') {
      visible = note.connections.some(c => {
        const y = g.noteVirtualY(c.beat, c.subBeat || 0, viewport.scale, beatDisplay);
        return y >= bounds.minY && y <= bounds.maxY;
      });
    } else if (note.type === 'BPM') {
      const y = g.noteVirtualY(note.beat, 0, viewport.scale, beatDisplay);
      visible = y >= bounds.minY && y <= bounds.maxY;
    }
    if (visible) out.add(index);
  });
  return out;
}

// ---------------- stub canvas 基建 ----------------
interface Counters { drawImage: number; spriteRenders: number; }
function makeCountingCtx(counters: Counters): CanvasRenderingContext2D {
  return new Proxy({}, {
    get(_t, prop) {
      if (prop === 'drawImage') {
        return () => { counters.drawImage++; };
      }
      return () => undefined;
    },
    set() { return true; },
  }) as unknown as CanvasRenderingContext2D;
}
function makeCanvasStub(counters: Counters) {
  return { width: 0, height: 0, getContext: () => makeCountingCtx(counters) };
}

// 共享空引用：瓦片缓存 basis 按 selectedItems/clipboard 引用判失效，帧间必须稳定
const EMPTY_SELECTED: never[] = [];
const EMPTY_CLIPBOARD: never[] = [];
// 音符皮肤图标集（issue 29）：默认选择构建一次共享（纯数据，不含 DOM）
const SHARED_NOTE_ICONS = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));

function makeRc(geometry: ChartGeometry, notes: ChartNote[], chartEndBeat: number, es: number, scrollY: number, zoomGesture: boolean, counters: Counters, surface: { w: number; h: number } = SURFACE): RenderCtx {
  return {
    geometry,
    viewport: { scrollX: 0, scrollY, scale: es, virtualWidth: 0, virtualHeight: 0 },
    surface,
    dpr: 1,
    beatDisplay: BEAT_DISPLAY,
    chartEndBeat,
    notes,
    selectedItems: EMPTY_SELECTED,
    selectionBox: null,
    slideBuffer: null,
    hoverPos: null,
    clipboard: EMPTY_CLIPBOARD,
    markerBeat: null,
    markerSelected: false,
    armedTool: null,
    spriteIcon: { render: () => { counters.spriteRenders++; }, renderDecorator: () => undefined } as unknown as RenderCtx['spriteIcon'],
    noteIcons: SHARED_NOTE_ICONS,
    zoomGesture,
  };
}

/** 保持指定 beat 位于画布中心的 scrollY（模拟以鼠标为锚的缩放） */
function scrollYForCenterBeat(g: ChartGeometry, beat: number, es: number): number {
  return g.beatToVirtualY(beat, es) - SURFACE.h / (2 * es);
}

// ---------------- 测试 ----------------
describe('visibleBeatRange（网格只迭代可见拍）', () => {
  it('长谱面（2000 拍）窄视口只返回窗口内拍数，与谱面总长无关', () => {
    const g = new ChartGeometry(bpm120, 2000, SURFACE);
    const es = 1;
    const scrollY = scrollYForCenterBeat(g, 1000, es);
    const viewport = { scrollX: 0, scrollY, scale: es };
    const r = visibleBeatRange(g, viewport, 2000);
    // 视口高 900px + padding 400px ≈ 1300px ≈ 6 拍 + 余量；绝不应接近 2000
    expect(r.max - r.min).toBeLessThanOrEqual(12);
    expect(r.min).toBeLessThanOrEqual(1000);
    expect(r.max).toBeGreaterThanOrEqual(1000);
    expect(r.min).toBeGreaterThanOrEqual(0);
    expect(r.max).toBeLessThanOrEqual(2000);
  });

  it('谱面末端与起点处钳制到 [0, chartEndBeat]', () => {
    const g = new ChartGeometry(bpm120, 50, SURFACE);
    // scrollY=0 → 视口在谱面末端（虚拟Y顶部 = 大 beat 端），不越界
    const top = { scrollX: 0, scrollY: 0, scale: 1 };
    const rt = visibleBeatRange(g, top, 50);
    expect(rt.max).toBe(50);
    expect(rt.min).toBeGreaterThanOrEqual(0);
    // 滚到最大（判定线压 beat 0）→ 不出现负 beat
    const bottom = { scrollX: 0, scrollY: Math.max(0, g.totalVirtualHeight(1) - SURFACE.h), scale: 1 };
    const rb = visibleBeatRange(g, bottom, 50);
    expect(rb.min).toBe(0);
    expect(rb.max).toBeLessThanOrEqual(50);
  });
});

describe('visibleNotes 二分剔除（排序索引）', () => {
  it('5000 音符多视口下与旧版 O(n) 全量扫描结果一致', () => {
    const chartEndBeat = 1500;
    const notes = makeDenseNotes(5000, chartEndBeat);
    const g = new ChartGeometry(bpm120, chartEndBeat, SURFACE);
    for (const es of [0.2, 0.5, 1]) {
      const total = g.totalVirtualHeight(es);
      for (const frac of [0.1, 0.35, 0.5, 0.75, 0.95]) {
        const scrollY = Math.max(0, Math.min(total - SURFACE.h / es, (total - SURFACE.h / es) * frac));
        const viewport = { scrollX: 0, scrollY, scale: es };
        const fast = new Set(g.visibleNotes(notes, viewport, BEAT_DISPLAY).map(v => v.index));
        const brute = bruteForceVisible(g, notes, viewport, BEAT_DISPLAY);
        expect([...fast].sort((a, b) => a - b)).toEqual([...brute].sort((a, b) => a - b));
      }
    }
  });

  it('索引只构建一次：同 notes 重复查询为 O(log n + 可见数)（时间护栏）', () => {
    const chartEndBeat = 1500;
    const notes = makeDenseNotes(5000, chartEndBeat);
    const g = new ChartGeometry(bpm120, chartEndBeat, SURFACE);
    g.visibleNotes(notes, { scrollX: 0, scrollY: 0, scale: 0.5 }, BEAT_DISPLAY); // 预热索引
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      g.visibleNotes(notes, { scrollX: 0, scrollY: (i % 50) * 300, scale: 0.5 }, BEAT_DISPLAY);
    }
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(250); // 旧实现 200 次 × O(5000·log) 通常数百 ms 量级；二分后应远低于此
  });
});

describe('noteLayerCache 瓦片数学', () => {
  it('tileIndexRange 覆盖请求区间', () => {
    expect(tileIndexRange(0, TILE_PX - 1)).toEqual({ lo: 0, hi: 0 });
    expect(tileIndexRange(0, TILE_PX)).toEqual({ lo: 0, hi: 1 });
    expect(tileIndexRange(-500, 3000)).toEqual({ lo: 0, hi: Math.floor(3000 / TILE_PX) });
  });

  it('blit 矩形把 lane 中心与音符 Y 精确映射到主画布坐标（k=1 与 k≠1 均精确）', () => {
    const chartEndBeat = 100;
    const g = new ChartGeometry(bpm120, chartEndBeat, SURFACE);
    for (const [es, refScale] of [[0.8, 0.8], [0.9, 0.6]] as const) {
      const scrollY = scrollYForCenterBeat(g, 50, es);
      const viewport = { scrollX: 0, scrollY, scale: es };
      const anchorY = (g.chartEndVirtualY - scrollY) * es + SURFACE.h;
      const c = makeCoords(g, viewport, BEAT_DISPLAY, []);
      // refScale 布局的瓦片位图坐标系（位图与主画布同宽 → X 即主画布 ref 布局坐标）
      const cRef = makeCoords(g, { scrollX: 0, scrollY, scale: refScale }, BEAT_DISPLAY, []);
      const posOf = (beat: number) => g.chartEndVirtualY + SURFACE.h / es - g.beatToVirtualY(beat, es);
      for (const lane of [0, 3, 6]) {
        for (const beat of [30, 50, 77]) {
          const pos = posOf(beat);
          const tileId = Math.floor(pos / TILE_PX);
          const r = tileBlitRect(tileId, es, refScale, anchorY, SURFACE.w);
          const k = es / refScale;
          // 音符在瓦片位图内的位置：Y 走伪视口 pos 映射，X 走 refScale 主画布布局
          const p1 = (tileId + 1) * TILE_PX;
          const bitmapY = (p1 - pos) * refScale;
          const bitmapX = cRef.virtualToCanvas(cRef.getNoteVirtualX(lane), cRef.getNoteVirtualY(beat)).x;
          // blit 后的屏幕坐标（X 绕画布中心 × k，Y 线性 × k）
          const screenY = r.y + bitmapY * (r.h / (TILE_PX * refScale));
          const screenX = r.x + bitmapX * (r.w / SURFACE.w);
          const expected = c.virtualToCanvas(c.getNoteVirtualX(lane), c.getNoteVirtualY(beat));
          expect(Math.abs(screenX - expected.x)).toBeLessThan(1e-6);
          expect(Math.abs(screenY - expected.y)).toBeLessThan(1e-6);
          expect(k).toBeGreaterThan(0);
        }
      }
    }
  });

  it('surface 宽高变化后 blit 仍精确（issue 36 F3a：按渲染时宽度缩放、绕当前宽度居中）', () => {
    const chartEndBeat = 100;
    // 瓦片在 (w=750, h=900) 下以 refScale 渲染；结算后画布变为 (w=1000, h=1100)
    const gOld = new ChartGeometry(bpm120, chartEndBeat, SURFACE);
    const surfaceNew = { w: 1000, h: 1100 };
    const gNew = new ChartGeometry(bpm120, chartEndBeat, surfaceNew);
    for (const [es, refScale] of [[0.7, 0.7], [0.9, 0.6]] as const) {
      const scrollY = scrollYForCenterBeat(gOld, 50, es);
      const viewport = { scrollX: 0, scrollY, scale: es };
      // anchorY 必须用【当前】几何（新 surface.h）：Y 精确性由此保证
      const anchorY = (gNew.chartEndVirtualY - scrollY) * es + surfaceNew.h;
      const cNew = makeCoords(gNew, viewport, BEAT_DISPLAY, []);
      const cRef = makeCoords(gOld, { scrollX: 0, scrollY, scale: refScale }, BEAT_DISPLAY, []);
      // pos 空间与 surface 无关（pos = positionOfBeat），用渲染时几何计算
      const posOf = (beat: number) => gOld.chartEndVirtualY + SURFACE.h / es - gOld.beatToVirtualY(beat, es);
      for (const lane of [0, 3, 6]) {
        for (const beat of [30, 50, 77]) {
          const pos = posOf(beat);
          const tileId = Math.floor(pos / TILE_PX);
          const r = tileBlitRect(tileId, es, refScale, anchorY, surfaceNew.w, SURFACE.w);
          const p1 = (tileId + 1) * TILE_PX;
          const bitmapY = (p1 - pos) * refScale;
          const bitmapX = cRef.virtualToCanvas(cRef.getNoteVirtualX(lane), cRef.getNoteVirtualY(beat)).x;
          const screenY = r.y + bitmapY * (r.h / (TILE_PX * refScale));
          const screenX = r.x + bitmapX * (r.w / SURFACE.w);
          const expected = cNew.virtualToCanvas(cNew.getNoteVirtualX(lane), cNew.getNoteVirtualY(beat));
          expect(Math.abs(screenX - expected.x)).toBeLessThan(1e-6);
          expect(Math.abs(screenY - expected.y)).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('posRangeOf 覆盖视口 pos 区间', () => {
    const g = new ChartGeometry(bpm120, 100, SURFACE);
    const es = 0.8;
    const scrollY = scrollYForCenterBeat(g, 50, es);
    const rc = makeRc(g, [], 100, es, scrollY, false, { drawImage: 0, spriteRenders: 0 });
    const { posMin, posMax } = posRangeOf(rc);
    expect(posMin).toBeLessThan(posMax);
    const { lo, hi } = tileIndexRange(posMin, posMax);
    expect(lo * TILE_PX).toBeLessThanOrEqual(posMax);
    expect((hi + 1) * TILE_PX).toBeGreaterThanOrEqual(posMin);
  });
});

describe('端到端缩放性能（stub canvas，5000 音符）', () => {
  beforeEach(() => {
    resetNoteLayerCache();
    resetStaticLayerCache();
    __setTileCanvasFactoryForTests(() => {
      const counters = { drawImage: 0, spriteRenders: 0 };
      return makeCanvasStub(counters);
    });
    __setStaticCanvasFactoryForTests(() => {
      const counters = { drawImage: 0, spriteRenders: 0 };
      return makeCanvasStub(counters);
    });
  });

  const chartEndBeat = 1500;

  it('缩放手势帧零音符重绘、少量 drawImage、JS 开销在 60fps 预算内', () => {
    const notes = makeDenseNotes(5000, chartEndBeat);
    const g = new ChartGeometry(bpm120, chartEndBeat, SURFACE);
    const mainCounters: Counters = { drawImage: 0, spriteRenders: 0 };
    const mainCtx = makeCountingCtx(mainCounters);
    const mainCanvas = { width: 0, height: 0 };

    // 初帧（zoomGesture=false）：同步构建可见瓦片
    let es = 0.4;
    let rc = makeRc(g, notes, chartEndBeat, es, scrollYForCenterBeat(g, 750, es), false, mainCounters);
    const tBuild0 = performance.now();
    renderChart(mainCtx, mainCanvas as unknown as HTMLCanvasElement, rc);
    const buildMs = performance.now() - tBuild0;
    expect(buildMs).toBeLessThan(500); // 一次性构建（≈一次直渲成本）
    const spritesAfterBuild = mainCounters.spriteRenders;
    expect(spritesAfterBuild).toBeGreaterThan(0); // 确认确实画了音符

    // 连续 9 帧 zoom-in 手势（0.4 → ~0.94，窗口单调收缩 → 无新瓦片进入）
    const frameTimes: number[] = [];
    for (let k = 1; k <= 9; k++) {
      es = 0.4 * Math.pow(1.1, k);
      mainCounters.drawImage = 0;
      rc = makeRc(g, notes, chartEndBeat, es, scrollYForCenterBeat(g, 750, es), true, mainCounters);
      const t0 = performance.now();
      renderChart(mainCtx, mainCanvas as unknown as HTMLCanvasElement, rc);
      frameTimes.push(performance.now() - t0);
      // 核心断言：手势帧不重绘任何音符精灵，只 blit 瓦片
      expect(mainCounters.spriteRenders).toBe(spritesAfterBuild);
      expect(mainCounters.drawImage).toBeLessThanOrEqual(8);
    }
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    const max = Math.max(...frameTimes);
    expect(avg).toBeLessThan(16); // 60fps 帧预算
    expect(max).toBeLessThan(40);

    // settle 帧（手势结束）：以最终 es 高清重建可见瓦片
    mainCounters.spriteRenders = 0;
    rc = makeRc(g, notes, chartEndBeat, es, scrollYForCenterBeat(g, 750, es), false, mainCounters);
    const tSettle0 = performance.now();
    renderChart(mainCtx, mainCanvas as unknown as HTMLCanvasElement, rc);
    expect(performance.now() - tSettle0).toBeLessThan(500);
    expect(mainCounters.spriteRenders).toBeGreaterThan(0);

    // settle 后同 es 再来一帧手势：瓦片已新鲜 → 依然零重绘
    const spritesAfterSettle = mainCounters.spriteRenders;
    rc = makeRc(g, notes, chartEndBeat, es, scrollYForCenterBeat(g, 750, es), true, mainCounters);
    renderChart(mainCtx, mainCanvas as unknown as HTMLCanvasElement, rc);
    expect(mainCounters.spriteRenders).toBe(spritesAfterSettle);
  });

  it('zoom-out 手势（窗口扩张）帧耗时仍受控；高倍直渲模式可用', () => {
    const notes = makeDenseNotes(5000, chartEndBeat);
    const g = new ChartGeometry(bpm120, chartEndBeat, SURFACE);
    const counters: Counters = { drawImage: 0, spriteRenders: 0 };
    const ctx = makeCountingCtx(counters);
    const canvas = { width: 0, height: 0 };

    let es = 0.94;
    let rc = makeRc(g, notes, chartEndBeat, es, scrollYForCenterBeat(g, 750, es), false, counters);
    renderChart(ctx, canvas as unknown as HTMLCanvasElement, rc); // 初始构建

    for (let k = 1; k <= 9; k++) {
      es = 0.94 * Math.pow(0.9, k);
      rc = makeRc(g, notes, chartEndBeat, es, scrollYForCenterBeat(g, 750, es), true, counters);
      const t0 = performance.now();
      renderChart(ctx, canvas as unknown as HTMLCanvasElement, rc);
      expect(performance.now() - t0).toBeLessThan(40);
    }

    // es > MAX_CACHE_ES → 直渲模式：正常绘制可见音符
    resetNoteLayerCache();
    counters.spriteRenders = 0;
    rc = makeRc(g, notes, chartEndBeat, 1.5, scrollYForCenterBeat(g, 750, 1.5), false, counters);
    renderChart(ctx, canvas as unknown as HTMLCanvasElement, rc);
    expect(counters.spriteRenders).toBeGreaterThan(0);
  });

  it('drawNotesLayer 对外可独立调用（直渲分支）', () => {
    const notes = makeDenseNotes(100, 50);
    const geometry = new ChartGeometry(bpm120, 50, SURFACE);
    const counters: Counters = { drawImage: 0, spriteRenders: 0 };
    const ctx = makeCountingCtx(counters);
    const rc = makeRc(geometry, notes, 50, 1.5, 100, false, counters);
    drawNotesLayer(ctx, rc);
    expect(counters.spriteRenders).toBeGreaterThan(0);
  });

  it('surface 宽高变化（窗口缩放结算）后瓦片零重建（issue 36 F3a）', () => {
    const notes = makeDenseNotes(3000, chartEndBeat);
    const g1 = new ChartGeometry(bpm120, chartEndBeat, SURFACE);
    const counters: Counters = { drawImage: 0, spriteRenders: 0 };
    const ctx = makeCountingCtx(counters);
    const canvas = { width: 0, height: 0 };
    const es = 0.5;

    // 初帧：以 (750×900) 构建可见瓦片
    let rc = makeRc(g1, notes, chartEndBeat, es, scrollYForCenterBeat(g1, 750, es), false, counters);
    renderChart(ctx, canvas as unknown as HTMLCanvasElement, rc);
    const spritesAfterBuild = counters.spriteRenders;
    expect(spritesAfterBuild).toBeGreaterThan(0);

    // 窗口缩放结算：宽度变大、高度变小（可见集为子集 → 已建瓦片应全部续用），
    // geometry 实例随之重建（时间线内容相同）
    const surface2 = { w: 1000, h: 800 };
    const g2 = new ChartGeometry(bpm120, chartEndBeat, surface2);
    const scrollY2 = g2.beatToVirtualY(750, es) - surface2.h / (2 * es); // 同拍居中（pos 空间与 surface 无关 → 同批瓦片命中）
    rc = makeRc(g2, notes, chartEndBeat, es, scrollY2, false, counters, surface2);
    renderChart(ctx, canvas as unknown as HTMLCanvasElement, rc);
    // 核心断言：零音符重绘（瓦片续用，纯 blit）；静态层重建不计 sprite
    expect(counters.spriteRenders).toBe(spritesAfterBuild);
    expect(counters.drawImage).toBeGreaterThan(0);
  });

  it('静态层离屏缓存（issue 36 F2）：交互帧不重绘网格（仅 blit）', () => {
    const notes = makeDenseNotes(1000, chartEndBeat);
    const g = new ChartGeometry(bpm120, chartEndBeat, SURFACE);
    const counters: Counters = { drawImage: 0, spriteRenders: 0 };
    const ctx = makeCountingCtx(counters);
    const canvas = { width: 0, height: 0 };
    const es = 0.5;
    const scrollY = scrollYForCenterBeat(g, 750, es);

    // 计量【静态位图 ctx】的绘制调用（网格/起止线的 stroke/fillText 只发生在重建时；
    // 主画布上的判定线/BPM 线是每帧动态层，不进静态缓存，不能用主 ctx 计数）
    const staticDraws = { n: 0 };
    __setStaticCanvasFactoryForTests(() => ({
      width: 0, height: 0,
      getContext: () => new Proxy({}, {
        get(_t, prop) {
          if (prop === 'stroke' || prop === 'fillText') return () => { staticDraws.n++; };
          return () => undefined;
        },
        set() { return true; },
      }),
    }));

    // 初帧：静态层重建（网格 stroke/fillText > 0）
    let rc = makeRc(g, notes, chartEndBeat, es, scrollY, false, counters);
    renderChart(ctx, canvas as unknown as HTMLCanvasElement, rc);
    expect(staticDraws.n).toBeGreaterThan(0);

    // 交互帧（仅 hoverPos 变化，视口/几何/时间线不变）：静态层命中 → 位图零绘制，主画布仅 blit
    rc = { ...rc, hoverPos: { cx: 300, cy: 400 } };
    staticDraws.n = 0;
    counters.drawImage = 0;
    renderChart(ctx, canvas as unknown as HTMLCanvasElement, rc);
    expect(staticDraws.n).toBe(0);
    expect(counters.drawImage).toBeGreaterThanOrEqual(1); // 静态层 blit
  });
});

// ---------------------------------------------------------------------------
// issue 70 候选 2（帧调度）：**测量**，不是改造。
//
// 评审报告称「一帧内 N 个 pointermove = N 次全帧重绘」「getVisibleNotes 每帧 4 次」
// 「planDragMove 每次移动重建 5000 个 Tagged」。这些判断**从未被量化过**。
// 本组用例只做一件事：把「单次交互操作的响应成本」量成数字，
// 并钉住「每帧 getVisibleNotes 调用次数」这个结构性指标（可断言、不依赖机器快慢）。
//
// 运行：`npx vitest run tests/unit/RendererPerf.test.ts -t 候选 2`（数字打印在 stdout）。
// ---------------------------------------------------------------------------
describe('候选 2 测量：单次交互成本（issue 70）', () => {
  beforeEach(() => {
    resetNoteLayerCache();
    resetStaticLayerCache();
    __setTileCanvasFactoryForTests(() => makeCanvasStub({ drawImage: 0, spriteRenders: 0 }));
    __setStaticCanvasFactoryForTests(() => makeCanvasStub({ drawImage: 0, spriteRenders: 0 }));
  });

  const chartEndBeat = 1500;
  const MOVES = 100;

  /** 一次「交互帧」的 JS 成本：视口/几何/谱面全不变，只有 hoverPos 变（= 一次 mousemove 的重绘） */
  it('量：hover 交互帧 —— renderChart ×100 总耗时 + 每帧 getVisibleNotes 次数', () => {
    const notes = makeDenseNotes(5000, chartEndBeat);
    const g = new ChartGeometry(bpm120, chartEndBeat, SURFACE);
    const counters: Counters = { drawImage: 0, spriteRenders: 0 };
    const ctx = makeCountingCtx(counters);
    const canvas = { width: 0, height: 0 };
    const es = 0.5;
    const scrollY = scrollYForCenterBeat(g, 750, es);

    // 首帧：构建瓦片 + 静态层（不计入交互帧成本）
    const rc = makeRc(g, notes, chartEndBeat, es, scrollY, false, counters);
    renderChart(ctx, canvas as unknown as HTMLCanvasElement, rc);

    // 最坏交互帧：hover 有值（实时显示线两侧 O(n) 读数）+ 有 hoverItem（选中描边层）+ 同时点击线开
    const base: RenderCtx = {
      ...rc,
      hoverItem: { kind: 'note', noteIndex: 0 },
      display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true },
    };
    renderChart(ctx, canvas as unknown as HTMLCanvasElement, { ...base, hoverPos: { cx: 300, cy: 400 } }); // 预热

    const spy = vi.spyOn(ChartGeometry.prototype, 'visibleNotes');
    const t0 = performance.now();
    for (let i = 0; i < MOVES; i++) {
      renderChart(ctx, canvas as unknown as HTMLCanvasElement, { ...base, hoverPos: { cx: 300 + i, cy: 400 + i } });
    }
    const total = performance.now() - t0;
    const perFrameVisibleNotesCalls = spy.mock.calls.length / MOVES;
    spy.mockRestore();

    console.log(
      `[候选2] hover 交互帧 ×${MOVES}：总 ${total.toFixed(1)}ms，单帧 ${(total / MOVES).toFixed(2)}ms；` +
      `每帧 getVisibleNotes ${perFrameVisibleNotesCalls} 次`,
    );

    // 结构性断言（与机器快慢无关）：改造前每帧 4 次（BPM 标线 / 同时点击线 / BPM 数值 / 选中描边），
    // 现为 2 次（renderChart 的 coords 一份 + 瓦片层选中描边一份）。**任何回到 3+ 都视为退化**。
    expect(perFrameVisibleNotesCalls).toBeLessThanOrEqual(2);
    // 时间护栏：只拦数量级退化（实测 0.3ms）
    expect(total / MOVES).toBeLessThan(16);
  });

  /** hover 命中（findItemAt）：每次 mousemove 走一次全量命中扫描 */
  it('量：hover 命中 findItemAt ×100 总耗时', () => {
    const notes = makeDenseNotes(5000, chartEndBeat);
    const g = new ChartGeometry(bpm120, chartEndBeat, SURFACE);
    const es = 0.5;
    const viewport = { scrollX: 0, scrollY: scrollYForCenterBeat(g, 750, es), scale: es };
    const deps = { geometry: g, viewport, beatDisplay: BEAT_DISPLAY, notes, noteSize: 1 };
    findItemAt(300, 400, deps); // 预热

    const t0 = performance.now();
    for (let i = 0; i < MOVES; i++) findItemAt(300 + (i % 50), 400 + (i % 50), deps);
    const total = performance.now() - t0;
    console.log(`[候选2] findItemAt ×${MOVES}：总 ${total.toFixed(1)}ms，单次 ${(total / MOVES).toFixed(3)}ms`);
    expect(total / MOVES).toBeLessThan(4);
  });

  /** 拖拽幽灵预览：每次 mousemove 调一次 planDragMove（评审称全量重建 Tagged[]） */
  it('量：拖拽预览 planDragMove ×100 总耗时（20 件 / 5000 音符）', () => {
    const notes = makeDenseNotes(5000, chartEndBeat);
    const items: SelectionItem[] = [];
    for (let i = 0; i < 20; i++) items.push({ kind: 'note', noteIndex: i * 5 });
    const bounds = { chartEndBeat, beatDisplay: BEAT_DISPLAY };
    planDragMove(notes, items, { dBeat: 1, dLane: 0 }, bounds); // 预热

    const t0 = performance.now();
    for (let i = 0; i < MOVES; i++) {
      planDragMove(notes, items, { dBeat: (i % 8) + 1, dLane: 0 }, bounds);
    }
    const total = performance.now() - t0;
    console.log(`[候选2] planDragMove ×${MOVES}：总 ${total.toFixed(1)}ms，单次 ${(total / MOVES).toFixed(3)}ms`);
    // 回归护栏：改造前 1.83ms/次（占位表为全谱建 posKey 字符串），改造后 0.50ms/次。
    // 阈值 1.2 卡在两者之间 —— 窗口裁剪一旦被回退/写坏，这条会红。
    expect(total / MOVES).toBeLessThan(1.2);
  });

  /** 播放 HUD：playheadBeat（getBpmEvents O(n)）+ passedNoteCount（countNotesUpToBeat O(n)）每个 tick 各扫全谱 */
  it('量：播放 HUD 每个 tick 的全谱扫描 ×100 总耗时', () => {
    const notes = makeDenseNotes(5000, chartEndBeat);
    const t0 = performance.now();
    for (let i = 0; i < MOVES; i++) {
      const beat = secondsToBeat(getBpmEvents(notes), i * 0.1);
      countNotesUpToBeat(notes, beat);
    }
    const total = performance.now() - t0;
    console.log(`[候选2] 播放 HUD tick ×${MOVES}：总 ${total.toFixed(1)}ms，单 tick ${(total / MOVES).toFixed(3)}ms`);
    expect(total / MOVES).toBeLessThan(2);
  });
});
