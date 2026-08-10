// 渲染器与命中测试的共享类型（ADR-0003 候选 B）：
// 把 FinalVirtualCanvas 的「渲染 + 命中」从组件闭包中提出为可注入依赖的纯模块，
// 组件只保留挂载/生命周期/事件绑定，性能热路径集中于此、可独立单测。
import type { ChartNote, SelectionItem } from '../notes/Charts';
import type { ChartGeometry } from '../utils/ChartGeometry';
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
}
