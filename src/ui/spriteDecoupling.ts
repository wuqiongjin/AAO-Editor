/**
 * 图元切片解耦与纯净 Padding 隔离（issue 222）：
 *
 * 背景与根因：
 * 旧实现直接对整张 1024×1024 / 2048×1024 大图集进行全局逐级减半 Mipmap（issue 96），
 * 当缩小比例跨过阈值（如 Windows 125% 下 es < 1.4 跌入 Level 2）时，大步长双三次滤波
 * 将图集相邻精灵像素以及透明背景中残留的深青色底色 (76,105,113) 卷入音符边缘，
 * 导致外轮廓严重发灰、变暗、甚至断裂（Atlas Bleeding）。
 *
 * 解决方案（Q1=A, Q5=A, Q7=A 定案）：
 * 1. 内存按需解耦：首次绘制某个切片时，从源图集中提取该切片为独立离屏位图；
 * 2. 纯净 Padding：四周包裹 4px 纯净透明黑 (0,0,0,0) 安全边距，彻底防范双三次核插值越界；
 * 3. 管道清洗：提取像素时强制将所有 alpha===0 像素的 RGB 归零，消灭原厂残留底色；
 * 4. 独立 Mip 链：在图元自身维度构建减半位图，绝无图集邻近精灵混色；
 * 5. 弱引用生命周期：绑定在源图的 WeakMap 上，随大图自然 GC，零内存泄漏。
 */
import { mipDims } from './canvasSpriteMips';

/** 防双三次插值越界的纯净透明安全边距（像素） */
export const CLEAN_PADDING_PX = 4;

/**
 * 管道清洗：将所有完全透明像素（alpha === 0）的 RGB 强制重置为 0
 * 消除官方图集导出时保留在透明区域的垃圾底色（如深青色 76, 105, 113）
 */
export function cleanTransparentPixels(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    }
  }
}

export interface DecoupledSprite {
  /** 基础位图（尺寸为 (w + 2*padding) × (h + 2*padding)） */
  baseCanvas: HTMLCanvasElement;
  /** 独立 mip 链：[baseCanvas, level1, level2, ...] */
  mipChain: CanvasImageSource[];
  /** 原切片宽（像素） */
  w: number;
  /** 原切片高（像素） */
  h: number;
  /** 安全边距（像素） */
  padding: number;
  /** 打包进单张不可变 ImageBitmap 图集后的各级裁切源（高密动态预览零纹理切换、零分配） */
  packedDraws?: DecoupledDrawSource[];
  /** 未打包路径下按级缓存的裁切描述符（免去逐次新建对象） */
  drawSources?: Array<DecoupledDrawSource | undefined>;
}

const decoupledCaches = new WeakMap<HTMLImageElement, Map<number | string, DecoupledSprite>>();

function rectCacheKey(x: number, y: number, w: number, h: number): number | string {
  if (
    (x | 0) === x && (y | 0) === y && (w | 0) === w && (h | 0) === h
    && (x | y | w | h) >= 0 && x < 8192 && y < 8192 && w < 8192 && h < 8192
  ) {
    return ((x * 8192 + y) * 8192 + w) * 8192 + h;
  }
  return `${x},${y},${w},${h}`;
}

/** 默认离屏画布工厂（实例/测试可替身注入） */
function createOffscreenCanvasDefault(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  return document.createElement('canvas');
}

/**
 * 获取或创建某个精灵切片的解耦独立位图与专属 Mip 链
 */
export function getDecoupledSprite(
  img: HTMLImageElement,
  rect: { x: number; y: number; w: number; h: number },
  createCanvas: () => HTMLCanvasElement | null = createOffscreenCanvasDefault,
): DecoupledSprite | null {
  return getDecoupledSpriteByRect(img, rect.x, rect.y, rect.w, rect.h, createCanvas);
}

export function getDecoupledSpriteByRect(
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  createCanvas: () => HTMLCanvasElement | null = createOffscreenCanvasDefault,
): DecoupledSprite | null {
  if (w <= 0 || h <= 0) return null;

  let imgMap = decoupledCaches.get(img);
  if (!imgMap) {
    imgMap = new Map();
    decoupledCaches.set(img, imgMap);
  }

  const key = rectCacheKey(x, y, w, h);
  const cached = imgMap.get(key);
  if (cached) return cached;

  const pad = CLEAN_PADDING_PX;
  const totalW = w + pad * 2;
  const totalH = h + pad * 2;

  const canvas = createCanvas();
  if (!canvas) return null;
  canvas.width = totalW;
  canvas.height = totalH;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // 1. 提取切片并放置在带有 Padding 的中心区域
  try {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, x, y, w, h, pad, pad, w, h);
  } catch {
    return null;
  }

  // 2. 管道清洗：消除透明区域残留的深青色底色
  try {
    const imgData = ctx.getImageData(0, 0, totalW, totalH);
    cleanTransparentPixels(imgData.data);
    ctx.putImageData(imgData, 0, 0);
  } catch {
    // getImageData 在跨域受限时不阻断，降级沿用绘制结果
  }

  const decoupled: DecoupledSprite = {
    baseCanvas: canvas,
    mipChain: [canvas],
    w,
    h,
    padding: pad,
  };

  imgMap.set(key, decoupled);
  return decoupled;
}

/**
 * 从解耦图元的独立 Mip 链中获取指定 level 的位图源（按需增量构建）
 */
export function getDecoupledMipLevel(
  decoupled: DecoupledSprite,
  level: number,
  createCanvas: () => HTMLCanvasElement | null = createOffscreenCanvasDefault,
): CanvasImageSource {
  if (decoupled.packedDraws && decoupled.packedDraws.length > 0) {
    const idx = level <= 0 ? 0 : level >= decoupled.packedDraws.length ? decoupled.packedDraws.length - 1 : level;
    return decoupled.packedDraws[idx]!.source;
  }
  if (level <= 0) return decoupled.baseCanvas;
  const chain = decoupled.mipChain;
  if (chain[level]) return chain[level]!;

  // 增量从 level - 1 降采样生成
  for (let i = chain.length; i <= level; i++) {
    const prev = chain[i - 1];
    const pw = (prev as { width: number }).width;
    const ph = (prev as { height: number }).height;
    const { w: mw, h: mh } = mipDims(pw, ph, 1);
    const cv = createCanvas();
    if (!cv) return chain[i - 1]!;
    cv.width = mw;
    cv.height = mh;
    const cctx = cv.getContext('2d');
    if (!cctx) return chain[i - 1]!;
    cctx.imageSmoothingEnabled = true;
    cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(prev, 0, 0, pw, ph, 0, 0, mw, mh);
    chain.push(cv);
  }

  return chain[level] ?? decoupled.baseCanvas;
}

export interface DecoupledDrawSource {
  source: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * 解耦图元的专属 Mip 级数选择器（issue 222）：
 * 解耦图元已被提取为独立离屏位图，并附带 4px 纯净透明 Padding 隔离与管道清洗，
 * 彻底消除了整张大图集的相邻精灵渗色风险（Atlas Bleeding）。
 *
 * 现代浏览器 Canvas2D 在 imageSmoothingQuality='high' 下，双三次插值（Bicubic Catmull-Rom）
 * 在单步 1x~4.5x 降采样范围内具备极其细腻饱满的亚像素抗锯齿能力。
 * 旧版 mipLevelFor 按 2x 减半会导致在 100% 缩放下过早跌入 Level 2（源图被连续减半两次至仅 30px 高，
 * 高频抗锯齿坡度被严重抹平，造成肉眼可见的阶梯锯齿）。
 *
 * 因此解耦图元放宽单步减半门槛至 4.5x：
 * - ratio <= 4.5: Level 0（原图直出，最锐利最饱满）
 * - 4.5 < ratio <= 9: Level 1（减半一次，位图约 60px，单步降采样处于双三次滤波最适甜点区间）
 * - 9 < ratio <= 18: Level 2
 * - ratio > 18: Level 3+
 * 同时严格遵守 ADR-0017 的 min(lMax, lNoUp) 不上采样钳制原则，防细轴从更深级位图反向上采样放大。
 */
export function decoupledMipLevelFor(srcW: number, srcH: number, destW: number, destH: number): number {
  if (!(srcW > 0) || !(srcH > 0) || !(destW > 0) || !(destH > 0)) return 0;
  const rx = srcW / destW;
  const ry = srcH / destH;
  if (!(rx > 1) && !(ry > 1)) return 0;
  let maxDown: number;
  let minDown: number;
  if (rx > 1 && ry > 1) {
    maxDown = rx > ry ? rx : ry;
    minDown = rx < ry ? rx : ry;
  } else if (rx > 1) {
    maxDown = rx;
    minDown = rx;
  } else {
    maxDown = ry;
    minDown = ry;
  }
  const minSrc = srcW < srcH ? srcW : srcH;
  const maxLevel = Math.floor(Math.log2(minSrc));
  const lMax = Math.max(0, Math.ceil(Math.log2(maxDown / 4.5)));
  const lNoUp = Math.floor(Math.log2(minDown));
  const level = lMax < lNoUp ? lMax : lNoUp;
  const clamped = level < maxLevel ? level : maxLevel;
  return clamped > 0 ? clamped : 0;
}

/**
 * 获取解耦切片在指定 Mip 级别下的裁切参数，避免调用方手动拆解 padding 与缩放（消灭 Feature Envy）
 */
export function getDecoupledDrawSource(
  decoupled: DecoupledSprite,
  level: number,
  createCanvas: () => HTMLCanvasElement | null = createOffscreenCanvasDefault,
): DecoupledDrawSource {
  const safeLevel = level <= 0 ? 0 : level;
  if (decoupled.packedDraws && decoupled.packedDraws.length > 0) {
    const idx = safeLevel >= decoupled.packedDraws.length ? decoupled.packedDraws.length - 1 : safeLevel;
    return decoupled.packedDraws[idx]!;
  }
  const isDefault = createCanvas === createOffscreenCanvasDefault;
  if (isDefault && decoupled.drawSources?.[safeLevel]) {
    return decoupled.drawSources[safeLevel]!;
  }
  const source = getDecoupledMipLevel(decoupled, safeLevel, createCanvas);
  const mipW = (source as { width: number }).width;
  const mipH = (source as { height: number }).height;
  const totalW = decoupled.w + decoupled.padding * 2;
  const totalH = decoupled.h + decoupled.padding * 2;
  const kx = mipW / totalW;
  const ky = mipH / totalH;
  const entry: DecoupledDrawSource = {
    source,
    sx: decoupled.padding * kx,
    sy: decoupled.padding * ky,
    sw: decoupled.w * kx,
    sh: decoupled.h * ky,
  };
  if (isDefault) {
    decoupled.drawSources ??= [];
    decoupled.drawSources[safeLevel] = entry;
  }
  return entry;
}

/**
 * 票 89：把预热完毕的解耦切片及其全部 Mip 级位图（约 340 张独立 `HTMLCanvasElement`）
 * 货架式合批打包进单张不可变 `ImageBitmap` 图集，随后将临时离屏画布缩至 1×1 释放 GPU SharedImage 显存，
 * 让同帧数百颗音符绘制共享单张 GPU 纹理完成 Skia 批处理。
 */
export function packDecoupledSprites(sprites: readonly DecoupledSprite[]): ImageBitmap | null {
  if (
    typeof OffscreenCanvas === 'undefined'
    || typeof OffscreenCanvas.prototype.transferToImageBitmap !== 'function'
  ) {
    return null;
  }
  const unique = new Set<DecoupledSprite>();
  for (const s of sprites) {
    if (!s.packedDraws && s.mipChain.length > 0) unique.add(s);
  }
  if (unique.size === 0) return null;

  interface PackItem {
    sprite: DecoupledSprite;
    level: number;
    src: CanvasImageSource;
    pw: number;
    ph: number;
    ox: number;
    oy: number;
  }

  const E = 2;
  const margin = E * 2;
  const items: PackItem[] = [];
  let maxCellW = 0;
  for (const sprite of unique) {
    for (let level = 0; level < sprite.mipChain.length; level++) {
      const src = sprite.mipChain[level]!;
      const pw = Math.max(1, (src as { width: number }).width | 0);
      const ph = Math.max(1, (src as { height: number }).height | 0);
      if (pw + margin * 2 > maxCellW) maxCellW = pw + margin * 2;
      items.push({ sprite, level, src, pw, ph, ox: 0, oy: 0 });
    }
  }
  items.sort((a, b) => b.ph - a.ph);

  const atlasW = Math.max(2048, maxCellW);
  let curX = 0;
  let curY = 0;
  let rowH = 0;
  for (const item of items) {
    const cellW = item.pw + margin * 2;
    const cellH = item.ph + margin * 2;
    if (curX > 0 && curX + cellW > atlasW) {
      curX = 0;
      curY += rowH;
      rowH = 0;
    }
    item.ox = curX + margin;
    item.oy = curY + margin;
    curX += cellW;
    if (cellH > rowH) rowH = cellH;
  }
  const atlasH = Math.max(1, curY + rowH);

  try {
    const atlasCanvas = new OffscreenCanvas(atlasW, atlasH);
    const actx = atlasCanvas.getContext('2d');
    if (!actx) return null;
    actx.imageSmoothingEnabled = false;
    for (const { src, pw, ph, ox, oy } of items) {
      actx.drawImage(src, 0, 0, pw, ph, ox, oy, pw, ph);
      actx.drawImage(src, 0, 0, pw, 1, ox, oy - E, pw, E);
      actx.drawImage(src, 0, ph - 1, pw, 1, ox, oy + ph, pw, E);
      actx.drawImage(src, 0, 0, 1, ph, ox - E, oy, E, ph);
      actx.drawImage(src, pw - 1, 0, 1, ph, ox + pw, oy, E, ph);
    }
    const bitmap = atlasCanvas.transferToImageBitmap();
    try {
      const warm = new OffscreenCanvas(1, 1);
      warm.getContext('2d')?.drawImage(bitmap, 0, 0, 1, 1, 0, 0, 1, 1);
    } catch {
      /* 忽略预上传异常 */
    }
    for (const sprite of unique) {
      sprite.packedDraws = new Array<DecoupledDrawSource>(sprite.mipChain.length);
    }
    for (const { sprite, level, pw, ph, ox, oy } of items) {
      const totalW = sprite.w + sprite.padding * 2;
      const totalH = sprite.h + sprite.padding * 2;
      const kx = pw / totalW;
      const ky = ph / totalH;
      sprite.packedDraws![level] = {
        source: bitmap,
        sx: ox + sprite.padding * kx,
        sy: oy + sprite.padding * ky,
        sw: sprite.w * kx,
        sh: sprite.h * ky,
      };
    }
    for (const sprite of unique) {
      for (const src of sprite.mipChain) {
        const cv = src as { width?: number; height?: number };
        if (typeof cv.width === 'number' && typeof cv.height === 'number') {
          cv.width = 1;
          cv.height = 1;
        }
      }
      sprite.drawSources = undefined;
    }
    return bitmap;
  } catch {
    return null;
  }
}
