// 综合预览单格绘制（issue 29 Q8=B）。从 NoteSkinPreview 抽出，供整包预设缩略复用（issue 42）。
// 组件文件不能导出函数（react-refresh/only-export-components）。
import type CanvasSpriteIcon from '../../ui/CanvasSpriteIcon';
import type { ActiveNoteIcons, NoteSkinItemId } from './noteSkin';
import { computeSlideColLayout, SLIDE_PREVIEW_NODE_SCALE } from './noteSkinPreviewLayout';

export function drawPreviewSprite(
  ctx: CanvasRenderingContext2D,
  sprite: CanvasSpriteIcon,
  icons: ActiveNoteIcons,
  item: NoteSkinItemId,
  W: number,
  H: number,
) {
  const cx = W * 0.5;
  const cy = H * 0.5;
  if (item === 'tap' || item === 'skill') {
    const S = 1.6;
    sprite.render(ctx, {
      ...(item === 'tap' ? icons.tapFor(3) : icons.skillFor(3)),
      canvasX: cx, canvasY: cy, canvasSize: 36,
      canvasWidth: 36, canvasHeight: 21.6, scale: S, renderLayer: 'all',
    });
    return;
  }
  if (item === 'flick') {
    const S = 1.6;
    sprite.render(ctx, {
      ...icons.flickFor(3),
      decorators: icons.flickTopDecorator ? [icons.flickTopDecorator] : [],
      canvasX: cx, canvasY: cy, canvasSize: 36,
      canvasWidth: 36, canvasHeight: 21.6, scale: S, renderLayer: 'all',
    });
    return;
  }
  if (item === 'dirL' || item === 'dirR') {
    const type: 'L' | 'R' = item === 'dirL' ? 'L' : 'R';
    const S_DIR = 1.5;
    const group = icons.dirGroup(type, 1);
    sprite.render(ctx, {
      ...group.bodies[0].config,
      canvasX: cx, canvasY: cy, canvasSize: 45,
      canvasWidth: 45, canvasHeight: 45 * 0.33, scale: S_DIR, renderLayer: 'all',
    });
    const cv = group.chevron;
    if (cv) {
      sprite.render(ctx, {
        ...cv.config,
        canvasX: cx + (cv.offsetVirtualX + cv.extraDesignX) * S_DIR, canvasY: cy, canvasSize: 45,
        canvasWidth: cv.drawW, canvasHeight: cv.drawH, scale: S_DIR, renderLayer: 'all',
      });
    }
    return;
  }
  if (item === 'slide') {
    const layout = computeSlideColLayout(W, H);
    sprite.render(ctx, {
      ...icons.slideBand,
      canvasX: layout.cx, canvasY: (layout.topY + layout.bottomY) / 2, canvasSize: Math.max(layout.bandW, layout.bandH),
      canvasWidth: layout.bandW, canvasHeight: layout.bandH, scale: 1, renderLayer: 'main',
    });
    sprite.render(ctx, {
      ...icons.slideEndpointFor(3),
      canvasX: layout.cx, canvasY: layout.topY, canvasSize: 36,
      canvasWidth: 36, canvasHeight: 21.6, scale: SLIDE_PREVIEW_NODE_SCALE, renderLayer: 'main',
    });
    sprite.render(ctx, {
      ...icons.slideAmongFor(3),
      canvasX: layout.cx, canvasY: layout.midY, canvasSize: 36,
      canvasWidth: 36, canvasHeight: 21.6, scale: SLIDE_PREVIEW_NODE_SCALE, renderLayer: 'main',
    });
    sprite.render(ctx, {
      ...icons.slideEndpointFor(3),
      canvasX: layout.cx, canvasY: layout.bottomY, canvasSize: 36,
      canvasWidth: 36, canvasHeight: 21.6, scale: SLIDE_PREVIEW_NODE_SCALE, renderLayer: 'main',
    });
  }
}
