// 08 票（架构评审候选 3）核心行为锁：**缓存有主** —— 两层离屏缓存是 RenderTarget 的实例状态。
//
// 场景 = 未来的「离屏导出 / 谱面预览」：编辑器 target 渲染一帧后，第二个 target 渲染另一份谱面 /
// 另一个 surface；编辑器 target 的静态层与瓦片不得因此失效或换位（候选取景：离屏导出不再顶掉编辑器缓存）。
// 旧实现是模块级单例 —— 第二个 target 一渲染就会把前者的 basis / tiles 全部换掉，本组用例即该缺陷的回归网。
import { describe, expect, it } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { createRenderTarget, type RenderTarget } from '@/src/rendering/RenderTarget';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import { makeCanvasStub, makeCountingCtx, makeTallyingCanvasStub } from '@/tests/support/canvas';
import type { FrameView } from '@/src/rendering/types';
import type { ChartNote } from '@/src/chart/types';

const BEAT_DISPLAY = 4;
const SURFACE_A = { w: 750, h: 900 };
const SURFACE_B = { w: 600, h: 700 };
/** 音符皮肤图标集（issue 29）：默认选择构建一次共享（纯数据，不含 DOM） */
const SHARED_NOTE_ICONS = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));

function makeNotes(count: number, bpm = 120): ChartNote[] {
  const notes: ChartNote[] = [{ beat: 0, type: 'BPM', bpm }];
  for (let i = 1; i <= count; i++) notes.push({ type: 'Single', lane: i % 7, beat: i, subBeat: 0 });
  return notes;
}

function viewOf(g: ChartGeometry, notes: ChartNote[], scrollY: number, scale = g.effectiveScale(1)): FrameView {
  return {
    geometry: g,
    viewport: { scrollX: 0, scrollY, scale, virtualWidth: 0, virtualHeight: 0 },
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
    spriteIcon: { render: () => undefined, renderDecorator: () => undefined } as unknown as FrameView['spriteIcon'],
    noteIcons: SHARED_NOTE_ICONS,
  };
}

/** 把指定 beat 置于画布中心的 scrollY（与 viewOf 的 scale 同口径） */
function scrollYCenterBeat(g: ChartGeometry, beat: number, scale: number, surface: { w: number; h: number }): number {
  return g.beatToVirtualY(beat, scale) - surface.h / (2 * scale);
}

/** 一个 target（主画布 getContext 恒返回假 ctx；两层缓存注入假位图工厂） */
function makeTarget(surface: { w: number; h: number }): RenderTarget {
  const ctx = makeCountingCtx({ drawImage: 0 });
  const target = createRenderTarget({
    canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement,
    surface,
    dpr: 1,
  });
  target.noteLayer.__setCanvasFactoryForTests(() => makeCanvasStub({ drawImage: 0 }));
  target.staticLayer.__setCanvasFactoryForTests(() => makeCanvasStub({ drawImage: 0 }));
  return target;
}

describe('08 · RenderTarget 缓存有主（两个渲染目标互不顶掉）', () => {
  it('静态层：另一个 target 渲染不同 surface / BPM 的谱面后，本 target 仍是命中（纯 blit）', () => {
    const staticDrawsA = { n: 0 };
    const a = makeTarget(SURFACE_A);
    a.staticLayer.__setCanvasFactoryForTests(() =>
      makeTallyingCanvasStub(() => { staticDrawsA.n++; }, ['stroke', 'fillText']));
    const gA = new ChartGeometry([{ beat: 0, bpm: 120 }], { endBeat: 240 }, SURFACE_A);
    const notesA = makeNotes(200);
    const esA = gA.effectiveScale(1);
    const yA = scrollYCenterBeat(gA, 100, esA, SURFACE_A);

    a.renderFrame(viewOf(gA, notesA, yA, esA));
    expect(staticDrawsA.n).toBeGreaterThan(0); // 初帧建位图

    // 第二个渲染目标（离屏导出形态）：不同 surface + 不同 BPM 内容 —— 旧实现会顶掉单例 basis
    const b = makeTarget(SURFACE_B);
    const gB = new ChartGeometry([{ beat: 0, bpm: 180 }], { endBeat: 120 }, SURFACE_B);
    b.renderFrame(viewOf(gB, makeNotes(50, 180), scrollYCenterBeat(gB, 50, gB.effectiveScale(1), SURFACE_B)));
    expect(b.staticLayer).not.toBe(a.staticLayer);

    staticDrawsA.n = 0;
    a.renderFrame(viewOf(gA, notesA, yA, esA));
    expect(staticDrawsA.n).toBe(0); // 命中：只 blit、不重建（离屏导出没顶掉编辑器缓存）
  });

  it('音符瓦片：另一个 target 渲染不同谱面后，本 target 的瓦片对象身份不变、零重建', () => {
    const createsA = { n: 0 };
    const a = makeTarget(SURFACE_A);
    a.noteLayer.__setCanvasFactoryForTests(() => {
      createsA.n++;
      return makeCanvasStub({ drawImage: 0 });
    });
    const gA = new ChartGeometry([{ beat: 0, bpm: 120 }], { endBeat: 240 }, SURFACE_A);
    const notesA = makeNotes(200);
    const esA = gA.effectiveScale(1);
    const yA = scrollYCenterBeat(gA, 100, esA, SURFACE_A);

    a.renderFrame(viewOf(gA, notesA, yA, esA));
    expect(createsA.n).toBeGreaterThan(0);
    const tilesA = new Map(a.noteLayer.__getTilesForTests());
    expect(tilesA.size).toBeGreaterThan(0);

    // 第二个 target：自己的瓦片表（不同谱面）—— 不得清掉 a 的表
    const b = makeTarget(SURFACE_B);
    const gB = new ChartGeometry([{ beat: 0, bpm: 180 }], { endBeat: 120 }, SURFACE_B);
    b.renderFrame(viewOf(gB, makeNotes(50, 180), scrollYCenterBeat(gB, 50, gB.effectiveScale(1), SURFACE_B)));
    expect(b.noteLayer.__getTilesForTests().size).toBeGreaterThan(0);
    expect(b.noteLayer.__getTilesForTests()).not.toBe(a.noteLayer.__getTilesForTests());

    createsA.n = 0;
    a.renderFrame(viewOf(gA, notesA, yA, esA));
    expect(createsA.n).toBe(0); // 零重建
    for (const [id, tile] of tilesA) {
      const current = a.noteLayer.__getTilesForTests().get(id);
      if (current) expect(current, `瓦片 ${id} 被顶掉`).toBe(tile); // 身份不变
    }
  });

  it('configure 原地更新 surface/dpr：不重建 target，瓦片按 issue 36 F3a 续用', () => {
    const creates = { n: 0 };
    const target = makeTarget(SURFACE_A);
    target.noteLayer.__setCanvasFactoryForTests(() => {
      creates.n++;
      return makeCanvasStub({ drawImage: 0 });
    });
    const g1 = new ChartGeometry([{ beat: 0, bpm: 120 }], { endBeat: 240 }, SURFACE_A);
    const notes = makeNotes(200);
    // 显式 scale（两次渲染同口径）：surface 变化不改 es —— 与窗口缩放结算路径一致
    const es = 0.5;
    target.renderFrame(viewOf(g1, notes, scrollYCenterBeat(g1, 100, es, SURFACE_A), es));
    const built = creates.n;
    expect(built).toBeGreaterThan(0);

    const noteLayer = target.noteLayer;
    const tilesBefore = new Map(target.noteLayer.__getTilesForTests());
    // 窗口缩放结算形态：更宽 + 更矮 → 可见瓦片集是原来的子集（issue 36 F3a 的验收场景）
    const surface2 = { w: 1000, h: 800 };
    target.configure({ surface: surface2, dpr: 1 });
    expect(target.surface).toBe(surface2);
    expect(target.noteLayer).toBe(noteLayer); // target 未重建，缓存所有者不变

    const g2 = new ChartGeometry([{ beat: 0, bpm: 120 }], { endBeat: 240 }, surface2);
    creates.n = 0;
    target.renderFrame(viewOf(g2, notes, scrollYCenterBeat(g2, 100, es, surface2), es));
    expect(creates.n).toBe(0); // 瓦片续用（surface 宽高不在瓦片失效依据内）
    for (const [id, tile] of tilesBefore) {
      const current = target.noteLayer.__getTilesForTests().get(id);
      if (current) expect(current).toBe(tile);
    }
  });

  it('显示参数变化：同时点击线（simultaneousClickLines）与色觉辅助（colorAssist）独立使音符瓦片失效重建', () => {
    const creates = { n: 0 };
    const target = makeTarget(SURFACE_A);
    target.noteLayer.__setCanvasFactoryForTests(() => {
      creates.n++;
      return makeCanvasStub({ drawImage: 0 });
    });
    const g = new ChartGeometry([{ beat: 0, bpm: 120 }], { endBeat: 240 }, SURFACE_A);
    const notes = makeNotes(200);
    const es = 0.5;
    const y = scrollYCenterBeat(g, 100, es, SURFACE_A);

    // 初始状态：simultaneousClickLines = false, colorAssist = false
    target.renderFrame({
      ...viewOf(g, notes, y, es),
      display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: false, colorAssist: false },
    });
    const firstCount = creates.n;
    expect(firstCount).toBeGreaterThan(0);

    // 命中测试：相同 display 参数下零重建
    creates.n = 0;
    target.renderFrame({
      ...viewOf(g, notes, y, es),
      display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: false, colorAssist: false },
    });
    expect(creates.n).toBe(0);

    // 仅切换 simultaneousClickLines（从 false 改为 true）：必须立即全量失效并重建瓦片，不依赖 colorAssist
    creates.n = 0;
    target.renderFrame({
      ...viewOf(g, notes, y, es),
      display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true, colorAssist: false },
    });
    expect(creates.n).toBeGreaterThan(0);

    // 再次渲染相同参数：命中缓存零重建
    creates.n = 0;
    target.renderFrame({
      ...viewOf(g, notes, y, es),
      display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true, colorAssist: false },
    });
    expect(creates.n).toBe(0);

    // 仅切换 colorAssist（从 false 改为 true）：同样独立失效并重建
    creates.n = 0;
    target.renderFrame({
      ...viewOf(g, notes, y, es),
      display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: true, colorAssist: true },
    });
    expect(creates.n).toBeGreaterThan(0);
  });
});
