// 整包预设缩略画布（issue 42）：一块画布按该预设会写入的条目绘制。
// 未使用时可点，与「使用此包」同效果；使用中不可点。
import { useEffect, useMemo, useRef } from 'react';
import CanvasSpriteIcon from '../../ui/CanvasSpriteIcon';
import { buildActiveNoteIcons } from './noteSkin';
import { t } from '../../i18n';
import {
  computePresetThumbnailLayout,
  computeThumbnailSpriteTransform,
  PRESET_THUMBNAIL_ASPECT,
  PRESET_THUMBNAIL_CSS_W,
  presetSelection,
  presetThumbnailItems,
} from './noteSkinPresetThumbnail';
import { PREVIEW_CELL_H, PREVIEW_CELL_W } from './noteSkinPreviewLayout';
import { drawPreviewSprite } from './noteSkinPreviewDraw';

export default function NoteSkinPresetThumbnail({
  pack,
  active,
  onApply,
}: {
  pack: { id: string; label: string; pairedDir: string | null };
  active: boolean;
  onApply: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const items = useMemo(() => presetThumbnailItems(pack), [pack]);
  const selection = useMemo(() => presetSelection(pack), [pack]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sprite = new CanvasSpriteIcon();
    const icons = buildActiveNoteIcons(selection);
    let cancelled = false;

    const paint = () => {
      if (cancelled) return;
      const cssW = canvas.clientWidth;
      if (cssW <= 0) return;
      const layout = computePresetThumbnailLayout(cssW, items);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(layout.canvasH * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#101418';
      ctx.fillRect(0, 0, cssW, layout.canvasH);
      for (const cell of layout.cells) {
        const tf = computeThumbnailSpriteTransform(cell);
        ctx.save();
        ctx.beginPath();
        ctx.rect(cell.x, cell.y, cell.w, cell.h);
        ctx.clip();
        ctx.translate(tf.x, tf.y);
        ctx.scale(tf.scale, tf.scale);
        drawPreviewSprite(ctx, sprite, icons, cell.item, PREVIEW_CELL_W, PREVIEW_CELL_H);
        ctx.restore();
      }
    };

    const drawWhenReady = () => {
      CanvasSpriteIcon.ensureImagesLoaded(icons.preloadSrcs())
        .catch(() => undefined)
        .then(() => { if (!cancelled) paint(); });
    };

    drawWhenReady();
    const ro = new ResizeObserver(() => drawWhenReady());
    ro.observe(canvas);
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [items, selection]);

  return (
    <button
      type="button"
      className="asset-set-visual skin-preset-thumb"
      title={pack.label}
      aria-label={active ? pack.label : t('assets.presetThumb.applyAria', { label: pack.label })}
      style={{ width: PRESET_THUMBNAIL_CSS_W, aspectRatio: PRESET_THUMBNAIL_ASPECT }}
      disabled={active}
      onClick={onApply}
    >
      <canvas ref={canvasRef} className="skin-preset-thumb-canvas" aria-hidden="true" />
    </button>
  );
}
