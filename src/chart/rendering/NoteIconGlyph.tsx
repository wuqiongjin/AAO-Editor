// 工作台工具栏音符小图标（issue 86）：把当前音符皮肤的一个条目画进字形盒画布。
// 绘制几何在纯模块 `./noteGlyph`（同一套 ActiveNoteIcons + CanvasSpriteIcon，换肤自动跟随）；
// 方向键的字形盒按"本体与键型等大 × DIR_BODY_BOOST"加宽，其余条目为 size × size 方框。
import { useEffect, useRef } from 'react';
import CanvasSpriteIcon from '../../ui/CanvasSpriteIcon';
import type { ActiveNoteIcons, NoteSkinItemId } from '../../visual/noteSkin';
import { drawNoteGlyph, glyphBox } from './noteGlyph';

/** 画布内部固定超采样倍率：与运行时 dpr 解耦（dpr 随浏览器缩放变化且不触发本组件重绘，
 *  跟随 dpr 会在缩放后留下低清位图被拉伸）；固定 3× 后任意 ≤300% 缩放都从同一高清 backing 采样。 */
const BACKING_SCALE = 3;

/**
 * `icons` 由调用方用 `useMemo` 缓存（引用变化 = 换肤），图片未就绪时先预热再绘制。
 * 缺图不阻断（按缺图渲染，与画布侧口径一致）。
 */
export default function NoteIconGlyph({
  icons,
  item,
  size = 18,
}: {
  icons: ActiveNoteIcons;
  item: NoteSkinItemId;
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = glyphBox(icons, item, size); // 渲染期算一次供 style；effect 内对同输入重算（纯函数、廉价）

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { w, h } = glyphBox(icons, item, size);
    canvas.width = Math.round(w * BACKING_SCALE);
    canvas.height = Math.round(h * BACKING_SCALE);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let cancelled = false;
    const sprite = new CanvasSpriteIcon();
    const paint = () => {
      if (cancelled) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(BACKING_SCALE, 0, 0, BACKING_SCALE, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      drawNoteGlyph(ctx, sprite, icons, item, w, h);
    };
    CanvasSpriteIcon.ensureImagesLoaded(icons.preloadSrcs())
      .catch(() => undefined)
      .then(paint);
    return () => { cancelled = true; };
  }, [icons, item, size]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{ width: box.w, height: box.h, display: 'block' }}
    />
  );
}
