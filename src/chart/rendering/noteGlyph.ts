// 工作台工具栏音符小图标的**绘制几何**（issue 86；纯模块，与 React 组件分开放，
// 一是让 fast-refresh 规则干净，二是让单测能在 node 环境直接跑构图断言）。
//
// 与素材页 / 谱面画布**同一套音符皮肤**：同一份 `ActiveNoteIcons`（由 `settings.visual.noteSkin` 解析）
// + 同一个 `CanvasSpriteIcon` 绘制器 → "素材相同、朝向相同、换肤联动"是结构保证。
//
// 与素材页 `NoteSkinPreview` 的差别只在**构图尺寸**：素材页是 140×88 大方格（本体放大 1.5~1.6 倍、
// 滑条还带中间结点），直接缩到小尺寸会糊成一团。这里按字形盒重排（工具栏 28px）：
//   - 键型本体：设计 36×21.6 等比铺满；flick 仍挂素材页同款顶部箭头（几何由墨迹数据推导）；
//   - 方向键：本体 + 最外侧箭头**整组**——本体 = 键型本体 × `DIR_BODY_BOOST`（比其它音符显大一点），
//     箭头多出的宽度由加宽的字形盒承担（见 glyphBox）；按**整组墨迹中心**居中 + `DIR_INK_BALANCE`
//     补偿（本体居中会让墨迹整体偏箭头一侧，与上方单键的对称构图不齐）；
//   - 滑条：**只画"段"（连接带）**，不画起止端点音符；纵向铺满字形盒，
//     带宽 = 键型本体宽 × 30:36（`SLIDE_BAND_TO_NODE_RATIO`，与素材页预览/画布同口径）。
// 本模块**不写死任何素材坐标**：所有几何都从 `ActiveNoteIcons` 读取 → 换皮肤自动跟随。
import type CanvasSpriteIcon from '../../ui/CanvasSpriteIcon';
import type { ActiveNoteIcons, NoteSkinItemId } from '../../visual/noteSkin';
import { SLIDE_BAND_TO_NODE_RATIO } from '../../visual/noteMetrics';

/** 主音符 / 方向键本体设计尺寸（与 `noteSkin.NOTE_SKIN_GEOMETRY` 同源） */
const MAIN_W = 36;
const MAIN_H = 21.6;
const DIR_W = 45;
const DIR_H_RATIO = 0.33;

/**
 * 方向键视觉调参（工具栏字形专用，不影响画布/素材页；随目测验收迭代）：
 * - `DIR_BODY_BOOST`：方向键本体相对键型音符的放大倍率（>1 = 比其它音符显大一点）。
 * - `DIR_INK_BALANCE`：整组墨迹的对中补偿系数 —— 0 = 本体居中（墨迹偏箭头侧）、
 *   0.5 = 按墨迹几何中心居中、1 = 补偿到本体贴盒内缘（上限）。
 */
export const DIR_BODY_BOOST = 1.1;
export const DIR_INK_BALANCE = 0.9;

/**
 * 滑条字形的绘制几何（设计 px，随 size 缩放，导出供单测）。
 * 只画"段"（连接带）：纵向铺满字形盒（上下各留 1px 呼吸），
 * 带宽 = 键型本体宽（usable）× 30/36 —— 与真实画布/素材页预览同口径。
 */
export function slideGlyphGeometry(size: number): { bandW: number; bandH: number } {
  const usable = size - 2;
  return { bandW: usable * SLIDE_BAND_TO_NODE_RATIO, bandH: usable };
}

/**
 * 工具栏可画的字形项 = 音符皮肤六条目 **+ 曲线工具**（issue 114）。
 * `'curve'` **不是皮肤条目**（`NoteSkinItemId` 六条目定义不动）——它只是借用 SP 带材质
 * `slideBandSp`（`longNoteLine2`）画一条弯带的**工具图标**。
 */
export type ToolGlyphItem = NoteSkinItemId | 'curve';

/**
 * 曲线字形：带宽相对滑条带宽的收缩系数（issue 114 调参）。
 * 收缩腾出的横向余量即为 S 形摆幅——不收缩的话 28px 下带宽就吃满方框，弯了也看不出来。
 */
export const CURVE_BAND_WIDTH_RATIO = 0.62;

/** 曲线字形绘制几何（设计 px）：纵向铺满字形盒，带宽 × 摆幅恰好占满横向可用区 */
export function curveGlyphGeometry(size: number): { bandW: number; bandH: number; amplitude: number } {
  const usable = size - 2;
  const bandW = usable * SLIDE_BAND_TO_NODE_RATIO * CURVE_BAND_WIDTH_RATIO;
  return { bandW, bandH: usable, amplitude: Math.max(0, (usable - bandW) / 2) };
}

/** 曲线字形中心线（S 形）：一个完整正弦周期，两端回到中线（t = 纵向进度 0..1 → 横向偏移 -1..1） */
export function curveGlyphSway(t: number): number {
  return Math.sin(2 * Math.PI * t);
}

/**
 * 画曲线字形：**只画一段弯的 SP 带，不画端点**（issue 114 定案）。
 * 材质取 `slideBandSp`（与画布 SP 段同源，换肤联动；包缺该素材时 noteSkin 已回退普通带）。
 * 逐行铺带：每一行横向取素材的完整横截面（暗心 + 亮缘），纵向只占一行 → 得到沿中心线弯曲的带子。
 */
export function drawCurveGlyph(
  ctx: CanvasRenderingContext2D,
  sprite: CanvasSpriteIcon,
  icons: ActiveNoteIcons,
  w: number,
  h: number,
): void {
  const size = Math.min(w, h);
  const { bandW, bandH, amplitude } = curveGlyphGeometry(size);
  const cx = w / 2;
  const top = h / 2 - bandH / 2;
  const rows = Math.max(8, Math.round(bandH));
  const rowH = bandH / rows;
  const band = icons.slideBandSp;
  for (let i = 0; i < rows; i++) {
    const t = (i + 0.5) / rows;
    sprite.render(ctx, {
      ...band,
      canvasX: cx + curveGlyphSway(t) * amplitude,
      canvasY: top + (i + 0.5) * rowH,
      canvasSize: bandW,
      canvasWidth: bandW,
      // 行高多留 0.5px：相邻行轻微交叠，消除缩绘留下的 1px 接缝（同色叠合无痕）
      canvasHeight: rowH + 0.5,
      scale: 1,
      renderLayer: 'main',
    });
  }
}

/** 方向键整组横向半宽（设计 px）：len=1 时 offsetVirtualX=0，只剩箭头中线外推 + 箭头半宽，本体半宽兜底 */
function dirGroupHalfW(icons: ActiveNoteIcons, item: 'dirL' | 'dirR'): number {
  const chevron = icons.dirGroup(item === 'dirL' ? 'L' : 'R', 1).chevron;
  return Math.max(DIR_W / 2, chevron ? Math.abs(chevron.extraDesignX) + chevron.drawW / 2 : 0);
}

/**
 * 字形绘制盒（设计 px，导出供组件与单测）。
 * 方向键本体 = 键型本体宽 × `DIR_BODY_BOOST`（比其它音符显大一点），整组（本体 + 箭头）
 * 需要的宽度由盒子承担 —— W = 整组设计宽 × bodyScale + 两侧各 1px 呼吸，H 与方框同高；
 * 其余条目 = size × size 方框。
 */
export function glyphBox(icons: ActiveNoteIcons, item: ToolGlyphItem, size: number): { w: number; h: number } {
  if (item !== 'dirL' && item !== 'dirR') return { w: size, h: size };
  const halfW = dirGroupHalfW(icons, item);
  const bodyScale = ((size - 2) * DIR_BODY_BOOST) / DIR_W;
  return { w: Math.ceil(2 * halfW * bodyScale) + 2, h: size };
}

/**
 * 绘制一个音符皮肤字形（设计坐标系 = w × h 字形盒，居中；方向键盒的加宽口径见 glyphBox）
 */
export function drawNoteGlyph(
  ctx: CanvasRenderingContext2D,
  sprite: CanvasSpriteIcon,
  icons: ActiveNoteIcons,
  item: ToolGlyphItem,
  w: number,
  h: number,
): void {
  const cx = w / 2;
  const cy = h / 2;
  const usable = Math.min(w, h) - 2; // 边缘各留 1px 呼吸

  // issue 114：曲线工具图标 = 一段弯的 SP 带（无端点），与其余键型图标同为皮肤材质
  if (item === 'curve') {
    drawCurveGlyph(ctx, sprite, icons, w, h);
    return;
  }

  if (item === 'tap' || item === 'skill' || item === 'flick') {
    const icon = item === 'tap' ? icons.tapFor(3) : item === 'skill' ? icons.skillFor(3) : icons.flickFor(3);
    const decorators = item === 'flick' && icons.flickTopDecorator ? [icons.flickTopDecorator] : [];
    sprite.render(ctx, {
      ...icon,
      canvasX: cx, canvasY: cy,
      canvasSize: MAIN_W, canvasWidth: MAIN_W, canvasHeight: MAIN_H,
      scale: usable / MAIN_W,
      decorators,
      renderLayer: 'all',
    });
    return;
  }

  if (item === 'dirL' || item === 'dirR') {
    const type: 'L' | 'R' = item === 'dirL' ? 'L' : 'R';
    const group = icons.dirGroup(type, 1);
    const body = group.bodies[0];
    const chevron = group.chevron;
    const halfW = dirGroupHalfW(icons, item);
    // 整组铺满加宽盒 → 本体 = DIR_W × s = 键型本体 × DIR_BODY_BOOST（比其它音符显大一点）
    const s = (w - 2) / 2 / halfW;
    // 按**整组墨迹中心**居中（补偿系数 DIR_INK_BALANCE）：本体居中时墨迹 =
    // [±(halfW·s), ∓22.5·s]（箭头侧长），视觉重心偏箭头一侧 → 整体向盒中心侧补超额位移。
    const inkShift = (halfW - DIR_W / 2) * s * DIR_INK_BALANCE * (type === 'L' ? 1 : -1);
    sprite.render(ctx, {
      ...body.config,
      canvasX: cx + inkShift, canvasY: cy,
      canvasSize: DIR_W, canvasWidth: DIR_W, canvasHeight: DIR_W * DIR_H_RATIO,
      scale: s,
      renderLayer: 'all',
    });
    if (chevron) {
      sprite.render(ctx, {
        ...chevron.config,
        canvasX: cx + inkShift + (chevron.offsetVirtualX + chevron.extraDesignX) * s, canvasY: cy,
        canvasSize: DIR_W, canvasWidth: chevron.drawW, canvasHeight: chevron.drawH,
        scale: s,
        renderLayer: 'all',
      });
    }
    return;
  }

  // slide：只画"段"（连接带，不画起止端点音符）
  const g = slideGlyphGeometry(Math.min(w, h));
  sprite.render(ctx, {
    ...icons.slideBand,
    canvasX: cx, canvasY: cy,
    canvasSize: g.bandW, canvasWidth: g.bandW, canvasHeight: g.bandH,
    scale: 1,
    renderLayer: 'main',
  });
}
