// issue 146：播放中编辑谱面不应让画面出现「整屏音符没有像素」的帧。
//
// 背景（票内手揆）：播放帧的瓦片 miss 故意不同步光栅（`e289e8e` defer play-time raster，
// 保 101/139/140 的播放帧预算），miss 的瓦片由 setTimeout 队列逐块补；
// 而单个音符变更的失效范围（含 `(VIEWPORT_PADDING + 48)/es` 余量，默认缩放下 ≈ ±248 pos px）
// 往往盖住**全部可见内容瓦片** → 旧实现里那些帧整屏音符都画不出来。
// 定案：失效改为「打脏 + 保留旧位图」，本帧 blit 上一版过渡，队列重建完自然换下。
import { describe, it, expect, beforeEach } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import {
  drawNotesLayer, resetNoteLayerCache, __setTileCanvasFactoryForTests,
  __getTilesForTests, __getLastNoteLayerStats, __flushPlayingTileQueueForTests,
} from '@/src/rendering/pipeline/noteLayerCache';
import type { RenderCtx } from '@/src/rendering/types';
import type { ChartNote } from '@/src/chart/types';
import { makeNoopCtx } from '@/tests/support/canvas';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';

const SURFACE = { w: 750, h: 900 };
const BEAT_DISPLAY = 4;
const ES = 1;
const CTX = makeNoopCtx();

/** 200 个单键 + 首拍 BPM：足够让 diff 既不打到 DIFF_FULL_LIMIT、又能铺满可见瓦片 */
function makeNotes(): ChartNote[] {
  const out: ChartNote[] = [{ beat: 0, type: 'BPM', bpm: 120 }];
  for (let i = 1; i <= 200; i++) out.push({ type: 'Single', lane: i % 7, beat: i, subBeat: 0 });
  return out;
}

/** 结构共享地换掉一个音符（模拟放置 / 覆盖） */
function replaceNote(notes: ChartNote[], at: number): ChartNote[] {
  const next = [...notes];
  next[at] = { ...(notes[at] as ChartNote) } as ChartNote;
  return next;
}

/** 整份换引用（模拟 undo / redo 或整体替换：`diffNotes` 会判 full） */
function replaceAllNotes(notes: ChartNote[]): ChartNote[] {
  return notes.map((n) => ({ ...n }) as ChartNote);
}

function geometry(): ChartGeometry {
  return new ChartGeometry([{ beat: 0, bpm: 120 }], { endBeat: 240 }, SURFACE);
}

/** 视口中部（beat 100 附近）对应的 scrollY */
function centerScrollY(g: ChartGeometry): number {
  return g.beatToVirtualY(100, ES) - SURFACE.h / (2 * ES);
}

function makeRc(g: ChartGeometry, notes: ChartNote[], scrollY: number, playing: boolean): RenderCtx {
  return {
    geometry: g,
    viewport: { scrollX: 0, scrollY, scale: ES, virtualWidth: 0, virtualHeight: 0 },
    surface: SURFACE,
    dpr: 1,
    beatDisplay: BEAT_DISPLAY,
    chartEndBeat: g.chartEndBeat,
    notes,
    selectedItems: [],
    selectionBox: null,
    slideBuffer: null,
    hoverPos: null,
    clipboard: [],
    markerSeconds: null,
    armedTool: null,
    spriteIcon: { render: () => undefined, renderDecorator: () => undefined } as unknown as RenderCtx['spriteIcon'],
    noteIcons: buildActiveNoteIcons(normalizeNoteSkinSelection(undefined)),
    playing,
  };
}

/** 可见区间内第一块被打脏的瓦片（失效区域有可能不包含最边上那块） */
function firstDirtyTileId(): number {
  const { lo, hi } = __getLastNoteLayerStats();
  const map = __getTilesForTests();
  for (let id = lo; id <= hi; id++) if (map.get(id)?.dirty) return id;
  throw new Error(`可见区间 [${lo}, ${hi}] 内没有打脏的瓦片`);
}

/** 热身到播放稳态，返回稳态那一帧的瓦片账 */
function warmToSteady(g: ChartGeometry, notes: ChartNote[], y0: number) {
  drawNotesLayer(CTX, makeRc(g, notes, y0, false));
  __flushPlayingTileQueueForTests();
  for (let i = 1; i <= 3; i++) drawNotesLayer(CTX, makeRc(g, notes, y0 + i, true));
  __flushPlayingTileQueueForTests();
  return __getLastNoteLayerStats();
}

describe('issue 146 · 播放中编辑谱面不出现空白帧', () => {
  let bitmaps = 0;
  beforeEach(() => {
    resetNoteLayerCache();
    bitmaps = 0;
    __setTileCanvasFactoryForTests(() => {
      bitmaps++;
      return { width: 0, height: 0, getContext: () => makeNoopCtx() };
    });
  });

  it('改一个音符：当帧仍 blit 全部可见瓦片，且播放期不通步光栅', () => {
    const notes = makeNotes();
    const g = geometry();
    const y0 = centerScrollY(g);
    const baseline = warmToSteady(g, notes, y0);
    expect(baseline.blitted).toBeGreaterThan(0);

    drawNotesLayer(CTX, makeRc(g, replaceNote(notes, 100), y0 + 4, true));
    const st = __getLastNoteLayerStats();
    // 修复前：blitted 掉到 0 —— 整屏音符那一帧都没有像素。
    expect(st.blitted).toBe(baseline.blitted);
    expect(st.blitCssPx).toBe(baseline.blitCssPx);
    // 播放帧仍不付同步光栅成本（保 issue 101 / 139 / 140）。
    expect(st.rebuilt).toBe(0);
  });

  it('整份换引用（undo / redo 形态）：同样不留空白帧', () => {
    const notes = makeNotes();
    const g = geometry();
    const y0 = centerScrollY(g);
    const baseline = warmToSteady(g, notes, y0);

    drawNotesLayer(CTX, makeRc(g, replaceAllNotes(notes), y0 + 4, true));
    const st = __getLastNoteLayerStats();
    expect(st.blitted).toBe(baseline.blitted);
    expect(st.rebuilt).toBe(0);
  });

  it('队列把打脏的瓦片换成新内容：对象换掉、dirty 清掉、随后不再重建', () => {
    const notes = makeNotes();
    const g = geometry();
    const y0 = centerScrollY(g);
    warmToSteady(g, notes, y0);
    const edited = replaceNote(notes, 100);
    drawNotesLayer(CTX, makeRc(g, edited, y0 + 4, true));

    const id = firstDirtyTileId();
    const before = __getTilesForTests().get(id);
    expect(before?.dirty).toBe(true);

    __flushPlayingTileQueueForTests();
    const after = __getTilesForTests().get(id);
    expect(after).not.toBe(before);
    expect(after?.dirty).toBeFalsy();

    // 之后连续播放帧 notes 引用不变 → 不再打脏、也不再建位图（与改前稳态同开销）
    const settled = bitmaps;
    for (let i = 5; i <= 9; i++) drawNotesLayer(CTX, makeRc(g, edited, y0 + i, true));
    __flushPlayingTileQueueForTests();
    expect(bitmaps).toBe(settled);
  });

  it('非播放期改音符：当帧同步重建（放置即看得见，旧行为不回退）', () => {
    const notes = makeNotes();
    const g = geometry();
    const y0 = centerScrollY(g);
    drawNotesLayer(CTX, makeRc(g, notes, y0, false));
    __flushPlayingTileQueueForTests();
    const baseline = __getLastNoteLayerStats();

    drawNotesLayer(CTX, makeRc(g, replaceNote(notes, 100), y0, false));
    const st = __getLastNoteLayerStats();
    expect(st.rebuilt).toBeGreaterThan(0);
    expect(st.blitted).toBe(baseline.blitted);
  });

  it('播放中编辑后停止播放：打脏的瓦片被同步补上，旧内容不残留', () => {
    const notes = makeNotes();
    const g = geometry();
    const y0 = centerScrollY(g);
    warmToSteady(g, notes, y0);
    const edited = replaceNote(notes, 100);
    drawNotesLayer(CTX, makeRc(g, edited, y0 + 4, true));
    const id = firstDirtyTileId();

    drawNotesLayer(CTX, makeRc(g, edited, y0 + 4, false));
    expect(__getTilesForTests().get(id)?.dirty).toBeFalsy();
    expect(__getLastNoteLayerStats().rebuilt).toBeGreaterThan(0);
  });
});
