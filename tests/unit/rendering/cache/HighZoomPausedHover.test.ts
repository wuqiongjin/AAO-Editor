// issue 195：高倍暂停帧不得因重建 padding 瓦片而把唯一覆盖视口的音符瓦片淘汰。
//
// 真实链路（Playwright 实测）：240% 下单块瓦片 ≈16.3MiB，64MiB 预算只容 3 块；静止预取
// `[lo,hi+2] + [firstTile,+4]` 超预算后持续淘汰。鼠标移动触发的暂停帧里，`draw()` 会同步
// 重建 `[lo,hi]` 中缺失的 padding 瓦片，`evictOverBudget()` 随之把 Map 中最旧的**视口覆盖块**
// 淘汰 → 该帧 `blitted=0`，整屏音符消失一瞬。
//
// 本用例手工摆出「预算已超、padding 缺一块、视口块在 Map 最旧」的临界状态：
// 旧实现会重建 padding 并淘汰视口块；新实现不把非视口的 missing 块纳入同步重建，视口块保留。
import { describe, it, expect, beforeEach } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import {
  createNoteLayerCache,
  maxTilesForBudget,
  planPrefetchTiles,
  tileBlitRect,
  tileBytesFor,
  tileIntersectsViewport,
  type NoteLayerCache,
} from '@/src/rendering/pipeline/noteLayerCache';
import type { RenderCtx } from '@/src/rendering/types';
import type { ChartNote } from '@/src/chart/types';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import { makeNoopCtx } from '@/tests/support/canvas';

const SURFACE = { w: 1550, h: 906 };
const ES = 2.4;
const DPR = 2;
const BEAT_DISPLAY = 4;
const CTX = makeNoopCtx();

/** 每半拍一个单键（0..40 拍）+ 首拍 BPM：可见瓦片恒非空，首音符瓦片 = 0 */
function makeNotes(): ChartNote[] {
  const notes: ChartNote[] = [{ beat: 0, type: 'BPM', bpm: 120 }];
  for (let i = 0; i <= 80; i++) {
    notes.push({ type: 'Single', lane: (i * 3) % 7, beat: Math.floor(i / 2), subBeat: i % 2 ? 2 : 0 });
  }
  return notes;
}

function makeGeometry(): ChartGeometry {
  return new ChartGeometry([{ beat: 0, bpm: 120 }], { endBeat: 40 }, SURFACE);
}

/** 视口中心落在 beat 10.5（240% 下视口只覆盖 1 块瓦片，lo..hi 含上下 padding 共 3 块） */
function makeRc(g: ChartGeometry): RenderCtx {
  const scrollY = g.beatToVirtualY(10.5, ES) - SURFACE.h / (2 * ES);
  return {
    geometry: g,
    viewport: { scrollX: 0, scrollY, scale: ES, virtualWidth: 0, virtualHeight: 0 },
    surface: SURFACE,
    dpr: DPR,
    beatDisplay: BEAT_DISPLAY,
    chartEndBeat: g.chartEndBeat,
    notes: makeNotes(),
    selectedItems: [],
    selectionBox: null,
    slideBuffer: null,
    hoverPos: { cx: SURFACE.w / 2, cy: SURFACE.h / 2 },
    clipboard: [],
    markerSeconds: null,
    armedTool: null,
    spriteIcon: { render: () => undefined, renderDecorator: () => undefined } as unknown as RenderCtx['spriteIcon'],
    noteIcons: buildActiveNoteIcons(normalizeNoteSkinSelection(undefined)),
    playing: false,
  };
}

/** 与 draw 同口径：anchorY = (chartEndVirtualY − scrollY)·es + surface.h */
function anchorYOf(rc: RenderCtx): number {
  return (rc.geometry.chartEndVirtualY - rc.viewport.scrollY) * ES + SURFACE.h;
}

/** [lo,hi] 内真正与视口相交的瓦片（padding 块不算） */
function onScreenIds(rc: RenderCtx, lo: number, hi: number): number[] {
  const anchorY = anchorYOf(rc);
  const ids: number[] = [];
  for (let id = lo; id <= hi; id++) {
    const r = tileBlitRect(id, ES, ES, anchorY, SURFACE.w, SURFACE.w);
    if (r.y + r.h > 0 && r.y < SURFACE.h) ids.push(id);
  }
  return ids;
}

/** 单块瓦片字节（复用生产同一口径，避免测试另写一份公式） */
const TILE_BYTES = tileBytesFor(SURFACE.w, ES, DPR);

/** `__getTilesForTests` 返回 ReadonlyMap；本用例需要手工摆位，故断言成可写 Map。 */
type TileLike = ReturnType<NoteLayerCache['__getTilesForTests']> extends ReadonlyMap<number, infer T> ? T : never;

function fakeTile(bytes: number) {
  return { canvas: { width: 0, height: 0, getContext: () => makeNoopCtx() }, refScale: ES, surfaceW: SURFACE.w, bytes, empty: false };
}

describe('issue 195 · 瓦片预算规划', () => {
  it('240% 下单块 ≈16.3MiB，64MiB 预算只能容 3 块；视口块判定不含 padding', () => {
    // 1550 宽 × round(512·2.4·1.5) 高 × 4B = 17,139,900B
    expect(tileBytesFor(SURFACE.w, ES, DPR)).toBe(17_139_900);
    expect(maxTilesForBudget(SURFACE.w, ES, DPR)).toBe(3);

    const g = makeGeometry();
    const rc = makeRc(g);
    const anchorY = anchorYOf(rc);
    expect(tileIntersectsViewport(4, ES, anchorY, SURFACE.h)).toBe(true);
    expect(tileIntersectsViewport(3, ES, anchorY, SURFACE.h)).toBe(false);
    expect(tileIntersectsViewport(5, ES, anchorY, SURFACE.h)).toBe(false);
  });

  it('预取规划受预算约束：视口块优先，余量给向上 2 块；远端首音符窗口高倍下让位', () => {
    const g = makeGeometry();
    const rc = makeRc(g);
    const anchorY = anchorYOf(rc);
    const plan = planPrefetchTiles({
      lo: 3, hi: 5, firstTile: 0,
      surfaceW: SURFACE.w, surfaceH: SURFACE.h,
      es: ES, dpr: DPR, anchorY,
    });
    expect(plan).toHaveLength(3);
    expect(plan).toContain(4);         // 视口覆盖块
    expect(plan).toEqual(expect.arrayContaining([6, 7])); // 向上 2 块
    expect(plan).not.toContain(3);     // padding 让位
    expect(plan).not.toContain(0);     // 远端首音符窗口让位
  });

  it('低倍预算充足时仍保留首音符窗口 [firstTile, firstTile+4]（issue 167/179/188 不回退）', () => {
    const plan = planPrefetchTiles({
      lo: 0, hi: 1, firstTile: 0,
      surfaceW: 750, surfaceH: 900, es: 1, dpr: 1,
      anchorY: 0,
    });
    for (let id = 0; id <= 4; id++) expect(plan).toContain(id);
  });
});

describe('issue 195 · 高倍暂停帧不淘汰视口覆盖瓦片', () => {
  let cache: NoteLayerCache;
  beforeEach(() => {
    cache = createNoteLayerCache();
    cache.__setCanvasFactoryForTests(() => ({ width: 0, height: 0, getContext: () => makeNoopCtx() }));
  });

  it('padding 缺块 + 预算超限：同步重建不得淘汰唯一视口块', () => {
    const g = makeGeometry();
    const rc = makeRc(g);
    cache.draw(CTX, rc);
    cache.__flushPlayingTileQueueForTests();

    const { lo, hi } = cache.__getLastNoteLayerStats();
    const viewIds = onScreenIds(rc, lo, hi);
    expect(viewIds.length).toBeGreaterThan(0);
    expect(viewIds.length).toBeLessThanOrEqual(2);

    // 第一帧的预取就可能已把视口块淘汰（旧实现）；再画一帧让它同步补回，取到可复用的视口瓦片对象。
    cache.draw(CTX, rc);
    const map = cache.__getTilesForTests() as Map<number, TileLike>;
    const viewTiles = viewIds.map((id) => [id, map.get(id)!] as const);
    expect(viewTiles.every(([, tile]) => tile !== undefined)).toBe(true);
    const paddingId = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
      .find((id) => !viewIds.includes(id));
    expect(paddingId).toBeDefined();

    // 摆出临界状态：视口块在最旧位置；padding 块缺失；额外 3 块 16.3MiB 假瓦片把总量顶到 >64MiB。
    map.clear();
    for (const [id, tile] of viewTiles) map.set(id, tile);
    for (let k = 0; k < 3; k++) map.set(9000 + k, fakeTile(TILE_BYTES) as unknown as TileLike);

    cache.draw(CTX, rc);
    const st = cache.__getLastNoteLayerStats();
    // 旧实现：padding 缺块同步重建 → evict 掉视口块 → blitted=0，整层音符消失。
    expect(st.blitted).toBeGreaterThan(0);
    for (const id of viewIds) expect(map.has(id)).toBe(true);
    cache.reset();
  });
});
