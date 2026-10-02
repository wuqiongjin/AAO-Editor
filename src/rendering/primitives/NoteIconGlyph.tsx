// 工作台工具栏音符小图标（issue 86）：把当前音符皮肤的一个条目画进字形盒画布。
// 绘制几何在纯模块 `./noteGlyph`（同一套 ActiveNoteIcons + CanvasSpriteIcon，换肤自动跟随）；
// 方向键的字形盒按"本体与键型等大 × DIR_BODY_BOOST"加宽，其余条目为 size × size 方框。
import { useEffect, useRef, useState } from 'react';
import CanvasSpriteIcon from '../../ui/CanvasSpriteIcon';
import type { ActiveNoteIcons } from '../skin/noteSkin';
import { drawNoteGlyph, glyphBox, type ToolGlyphItem } from './noteGlyph';

/**
 * backing 超采样倍数（08 四轮定案，ADR-0017 §1/§2 不变量「位图:物理 = 整数」）：
 * `dpr × 2`（下限 2）——整数性要落在 backing/dpr 上而非 backing 上。
 * 旧「固定 3× 与 dpr 解耦」在 dpr 1.25 屏是 3/1.25 = 2.4× 非整数重采样，浏览器跳采样点 =
 * 用户报告的键型图标锯齿（dpr 越大越严重）。新口径：
 * - dpr 1.25 → backing 2.5×（2× 盒式下采样，干净）；dpr 2 → 4×；dpr 1 → 2×（3× → 2× 的余量回退可接受）。
 * - dpr 随浏览器缩放变化且不触发 React 重渲 —— resize 监听把 dpr 并进 effect 依赖，缩放后自动重绘。
 */
function backingScale(dpr: number): number {
  return Math.max(2, dpr * 2);
}

function currentDpr(): number {
  return typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
}

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
  item: ToolGlyphItem;
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [dpr, setDpr] = useState(currentDpr);
  const box = glyphBox(icons, item, size); // 渲染期算一次供 style；effect 内对同输入重算（纯函数、廉价）

  // dpr 变化（浏览器 / OS 缩放）→ 重绘：backing 密度跟手，不留低清位图被拉伸
  useEffect(() => {
    const onResize = () => setDpr(currentDpr());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { w, h } = glyphBox(icons, item, size);
    const scale = backingScale(dpr);
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let cancelled = false;
    const sprite = new CanvasSpriteIcon();
    const paint = () => {
      if (cancelled) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      drawNoteGlyph(ctx, sprite, icons, item, w, h);
    };
    CanvasSpriteIcon.ensureImagesLoaded(icons.preloadSrcs())
      .catch(() => undefined)
      .then(paint);
    return () => { cancelled = true; };
  }, [icons, item, size, dpr]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{ width: box.w, height: box.h, display: 'block' }}
    />
  );
}
