// 渲染器与命中测试的共享类型（ADR-0003 候选 B）：
// 把 FinalVirtualCanvas 的「渲染 + 命中」从组件闭包中提出为可注入依赖的纯模块，
// 组件只保留挂载/生命周期/事件绑定，性能热路径集中于此、可独立单测。
import type { ChartNote, SelectionItem } from '../notes/Charts';
import type { ChartGeometry, SurfaceSize } from '../utils/ChartGeometry';
import type CanvasSpriteIcon from '../components/CanvasSpriteIcon';

/** 视口状态（虚拟尺寸 + 滚动 + 缩放） */
export interface ViewportState {
  scrollX: number;
  scrollY: number;
  scale: number;
  virtualWidth: number;
  virtualHeight: number;
}

export interface SelectionBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SlideBuffer {
  beat: number;
  lane: number;
  subBeat?: number;
}

export interface HoverPos {
  cx: number;
  cy: number;
}

/**
 * 渲染上下文：一次绘制所需的全部输入，显式依赖注入，避免组件闭包捕获。
 * 组件每次 RAF 组装该对象传给 renderChart；本对象不持有任何可变状态。
 */
export interface RenderCtx {
  geometry: ChartGeometry;
  viewport: ViewportState;
  /** 渲染面尺寸（CSS 像素），ADR-0006 §1：随容器变化 */
  surface: SurfaceSize;
  /** 设备像素比（上限 2），ADR-0006 §1：buffer = surface × dpr */
  dpr: number;
  beatDisplay: number;
  chartEndBeat: number;
  notes: ChartNote[];
  selectedItems: SelectionItem[];
  selectionBox: SelectionBox | null;
  slideBuffer: SlideBuffer | null;
  hoverPos: HoverPos | null;
  clipboard: ChartNote[];
  markerBeat: number | null;
  markerSelected: boolean;
  selectedTool: string;
  spriteIcon: CanvasSpriteIcon;
  /** 缩放手势进行中（issue 10）：true 时离屏瓦片只按比例 blit 不重建，手势结束再高清重渲 */
  zoomGesture?: boolean;
  /** 皮肤图片就绪版本（issue 10）：图片异步加载完成后 +1，避免瓦片缓存命中未出图的旧帧 */
  skinVersion?: number;
}
