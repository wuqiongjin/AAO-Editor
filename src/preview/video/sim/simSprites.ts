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
const circleSourceCache = new Map<string, TileSource>();
const circleOfSourceCache = new Map<string, TileSource>();
const particleTileSourceCache = new WeakMap<CanvasImageSource, Map<string | null, Array<TileSource | undefined>>>();
let packedCirclesAtlas: ImageBitmap | null = null;
const packedParticleAtlases = new WeakMap<CanvasImageSource, ImageBitmap>();

function canPackOffscreenBitmap(): boolean {
  return typeof OffscreenCanvas !== 'undefined'
    && typeof OffscreenCanvas.prototype.transferToImageBitmap === 'function';
}

function getCachedParticleSource(
  particles: CanvasImageSource,
  col: number,
  row: number,
  color: string | null,
): TileSource | undefined {
  return particleTileSourceCache.get(particles)?.get(color)?.[row * 4 + col];
}

function setCachedParticleSource(
  particles: CanvasImageSource,
  col: number,
  row: number,
  color: string | null,
  source: TileSource,
): void {
  let byColor = particleTileSourceCache.get(particles);
  if (!byColor) {
    byColor = new Map();
    particleTileSourceCache.set(particles, byColor);
  }
  let slots = byColor.get(color);
  if (!slots) {
    slots = new Array<TileSource | undefined>(16);
    byColor.set(color, slots);
  }
  slots[row * 4 + col] = source;
}

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
  const isDefault = createOffscreen === offscreen && cache === tileCache;
  const inGrid = (col | 0) === col && (row | 0) === row && col >= 0 && col < 4 && row >= 0 && row < 4;
  if (isDefault && inGrid) {
    const hit = getCachedParticleSource(sprites.particles, col, row, color);
    if (hit) return hit;
  }
  const key = `${col},${row},${color ?? 'none'}`;
  let tinted = cache.get(key) ?? null;
  if (!tinted) {
    tinted = buildTintedTile(sprites.particles, col, row, color, createOffscreen);
    if (tinted) cache.set(key, tinted);
  }
  const result: TileSource = tinted
    ? { source: tinted, sx: 0, sy: 0, sw: SPRITE_TILE, sh: SPRITE_TILE }
    : { source: sprites.particles, sx: col * SPRITE_TILE, sy: row * SPRITE_TILE, sw: SPRITE_TILE, sh: SPRITE_TILE };
  if (isDefault && inGrid) {
    setCachedParticleSource(sprites.particles, col, row, color, result);
  }
  return result;
}

/** 径向渐变圆（`inner` 实心 → `outer` 透明），缓存；无 DOM → null（该笔不画） */
export function radialCircle(
  inner: string,
  outer: string,
  createOffscreen: SimOffscreenFactory = offscreen,
  cache: Map<string, CanvasImageSource> = circleCache,
): TileSource | null {
  const isDefault = createOffscreen === offscreen && cache === circleCache;
  const key = `${inner}|${outer}`;
  if (isDefault) {
    const hit = circleSourceCache.get(key);
    if (hit) return hit;
  }
  let canvas = cache.get(key) ?? null;
  if (!canvas) {
    canvas = buildCircle(inner, outer, createOffscreen);
    if (canvas) cache.set(key, canvas);
  }
  if (!canvas) return null;
  const result: TileSource = { source: canvas, sx: 0, sy: 0, sw: SPRITE_TILE, sh: SPRITE_TILE };
  if (isDefault) circleSourceCache.set(key, result);
  return result;
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
  const isDefault = createOffscreen === offscreen && cache === circleCache;
  if (isDefault) {
    const hit = circleOfSourceCache.get(color);
    if (hit) return hit;
  }
  const result = radialCircle(color, transparentTint(color), createOffscreen, cache);
  if (isDefault && result) circleOfSourceCache.set(color, result);
  return result;
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

function shrinkCanvasMap(map: Map<string, CanvasImageSource>): void {
  for (const src of map.values()) {
    const cv = src as { width?: number; height?: number };
    if (typeof cv.width === 'number' && typeof cv.height === 'number') {
      cv.width = 1;
      cv.height = 1;
    }
  }
  map.clear();
}

function blitExtrudedTile(
  actx: OffscreenCanvasRenderingContext2D,
  scratch: OffscreenCanvas,
  cols: number,
  cellIndex: number,
  S: number,
  E: number,
  stride: number,
): { ox: number; oy: number } {
  const ox = (cellIndex % cols) * stride + E * 2;
  const oy = ((cellIndex / cols) | 0) * stride + E * 2;
  actx.drawImage(scratch, 0, 0, S, S, ox, oy, S, S);
  actx.drawImage(scratch, 0, 0, S, 1, ox, oy - E, S, E);
  actx.drawImage(scratch, 0, S - 1, S, 1, ox, oy + S, S, E);
  actx.drawImage(scratch, 0, 0, 1, S, ox - E, oy, E, S);
  actx.drawImage(scratch, S - 1, 0, 1, S, ox + S, oy, E, S);
  actx.drawImage(scratch, 0, 0, 1, 1, ox - E, oy - E, E, E);
  actx.drawImage(scratch, S - 1, 0, 1, 1, ox + S, oy - E, E, E);
  actx.drawImage(scratch, 0, S - 1, 1, 1, ox - E, oy + S, E, E);
  actx.drawImage(scratch, S - 1, S - 1, 1, 1, ox + S, oy + S, E, E);
  return { ox, oy };
}

/**
 * 票 89：径向圆（共 6 枚）与具体 `particles.png` 实例无关，进程期打包一次常驻；
 * 染色粒子块（共 15 枚）按 `sprites.particles` 以 `WeakMap` 隔离持有各自 `ImageBitmap`，
 * 避免预览挂载期间跑离线导出或换包预热 `.close()` 掉实时舞台仍在引用的图集。
 */
function packEffectSpritesAtlas(sprites: SimSprites | null): {
  circles: ImageBitmap | null;
  particles: ImageBitmap | null;
} {
  if (!canPackOffscreenBitmap()) return { circles: null, particles: null };
  const S = SPRITE_TILE;
  const E = 4;
  const stride = S + E * 4;

  if (!packedCirclesAtlas) {
    try {
      const cols = 3;
      const rows = 2;
      const scratch = new OffscreenCanvas(S, S);
      const sctx = scratch.getContext('2d');
      const atlasCanvas = new OffscreenCanvas(cols * stride, rows * stride);
      const actx = atlasCanvas.getContext('2d');
      if (sctx && actx) {
        actx.imageSmoothingEnabled = false;
        const placements: Array<{ tint: string; outer: string; ox: number; oy: number }> = [];
        let cellIndex = 0;
        const half = S / 2;
        for (const tint of Object.values(SIM_EFFECT_TINTS)) {
          const outer = transparentTint(tint);
          sctx.clearRect(0, 0, S, S);
          const grad = sctx.createRadialGradient(half, half, 0, half, half, half);
          grad.addColorStop(0, tint);
          grad.addColorStop(1, outer);
          sctx.fillStyle = grad;
          sctx.fillRect(0, 0, S, S);
          const { ox, oy } = blitExtrudedTile(actx, scratch, cols, cellIndex++, S, E, stride);
          placements.push({ tint, outer, ox, oy });
        }
        const bitmap = atlasCanvas.transferToImageBitmap();
        scratch.width = scratch.height = 1;
        packedCirclesAtlas = bitmap;
        shrinkCanvasMap(circleCache);
        circleSourceCache.clear();
        circleOfSourceCache.clear();
        for (const { tint, outer, ox, oy } of placements) {
          const entry: TileSource = { source: bitmap, sx: ox, sy: oy, sw: S, sh: S };
          circleOfSourceCache.set(tint, entry);
          circleSourceCache.set(`${tint}|${outer}`, entry);
        }
      }
    } catch {
      /* 降级走独立画布 */
    }
  }

  let particlesAtlas: ImageBitmap | null = sprites
    ? (packedParticleAtlases.get(sprites.particles) ?? null)
    : null;
  if (sprites && !particlesAtlas) {
    try {
      const cols = 4;
      const rows = 4;
      const scratch = new OffscreenCanvas(S, S);
      const sctx = scratch.getContext('2d');
      const atlasCanvas = new OffscreenCanvas(cols * stride, rows * stride);
      const actx = atlasCanvas.getContext('2d');
      if (sctx && actx) {
        actx.imageSmoothingEnabled = false;
        const placements: Array<{ col: number; row: number; color: string | null; ox: number; oy: number }> = [];
        let cellIndex = 0;
        for (const [[col, row], color] of SIM_WARMUP_TILE_SPECS) {
          sctx.globalCompositeOperation = 'source-over';
          sctx.clearRect(0, 0, S, S);
          sctx.drawImage(sprites.particles, col * S, row * S, S, S, 0, 0, S, S);
          if (color !== null) {
            sctx.globalCompositeOperation = 'source-atop';
            sctx.fillStyle = color;
            sctx.fillRect(0, 0, S, S);
          }
          const { ox, oy } = blitExtrudedTile(actx, scratch, cols, cellIndex++, S, E, stride);
          placements.push({ col, row, color, ox, oy });
        }
        const bitmap = atlasCanvas.transferToImageBitmap();
        scratch.width = scratch.height = 1;
        packedParticleAtlases.set(sprites.particles, bitmap);
        particlesAtlas = bitmap;
        shrinkCanvasMap(tileCache);
        for (const { col, row, color, ox, oy } of placements) {
          setCachedParticleSource(sprites.particles, col, row, color, {
            source: bitmap, sx: ox, sy: oy, sw: S, sh: S,
          });
        }
      }
    } catch {
      particlesAtlas = null;
    }
  }

  return { circles: packedCirclesAtlas, particles: particlesAtlas };
}

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
  const isDefault = !opts.createOffscreen && !opts.tiles && !opts.circles;
  const createOffscreen = opts.createOffscreen ?? offscreen;
  const tiles = opts.tiles ?? tileCache;
  const circles = opts.circles ?? circleCache;
  const warm = createOffscreen( isDefault ? 1 : SPRITE_TILE );
  if (!warm) return;

  const packed = isDefault ? packEffectSpritesAtlas(sprites) : { circles: null, particles: null };
  if (!packed.circles) {
    for (const tint of Object.values(SIM_EFFECT_TINTS)) {
      radialCircleOf(tint, createOffscreen, circles);
    }
  }
  if (sprites && !packed.particles) {
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
  if (packed.circles) {
    touch(packed.circles);
  } else {
    for (const c of circles.values()) touch(c);
  }
  if (packed.particles) {
    touch(packed.particles);
  } else {
    for (const tile of tiles.values()) touch(tile);
  }
  if (isDefault) {
    const cv = warm.canvas as { width?: number; height?: number };
    if (typeof cv.width === 'number') cv.width = 1;
    if (typeof cv.height === 'number') cv.height = 1;
  }
}

/** 整张精灵的染色缓存（按图身份 → 颜色） */
const tintedImageCache = new WeakMap<CanvasImageSource, Map<string, CanvasImageSource | null>>();

/**
 * 整张精灵染色（chart-preview 51 的 AP combo 变色）：`multiply` 保住原图明暗（白字变彩色、
 * 灰阶过渡还在），再用 `destination-in` 把颜色裁回字形 alpha —— 否则 `multiply` 会把整块
 * 矩形填成实色（透明底也会变成不透明）。建好就缓存；无 DOM（node 单测）→ 原图。
 */
export function tintedImage(img: CanvasImageSource, color: string): CanvasImageSource {
  if (typeof document === 'undefined') return img;
  let map = tintedImageCache.get(img);
  if (!map) {
    map = new Map();
    tintedImageCache.set(img, map);
  }
  if (!map.has(color)) map.set(color, buildTintedImage(img, color));
  return map.get(color) ?? img;
}

function buildTintedImage(img: CanvasImageSource, color: string): CanvasImageSource | null {
  const w = Number((img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width || 0);
  const h = Number((img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height || 0);
  if (!w || !h) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(img, 0, 0);
    return canvas;
  } catch {
    return null;
  }
}
