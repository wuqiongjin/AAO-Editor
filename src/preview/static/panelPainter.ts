// 面板出图器（chart-preview 03）：**一份共享的离屏渲染目标**逐面板代画。
//
// 为什么共享（research §3.4 的待设计点，2026-09-30 定案）：每个面板各建一个 `RenderTarget`
// 就等于各带两层离屏缓存，内存按面板数叠加（3 分钟谱 45 面板 ≈ 180MB+）；共享后常驻内存 =
// 一份缓存（屏幕层 + pos 条带 + 音符瓦片 ≤64MB）+ 各面板自己的显示 canvas（45 × 130×537 @dpr2 ≈ 50MB）。
// 代价：相邻面板的 pos 条带会互相顶掉（每面板重建一次网格条带）—— 一次性出图，可接受。
//
// 面板里画的**就是**编辑器那套渲染（`renderChart` / `RenderTarget`）：不新写第二种画笔（ADR-0016 §2）。
import { createRenderTarget, bufferSizeFor, type FrameView, type HoverPos, type RenderDisplayOptions } from '../../rendering';
import { LANES, LANE_WIDTH, TRACK_CHROME_TOTAL } from '../../chart/geometry/ChartGeometry';
import type { AppSettings } from '../../chart/config/AppSettings';
import type { ChartNote, SelectionItem } from '../../chart/types';
import type { ActiveNoteIcons } from '../../rendering/skin/noteSkin';
import type CanvasSpriteIcon from '../../ui/CanvasSpriteIcon';
import { panelScrollY, type PanelLayout } from './panelLayout';

/**
 * 面板要画的**那一份谱面**（视图与导出共用同一套字段定义）：
 * 谱面 + 作者画布设置 + 当前细分档。`subBeat` 的单位就是 `1/beatDisplay`（与工作台同值，
 * 换值会挪音符），这条口径只在这里说一次，两处消费点不再各写一遍。
 */
export interface PanelSceneInput {
  notes: ChartNote[];
  /** 谱面长度（秒，ADR-0005 第一性） */
  chartDuration: number;
  verticalRatio: number;
  beatDisplay: number;
  /** 作者的画布显示设置（settings.display）：音符大小 / 轨道主题等跟作者走 */
  settingsDisplay: AppSettings['display'];
  /** 作者的音符皮肤选择（settings.visual.noteSkin） */
  noteSkin: AppSettings['visual']['noteSkin'];
}

export interface PanelPainterParams {
  /** 面板模型（含 geometry / es / 面板尺寸 / 窗口长度） */
  layout: PanelLayout;
  /** 已叠加预览显示档的显示参数（见 `displayProfile.ts`） */
  display: RenderDisplayOptions;
  /** 谱面 + 细分档 + 皮肤图标（`display` 之外的那部分渲染输入） */
  scene: PanelSceneInput;
  noteIcons: ActiveNoteIcons;
  spriteIcon: CanvasSpriteIcon;
  /** 出图密度（预览 = 画布 dpr；导出 = 固定档，不读窗口） */
  dpr: number;
  /** 皮肤图集就绪版本：进 `FrameView`（瓦片失效依据），也当画家身份的一部分 —— 图集到位后已出图的面板会重画 */
  skinVersion?: number;
  /** 离屏画布工厂（测试注入假位图；缺省 `document.createElement('canvas')`） */
  createCanvas?: () => HTMLCanvasElement;
}

/** 出图器工厂：生产用真渲染；视图测试注入记录型替身（画面组件唯一的绘制接缝） */
export type PanelPainterFactory = (params: PanelPainterParams) => PanelPainter;

export interface PanelPainter {
  readonly panelW: number;
  readonly panelH: number;
  readonly es: number;
  /** 面板位图缓冲尺寸（px）= 面板 CSS 尺寸 × dpr：**画家自己的账**，调用方按它设画布缓冲 */
  readonly bufferW: number;
  readonly bufferH: number;
  /**
   * 出面板 k 的图并 blit 到 `dest` 的 (x, y)（CSS px）。
   * `dest` 需已按**本画家 dpr** 设好 transform；`dest` 为 null（画布不可用）只出图不落地。
   * `hover` = 面板局部指针位置（`null` = 无 hover）：读数仍由渲染域同一份实现画（ADR-0016 §2）。
   */
  blitInto(
    panelIndex: number,
    dest: CanvasRenderingContext2D | null,
    x: number,
    y: number,
    hover?: HoverPos | null,
  ): void;
}

const EMPTY_NOTES: ChartNote[] = [];
const EMPTY_SELECTION: SelectionItem[] = [];

const defaultCreateCanvas = (): HTMLCanvasElement => document.createElement('canvas');

export function createPanelPainter(params: PanelPainterParams): PanelPainter {
  const { layout, scene, display, noteIcons, spriteIcon, dpr } = params;
  const { notes, beatDisplay } = scene;
  const { geometry, panelW, panelH, es } = layout;
  const surface = { w: panelW, h: panelH };
  const scratch = (params.createCanvas ?? defaultCreateCanvas)();
  const target = createRenderTarget({ canvas: scratch, surface, dpr });
  // blit 源矩形取位图整数尺寸（与 bufferSizeFor 同口径），目标矩形是 CSS 尺寸
  const { w: bufferW, h: bufferH } = bufferSizeFor(surface, dpr);
  const virtualWidth = LANES * LANE_WIDTH + TRACK_CHROME_TOTAL * 2;

  function blitInto(
    panelIndex: number,
    dest: CanvasRenderingContext2D | null,
    x: number,
    y: number,
    hover: HoverPos | null = null,
  ): void {
    const view: FrameView = {
      geometry,
      viewport: {
        scrollX: 0,
        scrollY: panelScrollY(layout, panelIndex),
        scale: es,
        virtualWidth,
        virtualHeight: geometry.chartEndVirtualY + layout.windowVirtualY,
      },
      beatDisplay,
      chartEndBeat: geometry.chartEndBeat,
      notes,
      selectedItems: EMPTY_SELECTION,
      selectionBox: null,
      slideBuffer: null,
      hoverPos: hover,
      clipboard: EMPTY_NOTES,
      markerSeconds: null,
      armedTool: null,
      spriteIcon,
      noteIcons,
      skinVersion: params.skinVersion,
      display,
      // 背景皮肤不进预览面板（chart-preview 03）：它是 chrome 侧的装饰，在 130px 面板里反而盖住轨道；
      // 面板只承载"轨道 + 网格 + 音符"（与 Bestdori 静态预览同取舍）。
    };
    target.renderFrame(view);
    if (!dest) return;
    dest.drawImage(scratch, 0, 0, bufferW, bufferH, x, y, panelW, panelH);
  }

  return { panelW, panelH, es, bufferW, bufferH, blitInto };
}
