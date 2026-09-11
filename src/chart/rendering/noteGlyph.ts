// 工作台工具栏音符小图标的**绘制几何**（issue 86；纯模块，与 React 组件分开放，
// 一是让 fast-refresh 规则干净，二是让单测能在 node 环境直接跑构图断言）。
//
// 与素材页 / 谱面画布**同一套音符皮肤**：同一份 `ActiveNoteIcons`（由 `settings.visual.noteSkin` 解析）
// + 同一个 `CanvasSpriteIcon` 绘制器 → "素材相同、朝向相同、换肤联动"是结构保证。
//
// 与素材页 `NoteSkinPreview` 的差别只在**构图尺寸**：素材页是 140×88 大方格（本体放大 1.5~1.6 倍、
// 滑条还带中间结点），直接缩到 18px 会糊成一团。这里按 18px 方框重排：
//   - 键型本体：设计 36×21.6 等比铺满；flick 仍挂素材页同款顶部箭头（几何由墨迹数据推导）；
//   - 方向键：本体 + 最外侧箭头**整组**（箭头外推量与半宽由 `dirGroup` 的墨迹数据推导）铺满方框；
//   - 滑条：竖向连接带 + 上下端点（18px 下省略中间结点，否则三条挤在一起不可辨）。
// 本模块**不写死任何素材坐标**：所有几何都从 `ActiveNoteIcons` 读取 → 换皮肤自动跟随。
import type CanvasSpriteIcon from '../../ui/CanvasSpriteIcon';
import type { ActiveNoteIcons, NoteSkinItemId } from '../../visual/noteSkin';

/** 主音符 / 方向键本体设计尺寸（与 `noteSkin.NOTE_SKIN_GEOMETRY` 同源） */
const MAIN_W = 36;
const MAIN_H = 21.6;
const DIR_W = 45;
const DIR_H_RATIO = 0.33;

/** 滑条小构图的绘制盒（设计 px）：18px 下带子 + 两端点的比例取舍，非素材坐标 */
const SLIDE_BAND_W = 7;
const SLIDE_BAND_H = 9.6;
const SLIDE_END_SCALE = 14 / MAIN_W;

/** 绘制一个音符皮肤字形（设计坐标系 = size × size 方框，居中） */
export function drawNoteGlyph(
  ctx: CanvasRenderingContext2D,
  sprite: CanvasSpriteIcon,
  icons: ActiveNoteIcons,
  item: NoteSkinItemId,
  size: number,
): void {
  const cx = size / 2;
  const cy = size / 2;
  const usable = size - 2; // 两侧各留 1px 呼吸

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
    // 整组横向半宽（设计 px）：len=1 时 offsetVirtualX=0，只剩箭头中线外推 + 箭头半宽，本体半宽兜底
    const halfW = Math.max(
      DIR_W / 2,
      chevron ? Math.abs(chevron.extraDesignX) + chevron.drawW / 2 : 0,
    );
    const s = usable / 2 / halfW;
    sprite.render(ctx, {
      ...body.config,
      canvasX: cx, canvasY: cy,
      canvasSize: DIR_W, canvasWidth: DIR_W, canvasHeight: DIR_W * DIR_H_RATIO,
      scale: s,
      renderLayer: 'all',
    });
    if (chevron) {
      sprite.render(ctx, {
        ...chevron.config,
        canvasX: cx + (chevron.offsetVirtualX + chevron.extraDesignX) * s, canvasY: cy,
        canvasSize: DIR_W, canvasWidth: chevron.drawW, canvasHeight: chevron.drawH,
        scale: s,
        renderLayer: 'all',
      });
    }
    return;
  }

  // slide：竖向连接带 + 上下端点
  const endDrawW = MAIN_W * SLIDE_END_SCALE;
  const half = SLIDE_BAND_H / 2;
  const bandVisualW = Math.min(SLIDE_BAND_W, endDrawW);
  sprite.render(ctx, {
    ...icons.slideBand,
    canvasX: cx, canvasY: cy,
    canvasSize: bandVisualW, canvasWidth: bandVisualW, canvasHeight: SLIDE_BAND_H,
    scale: 1,
    renderLayer: 'main',
  });
  for (const y of [cy - half, cy + half]) {
    sprite.render(ctx, {
      ...icons.slideEndpointFor(3),
      canvasX: cx, canvasY: y,
      canvasSize: MAIN_W, canvasWidth: MAIN_W, canvasHeight: MAIN_H,
      scale: SLIDE_END_SCALE,
      renderLayer: 'main',
    });
  }
}
