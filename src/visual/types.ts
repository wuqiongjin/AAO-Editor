// 渲染器与命中测试的共享类型（ADR-0003 候选 B）：
// 把 FinalVirtualCanvas 的「渲染 + 命中」从组件闭包中提出为可注入依赖的纯模块，
// 组件只保留挂载/生命周期/事件绑定，性能热路径集中于此、可独立单测。
import type { ChartNote, SelectionItem } from '../chart/types';
import type { ChartGeometry, SurfaceSize } from '../chart/geometry/ChartGeometry';
import type CanvasSpriteIcon from '../ui/CanvasSpriteIcon';
import type { ActiveNoteIcons } from './noteSkin';
import type { GridStylePreset } from './gridStyle';

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
  /**
   * 悬停命中项（issue 56 c）：由组件在 hoverPos 变化时经 findItemAt 计算注入，
   * 渲染器不每帧跑命中测试（C6）。null/undefined = 未悬停或命中没有反馈的对象。
   */
  hoverItem?: SelectionItem | null;
  clipboard: ChartNote[];
  markerBeat: number | null;
  markerSelected: boolean;
  /** 持工具态（ADR-0008 §1）：null = 指针态。渲染器按此分派幽灵预览（放置/粘贴/镜像） */
  armedTool: string | null;
  /** 拖拽移动实时幽灵（ADR-0008 §6）：拖拽中的落点音符（覆盖原位置渲染的临时结果），null = 无拖拽 */
  dragGhost?: ChartNote[] | null;
  spriteIcon: CanvasSpriteIcon;
  /** 音符皮肤图标集（issue 29）：由组件按 settings.visual.noteSkin 构建注入；换肤时引用变化 → 瓦片经 skinVersion 失效 */
  noteIcons: ActiveNoteIcons;
  /** 缩放手势进行中（issue 10）：true 时离屏瓦片只按比例 blit 不重建，手势结束再高清重渲 */
  zoomGesture?: boolean;
  /** 皮肤图片就绪版本（issue 10）：图片异步加载完成后 +1，避免瓦片缓存命中未出图的旧帧 */
  skinVersion?: number;
  /** 画布显示参数（issue 39 功能设置·画布显示）：由组件从 settings 读取注入，null = 用默认行为 */
  display?: RenderDisplayOptions;
  /** 谱面背景皮肤（issue 29 Q4 最小模型）：enabled×解码就绪时由组件注入；进静态层（cover 铺满 + 不透明度合成），
   *  revision / opacity 变化经 staticLayerCache basis 失效重建。null/undefined = 无背景 */
  background?: RenderBackgroundImage | null;
}

/** 背景皮肤渲染输入：source = 已解码位图（utils/backgroundSkin.ts 解码产物）；opacity/fit/scope 由 settings 提供 */
export interface RenderBackgroundImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** 图片实例版本：换图 +1，静态层据此失效 */
  revision: number;
  /** 图片不透明度（0 = 纯黑画布，1 = 原图全亮）；缺失/非法由渲染器回退默认 */
  opacity?: number;
  /** 填充方式：cover 铺满裁剪（默认）/ contain 完整显示留黑边 */
  fit?: 'cover' | 'contain';
  /** 显示范围：outsideTrack 仅轨道外（默认，轨道区保持原始深色）/ fullCanvas 全画布（轨道区半透明压暗） */
  scope?: 'outsideTrack' | 'fullCanvas';
}

/** 画布显示参数（issue 39）。数值以比例存储（100% = 1）。 */
export interface RenderDisplayOptions {
  /** 节奏图示大小：音符占轨道比例，0.1..2.0（#1） */
  noteSize: number;
  /** 长压线不透明度：slide 线条不透明度，0.1..1.0（#2） */
  slideOpacity: number;
  /** 同时点击线开关：同节拍音符连接线（#3） */
  simultaneousClickLines: boolean;
  /** 色觉辅助开关（#4）：开启后半拍整数倍位置之外的普通 tap 换虚拍款式（仅 Single 主体，不影响 flick/skill） */
  colorAssist?: boolean;
  /** 轨道样式预设（issue 53，第二轮改为颜色主题 灰阶/琥珀/青蓝/多彩）；缺省/非法由渲染器回退 mono */
  gridStyle?: GridStylePreset;
  /** 线形分层开关（issue 53 第二轮 Q3=A，默认关）：开启后按层级叠加虚线形态阶梯 */
  lineShapeTiers?: boolean;
  /** 轨道线透明度系数（issue 53 第三轮补）：0.1..1，与主题分层 alpha 相乘；缺省 1 */
  gridOpacity?: number;
  /** 谱面文字大小系数（issue 51 第二轮 Q1=A）：0.5..3，作用于 BPM 数值/START/END/实时信息 */
  labelScale?: number;
}
