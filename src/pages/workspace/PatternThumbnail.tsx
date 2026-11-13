// 片段缩略图（issue 185 / 207 优化）：由 `notes` + `bpmContext` **实渲染**，不存位图（ADR-0023 §1）。
// 音符本体贴当前音符皮肤的**真实精灵**（2026-10-31 验收）；取景/贴点口径见
// `src/patterns/thumbnail`（纯几何）与 `thumbnailPaint`（纯绘制）。这里只管画布尺寸、dpr、
// 皮肤解析与重绘时机。
//
// issue 207 性能重构：
// 1. 固定尺寸 88×56：避免在 useEffect 中同步读取 clientWidth/clientHeight 导致 layout thrashing；
// 2. 懒绘制门控（IntersectionObserver）：只有滚动到视口附近（rootMargin 120px）的缩略图才执行 Canvas 绘制与贴图，
//    避免打开抽屉瞬间 50+ 个卡片主线程同时抢 CPU/GPU 导致播放掉帧；
// 3. 异步排队（requestAnimationFrame）：首帧交还给抽屉进场动画与谱面播放 RAF，次帧再上色；
// 4. 单例共享精灵与 WeakMap 几何缓存。
import { memo, useEffect, useRef } from 'react';
import { buildPatternThumbnailScene } from '../../patterns/thumbnail';
import { drawPatternThumbnail } from '../../patterns/thumbnailPaint';
import type { Pattern } from '../../patterns/types';
import type { ActiveNoteIcons } from '../../rendering/skin/noteSkin';
import { t } from '../../i18n';
import CanvasSpriteIcon from '../../ui/CanvasSpriteIcon';

const THUMB_W = 88;
const THUMB_H = 56;

let sharedSprite: CanvasSpriteIcon | null = null;
function getSharedSprite(): CanvasSpriteIcon {
  if (!sharedSprite) sharedSprite = new CanvasSpriteIcon();
  return sharedSprite;
}

export interface PatternThumbnailProps {
  pattern: Pattern;
  icons: ActiveNoteIcons;
}

export default memo(function PatternThumbnail({
  pattern,
  icons,
}: PatternThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    const paint = () => {
      if (cancelled) return;
      // jsdom 无真实布局引擎且未安装 canvas 包时跳过绘制，避免冗余警告
      if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent) && !canvas.clientWidth && !canvas.clientHeight) {
        return;
      }
      const ctx = canvas.getContext ? canvas.getContext('2d') : null;
      if (!ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = THUMB_W;
      const h = THUMB_H;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPatternThumbnail(
        ctx,
        buildPatternThumbnailScene(pattern, { w, h }),
        { w, h },
        { icons, sprite: getSharedSprite() },
      );
    };

    const renderWithPreload = () => {
      paint();
      CanvasSpriteIcon.ensureImagesLoaded(icons.preloadSrcs())
        .catch(() => undefined)
        .then(() => { if (!cancelled) paint(); });
    };

    if (typeof IntersectionObserver === 'function') {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            observer.disconnect();
            // 在下一帧绘制，避免阻塞抽屉展开的当帧布局与谱面播放 RAF
            requestAnimationFrame(() => {
              if (cancelled) return;
              renderWithPreload();
            });
            break;
          }
        }
      }, { rootMargin: '120px 0px' });

      observer.observe(canvas);
      return () => {
        cancelled = true;
        observer.disconnect();
      };
    } else {
      // jsdom 或不支持 IntersectionObserver 的环境直接同步绘制
      renderWithPreload();
      return () => { cancelled = true; };
    }
  }, [pattern, icons]);

  // 缩略图是卡片的第三元素（形状速写），对读屏给一句话而不是一串无名像素
  return (
    <canvas
      ref={canvasRef}
      className="pld-card__thumb-canvas"
      role="img"
      aria-label={t('patternLibrary.thumbnail', { name: pattern.name })}
    />
  );
});
