// 渲染目标（候选 3「一帧只有一个构建者，缓存有主」）：
//
// 一次绘制「画到哪」的全部归属 —— 画布（2d 上下文 + 缓冲尺寸）+ surface + dpr + 两层离屏缓存实例。
// 工作台画布是 target 之一；离屏导出 / 未来预览各建自己的 target，互不顶掉对方的缓存
// （issue 36 F2/F3 的失效语义逐条不变，只是从模块级单例搬进实例）。
//
// 帧 = target × view：
// - target（`createRenderTarget`）：surface / dpr / 缓存 —— 见 `../pipeline/*LayerCache`；
// - view（`FrameView`）：notes / 选区 / 光标 / 显示参数等「画什么」；
// - 装配与绘制在渲染域出口：`frameFor(target, view)` → `RenderCtx`，`target.renderFrame(view)` 一次调用出帧。
import type { SurfaceSize } from '../chart/geometry/ChartGeometry';
import type { FrameView } from './types';
import { createStaticLayerCache, type StaticLayerCache } from './pipeline/staticLayerCache';
import { createNoteLayerCache, type NoteLayerCache } from './pipeline/noteLayerCache';
import { renderChart } from './render';

export interface RenderTargetOptions {
  /** 目标画布（工作台画布 / 离屏导出画布） */
  canvas: HTMLCanvasElement;
  /** 渲染面尺寸（CSS 像素，ADR-0006 §1）；surface 变化经 `configure` 原地更新 */
  surface: SurfaceSize;
  /** 画布 dpr：工作台经 `resolveCanvasDpr(display.imageQuality, devicePixelRatio)` 现算 */
  dpr: number;
}

export interface RenderTarget {
  readonly canvas: HTMLCanvasElement;
  readonly surface: SurfaceSize;
  readonly dpr: number;
  /** 静态层离屏缓存的所有者（测试 / 诊断用；产品绘制经 `renderFrame`） */
  readonly staticLayer: StaticLayerCache;
  /** 音符瓦片缓存的所有者（测试 / 诊断用） */
  readonly noteLayer: NoteLayerCache;
  /** 画布 2d 上下文（懒解析并缓存；null = 画布不可用，绘制 no-op） */
  context(): CanvasRenderingContext2D | null;
  /** surface / dpr 变化原地更新（缓存续用或失效由各层既有 basis 决定，不重建 target） */
  configure(next: { surface?: SurfaceSize; dpr?: number }): void;
  /** 一次调用画一帧（帧装配 + 绘制编排都在渲染域内） */
  renderFrame(view: FrameView): void;
}

export function createRenderTarget(opts: RenderTargetOptions): RenderTarget {
  const { canvas } = opts;
  let surface = opts.surface;
  let dpr = opts.dpr;
  let ctxResolved = false;
  let ctx: CanvasRenderingContext2D | null = null;
  const staticLayer = createStaticLayerCache();
  const noteLayer = createNoteLayerCache();

  const target: RenderTarget = {
    canvas,
    get surface() { return surface; },
    get dpr() { return dpr; },
    staticLayer,
    noteLayer,
    context() {
      if (!ctxResolved) {
        ctx = canvas.getContext('2d');
        ctxResolved = true;
      }
      return ctx;
    },
    configure(next) {
      if (next.surface) surface = next.surface;
      if (next.dpr != null) dpr = next.dpr;
    },
    renderFrame(view) {
      renderChart(target, view);
    },
  };
  return target;
}
