// 外侧装饰文字系统（issue 51 grill 定案 2026-09-06；同日第二轮修订）：
// 贴轨道外缘、恒定 CSS 像素间距与字号的画布标注文字体系。
// 双带制（第二轮 Q2=A）：BPM 数值贴轨道（内带），START/END 远离轨道（外带）——水平分带互不抢占，
// BPM 数值在端点处恒定居中（不再让位/堆叠）。
// 字号（第二轮 Q1=A）：基准 14px × settings.display.labelScale（50%..300%），缩放中恒定。
// 实时显示线两侧信息（issue 54）是"实时信息文字"另一类样式（11px 基准、等宽、中性白），
// 不走本模块字号，只复用沟槽锚定思想。
import type { Coords } from './coords';

/** 内带：BPM 数值右缘距轨道左外缘的恒定间距 */
export const BPM_LABEL_GAP_PX = 8;
/** 常显标线文字基准字号（× labelScale；缩放中恒定，如轨道外装饰）。
 *  第二轮补修订：默认形态即原 150% 观感 → 基准 14→21px（labelScale 100% = 21px） */
export const GUTTER_LABEL_FONT_PX = 21;
/** 文字与所标注线条的纵向间隙（above/below 时）。第三轮：0——与 BPM 数值骑线（居中、
 *  距离 0）的观感一致，START/END 文字盒贴线 */
export const GUTTER_LABEL_LINE_GAP_PX = 0;

/** 沟槽文字分带：bpm = 内带（BPM 数值）、bound = 外带（START/END） */
export type GutterBand = 'bpm' | 'bound';

/**
 * 外带间距（动态，随文字大小系数放大）：BPM 数值最多 3 位数字，外带必须让其出
 * 内带文字盒 + 间隔，保证双带在任何 labelScale 下都不重叠（第二轮 Q2=A）。
 */
export function boundLabelGapPx(labelScale: number): number {
  return BPM_LABEL_GAP_PX + Math.ceil(GUTTER_LABEL_FONT_PX * labelScale * 2.2) + 8;
} // labelScale=1 → 63px

/** 常显标线文字的纵向位置语义：垂直居中于线（BPM 数值）/ 线上方（START）/ 线下方（END） */
export type GutterLabelPlacement = 'centered' | 'above' | 'below';

export interface GutterLabelLayout {
  x: number;
  y: number;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  font: string;
}

const GUTTER_LABEL_FONT = (px: number) => `600 ${px}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

/**
 * 常显标线文字的锚定布局（纯函数，供单测）：
 * 右对齐到「轨道左外缘 − 分带间距」，纵向按 placement 相对 lineCanvasY 定位，
 * 字号 = 带基准 × labelScale（恒定 CSS 像素，缩放中距离与大小不变）。
 */
export function layoutGutterLabel(
  c: Coords,
  scale: number,
  lineCanvasY: number,
  placement: GutterLabelPlacement,
  band: GutterBand = 'bpm',
  labelScale = 1,
): GutterLabelLayout {
  const { trackStartX } = c.trackGeometry(scale);
  const gap = band === 'bpm' ? BPM_LABEL_GAP_PX : boundLabelGapPx(labelScale);
  const fontPx = Math.round(GUTTER_LABEL_FONT_PX * labelScale);
  const base: GutterLabelLayout = {
    x: trackStartX - gap,
    y: lineCanvasY,
    textAlign: 'right',
    textBaseline: 'middle',
    font: GUTTER_LABEL_FONT(fontPx),
  };
  if (placement === 'above') {
    // alphabetic 基线 = 大写墨迹底正好压线（'bottom' 基线含下伸空间，墨迹会悬空 ~5px）
    base.y = lineCanvasY - GUTTER_LABEL_LINE_GAP_PX;
    base.textBaseline = 'alphabetic';
  } else if (placement === 'below') {
    base.y = lineCanvasY + GUTTER_LABEL_LINE_GAP_PX;
    base.textBaseline = 'top';
  }
  return base;
}

/**
 * 按 layout 绘制一枚外侧装饰文字（薄封装；布局数学见 layoutGutterLabel）。
 * 沟槽宽度不足（文字盒左缘越出画布）时整体隐藏——优雅降级（第二轮 Q2 定案）。
 * 返回是否实际绘制。
 */
export function drawGutterLabel(ctx: CanvasRenderingContext2D, layout: GutterLabelLayout, text: string, color: string): boolean {
  ctx.save();
  ctx.font = layout.font;
  const textWidth = ctx.measureText(text)?.width ?? 0;
  if (layout.x - textWidth < 0) {
    ctx.restore();
    return false;
  }
  ctx.fillStyle = color;
  ctx.textAlign = layout.textAlign;
  ctx.textBaseline = layout.textBaseline;
  ctx.fillText(text, layout.x, layout.y);
  ctx.restore();
  return true;
}

/** 文字盒纵向钳制（纯函数）：把 layout.y 钳入画布，保证文字盒完整可见（"都在谱面范围内"） */
export function clampGutterLabelY(layout: GutterLabelLayout, surfaceH: number, fontPx: number): GutterLabelLayout {
  const half = fontPx / 2;
  if (layout.textBaseline === 'middle') layout.y = Math.min(Math.max(layout.y, half), surfaceH - half);
  else if (layout.textBaseline === 'top') layout.y = Math.min(Math.max(layout.y, 0), surfaceH - fontPx);
  else layout.y = Math.min(Math.max(layout.y, fontPx), surfaceH); // bottom / alphabetic：基线最低=画布底缘
  return layout;
}
