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
  /** 字号（px）：宽度/可见性判定与命中盒共用 */
  fontPx: number;
}

const GUTTER_LABEL_FONT = (px: number) => `600 ${px}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

/**
 * 沟槽文字宽度（等宽字体）：给 ctx 就精确测量，否则按 0.62em 估算。
 * **绘制与命中判定必须共用本函数**，否则沟槽宽度临界时会出现"已隐藏但仍可点中"的隐形热区。
 */
export function measureGutterLabelWidth(
  text: string,
  fontPx: number,
  ctx?: CanvasRenderingContext2D | null,
): number {
  const measured = ctx ? (ctx.font = GUTTER_LABEL_FONT(fontPx), ctx.measureText(text)?.width ?? 0) : 0;
  return measured > 0 ? measured : Math.max((text.length || 3) * fontPx * 0.62, fontPx);
}

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
    fontPx,
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
  // 与命中判定共用同一套宽度/可见性判定（measureGutterLabelWidth）
  const textWidth = measureGutterLabelWidth(text, layout.fontPx ?? GUTTER_LABEL_FONT_PX, ctx);
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

/**
 * 就地警示后缀（挂在 BPM 数值之后；issue 142 —— 末条 BPM 为负，导出后 Bestdori 打不开）。
 * 用 ASCII `!` 而非 `⚠`：沟槽文字走等宽字体栈，emoji/符号字形在部分平台会掉成方框。
 */
export const BPM_TAIL_WARNING_MARK = ' !';

/**
 * BPM 沟槽数值文字 —— **绘制与命中盒共用同一串**，宽度判定才不会错位
 * （`bpmLabelBox` 按这串文字量宽度；命中判定见 `hitBpmLabelAt`）。
 */
export function bpmLabelText(bpm: number, isTrailingNegative: boolean): string {
  return isTrailingNegative ? `${bpm}${BPM_TAIL_WARNING_MARK}` : String(bpm);
}

/**
 * BPM 数值文字盒（§5 手势仲裁修订 2026-09-08）：**只认数字自身的横向范围**，
 * 不再把整条水平线都判成命中（否则左沟槽双击/单击在数字所在高度上永远吃不掉起点标记手势）。
 * 与 §5 就地编辑输入框同款宽度估算（等宽字体 0.62em + 8px 内边距，最少 2 字宽），
 * 右缘 = 内带锚点（轨道左外缘 − BPM_LABEL_GAP_PX）+ 少量容差；纵向与绘制同款居中 + 容差，
 * 并沿用 clampGutterLabelY 的钳制（画布顶/底缘文字被推回时命中区同步）。
 * 纯函数（不依赖 canvas 测量），供命中判定与单测共用。
 */
export function bpmLabelBox(
  trackStartX: number,
  lineCanvasY: number,
  text: string,
  labelScale = 1,
  surfaceH?: number,
  /** 文字宽度：由 measureGutterLabelWidth 给出（可传画布 ctx 精确测量），与绘制端同一套判定 */
  textWidth?: number,
): { x1: number; x2: number; y1: number; y2: number } {
  const fontPx = Math.round(GUTTER_LABEL_FONT_PX * labelScale);
  const right = trackStartX - BPM_LABEL_GAP_PX;
  const width = (textWidth ?? measureGutterLabelWidth(text, fontPx)) + 8;
  const y = surfaceH === undefined
    ? lineCanvasY
    : Math.min(Math.max(lineCanvasY, fontPx / 2), Math.max(surfaceH - fontPx / 2, fontPx / 2));
  const half = fontPx / 2 + 4;
  const y1 = Math.max(y - half, 0);
  const y2 = surfaceH === undefined ? y + half : Math.min(y + half, surfaceH);
  return { x1: right - width, x2: right + 4, y1, y2 };
}
