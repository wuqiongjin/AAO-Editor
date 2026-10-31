// 片段缩略图（issue 185）：由 `notes` + `bpmContext` **实渲染**，不存位图（ADR-0023 §1）。
// 取景与画法都在 `chart/patterns/thumbnail`（纯函数）；这里只管画布尺寸、dpr 与重绘时机。
import { useEffect, useRef } from 'react';
import { buildPatternThumbnailScene, drawPatternThumbnail } from '../../chart/patterns/thumbnail';
import type { Pattern } from '../../chart/patterns/types';
import { t } from '../../i18n';

export default function PatternThumbnail({ pattern }: { pattern: Pattern }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const paint = () => {
      // 没有布局（jsdom / 尚未挂载出尺寸）时跳过：也顺带避开「没有 2d 上下文」的空转
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w <= 0 || h <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPatternThumbnail(ctx, buildPatternThumbnailScene(pattern, { w, h }), { w, h });
    };

    paint();
    // 抽屉可拖宽：宽度一变就要按新尺寸重新取景
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [pattern]);

  // 缩略图是卡片的第三元素（形状速写），对读屏给一句话而不是一串无名像素
  return (
    <canvas
      ref={canvasRef}
      className="pld-card__thumb-canvas"
      role="img"
      aria-label={t('patternLibrary.thumbnail', { name: pattern.name })}
    />
  );
}
