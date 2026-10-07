// Bestdori 自家精灵的取块与染色（chart-preview 21）：combo 数字 / COMBO 标签 / 打击特效图块。
//
// 口径照 Bestdori（bundle scope 691780a2）：
//   - `particles.png` = 4×4 图块（每块 256²）；命中特效按 `createTapEffectSprite(col,row,tint)` 取块，
//     再用 `source-atop` 给整块染上元素配色（tap 青 / flick 粉 / skill 黄 / 方向键紫·橙）；
//   - 圆（`createCircleSprite`）是它**程序化生成**的 256² 径向渐变（内 → 外透明），不是图块；
//   - `digits.png` = 10 列数字（每列 `width/10`）；`combo.png` 是 "COMBO" 标签图。
//
// 染色 / 生成都是"每块每色一张"，建好就缓存（Map）；逐帧只做 drawImage。
// **无 DOM（node 单测）→ 返回 null，调用方退回"不染的整块"或自绘**。
import type { SimSprites } from './simAssets';

/** 图块边长（`particles.png` 1024 / 4） */
export const SPRITE_TILE = 256;
/** `digits.png` 的列数（每列一个数字） */
export const DIGIT_COLUMNS = 10;

/** 一次绘制要用的源（图块 / 生成圆的统一形态：都是 0,0,260,260 或原图子矩形） */
export interface TileSource {
  source: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

const tileCache = new Map<string, CanvasImageSource | null>();
const circleCache = new Map<string, CanvasImageSource | null>();

/** 离屏位图 + 2d 上下文（无 DOM / 不可用 → null） */
function offscreen(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    return ctx ? { canvas, ctx } : null;
  } catch {
    return null;
  }
}

/** 整块染色（`source-atop`；`color` 为 null = 不染；失败 → null） */
function buildTintedTile(
  img: CanvasImageSource,
  col: number,
  row: number,
  color: string | null,
): CanvasImageSource | null {
  const off = offscreen(SPRITE_TILE);
  if (!off) return null;
  try {
    off.ctx.drawImage(img, col * SPRITE_TILE, row * SPRITE_TILE, SPRITE_TILE, SPRITE_TILE, 0, 0, SPRITE_TILE, SPRITE_TILE);
    if (color !== null) {
      off.ctx.globalCompositeOperation = 'source-atop';
      off.ctx.fillStyle = color;
      off.ctx.fillRect(0, 0, SPRITE_TILE, SPRITE_TILE);
    }
    return off.canvas;
  } catch {
    return null;
  }
}

/** 生成径向渐变圆（内 → 外透明；照 Bestdori 的 `createCircleSprite`） */
function buildCircle(inner: string, outer: string): CanvasImageSource | null {
  const off = offscreen(SPRITE_TILE);
  if (!off) return null;
  try {
    const half = SPRITE_TILE / 2;
    const grad = off.ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    off.ctx.fillStyle = grad;
    off.ctx.fillRect(0, 0, SPRITE_TILE, SPRITE_TILE);
    return off.canvas;
  } catch {
    return null;
  }
}

/**
 * `particles.png` 的 (col,row) 块，按 `color` 染色（缓存）。
 * `color` 给 null = **不染**（照 Bestdori：连按那枚 `connectionRing` 就是原色）。
 * 无 DOM 时退回原图整块（不染）—— 观感差一点，但不会画不出来。
 */
export function particleTile(
  sprites: SimSprites,
  col: number,
  row: number,
  color: string | null = null,
): TileSource {
  const key = `${col},${row},${color ?? 'none'}`;
  if (!tileCache.has(key)) tileCache.set(key, buildTintedTile(sprites.particles, col, row, color));
  const tinted = tileCache.get(key);
  if (tinted) return { source: tinted, sx: 0, sy: 0, sw: SPRITE_TILE, sh: SPRITE_TILE };
  return { source: sprites.particles, sx: col * SPRITE_TILE, sy: row * SPRITE_TILE, sw: SPRITE_TILE, sh: SPRITE_TILE };
}

/** 径向渐变圆（`inner` 实心 → `outer` 透明），缓存；无 DOM → null（该笔不画） */
export function radialCircle(inner: string, outer: string): TileSource | null {
  const key = `${inner}|${outer}`;
  if (!circleCache.has(key)) circleCache.set(key, buildCircle(inner, outer));
  const canvas = circleCache.get(key);
  return canvas ? { source: canvas, sx: 0, sy: 0, sw: SPRITE_TILE, sh: SPRITE_TILE } : null;
}

/** 本色 → 同色全透明（生成圆的外圈；`rgba(r, g, b, 1)` → `rgba(r, g, b, 0)`） */
function transparentTint(color: string): string {
  return color.replace(/,\s*1\)$/, ', 0)');
}

/**
 * 元素本色的生成圆（内 = 本色、外 = 同色透明）—— 照 Bestdori 的 `createCircleSprite`，
 * 一色一张缓存；无 DOM → null（那一笔不画，其余图块照画）。
 */
export function radialCircleOf(color: string): TileSource | null {
  return radialCircle(color, transparentTint(color));
}

/** 数字位图矩形（源图像素）：第 `digit` 列 */
export function digitRect(sprites: SimSprites, digit: number): { sx: number; sy: number; sw: number; sh: number } {
  const w = sprites.digits.width / DIGIT_COLUMNS;
  return { sx: Math.min(DIGIT_COLUMNS - 1, Math.max(0, digit)) * w, sy: 0, sw: w, sh: sprites.digits.height };
}
