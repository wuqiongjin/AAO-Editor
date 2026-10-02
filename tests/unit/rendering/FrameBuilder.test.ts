// 08 票（架构评审候选 3）锁测：**帧 = target × view**。
// - frameFor(target, view)：surface/dpr 由 target 注入，其余字段逐条透传（同引用）；
// - renderFrame(view)：一次调用完成缓冲尺寸 + transform + 两层缓存绘制；
// - resolveCanvasDpr / bufferSizeFor：dpr 策略与位图尺寸的唯一实现处（取值口径原样保留）。
import { describe, expect, it } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { createRenderTarget, type RenderTarget } from '@/src/rendering/RenderTarget';
import { frameFor } from '@/src/rendering/render';
import { resolveCanvasDpr, bufferSizeFor, imageQualityDensity, imageQualitySupersample } from '@/src/rendering/rasterScale';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import { makeCanvasStub, makeRecordingCtx, makeTallyingCanvasStub } from '@/tests/support/canvas';
import type { FrameView } from '@/src/rendering/types';
import type { ChartNote } from '@/src/chart/types';

const SURFACE = { w: 750, h: 900 };
const DPR = 2;
const BPM = [{ beat: 0, bpm: 120 }];
const SHARED_NOTE_ICONS = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));

function makeView(): FrameView {
  const g = new ChartGeometry(BPM, { endBeat: 64 }, SURFACE);
  const notes: ChartNote[] = [
    { beat: 0, type: 'BPM', bpm: 120 },
    { type: 'Single', lane: 3, beat: 16, subBeat: 0 },
  ];
  const scrollY = g.beatToVirtualY(16, 0.5) - SURFACE.h / (2 * 0.5);
  return {
    geometry: g,
    viewport: { scrollX: 0, scrollY, scale: 0.5, virtualWidth: 0, virtualHeight: 0 },
    beatDisplay: 4,
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

function makeTarget(ctx: CanvasRenderingContext2D | null, dpr = DPR): RenderTarget {
  const target = createRenderTarget({
    canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement,
    surface: SURFACE,
    dpr,
  });
  target.noteLayer.__setCanvasFactoryForTests(() => makeCanvasStub({ drawImage: 0 }));
  target.staticLayer.__setCanvasFactoryForTests(() => makeCanvasStub({ drawImage: 0 }));
  return target;
}

describe('08 · 帧构建者（frameFor / renderFrame）', () => {
  it('frameFor：surface/dpr 来自 target，view 字段逐条透传（同引用，不深拷贝）', () => {
    const { proxy } = makeRecordingCtx();
    const target = makeTarget(proxy);
    const view = makeView();

    const rc = frameFor(target, view);
    expect(rc.surface).toBe(SURFACE);
    expect(rc.dpr).toBe(DPR);
    expect(rc.notes).toBe(view.notes);
    expect(rc.geometry).toBe(view.geometry);
    expect(rc.viewport).toBe(view.viewport);
    expect(rc.selectedItems).toBe(view.selectedItems);
    expect(rc.armedTool).toBe(view.armedTool);
    expect(rc.noteIcons).toBe(view.noteIcons);
  });

  it('renderFrame：一次调用完成 缓冲 = surface×dpr + setTransform(dpr) + 静态层/音符层各绘一次', () => {
    const { proxy, calls } = makeRecordingCtx();
    const target = makeTarget(proxy);
    const staticDraws = { n: 0 };
    target.staticLayer.__setCanvasFactoryForTests(() =>
      makeTallyingCanvasStub(() => { staticDraws.n++; }, ['stroke', 'fillText']));
    target.renderFrame(makeView());

    expect(target.canvas.width).toBe(Math.round(SURFACE.w * DPR));
    expect(target.canvas.height).toBe(Math.round(SURFACE.h * DPR));
    expect(calls).toContainEqual(['setTransform', [DPR, 0, 0, DPR, 0, 0]]);
    // 静态层确实建/画了位图（屏幕层 + pos 条带的重建笔数）
    expect(staticDraws.n).toBeGreaterThan(0);
    // 音符层确实出了一帧：瓦片 blit 有数（不只是 stats 初值）
    const stats = target.noteLayer.__getLastNoteLayerStats();
    expect(stats.layerMode).toBe('tiles');
    expect(stats.blitted).toBeGreaterThan(0);
    // 主画布上的静态层 blit（屏幕层 + 条带）
    expect(calls.filter(([k]) => k === 'drawImage').length).toBeGreaterThanOrEqual(2);
  });

  it('renderFrame：画布不可用（无 2d 上下文）时 no-op、不抛', () => {
    const target = makeTarget(null);
    expect(() => target.renderFrame(makeView())).not.toThrow();
  });

  it('context() 懒解析并缓存同一实例', () => {
    let calls = 0;
    const { proxy } = makeRecordingCtx();
    const target = createRenderTarget({
      canvas: {
        width: 0, height: 0,
        getContext: () => { calls++; return proxy; },
      } as unknown as HTMLCanvasElement,
      surface: SURFACE,
      dpr: 1,
    });
    expect(target.context()).toBe(proxy);
    expect(target.context()).toBe(proxy);
    expect(calls).toBe(1);
  });
});

describe('08 · dpr / 缓冲尺寸解析唯一处（rasterScale）', () => {
  it('resolveCanvasDpr：流畅 1× / 标准 2× / 高清 4×（整数密度阶梯），且不超设备像素比', () => {
    expect(resolveCanvasDpr('smooth', 4)).toBe(1);
    expect(resolveCanvasDpr('standard', 4)).toBe(2);
    expect(resolveCanvasDpr('hd', 4)).toBe(4);
    expect(resolveCanvasDpr('hd', 2)).toBe(2);
    expect(resolveCanvasDpr('standard', 1)).toBe(1);
    expect(resolveCanvasDpr('smooth', 1)).toBe(1);
    // 缺省 / 非法档 = 标准（非 smooth/hd 一律 2）
    expect(resolveCanvasDpr(undefined, 3)).toBe(2);
    expect(resolveCanvasDpr('unknown', 3)).toBe(2);
  });

  it('imageQualityDensity：工作台画布档位表（min 上限口径用）', () => {
    expect(imageQualityDensity('smooth')).toBe(1);
    expect(imageQualityDensity('standard')).toBe(2);
    expect(imageQualityDensity('hd')).toBe(4);
    expect(imageQualityDensity(undefined)).toBe(2);   // 缺省 / 非法 = 标准
    expect(imageQualityDensity('unknown')).toBe(2);
    // resolveCanvasDpr 就是它的 min 形态（同一张表，不再各写一份）
    expect(resolveCanvasDpr('hd', 2)).toBe(Math.min(2, imageQualityDensity('hd')));
  });

  it('imageQualitySupersample：静态位图超采样档（ADR-0017 位图:物理 整数比：density = dpr × 它）', () => {
    expect(imageQualitySupersample('smooth')).toBe(1);
    expect(imageQualitySupersample('standard')).toBe(1);
    expect(imageQualitySupersample('hd')).toBe(2);
    expect(imageQualitySupersample(undefined)).toBe(1);   // 缺省 / 非法 = 标准
    expect(imageQualitySupersample('unknown')).toBe(1);
  });

  it('bufferSizeFor：round(css × dpr)（非整宽量化口径：751×1.5 → 1127）', () => {
    expect(bufferSizeFor({ w: 750, h: 900 }, 2)).toEqual({ w: 1500, h: 1800 });
    expect(bufferSizeFor({ w: 751, h: 900 }, 1.5)).toEqual({ w: 1127, h: 1350 });
  });
});
