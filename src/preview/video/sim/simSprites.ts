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
import { SIM_EFFECT_TINTS, SIM_SPRITE_EFFECT } from './simGeometry';

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

const tileCache = new Map<string, CanvasImageSource>();
const circleCache = new Map<string, CanvasImageSource>();

/** 离屏位图 + 2d 上下文（无 DOM / 不可用 → null） */
export type SimOffscreenFactory = (
  size: number,
) => { canvas: CanvasImageSource; ctx: CanvasRenderingContext2D } | null;

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
  createOffscreen: SimOffscreenFactory = offscreen,
): CanvasImageSource | null {
  const off = createOffscreen(SPRITE_TILE);
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
function buildCircle(
  inner: string,
  outer: string,
  createOffscreen: SimOffscreenFactory = offscreen,
): CanvasImageSource | null {
  const off = createOffscreen(SPRITE_TILE);
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
  createOffscreen: SimOffscreenFactory = offscreen,
  cache: Map<string, CanvasImageSource> = tileCache,
): TileSource {
  const key = `${col},${row},${color ?? 'none'}`;
  let tinted = cache.get(key) ?? null;
  if (!tinted) {
    tinted = buildTintedTile(sprites.particles, col, row, color, createOffscreen);
    if (tinted) cache.set(key, tinted);
  }
  if (tinted) return { source: tinted, sx: 0, sy: 0, sw: SPRITE_TILE, sh: SPRITE_TILE };
  return { source: sprites.particles, sx: col * SPRITE_TILE, sy: row * SPRITE_TILE, sw: SPRITE_TILE, sh: SPRITE_TILE };
}

/** 径向渐变圆（`inner` 实心 → `outer` 透明），缓存；无 DOM → null（该笔不画） */
export function radialCircle(
  inner: string,
  outer: string,
  createOffscreen: SimOffscreenFactory = offscreen,
  cache: Map<string, CanvasImageSource> = circleCache,
): TileSource | null {
  const key = `${inner}|${outer}`;
  let canvas = cache.get(key) ?? null;
  if (!canvas) {
    canvas = buildCircle(inner, outer, createOffscreen);
    if (canvas) cache.set(key, canvas);
  }
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
export function radialCircleOf(
  color: string,
  createOffscreen: SimOffscreenFactory = offscreen,
  cache: Map<string, CanvasImageSource> = circleCache,
): TileSource | null {
  return radialCircle(color, transparentTint(color), createOffscreen, cache);
}

/** 数字位图矩形（源图像素）：第 `digit` 列 */
export function digitRect(sprites: SimSprites, digit: number): { sx: number; sy: number; sw: number; sh: number } {
  const w = sprites.digits.width / DIGIT_COLUMNS;
  return { sx: Math.min(DIGIT_COLUMNS - 1, Math.max(0, digit)) * w, sy: 0, sw: w, sh: sprites.digits.height };
}

/** 仿真场打击特效与滑条按住特效用到的全部 `[图块坐标, 染色]` 组合清单（供预热与单测共用单一真源） */
export const SIM_WARMUP_TILE_SPECS: ReadonlyArray<readonly [readonly [number, number], string | null]> = [
  [SIM_SPRITE_EFFECT.tile.beam, SIM_EFFECT_TINTS.tap],
  [SIM_SPRITE_EFFECT.tile.slot, SIM_EFFECT_TINTS.tap],
  [SIM_SPRITE_EFFECT.tile.ring, SIM_EFFECT_TINTS.tap],
  [SIM_SPRITE_EFFECT.tile.rotatingRing, SIM_EFFECT_TINTS.tap],
  [SIM_SPRITE_EFFECT.tile.slot, SIM_EFFECT_TINTS.flick],
  [SIM_SPRITE_EFFECT.tile.ring, SIM_EFFECT_TINTS.flick],
  [SIM_SPRITE_EFFECT.tile.skillBeam, SIM_EFFECT_TINTS.skill],
  [SIM_SPRITE_EFFECT.tile.slot, SIM_EFFECT_TINTS.skill],
  [SIM_SPRITE_EFFECT.tile.star, SIM_EFFECT_TINTS.skill],
  [SIM_SPRITE_EFFECT.tile.ring, SIM_EFFECT_TINTS.skill],
  [SIM_SPRITE_EFFECT.tile.arrow, SIM_EFFECT_TINTS.directionalL],
  [SIM_SPRITE_EFFECT.tile.ring, SIM_EFFECT_TINTS.directionalL],
  [SIM_SPRITE_EFFECT.tile.arrow, SIM_EFFECT_TINTS.directionalR],
  [SIM_SPRITE_EFFECT.tile.ring, SIM_EFFECT_TINTS.directionalR],
  [SIM_SPRITE_EFFECT.tile.connectionRing, null],
];

/**
 * 预热全部打击特效离屏染色图块、径向渐变圆与精灵位图（chart-preview 57）：
 * 在素材加载完成时（开播前）一次性构建 `tileCache` / `circleCache` 并在离屏画布上触发首次 `drawImage`，
 * 消除播放到首个音符抵线瞬间在 rAF 热路径里同步创建十几个 256² 离屏画布 + `source-atop` 合成 +
 * 首次解码上传 `digits.png` / `combo.png` / `particles.png` 造成的音画同卡。
 */
export function warmupSimSprites(
  sprites: SimSprites | null,
  stageImages: ReadonlyArray<CanvasImageSource | null | undefined> = [],
  opts: {
    createOffscreen?: SimOffscreenFactory;
    tiles?: Map<string, CanvasImageSource>;
    circles?: Map<string, CanvasImageSource>;
  } = {},
): void {
  const createOffscreen = opts.createOffscreen ?? offscreen;
  const tiles = opts.tiles ?? tileCache;
  const circles = opts.circles ?? circleCache;
  const warm = createOffscreen(SPRITE_TILE);
  if (!warm) return;

  for (const tint of Object.values(SIM_EFFECT_TINTS)) {
    radialCircleOf(tint, createOffscreen, circles);
  }

  if (sprites) {
    for (const [[col, row], color] of SIM_WARMUP_TILE_SPECS) {
      particleTile(sprites, col, row, color, createOffscreen, tiles);
    }
  }

  const touch = (src: CanvasImageSource | null | undefined) => {
    if (!src) return;
    try {
      warm.ctx.drawImage(src, 0, 0, 1, 1, 0, 0, 1, 1);
    } catch {
      /* 忽略测试替身或未就绪图像 */
    }
  };

  for (const img of stageImages) touch(img);
  if (sprites) {
    touch(sprites.digits);
    touch(sprites.combo);
    touch(sprites.particles);
  }
  for (const c of circles.values()) touch(c);
  for (const tile of tiles.values()) touch(tile);
}
