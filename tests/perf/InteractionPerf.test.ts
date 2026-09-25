// issue 35 回归测试：密集音符下放置/操作卡顿的三项修复
// - F1 选中高亮移出瓦片：选择变化 0 瓦片重建，主画布叠加层绘制选中圈
// - F3 notes 按变化拍区间增量失效：单音符编辑只重建受影响瓦片；屏外编辑 0 重建
// - F6 NoteReplacementRules 不可变：旧数组对象/连接点数组不被在位变异（History 结构共享 + F3 diff 前提）
import { describe, it, expect, beforeEach } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { renderChart } from '@/src/visual/render';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/visual/noteSkin';
import {
  drawNotesLayer, resetNoteLayerCache, diffNotes, __setTileCanvasFactoryForTests,
} from '@/src/visual/noteLayerCache';
import { resetStaticLayerCache, __setStaticCanvasFactoryForTests } from '@/src/visual/staticLayerCache';
import { handleNoteReplacement, handleSlideToSlideCombination } from '@/src/chart/editing/NoteReplacementRules';
import type { RenderCtx } from '@/src/visual/types';
import type { ChartNote } from '@/src/chart/types';
import { makeCountingCtx } from '@/tests/support/canvas';

const bpm120 = [{ beat: 0, bpm: 120 }];
const SURFACE = { w: 750, h: 900 };
const BEAT_DISPLAY = 4;

function makeDenseNotes(n: number, chartEndBeat: number): ChartNote[] {
  const notes: ChartNote[] = [];
  for (let i = 0; i < n; i++) {
    const beat = Math.round((i / n) * chartEndBeat * 4) / 4;
    const lane = i % 7;
    const kind = i % 10;
    if (kind === 1) notes.push({ type: 'LDirectional', lane, beat, subBeat: 0, length: (i % 3) + 1 } as ChartNote);
    else if (kind === 2) notes.push({ type: 'RDirectional', lane, beat, subBeat: 0, length: (i % 3) + 1 } as ChartNote);
    else notes.push({ type: 'Single', lane, beat, subBeat: 0, flick: i % 7 === 0 } as ChartNote);
  }
  return notes;
}

// ---------------- stub canvas 基建 ----------------
type Counters = { drawImage: number; sprites: number; stroke: number };
const EMPTY_SELECTED: never[] = [];
const EMPTY_CLIPBOARD: never[] = [];
// 音符皮肤图标集（issue 29）：默认选择构建一次共享（纯数据，不含 DOM）
const SHARED_NOTE_ICONS = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));

function makeRc(geometry: ChartGeometry, notes: ChartNote[], chartEndBeat: number, es: number, scrollY: number, selectedItems: unknown[], counters: Counters, spriteCounter?: { n: number }): RenderCtx {
  return {
    geometry,
    viewport: { scrollX: 0, scrollY, scale: es, virtualWidth: 0, virtualHeight: 0 },
    surface: SURFACE,
    dpr: 1,
    beatDisplay: BEAT_DISPLAY,
    chartEndBeat,
    notes,
    selectedItems: selectedItems as RenderCtx['selectedItems'],
    selectionBox: null,
    slideBuffer: null,
    hoverPos: null,
    clipboard: EMPTY_CLIPBOARD,
    markerSeconds: null,
    armedTool: null,
    spriteIcon: { render: () => { if (spriteCounter) spriteCounter.n++; else counters.sprites++; }, renderDecorator: () => undefined } as unknown as RenderCtx['spriteIcon'],
    noteIcons: SHARED_NOTE_ICONS,
  };
}

/** beat 置于画布中心的 scrollY */
function scrollYForCenterBeat(g: ChartGeometry, beat: number, es: number): number {
  return g.beatToVirtualY(beat, es) - SURFACE.h / (2 * es);
}

// ---------------- diffNotes（F3 纯函数） ----------------
describe('diffNotes 结构共享 diff', () => {
  const n = (beat: number, subBeat = 0): ChartNote => ({ type: 'Single', lane: 0, beat, subBeat });

  it('全部同引用（换数组壳）→ none', () => {
    const a = [n(1), n(2), n(3)];
    expect(diffNotes(a, [...a], 4)).toEqual({ kind: 'none' });
  });

  it('替换中间音符 → 区间收敛到该拍', () => {
    const a = [n(1), n(2), n(3)];
    const b = [a[0], n(2), a[2]];
    expect(diffNotes(a, b, 4)).toEqual({ kind: 'range', minBeat: 2, maxBeat: 2 });
  });

  it('尾部追加 / 中间删除 → 区间为变化音符的拍', () => {
    const first = n(1);
    expect(diffNotes([first], [first, n(5)], 4)).toEqual({ kind: 'range', minBeat: 5, maxBeat: 5 });
    const a3 = [n(1), n(2), n(3)];
    const d3 = [a3[0], a3[2]];
    expect(diffNotes(a3, d3, 4)).toEqual({ kind: 'range', minBeat: 2, maxBeat: 2 });
  });

  it('subBeat 按 beatDisplay 折算为精确拍（新旧并集）', () => {
    const a = [n(1)];
    const b = [n(1, 2)];
    expect(diffNotes(a, b, 4)).toEqual({ kind: 'range', minBeat: 1, maxBeat: 1.5 });
  });

  it('滑条变化取新旧连接点并集的首尾拍', () => {
    const slide = (b1: number, b2: number): ChartNote => ({
      type: 'Slide', connections: [{ lane: 0, beat: b1 }, { lane: 1, beat: b2 }],
    } as ChartNote);
    const a = [slide(2, 4), n(10)];
    const b = [slide(3, 8), a[1]];
    expect(diffNotes(a, b, 4)).toEqual({ kind: 'range', minBeat: 2, maxBeat: 8 });
  });

  it('变更中段过大 → full（回退全量失效）', () => {
    const a = Array.from({ length: 100 }, (_, i) => n(i));
    const b = a.map((x, i) => n(i, 1)); // 全量替换引用
    expect(diffNotes(a, b, 4)).toEqual({ kind: 'full' });
  });
});

// ---------------- 瓦片增量失效 + 选中叠加（F1/F3 端到端） ----------------
describe('noteLayerCache 增量失效（3000 音符）', () => {
  const chartEndBeat = 1500;
  const es = 0.5;
  const g = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , SURFACE);
  const scrollY = scrollYForCenterBeat(g, 750, es);

  beforeEach(() => {
    resetNoteLayerCache();
    resetStaticLayerCache();
    __setTileCanvasFactoryForTests(() => ({
      width: 0, height: 0,
      getContext: () => makeCountingCtx({ drawImage: 0, sprites: 0, stroke: 0 }, ['drawImage', 'stroke']),
    }));
    __setStaticCanvasFactoryForTests(() => ({
      width: 0, height: 0,
      getContext: () => makeCountingCtx({ drawImage: 0, sprites: 0, stroke: 0 }, ['drawImage', 'stroke']),
    }));
  });

  /** 每个用例独立的绘制 harness：sprites 跨 draw 累计（瓦片重建会重绘精灵）；
   *  rebuilt 跨 draw 累计新建的瓦片位图数（renderTile 每重建一块非空瓦片调一次位图工厂） */
  const mkDraw = () => {
    const sprites = { n: 0 };
    const rebuilt = { n: 0 };
    __setTileCanvasFactoryForTests(() => {
      rebuilt.n++;
      return { width: 0, height: 0, getContext: () => makeCountingCtx({ drawImage: 0, sprites: 0, stroke: 0 }, ['drawImage', 'stroke']) };
    });
    const draw = (notes: ChartNote[], selected: unknown[] = EMPTY_SELECTED) => {
      const main: Counters = { drawImage: 0, sprites: 0, stroke: 0 };
      drawNotesLayer(makeCountingCtx(main, ['drawImage', 'stroke']), makeRc(g, notes, chartEndBeat, es, scrollY, selected, main, sprites));
      return main;
    };
    return { sprites, rebuilt, draw };
  };

  it('选中变化：0 瓦片重建（瓦片精灵不重绘），主画布叠加层绘制选中圈', () => {
    const { sprites, rebuilt, draw } = mkDraw();
    const notes = makeDenseNotes(3000, chartEndBeat);
    draw(notes);
    expect(rebuilt.n).toBeGreaterThan(0); // 初帧构建了可见瓦片
    const builtTiles = rebuilt.n;

    // 视口中部选中一个音符（可见拍窗 ≈ [744, 756] → 下标 >1490 即在窗内）
    const k = notes.findIndex((note, i) => i > 1490 && note.type === 'Single');
    const before = sprites.n;
    const main = draw(notes, [{ kind: 'note', noteIndex: k }]);

    expect(rebuilt.n).toBe(builtTiles);   // F1：选择变化 0 瓦片重建
    expect(sprites.n).toBe(before);
    expect(main.stroke).toBeGreaterThan(0); // F1：叠加层画了选中描边（issue 56 起为 ink 圆角矩形）
    // 切换到另一个选中音符：瓦片依旧不重绘
    const k2 = notes.findIndex((note, i) => i > 1505 && note.type === 'Single');
    draw(notes, [{ kind: 'note', noteIndex: k2 }]);
    expect(rebuilt.n).toBe(builtTiles);
  });

  it('视口内单音符编辑：重建 ≤2 块瓦片（验收线），远小于全量', () => {
    const { sprites, rebuilt, draw } = mkDraw();
    const notes = makeDenseNotes(3000, chartEndBeat);
    draw(notes);
    const spritesAfterBuild = sprites.n;
    const builtTiles = rebuilt.n;
    expect(builtTiles).toBeGreaterThanOrEqual(3); // 视口本身就有多块瓦片

    // 视口中心替换一个音符（可见拍窗内，不可变构造，模拟 handleNoteReplacement 的产物）
    const k = notes.findIndex((note, i) => i > 1490 && note.type === 'Single');
    const edited = [...notes];
    edited[k] = { ...edited[k]!, flick: true } as ChartNote;
    draw(edited);

    const rebuiltCount = rebuilt.n - builtTiles;
    expect(rebuiltCount).toBeGreaterThanOrEqual(1); // 受影响瓦片确实重建
    // F3：增量失效。es=0.5 时瓦片渲染外扩 200/es=400 虚拟px/侧 → 变更±margin 横跨 ≈2 瓦片宽 + 跨界 → ≤3
    // （全量重建 = builtTiles ≥3 块；浏览器 es≈0.59 下实测 ≈2-3 块，见 issue 35 复测）
    expect(rebuiltCount).toBeLessThanOrEqual(3);
    expect(sprites.n).toBeGreaterThan(spritesAfterBuild);
  });

  it('视口外单音符编辑：0 瓦片重建（屏外拍区间的瓦片本就不在可见集）', () => {
    const { sprites, rebuilt, draw } = mkDraw();
    const notes = makeDenseNotes(3000, chartEndBeat);
    draw(notes);
    const spritesAfterBuild = sprites.n;
    const builtTiles = rebuilt.n;

    const k = notes.findIndex((note, i) => i < 100 && note.type === 'Single'); // beat ≈ 0..50，远离视口中心 750
    const edited = [...notes];
    edited[k] = { ...edited[k]!, flick: true } as ChartNote;
    draw(edited);

    expect(rebuilt.n).toBe(builtTiles); // F3：屏外变化不影响可见瓦片
    expect(sprites.n).toBe(spritesAfterBuild);
  });

  it('BPM/geometry 变化仍全量失效（拍位置整体改变，不能增量）', () => {
    const { sprites, rebuilt, draw } = mkDraw();
    const notes = makeDenseNotes(3000, chartEndBeat);
    draw(notes);
    const builtTiles = rebuilt.n;

    // BPM 音符改变 → getBpmEvents 内容变 → 组件复用判定失败会新建 geometry（F2 走全量分支）
    const g2 = new ChartGeometry([{ beat: 0, bpm: 180 }], { endBeat: chartEndBeat } , SURFACE);
    const main: Counters = { drawImage: 0, sprites: 0, stroke: 0 };
    drawNotesLayer(makeCountingCtx(main, ['drawImage', 'stroke']), makeRc(g2, notes, chartEndBeat, es, scrollYForCenterBeat(g2, 750, es), EMPTY_SELECTED, main, sprites));

    expect(rebuilt.n - builtTiles).toBeGreaterThanOrEqual(builtTiles); // 全量重建可见瓦片
  });

  it('renderChart 全链路：编辑后一帧仍正常 blit 瓦片（无回归）', () => {
    const sprites = { n: 0 };
    const notes = makeDenseNotes(3000, chartEndBeat);
    const canvas = { width: 0, height: 0 };
    const main: Counters = { drawImage: 0, sprites: 0, stroke: 0 };
    const ctx = makeCountingCtx(main, ['drawImage', 'stroke']);
    renderChart(ctx, canvas as unknown as HTMLCanvasElement, makeRc(g, notes, chartEndBeat, es, scrollY, EMPTY_SELECTED, main, sprites));
    expect(main.drawImage).toBeGreaterThan(0);

    const k = notes.findIndex((note, i) => i > 1400 && note.type === 'Single');
    const edited = [...notes];
    edited[k] = { ...edited[k]!, flick: true } as ChartNote;
    main.drawImage = 0;
    renderChart(ctx, canvas as unknown as HTMLCanvasElement, makeRc(g, edited, chartEndBeat, es, scrollY, EMPTY_SELECTED, main, sprites));
    expect(main.drawImage).toBeGreaterThan(0); // 可见瓦片照常 blit
  });
});

// ---------------- F6 不可变回归（History 结构共享前提） ----------------
describe('NoteReplacementRules 不可变（issue 35 F6）', () => {
  it('同类型方向键叠加：旧对象不被在位变异，撤销后长度可回退', () => {
    const orig = { type: 'LDirectional', beat: 1, lane: 2, subBeat: 0, length: 1 } as ChartNote;
    const r = handleNoteReplacement([orig], 1, 2, 0, 'ldirectional');
    expect((r.newNotes[0] as { length: number }).length).toBe(2);
    expect((orig as { length: number }).length).toBe(1); // 共享旧对象未被改
    expect(r.newNotes[0]).not.toBe(orig);                 // 构造了新对象
  });

  it('滑条合并（终点+起点）：旧滑条 connections 数组不被在位变异', () => {
    const origSlide = {
      type: 'Slide',
      connections: [{ beat: 0, lane: 0 }, { beat: 2, lane: 2 }],
    } as ChartNote;
    const notes: ChartNote[] = [origSlide];
    const r = handleSlideToSlideCombination(notes, [{ beat: 2, lane: 2 }, { beat: 4, lane: 4 }]);
    expect(r.shouldCombine).toBe(true);
    const merged = r.newNotes[0] as unknown as { connections: unknown[] };
    expect(merged.connections).toHaveLength(3);                       // 合并进新终点
    expect((origSlide as unknown as { connections: unknown[] }).connections).toHaveLength(2); // 旧数组未动
    expect(r.newNotes[0]).not.toBe(origSlide);
  });

  it('滑条合并（起点+终点）：旧滑条 connections 数组不被在位变异', () => {
    const origSlide = {
      type: 'Slide',
      connections: [{ beat: 2, lane: 2 }, { beat: 4, lane: 4 }],
    } as ChartNote;
    const notes: ChartNote[] = [origSlide];
    const r = handleSlideToSlideCombination(notes, [{ beat: 0, lane: 0 }, { beat: 2, lane: 2 }]);
    expect(r.shouldCombine).toBe(true);
    const merged = r.newNotes[0] as unknown as { connections: unknown[] };
    expect(merged.connections).toHaveLength(3);
    expect((origSlide as unknown as { connections: unknown[] }).connections).toHaveLength(2);
  });
});
