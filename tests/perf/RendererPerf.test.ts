// issue 10 性能测试：密集音符（3000-5000）下缩放流畅性保障。
// node 环境用 stub ctx 计量 JS 侧开销与调用次数（真实光栅化由浏览器 ?perf=1 基线覆盖）。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChartGeometry, LANES } from '@/src/chart/geometry/ChartGeometry';
import { renderChart, visibleBeatRanges } from '@/src/rendering/render';
import { findItemAt } from '@/src/rendering/hitTest/hitTest';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import { createNoteLayerCache, tileIndexRange, tileBlitRect, posRangeOf, TILE_PX } from '@/src/rendering/pipeline/noteLayerCache';
import { createRenderTarget, type RenderTarget } from '@/src/rendering/RenderTarget';
import { makeCoords } from '@/src/rendering/coords';
import { planDragMove } from '@/src/chart/editing/NoteDragging';
import { countNotesUpToBeat } from '@/src/chart/editing/NoteEditing';
import { getBpmEvents, secondsToBeat } from '@/src/audio/AudioTiming';
import type { RenderCtx } from '@/src/rendering/types';
import type { ChartNote, SelectionItem } from '@/src/chart/types';
import { makeCountingCtx, makeCanvasStub, makeTallyingCanvasStub, makeTransformRecordingTile } from '@/tests/support/canvas';

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
type Counters = { drawImage: number; spriteRenders: number };
// 共享空引用：瓦片缓存 basis 按 selectedItems/clipboard 引用判失效，帧间必须稳定
const EMPTY_SELECTED: never[] = [];
const EMPTY_CLIPBOARD: never[] = [];
// 音符皮肤图标集（issue 29）：默认选择构建一次共享（纯数据，不含 DOM）
const SHARED_NOTE_ICONS = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));

function makeRc(
  geometry: ChartGeometry,
  notes: ChartNote[],
  chartEndBeat: number,
  es: number,
  scrollY: number,
  zoomGesture: boolean,
  counters: Counters,
  surface: { w: number; h: number } = SURFACE,
  extra: { playing?: boolean; skinVersion?: number } = {},
): RenderCtx {
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
    markerSeconds: null,
    armedTool: null,
    spriteIcon: { render: () => { counters.spriteRenders++; }, renderDecorator: () => undefined } as unknown as RenderCtx['spriteIcon'],
    noteIcons: SHARED_NOTE_ICONS,
    zoomGesture,
    playing: extra.playing,
    skinVersion: extra.skinVersion,
  };
}

/** 保持指定 beat 位于画布中心的 scrollY（模拟以鼠标为锚的缩放） */
function scrollYForCenterBeat(g: ChartGeometry, beat: number, es: number): number {
  return g.beatToVirtualY(beat, es) - SURFACE.h / (2 * es);
}

/** 渲染目标替身（候选 3）：主画布 getContext 恒返回给定 ctx；surface/dpr/两层缓存全归 target。 */
function makeTarget(ctx: CanvasRenderingContext2D, surface: { w: number; h: number } = SURFACE, dpr = 1): RenderTarget {
  return createRenderTarget({
    canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement,
    surface,
    dpr,
  });
}

/** 端到端帧渲染用 target：两层缓存注入假位图工厂（每用例一份实例，替代原模块级单例 + 工厂注入） */
function makeFrameTarget(ctx: CanvasRenderingContext2D, surface: { w: number; h: number } = SURFACE, dpr = 1): RenderTarget {
  const target = makeTarget(ctx, surface, dpr);
  target.noteLayer.__setCanvasFactoryForTests(() => makeCanvasStub({ drawImage: 0, spriteRenders: 0 }));
  target.staticLayer.__setCanvasFactoryForTests(() => makeCanvasStub({ drawImage: 0, spriteRenders: 0 }));
  return target;
}

// ---------------- 测试 ----------------
describe('visibleBeatRanges（网格只迭代可见拍区间，issue 104 修法 4）', () => {
  it('长谱面（2000 拍）窄视口只返回窗口内拍数，与谱面总长无关', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 2000 } , SURFACE);
    const es = 1;
    const scrollY = scrollYForCenterBeat(g, 1000, es);
    const viewport = { scrollX: 0, scrollY, scale: es };
    const rs = visibleBeatRanges(g, viewport, 2000);
    // 单调谱面 → 单区间；视口高 900px + padding 400px ≈ 1300px ≈ 6 拍 + 余量，绝不应接近 2000
    expect(rs).toHaveLength(1);
    const [r] = rs;
    expect(r.end - r.start).toBeLessThanOrEqual(12);
    expect(r.start).toBeLessThanOrEqual(1000);
    expect(r.end).toBeGreaterThanOrEqual(1000);
    expect(r.start).toBeGreaterThanOrEqual(0);
    expect(r.end).toBeLessThanOrEqual(2000);
  });

  it('谱面末端与起点处钳制到 [0, chartEndBeat]', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 50 } , SURFACE);
    // scrollY=0 → 视口在谱面末端（虚拟Y顶部 = 大 beat 端），不越界
    const top = { scrollX: 0, scrollY: 0, scale: 1 };
    const rt = visibleBeatRanges(g, top, 50);
    expect(Math.max(...rt.map(r => r.end))).toBe(50);
    expect(Math.min(...rt.map(r => r.start))).toBeGreaterThanOrEqual(0);
    // 滚到最大（判定线压 beat 0）→ 不出现负 beat
    const bottom = { scrollX: 0, scrollY: Math.max(0, g.totalVirtualHeight(1) - SURFACE.h), scale: 1 };
    const rb = visibleBeatRanges(g, bottom, 50);
    expect(Math.min(...rb.map(r => r.start))).toBe(0);
    expect(Math.max(...rb.map(r => r.end))).toBeLessThanOrEqual(50);
  });
});

describe('visibleNotes 二分剔除（排序索引）', () => {
  it('5000 音符多视口下与旧版 O(n) 全量扫描结果一致', () => {
    const chartEndBeat = 1500;
    const notes = makeDenseNotes(5000, chartEndBeat);
    const g = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , SURFACE);
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
    const g = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , SURFACE);
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
    const g = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , SURFACE);
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
    const gOld = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , SURFACE);
    const surfaceNew = { w: 1000, h: 1100 };
    const gNew = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , surfaceNew);
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
    const g = new ChartGeometry(bpm120, { endBeat: 100 } , SURFACE);
    const es = 0.8;
    const scrollY = scrollYForCenterBeat(g, 50, es);
    const rc = makeRc(g, [], 100, es, scrollY, false, { drawImage: 0, spriteRenders: 0 });
    const { posMin, posMax } = posRangeOf(rc);
    expect(posMin).toBeLessThan(posMax);
    const { lo, hi } = tileIndexRange(posMin, posMax);
    expect(lo * TILE_PX).toBeLessThanOrEqual(posMax);
    expect((hi + 1) * TILE_PX).toBeGreaterThanOrEqual(posMin);
  });

  it('issue 98：瓦片 transform 按「位图实际尺寸/css 尺寸」绘制（css 跨距恰填满整数量化位图，消除 round 压缩）', () => {
    const chartEndBeat = 100;
    const g = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , SURFACE);
    // es=0.8 → 瓦片 css 高 = TILE_PX·es = 409.6（非整数）；tileDpr = min(dpr=1, 1.5) = 1
    // → 位图高 round(409.6) = 410。修复前 transform 恒 tileDpr=1 → 内容只画到 409.6 行，
    // blit 拉伸 410 行 → 距瓦片顶边线性行进最大 ±0.4px 的压缩（每 es 重掷 → 缩放手势期音符跳动）。
    const es = 0.8;
    const notes: ChartNote[] = [{ type: 'Single', lane: 3, beat: 50, subBeat: 0 } as ChartNote];
    const transforms: { sx: number; sy: number; bw: number; bh: number }[] = [];
    const noteLayer = createNoteLayerCache();
    noteLayer.__setCanvasFactoryForTests(() => makeTransformRecordingTile((t) => transforms.push(t)));
    const counters: Counters = { drawImage: 0, spriteRenders: 0 };
    noteLayer.draw(makeCountingCtx(counters), makeRc(g, notes, chartEndBeat, es, scrollYForCenterBeat(g, 50, es), false, counters));

    expect(transforms.length).toBeGreaterThan(0); // 确实渲染了瓦片
    const tileDpr = 1; // rc.dpr = 1
    for (const tr of transforms) {
      expect(tr.bw).toBe(Math.round(SURFACE.w * tileDpr));
      expect(tr.bh).toBe(Math.round(TILE_PX * es * tileDpr)); // 410：整数量化位图高
      // 核心不变量：transform 把 css 跨距【恰好】映射到整数位图（修复前 sy=tileDpr → sy·cssH=409.6 ≠ 410）
      expect(tr.sx * SURFACE.w).toBeCloseTo(tr.bw, 6);
      expect(tr.sy * (TILE_PX * es)).toBeCloseTo(tr.bh, 6);
    }
    // blit 目标高与位图 css 高恒等（瓦片接缝数学不动，issue 10/36 不变量保持）
    const anchorY = (g.chartEndVirtualY - scrollYForCenterBeat(g, 50, es)) * es + SURFACE.h;
    const r = tileBlitRect(0, es, es, anchorY, SURFACE.w);
    expect(r.h).toBe(TILE_PX * es);
    expect(r.h * (transforms[0].sy)).toBeCloseTo(transforms[0].bh, 6);

    // X 轴同锁：dpr=1.5 + 非整宽（751·1.5 = 1126.5 → bw=1127）时 sx 也必须按实际位图尺寸取
    const g2 = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , { w: 751, h: 900 });
    const transforms2: { sx: number; sy: number; bw: number; bh: number }[] = [];
    const noteLayer2 = createNoteLayerCache();
    noteLayer2.__setCanvasFactoryForTests(() => makeTransformRecordingTile((t) => transforms2.push(t)));
    const rc2 = { ...makeRc(g2, notes, chartEndBeat, es, scrollYForCenterBeat(g2, 50, es), false, counters, { w: 751, h: 900 }), dpr: 1.5 };
    noteLayer2.draw(makeCountingCtx(counters), rc2);
    expect(transforms2.length).toBeGreaterThan(0);
    for (const tr of transforms2) {
      expect(tr.bw).toBe(Math.round(751 * 1.5)); // 1127：round(1126.5)——X 跨距非整
      expect(tr.sx * 751).toBeCloseTo(tr.bw, 6); // 修复前 sx=1.5 → 1126.5 ≠ 1127
      expect(tr.sy * (TILE_PX * es)).toBeCloseTo(tr.bh, 6);
    }
  });
});

describe('端到端缩放性能（stub canvas，5000 音符）', () => {
  // 候选 3：缓存有主——每用例一份 target 实例（模块级单例与工厂注入已删除）
  const chartEndBeat = 1500;

  it('缩放手势帧渐进重建（预算内逐帧转新）、帧开销 60fps 预算内、settle 无集中跳变', () => {
    const notes = makeDenseNotes(5000, chartEndBeat);
    const g = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , SURFACE);
    const mainCounters: Counters = { drawImage: 0, spriteRenders: 0 };
    const mainCtx = makeCountingCtx(mainCounters);
    const target = makeFrameTarget(mainCtx, SURFACE);

    // 初帧（zoomGesture=false）：同步构建可见瓦片
    let es = 0.4;
    let rc = makeRc(g, notes, chartEndBeat, es, scrollYForCenterBeat(g, 750, es), false, mainCounters);
    const tBuild0 = performance.now();
    renderChart(target, rc);
    const buildMs = performance.now() - tBuild0;
    expect(buildMs).toBeLessThan(500); // 一次性构建（≈一次直渲成本）
    const spritesAfterBuild = mainCounters.spriteRenders;
    expect(spritesAfterBuild).toBeGreaterThan(0); // 确认确实画了音符

    // 连续 9 帧 zoom-in 手势（0.4 → ~0.94，窗口单调收缩 → 无新瓦片进入）
    // issue 173：帧成本按**本进程 CPU 时间**计量（`process.cpuUsage` 差值），不把被调度出去的时间
    // 算进渲染成本 —— 墙钟在多 worker 并发下会被抢占放大 10 倍以上，曾把 1.6ms 的帧测成 19ms。
    const frameCpuMs: number[] = [];
    const frameWallMs: number[] = [];
    const rebuiltEver = new Set<number>();
    let spritesPrev = spritesAfterBuild;
    let rebuildFrames = 0;
    for (let k = 1; k <= 9; k++) {
      es = 0.4 * Math.pow(1.1, k);
      mainCounters.drawImage = 0;
      rc = makeRc(g, notes, chartEndBeat, es, scrollYForCenterBeat(g, 750, es), true, mainCounters);
      const tilesBefore = new Map(target.noteLayer.__getTilesForTests());
      const cpu0 = process.cpuUsage();
      const t0 = performance.now();
      renderChart(target, rc);
      frameWallMs.push(performance.now() - t0);
      const { user, system } = process.cpuUsage(cpu0);
      frameCpuMs.push((user + system) / 1000); // µs → ms
      // 核心断言：手势帧在时间预算内渐进重建 stale 瓦片（精灵逐帧转新），
      // 帧成本有界由下面的 avg/max 与 drawImage 上限共同看守
      expect(mainCounters.spriteRenders).toBeGreaterThanOrEqual(spritesPrev);
      if (mainCounters.spriteRenders > spritesPrev) rebuildFrames++;
      spritesPrev = mainCounters.spriteRenders;
      expect(mainCounters.drawImage).toBeLessThanOrEqual(8);
      // issue 173：记录本帧重建了哪些瓦片（对象身份变化 = 重建）
      const tilesAfter = target.noteLayer.__getTilesForTests();
      for (const [id, t] of tilesBefore) if (tilesAfter.get(id) !== t) rebuiltEver.add(id);
    }
    const avgCpu = frameCpuMs.reduce((a, b) => a + b, 0) / frameCpuMs.length;
    const maxWall = Math.max(...frameWallMs);
    expect(avgCpu).toBeLessThan(16); // 60fps 帧预算（CPU 时间口径，免疫并发抢占）
    expect(maxWall).toBeLessThan(100); // 墙钟兜底：只防"整个进程被冻住"级别的极端长帧
    expect(rebuildFrames).toBeGreaterThan(0); // 渐进重建确实发生

    // issue 173 公平性：最终可见的每块瓦片都在手势期内轮到过（旧实现恒从 lo 重扫 → 高 id 饿死）。
    // 与机器快慢无关：即使预算被抢占吃光、每帧只建一块，游标轮转也保证轮得到。
    const finalIds = (() => {
      const { posMin, posMax } = posRangeOf(rc);
      const { lo, hi } = tileIndexRange(posMin, posMax);
      const ids: number[] = [];
      for (let id = lo; id <= hi; id++) ids.push(id);
      return ids;
    })();
    for (const id of finalIds) {
      expect(rebuiltEver.has(id), `瓦片 ${id} 在手势期一次都没重建（饿死）`).toBe(true);
    }

    // settle 帧（手势结束）：机器跟得上时（backlog=0，手势末帧已把可见瓦片全部转新）**必须零重建**；
    // 被抢占到预算吃光时只允许补完末帧遗留的残块（issue 173：不再整屏集中重建）。
    const backlog = target.noteLayer.__getLastNoteLayerStats().backlog;
    const tilesBeforeSettle = new Map(target.noteLayer.__getTilesForTests());
    mainCounters.spriteRenders = 0;
    rc = makeRc(g, notes, chartEndBeat, es, scrollYForCenterBeat(g, 750, es), false, mainCounters);
    const tSettle0 = performance.now();
    renderChart(target, rc);
    expect(performance.now() - tSettle0).toBeLessThan(500);
    const tilesAfterSettle = target.noteLayer.__getTilesForTests();
    let settleRebuilt = 0;
    for (const [id, t] of tilesBeforeSettle) if (tilesAfterSettle.get(id) !== t) settleRebuilt++;
    expect(settleRebuilt).toBeLessThanOrEqual(backlog); // 只补积压，不重画已转新的
    if (backlog === 0) expect(mainCounters.spriteRenders).toBe(0); // 无积压 → 无集中重建

    // settle 后同 es 再来一帧手势：瓦片已新鲜 → 依然零重绘
    const spritesAfterSettle = mainCounters.spriteRenders;
    rc = makeRc(g, notes, chartEndBeat, es, scrollYForCenterBeat(g, 750, es), true, mainCounters);
    renderChart(target, rc);
    expect(mainCounters.spriteRenders).toBe(spritesAfterSettle);
  });

  it('zoom-out 手势（窗口扩张）帧耗时仍受控；es=1.5 仍走瓦片可绘', () => {
    const notes = makeDenseNotes(5000, chartEndBeat);
    const g = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , SURFACE);
    const counters: Counters = { drawImage: 0, spriteRenders: 0 };
    const ctx = makeCountingCtx(counters);
    const target = makeFrameTarget(ctx, SURFACE);

    let es = 0.94;
    let rc = makeRc(g, notes, chartEndBeat, es, scrollYForCenterBeat(g, 750, es), false, counters);
    renderChart(target, rc); // 初始构建

    for (let k = 1; k <= 9; k++) {
      es = 0.94 * Math.pow(0.9, k);
      rc = makeRc(g, notes, chartEndBeat, es, scrollYForCenterBeat(g, 750, es), true, counters);
      const t0 = performance.now();
      renderChart(target, rc);
      expect(performance.now() - t0).toBeLessThan(100);
    }

    // es=1.5（issue 140：低于工具栏 300% 上限）仍走瓦片：spriteIcon 会计入绘制
    target.noteLayer.reset();
    counters.spriteRenders = 0;
    rc = makeRc(g, notes, chartEndBeat, 1.5, scrollYForCenterBeat(g, 750, 1.5), false, counters);
    renderChart(target, rc);
    expect(counters.spriteRenders).toBeGreaterThan(0);
  });

  it('音符层缓存对外可独立调用（高倍瓦片）', () => {
    const notes = makeDenseNotes(100, 50);
    const geometry = new ChartGeometry(bpm120, { endBeat: 50 } , SURFACE);
    const counters: Counters = { drawImage: 0, spriteRenders: 0 };
    const ctx = makeCountingCtx(counters);
    const rc = makeRc(geometry, notes, 50, 1.5, 100, false, counters);
    makeFrameTarget(ctx, SURFACE).noteLayer.draw(ctx, rc);
    expect(counters.spriteRenders).toBeGreaterThan(0);
  });

  it('surface 宽高变化（窗口缩放结算）后瓦片零重建（issue 36 F3a）', () => {
    const notes = makeDenseNotes(3000, chartEndBeat);
    const g1 = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , SURFACE);
    const counters: Counters = { drawImage: 0, spriteRenders: 0 };
    const ctx = makeCountingCtx(counters);
    const target = makeFrameTarget(ctx, SURFACE);
    const es = 0.5;

    // 初帧：以 (750×900) 构建可见瓦片
    let rc = makeRc(g1, notes, chartEndBeat, es, scrollYForCenterBeat(g1, 750, es), false, counters);
    renderChart(target, rc);
    const spritesAfterBuild = counters.spriteRenders;
    expect(spritesAfterBuild).toBeGreaterThan(0);

    // 窗口缩放结算：宽度变大、高度变小（可见集为子集 → 已建瓦片应全部续用），
    // geometry 实例随之重建（时间线内容相同）
    const surface2 = { w: 1000, h: 800 };
    const g2 = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , surface2);
    const scrollY2 = g2.beatToVirtualY(750, es) - surface2.h / (2 * es); // 同拍居中（pos 空间与 surface 无关 → 同批瓦片命中）
    rc = makeRc(g2, notes, chartEndBeat, es, scrollY2, false, counters, surface2);
    target.configure({ surface: surface2 }); // 候选 3：surface 归 target，原地更新（缓存续用）
    renderChart(target, rc);
    // 核心断言：零音符重绘（瓦片续用，纯 blit）；静态层重建不计 sprite
    expect(counters.spriteRenders).toBe(spritesAfterBuild);
    expect(counters.drawImage).toBeGreaterThan(0);
  });

  it('静态层离屏缓存（issue 36 F2）：交互帧不重绘网格（仅 blit）', () => {
    const notes = makeDenseNotes(1000, chartEndBeat);
    const g = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , SURFACE);
    const counters: Counters = { drawImage: 0, spriteRenders: 0 };
    const ctx = makeCountingCtx(counters);
    const target = makeFrameTarget(ctx, SURFACE);
    const es = 0.5;
    const scrollY = scrollYForCenterBeat(g, 750, es);

    // 计量【静态位图 ctx】的绘制调用（网格/起止线的 stroke/fillText 只发生在重建时；
    // 主画布上的判定线/BPM 线是每帧动态层，不进静态缓存，不能用主 ctx 计数）
    const staticDraws = { n: 0 };
    target.staticLayer.__setCanvasFactoryForTests(() =>
      makeTallyingCanvasStub(() => { staticDraws.n++; }, ['stroke', 'fillText']));

    // 初帧：静态层重建（网格 stroke/fillText > 0）
    let rc = makeRc(g, notes, chartEndBeat, es, scrollY, false, counters);
    renderChart(target, rc);
    expect(staticDraws.n).toBeGreaterThan(0);

    // 交互帧（仅 hoverPos 变化，视口/几何/时间线不变）：静态层命中 → 位图零绘制，主画布仅 blit
    rc = { ...rc, hoverPos: { cx: 300, cy: 400 } };
    staticDraws.n = 0;
    counters.drawImage = 0;
    renderChart(target, rc);
    expect(staticDraws.n).toBe(0);
    expect(counters.drawImage).toBeGreaterThanOrEqual(1); // 静态层 blit
  });

  it('静态层失效键含纵向比例（issue 70 候选 5-a）：只改 verticalRatio 而 scale/scrollY 不变 → 网格必须重建', () => {
    const notes = makeDenseNotes(200, chartEndBeat);
    const g1 = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , SURFACE, 1);
    const counters: Counters = { drawImage: 0, spriteRenders: 0 };
    const ctx = makeCountingCtx(counters);
    const target = makeFrameTarget(ctx, SURFACE);
    const es = 0.5;
    const scrollY = scrollYForCenterBeat(g1, 750, es);

    const staticDraws = { n: 0 };
    target.staticLayer.__setCanvasFactoryForTests(() =>
      makeTallyingCanvasStub(() => { staticDraws.n++; }, ['stroke', 'fillText']));

    renderChart(target, makeRc(g1, notes, chartEndBeat, es, scrollY, false, counters));
    expect(staticDraws.n).toBeGreaterThan(0); // 初帧建位图

    // 只改纵向比例：surface / scale / scrollY / bpmEvents / chartEndBeat 全不变。
    // 改前 basis 命中 → 位图停留在旧比例；而旧比例的内容确实不同（探针实测：
    // ratio 1 / 2 的静态层绘制调用 178 vs 114 条，序列不一致）。
    // ⚠ 本条是**失效键完整性**护栏，不是用户可见缺陷的回归测试 —— 用户在当前 UI 路径下
    // 未复现"网格陈旧"（切到设置页改纵向比例时另有 basis 字段随之变化，把重建顺带触发了）。
    // 与 issue 29 问题1（漏加背景字段）同族：都是"加了新渲染维度，忘了扩失效比较链"。
    const g2 = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , SURFACE, 2);
    expect(g2.verticalRatio).toBe(2);
    staticDraws.n = 0;
    renderChart(target, makeRc(g2, notes, chartEndBeat, es, scrollY, false, counters));
    expect(staticDraws.n).toBeGreaterThan(0);
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
// 运行：`npx vitest run tests/perf/RendererPerf.test.ts -t 候选 2`（数字打印在 stdout）。
// ---------------------------------------------------------------------------
describe('候选 2 测量：单次交互成本（issue 70）', () => {
  const chartEndBeat = 1500;
  const MOVES = 100;

  /** 一次「交互帧」的 JS 成本：视口/几何/谱面全不变，只有 hoverPos 变（= 一次 mousemove 的重绘） */
  it('量：hover 交互帧 —— renderChart ×100 总耗时 + 每帧 getVisibleNotes 次数', () => {
    const notes = makeDenseNotes(5000, chartEndBeat);
    const g = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , SURFACE);
    const counters: Counters = { drawImage: 0, spriteRenders: 0 };
    const ctx = makeCountingCtx(counters);
    const target = makeFrameTarget(ctx, SURFACE);
    const es = 0.5;
    const scrollY = scrollYForCenterBeat(g, 750, es);

    // 首帧：构建瓦片 + 静态层（不计入交互帧成本）
    const rc = makeRc(g, notes, chartEndBeat, es, scrollY, false, counters);
    renderChart(target, rc);

    // 最坏交互帧：hover 有值（实时显示线两侧 O(n) 读数）+ 有 hoverItem（选中描边层）+ 同时点击线开
    const base: RenderCtx = {
      ...rc,
      hoverItem: { kind: 'note', noteIndex: 0 },
      display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true },
    };
    renderChart(target, { ...base, hoverPos: { cx: 300, cy: 400 } }); // 预热

    const spy = vi.spyOn(ChartGeometry.prototype, 'visibleNotes');
    const t0 = performance.now();
    for (let i = 0; i < MOVES; i++) {
      renderChart(target, { ...base, hoverPos: { cx: 300 + i, cy: 400 + i } });
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
    const g = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , SURFACE);
    const es = 0.5;
    const viewport = { scrollX: 0, scrollY: scrollYForCenterBeat(g, 750, es), scale: es };
    const deps = { geometry: g, viewport, beatDisplay: BEAT_DISPLAY, notes, noteSize: 1 };
    findItemAt(300, 400, deps); // 预热

    const t0 = performance.now();
    for (let i = 0; i < MOVES; i++) findItemAt(300 + (i % 50), 400 + (i % 50), deps);
    const total = performance.now() - t0;
    console.log(`[候选2] findItemAt ×${MOVES}：总 ${total.toFixed(1)}ms，单次 ${(total / MOVES).toFixed(3)}ms`);
    // 时间护栏：实测 0.7~2.0ms，全量多 worker 并发下防数量级退化（< 8ms）
    expect(total / MOVES).toBeLessThan(8);
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
    // 在全量多 worker 并发下，绝对墙钟时间受 CPU 调度影响膨胀 2~2.5 倍；
    // 阈值设为 3.5ms（窗口裁剪一旦回退，并发下会飙升至 5ms+ 依然会红；同时免疫多进程并发调度噪音）。
    expect(total / MOVES).toBeLessThan(3.5);
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

describe('issue 101 · 换肤全量失效后的播放滚动帧', () => {
  it('换肤全量失效后播放帧不同步光栅，miss 瓦片进队列再渐进建', () => {
    vi.restoreAllMocks();
    const chartEndBeat = 1500;
    const notes = makeDenseNotes(5000, chartEndBeat);
    const g = new ChartGeometry(bpm120, { endBeat: chartEndBeat }, SURFACE);
    const counters: Counters = { drawImage: 0, spriteRenders: 0 };
    const ctx = makeCountingCtx(counters);
    const noteLayer = createNoteLayerCache();
    const es = 0.4;
    const scrollY = scrollYForCenterBeat(g, 750, es);

    let tileCreates = 0;
    noteLayer.__setCanvasFactoryForTests(() => {
      tileCreates++;
      return makeCanvasStub({ drawImage: 0, spriteRenders: 0 });
    });

    noteLayer.draw(ctx, makeRc(g, notes, chartEndBeat, es, scrollY, false, counters));
    const restCreates = tileCreates;
    expect(restCreates).toBeGreaterThan(2);

    let now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    tileCreates = 0;
    noteLayer.__setCanvasFactoryForTests(() => {
      tileCreates++;
      now += 5;
      return makeCanvasStub({ drawImage: 0, spriteRenders: 0 });
    });

    noteLayer.draw(ctx, makeRc(g, notes, chartEndBeat, es, scrollY, false, counters, SURFACE, {
      playing: true,
      skinVersion: 1,
    }));

    // issue 140：播放 RAF 不进同步 renderTile（issue 101 意图 = 不在滚动帧付整屏光栅）
    expect(tileCreates).toBe(0);
    expect(noteLayer.__getLastNoteLayerStats().rebuilt).toBe(0);

    noteLayer.__flushPlayingTileQueueForTests();
    expect(tileCreates).toBeGreaterThan(0);
  });
});

describe('issue 167 / 179 · 首个音符抵线卡顿防范（静止期靶向预热与播放期节流）', () => {
  it('静止期自动将视口上方 [lo, hi+2] 及全谱首个实体音符窗口 [firstTile, firstTile+2] 加入预热队列并建好', () => {
    vi.restoreAllMocks();
    const chartEndBeat = 100;
    // 首个音符在 beat 20（pos = 4400，瓦片 8），紧邻后续音符落在瓦片 9、10
    const notes: ChartNote[] = [
      { type: 'BPM', beat: 0, bpm: 120 },
      { type: 'Single', lane: 3, beat: 20, subBeat: 0 },
      { type: 'Single', lane: 4, beat: 23, subBeat: 0 },
      { type: 'Single', lane: 2, beat: 26, subBeat: 0 },
    ];
    const g = new ChartGeometry(bpm120, { endBeat: chartEndBeat }, SURFACE);
    const counters: Counters = { drawImage: 0, spriteRenders: 0 };
    const ctx = makeCountingCtx(counters);
    const noteLayer = createNoteLayerCache();
    const es = 1;
    // 视口在底部 0 拍（此时视口在瓦片 0~2 左右，瓦片 8~10 远在视口之外）
    const scrollY = g.chartEndVirtualY;

    noteLayer.__setCanvasFactoryForTests(() => {
      return makeCanvasStub({ drawImage: 0, spriteRenders: 0 });
    });

    const rc = makeRc(g, notes, chartEndBeat, es, scrollY, false, counters);
    const { posMin, posMax } = posRangeOf(rc);
    const { hi } = tileIndexRange(posMin, posMax);

    // 静止帧绘制
    noteLayer.draw(ctx, rc);

    // 同步 flush 队列后：视口上方 hi+2 以及首音符连续窗口 [firstTile, firstTile+2] 必须均已建好
    noteLayer.__flushPlayingTileQueueForTests();
    const tiles = noteLayer.__getTilesForTests();
    const firstTileId = Math.floor((20 * 220) / TILE_PX); // 8
    expect(tiles.has(hi + 2)).toBe(true);
    expect(tiles.has(firstTileId)).toBe(true);
    expect(tiles.has(firstTileId + 1)).toBe(true);
    expect(tiles.has(firstTileId + 2)).toBe(true);
    expect(tiles.get(firstTileId)?.empty).toBe(false);
    expect(tiles.get(firstTileId + 1)?.empty).toBe(false);
    expect(tiles.get(firstTileId + 2)?.empty).toBe(false);
  });

  it('播放期补建节流为 16ms，静止期排空为 0ms（防连环同步光栅打穿帧预算）', () => {
    vi.restoreAllMocks();
    const chartEndBeat = 100;
    const notes: ChartNote[] = [
      { type: 'Single', lane: 3, beat: 10, subBeat: 0 },
    ];
    const g = new ChartGeometry(bpm120, { endBeat: chartEndBeat }, SURFACE);
    const counters: Counters = { drawImage: 0, spriteRenders: 0 };
    const ctx = makeCountingCtx(counters);
    const noteLayer = createNoteLayerCache();
    const es = 1;
    const scrollY = g.chartEndVirtualY;

    const timeoutDelays: number[] = [];
    const origSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: any, delay?: number, ...args: any[]) => {
      timeoutDelays.push(delay ?? 0);
      return origSetTimeout(fn, delay, ...args);
    }) as any);

    // 1. 静止帧绘制：排队 delay 应为 0
    noteLayer.draw(ctx, makeRc(g, notes, chartEndBeat, es, scrollY, false, counters));
    expect(timeoutDelays.length).toBeGreaterThan(0);
    expect(timeoutDelays[timeoutDelays.length - 1]).toBe(0);

    noteLayer.reset();
    timeoutDelays.length = 0;

    // 2. 播放帧绘制：排队 delay 应为 16
    noteLayer.draw(ctx, makeRc(g, notes, chartEndBeat, es, scrollY, false, counters, SURFACE, { playing: true }));
    expect(timeoutDelays.length).toBeGreaterThan(0);
    expect(timeoutDelays[timeoutDelays.length - 1]).toBe(16);
  });
});

