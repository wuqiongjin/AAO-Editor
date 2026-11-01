// 片段缩略图（issue 185）：由 `notes` + `bpmContext` **实渲染**，不存位图（ADR-0023 §1）。
// 音符本体贴当前音符皮肤的**真实精灵**（2026-10-31 验收）；取景/贴点口径见
// `chart/patterns/thumbnail`（纯几何）与 `thumbnailPaint`（纯绘制）。这里只管画布尺寸、dpr、
// 皮肤解析与重绘时机。
import { useEffect, useMemo, useRef } from 'react';
import { useConfig } from '../../app/ProviderTree';
import { buildPatternThumbnailScene } from '../../chart/patterns/thumbnail';
import { drawPatternThumbnail } from '../../chart/patterns/thumbnailPaint';
import type { Pattern } from '../../chart/patterns/types';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '../../rendering/skin/noteSkin';
import { t } from '../../i18n';
import CanvasSpriteIcon from '../../ui/CanvasSpriteIcon';

export default function PatternThumbnail({ pattern }: { pattern: Pattern }) {
  const { settings } = useConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 皮肤：与工作台画布同一份归一化 + 图标集（换肤时引用变化 → 重绘）
  const noteSkin = useMemo(
    () => normalizeNoteSkinSelection(settings.visual?.noteSkin),
    [settings.visual?.noteSkin],
  );
  const icons = useMemo(() => buildActiveNoteIcons(noteSkin), [noteSkin]);
  const spriteRef = useRef<CanvasSpriteIcon | null>(null);
  if (spriteRef.current === null) spriteRef.current = new CanvasSpriteIcon();
  const sprite = spriteRef.current;

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
      drawPatternThumbnail(ctx, buildPatternThumbnailScene(pattern, { w, h }), { w, h }, { icons, sprite });
    };

    paint();
    // 皮肤图是异步的：就绪后补画一次（未就绪时精灵绘制器自己跳过，不会画出半张图）
    let cancelled = false;
    CanvasSpriteIcon.ensureImagesLoaded(icons.preloadSrcs())
      .catch(() => undefined)
      .then(() => { if (!cancelled) paint(); });

    // 抽屉可拖宽：宽度一变就要按新尺寸重新取景
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(paint);
      observer.observe(canvas);
    }
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [pattern, icons, sprite]);

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
