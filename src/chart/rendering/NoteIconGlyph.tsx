// 工作台工具栏音符小图标（issue 86）：把当前音符皮肤的一个条目画进 size × size 的画布。
// 绘制几何在纯模块 `./noteGlyph`（同一套 ActiveNoteIcons + CanvasSpriteIcon，换肤自动跟随）。
import { useEffect, useRef } from 'react';
import CanvasSpriteIcon from '../../ui/CanvasSpriteIcon';
import type { ActiveNoteIcons, NoteSkinItemId } from '../../visual/noteSkin';
import { drawNoteGlyph } from './noteGlyph';

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

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let cancelled = false;
    const sprite = new CanvasSpriteIcon();
    const paint = () => {
      if (cancelled) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawNoteGlyph(ctx, sprite, icons, item, size);
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
      style={{ width: size, height: size, display: 'block' }}
    />
  );
}
