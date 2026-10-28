// 结尾段的**一帧绘制**（chart-preview 52）：中央章（字样 + 5 波粒子）→ 黑幕转场 → 结算画面。
//
// 版式照票 52「最终版式」的整份 JSON（参数在 `endingSpec.ts`），绘制顺序照原型
// `public/proto/ending.html` 的 `draw()`：
//
//   ① 舞台（= **仿真场末帧**，取景沿用 `simField` 的 `backgroundRect`；轨道 / 判定线仍在）
//   ② 章：粒子（画在字样**后面**）→ 字样逐字母落下（`!` 下的星标从正中飞出）
//   ③ 转场：结算组件逐个入场，黑幕盖 0.22T → 停 0.30T → 抬完 0.62T
//   ④ 结算：左半封面满幅 + 向右渐隐、封面实体、顶栏、白卡（五行 + MAX COMBO）、AP 标
//
// 三条口径（都是用户拍过的）：
//   - **整帧 1920×1080**：结尾 UI 按帧高缩放，不嵌进场地矩形（嵌进去会整体缩 0.2%）。
//   - **缺件不造假**：中央章 / 结算标的 AP·FC 图、`judge.png`、粒子图集缺哪件，那一处就走纯字 / 不画；
//     不画假徽章（票 52 Q12）。AP 与 FC 各有**两套**材质（章用大的、结算用小的），互不顶替。
//   - **不开第二份渲染真相**：章的舞台直接调 `drawSimFrameAt` 画谱面末帧，**分层给 alpha**
//     （背景 / 轨道+判定线 / combo 各自淡出；不再烤成一张整帧快照 —— 那样 combo 与轨道
//     就收不掉了）；UI 层与仿真场互不共享画笔。
import { HEADER_SANS } from '../../fontStack';
import { drawSimFrameAt, SIM_FALLBACK_BG, type SimFrameInput } from '../sim/simField';
import { drawSquareCover, openingPlaceholderCover } from '../opening/openingFrame';
import {
  ENDING_SPEC,
  endingUnits,
  type EndingSpec,
  type EndingStamp,
  type EndingUnits,
} from './endingSpec';
import type { EndingAssets } from './endingAssets';

/** 判定五档计数（Auto 永远全 PERFECT；形态只改章与标记，不改计数口径） */
export interface EndingCounts {
  perfect: number;
  great: number;
  good: number;
  bad: number;
  miss: number;
}

/**
 * 章要铺的**仿真场末帧**：场地按它自己的几何（`SimFieldMetrics`）画，章盖在它上面。
 * `x` / `y` 是场地在整帧里的左上角偏移（导出几何的 `field.x` / `field.y`）。
 */
export interface EndingStageInput {
  frame: SimFrameInput;
  /** 那一帧的秒（= 谱面时长） */
  seconds: number;
  x: number;
  y: number;
}

/** 结尾段的**内容面**（封面已解码；场地由出帧层补成 `EndingFrameInput`） */
export interface EndingContentInput {
  /** 中央章形态：`clear` = 无章（也不放粒子） */
  stamp: EndingStamp;
  /** 顶栏曲名 */
  title: string;
  /** 难度名（全大写英文，由页面给；preview 域不 import 工程域） */
  difficultyName: string;
  /** 难度色（由页面给，全应用唯一标准） */
  difficultyColor: string;
  /** Lv 数字（null = 写 `–`） */
  level: number | null;
  /** 工程封面（无封面走开场同款占位） */
  cover: CanvasImageSource | null;
  /** 无封面时占位块的色相（页面按工程 id 派生） */
  coverHue: number;
  counts: EndingCounts;
  maxCombo: number;
  assets: EndingAssets;
}

/** 一帧的完整输入 */
export interface EndingFrameInput extends EndingContentInput {
  stage: EndingStageInput;
}

// ---------------------------------------------------------------- 常量

/** `all_perfect.png` 的原图比例（1028×187）：章字样与纯字共用同一个框 */
const WORD_ASPECT = 187 / 1028;
/** 幕布抬起后最后一次粒子余烬的时长（秒） */
const EMBERS_SECONDS = 0.55;

/** 结算白卡的五档顺序 */
const ROWS = ['PERFECT', 'GREAT', 'GOOD', 'BAD', 'MISS'] as const;
type RowName = (typeof ROWS)[number];

/** 每档对应的计数键（与 `ROWS` 同序） */
const ROW_COUNTS = ['perfect', 'great', 'good', 'bad', 'miss'] as const;

/** 判定图集坐标（`judgeskin/skin00/judge.asset` 原样，见 `docs/research/gbp-ui-assets.md` §5） */
const JUDGE_SPRITES: Record<RowName, readonly [number, number, number, number]> = {
  PERFECT: [0, 177, 287, 79],
  GREAT: [0, 105, 225, 70],
  GOOD: [227, 105, 219, 70],
  BAD: [168, 33, 148, 70],
  MISS: [0, 33, 166, 70],
};

/**
 * 顶栏星徽的三态切图（`atlas/MenuAtlas.png` **左上角**，2026-10-27 用户指认）：
 * 虹彩 = ALL PERFECT、粉 = FULL COMBO、金 = CLEAR —— 颜色即形态，一张图集切三格。
 *
 * 三格**不是同尺寸**（贴纸边 51×49 / 51×49、金 41×39），外发光各向外溢 ~3px（已含在框里）。
 * 画的时候按 `BADGE_INK_W` 统一比例尺、同中心对齐，**保留三颗的相对大小** ——
 * 各自缩到同高的话金星会被放大一圈，和实机不一致。
 * （图集里第四颗是灰星 = 未通关；导出弹窗只有 AP / FC / CLEAR 三档，不接。）
 */
const BADGE_SPRITES: Record<EndingStamp, readonly [number, number, number, number]> = {
  ap: [116, 218, 57, 55],
  fc: [60, 257, 57, 55],
  clear: [275, 230, 47, 45],
};
/** 比例尺基准 = 最大那格（AP / FC）的框宽：`starSize` 即星徽（含发光）宽 */
const BADGE_INK_W = 57;

/** `tex_parSet_fever.png` 里的实心五角星（粒子母图） */
const PAR_STAR = [153, 278, 79, 76] as const;

/** 5 波爆炸的配色池（`palette: 'cycle'` 按波次轮换，看得出层次） */
const PALETTES = {
  warm: ['#ffe27a', '#ffb36b', '#fff3cf', '#ff8f5e'],
  cool: ['#8fe9ff', '#7df0c8', '#ffffff', '#bcd4ff'],
  pink: ['#ff9fd2', '#d7a4ff', '#ffffff', '#ffc2e6'],
  mix: ['#ffe25a', '#7df0c8', '#ffffff', '#ff9fd2'],
} as const;
const WAVE_PALETTE = ['cool', 'warm', 'pink', 'mix', 'cool'] as const;

// ---------------------------------------------------------------- 小工具

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (v: number): number => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};
const easeOutCubic = (v: number): number => 1 - Math.pow(1 - clamp01(v), 3);

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

function withShadow(
  ctx: CanvasRenderingContext2D,
  blur: number,
  dy: number,
  alpha: number,
  fn: () => void,
): void {
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${alpha})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = dy;
  fn();
  ctx.restore();
}

/** 超宽先自适应缩字号（下限 55% 基准），仍放不下才截断 */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  basePx: number,
  maxW: number,
): number {
  let px = basePx;
  for (let i = 0; i < 80; i++) {
    ctx.font = `${weight} ${px}px ${HEADER_SANS}`;
    if (ctx.measureText(text).width <= maxW || px <= basePx * 0.55) break;
    px -= Math.max(0.5, basePx * 0.015);
  }
  ctx.font = `${weight} ${px}px ${HEADER_SANS}`;
  return px;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) out = out.slice(0, -1);
  return `${out}…`;
}

/** 计数一律四位（`0667` / `0000`）：前导 0 转灰、末位恒深色是游戏口径 */
function formatCount(value: number): string {
  return String(Math.max(0, Math.trunc(value))).padStart(4, '0');
}

function imageSide(src: CanvasImageSource): { w: number; h: number } {
  const s = src as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
  return {
    w: Number(s.naturalWidth ?? s.width ?? 0) || 0,
    h: Number(s.naturalHeight ?? s.height ?? 0) || 0,
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- 预烘层

/**
 * 分层淡出：`elapsed` 秒时某层的不透明度（`dur <= 0` = 到点直接归零）。
 * 结尾段里 combo 先收、轨道慢慢退，结算只剩背景舞台。
 */
function layerAlpha(elapsed: number, at: number, dur: number): number {
  if (!Number.isFinite(dur) || dur <= 0) return elapsed < at ? 1 : 0;
  return 1 - clamp01((elapsed - at) / dur);
}

/** 结算左半幅的背景封面（虚化 + 压暗 + 向右渐隐）：一张图，按封面身份缓存 */
let bleedCache: { cover: CanvasImageSource; key: string; canvas: HTMLCanvasElement } | null = null;

function bleedCanvas(cover: CanvasImageSource, u: EndingUnits): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const key = `${u.w}x${u.h}|${u.spec.bgBlur}|${u.spec.bgBright}|${u.spec.bgScrim}`;
  if (bleedCache && bleedCache.cover === cover && bleedCache.key === key) {
    return bleedCache.canvas;
  }
  const { w: iw, h: ih } = imageSide(cover);
  if (!iw || !ih) return null;
  const canvas = document.createElement('canvas');
  canvas.width = u.w;
  canvas.height = u.h;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const dw = (iw * u.h) / ih;

  g.filter = `blur(${u.spec.bgBlur}px) saturate(0.9) brightness(${u.spec.bgBright / 100})`;
  g.drawImage(cover, 0, 0, dw, u.h);
  g.filter = 'none';

  // 压暗（只压在封面层上）
  const scrim = g.createLinearGradient(0, 0, u.wp('bgFadeTo'), 0);
  scrim.addColorStop(0, `rgba(8,12,20,${u.spec.bgScrim / 100})`);
  scrim.addColorStop(1, 'rgba(8,12,20,0)');
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = scrim;
  g.fillRect(0, 0, u.w, u.h);

  // 向右渐隐（**绝对坐标**渐变：起点左侧恒不透明、终点右侧恒透明，不需要分档）
  g.globalCompositeOperation = 'destination-out';
  const fade = g.createLinearGradient(
    u.wp('bgFadeFrom'),
    0,
    Math.max(u.wp('bgFadeTo'), u.wp('bgFadeFrom') + 1),
    0,
  );
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = fade;
  g.fillRect(0, 0, u.w, u.h);
  bleedCache = { cover, key, canvas };
  return canvas;
}

/*
 * ── 逐字母入场（2026-10-28）────────────────────────────────────────────────
 *
 * 章字样是一张**烤平的**贴纸图（`stamp-ap` 1028×187）：字母挨着字母，白色描边连成一片，
 * 整块只能做"从左到右擦入"。要做"一个一个落下"就得先把图**拆成一枚枚字形**：
 *
 *   ① 找"字芯"：饱和度够高的像素（彩色笔画本体），白色描边 / 白点纹理 / 外发光都不算；
 *   ② 字芯连通域：白描边天然把相邻字母隔开 ⇒ 每枚字母一块（`!` 与它旁边那道闪电
 *      在图上粘连，算作同一枚，一起落）；
 *   ③ 多源 BFS 生长：以字芯为种子把描边、纹理、柔光**各归最近的那一枚**（Voronoi 切分）；
 *   ④ 每枚切一张自己的画布，矩形**归一化**（跟字块一起缩放，换分辨率不用重拆）。
 *
 * 星标（`!` 下面那颗小星）在这套切分里天然是**独立一块** —— 按"贴着底边 + 近似方形"
 * 认出来，从字母层里摘掉，改由 `drawStampStar` 单独演（正中变大 → 飞到原位）。
 *
 * 拆不开（图是纯白 / 跨域污染 / 只有一块）就退回老路径：整块羽化擦入，行为与以前一致。
 */

/** 一枚字形：自己的画布 + 它在字块里的归一化矩形（0..1） */
interface GlyphSprite {
  canvas: HTMLCanvasElement;
  nx: number;
  ny: number;
  nw: number;
  nh: number;
  /** 彩色字芯的归一化宽（不含白描边）—— 星标影子按它取基准尺寸，跨章才对齐 */
  inkW: number;
}

/** 拆字结果：从左到右的字形（不含星标）+ 星标 */
interface GlyphSplit {
  glyphs: GlyphSprite[];
  star: GlyphSprite | null;
}

/** 章字样层（原图或纯字）+ 擦入用的遮罩层 */
interface WordLayer {
  stamp: EndingStamp;
  img: CanvasImageSource | null;
  w: number;
  h: number;
  /** 逐字母用：从原图拆出来的字形（纯字兜底 / 拆不开 = 空） */
  glyphs: GlyphSprite[];
  /** 逐字母用：`!` 下面那颗星（缺件 / 拆不开 = null） */
  star: GlyphSprite | null;
  /** 整块烘焙层（纯字兜底 / 拆不开时走擦入用；逐字母路径不用） */
  layer: HTMLCanvasElement | null;
  mask: HTMLCanvasElement | null;
}

/** 字芯判定：alpha 低于它算背景、饱和度低于它算白描边 */
const GLYPH_INK_MIN = 40;
const GLYPH_SAT_MIN = 0.18;
/** 连通域面积下限（占全图），滤掉贴纸上的高光小点 */
const GLYPH_AREA_MIN = 0.0006;

let wordCache: WordLayer | null = null;
let splitCache: { stamp: EndingStamp; img: CanvasImageSource; split: GlyphSplit | null } | null = null;

/**
 * 拆字（按图身份缓存）：同一张图只解析一遍 —— 归一化矩形与字号无关，
 * 换分辨率不必重跑。
 */
function glyphSplit(stamp: EndingStamp, img: CanvasImageSource): GlyphSplit | null {
  if (splitCache && splitCache.stamp === stamp && splitCache.img === img) return splitCache.split;
  const split = typeof document === 'undefined' ? null : splitImage(img);
  splitCache = { stamp, img, split };
  return split;
}

function splitImage(img: CanvasImageSource): GlyphSplit | null {
  const side = imageSide(img);
  const iw = Math.round(side.w);
  const ih = Math.round(side.h);
  if (iw <= 0 || ih <= 0) return null;

  const full = document.createElement('canvas');
  full.width = iw;
  full.height = ih;
  const g = full.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, iw, ih);

  let data: ImageData;
  try {
    data = g.getImageData(0, 0, iw, ih);
  } catch {
    return null; // 跨域污染的画布：读不出像素就别拆，退回整块擦入
  }
  const px = data.data;
  const n = iw * ih;

  // ① 字芯
  const core = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (px[o + 3]! < GLYPH_INK_MIN) continue;
    const r = px[o]!;
    const gg = px[o + 1]!;
    const b = px[o + 2]!;
    const mx = Math.max(r, gg, b);
    if (mx < 60) continue;
    if ((mx - Math.min(r, gg, b)) / mx < GLYPH_SAT_MIN) continue;
    core[i] = 1;
  }

  // ② 字芯连通域（4 邻域：8 邻域会把斜贴着两枚字芯串成一块）
  const comp = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const boxes: Array<{ id: number; x0: number; y0: number; x1: number; y1: number; area: number }> = [];
  for (let start = 0; start < n; start++) {
    if (!core[start] || comp[start]! >= 0) continue;
    const id = boxes.length;
    let sp = 0;
    stack[sp++] = start;
    comp[start] = id;
    let x0 = start % iw;
    let x1 = x0;
    let y0 = Math.floor(start / iw);
    let y1 = y0;
    let area = 0;
    while (sp > 0) {
      const p = stack[--sp]!;
      const x = p % iw;
      const y = (p - x) / iw;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && core[p - 1] && comp[p - 1]! < 0) {
        comp[p - 1] = id;
        stack[sp++] = p - 1;
      }
      if (x < iw - 1 && core[p + 1] && comp[p + 1]! < 0) {
        comp[p + 1] = id;
        stack[sp++] = p + 1;
      }
      if (y > 0 && core[p - iw] && comp[p - iw]! < 0) {
        comp[p - iw] = id;
        stack[sp++] = p - iw;
      }
      if (y < ih - 1 && core[p + iw] && comp[p + iw]! < 0) {
        comp[p + iw] = id;
        stack[sp++] = p + iw;
      }
    }
    boxes.push({ id, x0, y0, x1, y1, area });
  }

  const minArea = Math.max(48, n * GLYPH_AREA_MIN);
  const kept = boxes.filter((b) => b.area >= minArea).sort((a, b) => a.x0 - b.x0);
  if (kept.length < 2) return null;

  // ③ 认星标：贴到字块底边、且近似方形（字母 / `!` 都是竖高的，唯一方的是那颗星）
  const square = (b: (typeof kept)[number]): boolean => {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    return bw / bh > 0.7 && bw / bh < 1.4;
  };
  const starBox =
    kept
      .filter((b) => square(b) && (b.y1 + 1) / ih > 0.86)
      .sort((a, b) => b.y1 - a.y1)[0] ?? null;

  // ④ 多源 BFS：全部不透明像素按"最近的字芯"归属
  const parts = kept.map((b) => ({ ...b, star: b === starBox }));
  const slotOfComp = new Int32Array(boxes.length).fill(-1);
  parts.forEach((p, i) => {
    slotOfComp[p.id] = i;
  });
  const slot = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let tail = 0;
  for (let i = 0; i < n; i++) {
    const c = comp[i]!;
    if (c < 0) continue;
    const s = slotOfComp[c]!;
    if (s < 0) continue;
    slot[i] = s;
    queue[tail++] = i;
  }
  let head = 0;
  while (head < tail) {
    const p = queue[head++]!;
    const s = slot[p]!;
    const x = p % iw;
    const y = (p - x) / iw;
    const grow = (q: number): void => {
      if (slot[q]! >= 0 || px[q * 4 + 3]! <= 8) return;
      slot[q] = s;
      queue[tail++] = q;
    };
    if (x > 0) grow(p - 1);
    if (x < iw - 1) grow(p + 1);
    if (y > 0) grow(p - iw);
    if (y < ih - 1) grow(p + iw);
  }

  const rects = parts.map(() => ({ x0: iw, y0: ih, x1: -1, y1: -1 }));
  for (let i = 0; i < n; i++) {
    const s = slot[i]!;
    if (s < 0) continue;
    const x = i % iw;
    const y = (i - x) / iw;
    const r = rects[s]!;
    if (x < r.x0) r.x0 = x;
    if (x > r.x1) r.x1 = x;
    if (y < r.y0) r.y0 = y;
    if (y > r.y1) r.y1 = y;
  }

  const sprites = parts.map((_part, i): GlyphSprite | null => {
    const r = rects[i]!;
    const bw = r.x1 - r.x0 + 1;
    const bh = r.y1 - r.y0 + 1;
    if (bw <= 0 || bh <= 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = bw;
    canvas.height = bh;
    const cg = canvas.getContext('2d');
    if (!cg) return null;
    const out = cg.createImageData(bw, bh);
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const src = y * iw + x;
        if (slot[src]! !== i) continue;
        const so = src * 4;
        const to = ((y - r.y0) * bw + (x - r.x0)) * 4;
        out.data[to] = px[so]!;
        out.data[to + 1] = px[so + 1]!;
        out.data[to + 2] = px[so + 2]!;
        out.data[to + 3] = px[so + 3]!;
      }
    }
    cg.putImageData(out, 0, 0);
    // `ink*` = 彩色字芯的框（不含按 BFS 吞进来的白描边）：星标影子按它取基准尺寸，
    // 两张章的描边厚度不一样，用整块框会让 FC 的影子比 AP 大一圈
    const ink = parts[i]!;
    return {
      canvas,
      nx: r.x0 / iw,
      ny: r.y0 / ih,
      nw: bw / iw,
      nh: bh / ih,
      inkW: (ink.x1 - ink.x0 + 1) / iw,
    };
  });

  const glyphs: GlyphSprite[] = [];
  let star: GlyphSprite | null = null;
  parts.forEach((p, i) => {
    const sprite = sprites[i] ?? null;
    if (!sprite) return;
    if (p.star) star = sprite;
    else glyphs.push(sprite);
  });
  if (glyphs.length < 2) return null;
  return { glyphs, star };
}

/**
 * 中央章（大号材质）：`ap` = 用户自抠的 `stamp-ap`、`fc` = `stamp-fc`（**暂缺**）；
 * 缺件 = null ⇒ 走纯字（票 52 Q12：不拿结算那张小图放大顶替）。
 */
function stampWordImage(input: EndingFrameInput): HTMLImageElement | null {
  if (input.stamp === 'ap') return input.assets.stampAp;
  if (input.stamp === 'fc') return input.assets.stampFc;
  return null;
}

/**
 * 结算白卡的角标（**小号材质**，与中央章不是同一张图）：`ap` = `mark-ap`（暂缺）、
 * `fc` = `mark-fc`（韩服真件）；缺件 = null ⇒ 走纯字。
 */
function markImage(input: EndingFrameInput): HTMLImageElement | null {
  if (input.stamp === 'ap') return input.assets.markAp;
  if (input.stamp === 'fc') return input.assets.markFc;
  return null;
}

function wordLayer(input: EndingFrameInput, wPx: number): WordLayer | null {
  if (typeof document === 'undefined') return null;
  const img = stampWordImage(input);
  if (wordCache && wordCache.stamp === input.stamp && wordCache.img === img && wordCache.w === wPx) {
    return wordCache;
  }
  const w = Math.max(1, Math.round(wPx));
  // 有图按图自己的比例（AP 章 1028×187）；缺件才用 AP 那个常量兜底
  const iw = img ? img.naturalWidth || img.width : 0;
  const ih = img ? img.naturalHeight || img.height : 0;
  const aspect = iw > 0 && ih > 0 ? ih / iw : WORD_ASPECT;
  const h = Math.max(1, Math.round(w * aspect));

  // 逐字母：能拆就拆（星标从字母层里摘出来，交给 `drawStampStar` 单独演）
  const split = img ? glyphSplit(input.stamp, img) : null;
  let layer: HTMLCanvasElement | null = null;
  let mask: HTMLCanvasElement | null = null;

  if (!split) {
    layer = document.createElement('canvas');
    layer.width = w;
    layer.height = h;
    mask = document.createElement('canvas');
    mask.width = w;
    mask.height = h;
    const g = layer.getContext('2d');
    if (!g) return null;

    if (img) {
      g.drawImage(img, 0, 0, w, h);
    } else {
      // 缺中央章材质（FC 大号至今没有；AP 缺安装包时同理）⇒ **纯字**（票 52 Q12：缺件不造假徽章）
      const text = input.stamp === 'ap' ? 'ALL PERFECT!' : 'FULL COMBO';
      let px = h * 0.84;
      const maxW = w * 0.94;
      for (let i = 0; i < 80; i++) {
        g.font = `800 ${px}px ${HEADER_SANS}`;
        if (g.measureText(text).width <= maxW || px <= h * 0.3) break;
        px -= Math.max(1, h * 0.02);
      }
      g.font = `800 ${px}px ${HEADER_SANS}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = 'rgba(150, 230, 255, 0.8)';
      g.shadowBlur = h * 0.14;
      g.fillStyle = '#ffffff';
      g.fillText(text, w / 2, h / 2 + h * 0.02);
    }
  }

  wordCache = {
    stamp: input.stamp,
    img,
    w,
    h,
    glyphs: split?.glyphs ?? [],
    star: split?.star ?? null,
    layer,
    mask,
  };
  return wordCache;
}

// ---------------------------------------------------------------- 舞台

function drawStage(
  ctx: CanvasRenderingContext2D,
  u: EndingUnits,
  input: EndingFrameInput,
  elapsed: number,
): void {
  const { stage } = input;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, stage.x, stage.y);
  drawSimFrameAt(ctx, stage.frame, stage.seconds, {
    trackAlpha: layerAlpha(elapsed, u.spec.trackFadeAt, u.spec.trackFadeDur),
    comboAlpha: layerAlpha(elapsed, u.spec.comboFadeAt, u.spec.comboFadeDur),
    // 结尾段不画判定字：那是打歌时的东西
    judge: null,
  });
  ctx.restore();
}

// ---------------------------------------------------------------- 中央章

/**
 * 章字样 → 停满强度 → 淡出。
 *
 * 入场走**逐字母**（`drawGlyphWave`）：字形从上方落下来，一个一个从左到右。
 * 拆字失败 / 缺件走纯字时退回老路径 `drawWordWipe`（整块羽化擦入）。
 */
function drawStampWord(
  ctx: CanvasRenderingContext2D,
  u: EndingUnits,
  input: EndingFrameInput,
  elapsed: number,
): void {
  const word = wordLayer(input, u.wp('stampW'));
  if (!word) return;
  const inSec = Math.max(0.05, u.spec.stampIn);
  const p = clamp01(elapsed / inSec);
  const fadeStart = u.spec.stampDur - Math.max(0, u.spec.stampOut);
  const alpha =
    elapsed >= fadeStart ? 1 - smooth((elapsed - fadeStart) / Math.max(0.01, u.spec.stampOut)) : 1;
  if (alpha <= 0.003) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(u.w / 2, u.hp('stampY'));

  // 字块后面的柔光（不是星，不遮挡笔画）
  if (u.spec.wordGlow > 0.001 && p < 0.85) {
    const glowA = u.spec.wordGlow * (1 - smooth((p - 0.5) / 0.35)) * 0.55;
    if (glowA > 0.002) {
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, word.w * 0.55);
      gr.addColorStop(0, `rgba(190,240,255,${glowA})`);
      gr.addColorStop(1, 'rgba(190,240,255,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(-word.w * 0.6, -word.h * 0.9, word.w * 1.2, word.h * 1.8);
    }
  }

  if (word.glyphs.length >= 2) {
    drawGlyphWave(ctx, u, word, elapsed, alpha);
    drawStampStar(ctx, u, word, elapsed, alpha);
  } else {
    drawWordWipe(ctx, u, word, p);
  }
  ctx.restore();
}

/**
 * 逐字母落位：一枚枚字形像**排队**一样从上方滑进各自的位置。
 *
 * 队列的读法靠两件事：
 *   - 位移**线性**（`letterBounce = 0` 时）—— 空中的字块等速下移，间距均匀，看着就是"阶梯"；
 *   - 透明度**入队即 `letterInAlpha`，落位补齐到 1** —— 队尾的字是"已经出现了但发虚"，
 *     不是从无到有地淡入；队列长度 = `letterDur / 相邻间隔`（默认 1.3s / 11 字 ≈ 3 枚）。
 */
function drawGlyphWave(
  ctx: CanvasRenderingContext2D,
  u: EndingUnits,
  word: WordLayer,
  elapsed: number,
  alpha: number,
): void {
  const inSec = Math.max(0.05, u.spec.stampIn);
  const dur = Math.max(0.04, u.spec.letterDur);
  const span = Math.max(dur, (u.spec.letterSpan / 100) * inSec);
  const n = word.glyphs.length;
  const stagger = n > 1 ? (span - dur) / (n - 1) : 0;
  const drop = (u.spec.letterDrop / 100) * word.h;
  const bounce = Math.max(0, u.spec.letterBounce);
  const inAlpha = clamp01(u.spec.letterInAlpha);
  const halfW = word.w / 2;
  const halfH = word.h / 2;

  for (let i = 0; i < n; i++) {
    const q = clamp01((elapsed - i * stagger) / dur);
    if (q <= 0) continue;
    // 入队那一瞬间用 12% 的时长淡到 `inAlpha`，之后一路补到 1（落位时不再发虚）
    const a = inAlpha * smooth(clamp01(q / 0.12));
    const fade = a + (1 - a) * smooth(q);
    if (fade <= 0.004) continue;
    const g = word.glyphs[i]!;
    // 线性下落 + 尾段回弹（`bounce = 0` 时回弹项恒为 0，纯等速）
    const rise = drop * (1 - q);
    const sink = drop * bounce * 0.25 * Math.sin(Math.PI * clamp01((q - 0.7) / 0.3));
    ctx.globalAlpha = alpha * fade;
    ctx.drawImage(
      g.canvas,
      g.nx * word.w - halfW,
      g.ny * word.h - halfH - rise + sink,
      g.nw * word.w,
      g.nh * word.h,
    );
  }
}

/**
 * 章字样：羽化擦入（软边 + 轻微上浮 / 缩放）→ 停满强度 → 淡出。
 *
 * 擦入用 `destination-in` + **绝对坐标**渐变（`pos−feather → pos`，两侧由 canvas 自动夹住）：
 * 早期版本按进度分档构造渐变，`p ≈ 0` 那一帧会退化成整幅渐变 —— 看起来就是"闪一下"。
 */
function drawWordWipe(
  ctx: CanvasRenderingContext2D,
  u: EndingUnits,
  word: WordLayer,
  p: number,
): void {
  const mask = word.mask;
  const layer = word.layer;
  if (!mask || !layer) return;
  const g = mask.getContext('2d');
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, word.w, word.h);
  g.drawImage(layer, 0, 0);

  const feather = word.w * 0.26;
  const pos = smooth(p) * (word.w + feather);
  g.globalCompositeOperation = 'destination-in';
  const grad = g.createLinearGradient(pos - feather, 0, pos, 0);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, word.w, word.h);
  g.globalCompositeOperation = 'source-over';

  const easeIn = easeOutCubic(p);
  const scale = 0.97 + 0.03 * easeIn;
  const lift = (1 - easeIn) * u.h * 0.012;
  ctx.save();
  ctx.translate(0, lift);
  ctx.scale(scale, scale);
  ctx.drawImage(mask, -word.w / 2, -word.h / 2);
  ctx.restore();
}

/** 星贴图的代表色（`ghostTint = auto` 时用）：饱和² × 不透明度加权平均，再往白里混 30% */
const starTints = new WeakMap<HTMLCanvasElement, string>();

function starTint(canvas: HTMLCanvasElement): string {
  const hit = starTints.get(canvas);
  if (hit) return hit;
  let color = 'rgb(255,255,255)';
  const g = canvas.getContext('2d');
  if (g) {
    const { width: w, height: h } = canvas;
    const data = g.getImageData(0, 0, w, h).data;
    let r = 0;
    let gg = 0;
    let b = 0;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]!;
      if (a < 200) continue;
      const cr = data[i]!;
      const cg = data[i + 1]!;
      const cb = data[i + 2]!;
      const mx = Math.max(cr, cg, cb);
      if (mx <= 0) continue;
      const sat = (mx - Math.min(cr, cg, cb)) / mx;
      if (sat < 0.25) continue;
      const k = (a / 255) * sat * sat;
      r += cr * k;
      gg += cg * k;
      b += cb * k;
      sum += k;
    }
    if (sum > 0) {
      // 提亮：往白里混 —— 影子是压在字块上的，不能比字还深
      const lift = (c: number): number => Math.round(c / sum + (255 - c / sum) * 0.3);
      color = `rgb(${lift(r)}, ${lift(gg)}, ${lift(b)})`;
    }
  }
  starTints.set(canvas, color);
  return color;
}

/**
 * 纯色圆角五角星：**矢量画**，不放大贴图，所以放到 10× 边缘也是硬的。
 *
 * 圆角是逐顶点 `quadraticCurveTo` 磨出来的，**只 fill 不 stroke** ——
 * 同色描边在半透明处会二次叠加，星会显出一圈更深的边。
 */
function drawSolidStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  rot: number,
  color: string,
  alpha: number,
): void {
  if (alpha <= 0.004 || size <= 1) return;
  const outer = size / 2;
  const inner = outer * 0.45;
  const round = outer * 0.12;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? outer : inner;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([Math.cos(ang) * rad, Math.sin(ang) * rad]);
  }
  const along = (from: [number, number], to: [number, number], d: number): [number, number] => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy) || 1;
    return [from[0] + (dx / len) * d, from[1] + (dy / len) * d];
  };
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  if (rot) ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]!;
    const prev = pts[(i + pts.length - 1) % pts.length]!;
    const next = pts[(i + 1) % pts.length]!;
    // 切线长度同时受"圆角半径"和"相邻边长"约束，否则相邻角会互相啃掉
    const r = Math.min(round, Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) * 0.4);
    const a = along(cur, prev, r);
    const b = along(cur, next, r);
    if (i === 0) ctx.moveTo(a[0], a[1]);
    else ctx.lineTo(a[0], a[1]);
    ctx.quadraticCurveTo(cur[0], cur[1], b[0], b[1]);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/**
 * `!` 下面那颗星：正中出现（变大 + 旋转）→ 飞到原位（缩小 + 转正）→ 落位。
 *
 * 两处"影子"材质不同：
 *   - 起飞瞬间那枚是**纯色圆角五角星**（`ghostTint`，默认按星的代表色自动取），
 *     继续变大 + 继续旋转后淡出；
 *   - 落位之后那枚**仍用原图贴图**（星本身就这么小，放大量也小），只放大、不旋转。
 */
function drawStampStar(
  ctx: CanvasRenderingContext2D,
  u: EndingUnits,
  word: WordLayer,
  elapsed: number,
  alpha: number,
): void {
  const star = word.star;
  if (!star) return;
  const tint = u.spec.ghostTint && u.spec.ghostTint !== 'auto' ? u.spec.ghostTint : starTint(star.canvas);
  const sw = star.nw * word.w;
  const sh = star.nh * word.h;
  /** 影子基准 = 字芯宽（不含白描边）：AP / FC 的描边厚度不同，用整块框 FC 会大一圈 */
  const inkSize = Math.max(1, star.inkW * word.w);
  // 终态位置 = 原图里那个位置（落定后与"!"重新拼回同一张图）
  const homeX = (star.nx + star.nw / 2) * word.w - word.w / 2;
  const homeY = (star.ny + star.nh / 2) * word.h - word.h / 2;

  const inSec = Math.max(0.05, u.spec.stampIn);
  const at = Math.max(0, (u.spec.starAt / 100) * inSec);
  const growDur = Math.max(0.02, (u.spec.starGrow / 100) * inSec);
  const flyDur = Math.max(0.02, (u.spec.starFly / 100) * inSec);
  const growEnd = at + growDur;
  // 变大结束 → 起飞之间可以留一段停顿（0 = 立刻走）
  const flyStart = growEnd + (Math.max(0, u.spec.starHold) / 100) * inSec;
  const landAt = flyStart + flyDur;
  const big = Math.max(0.2, u.spec.starBig);
  const spin = (u.spec.starSpin * Math.PI) / 180;

  const paint = (cx: number, cy: number, scale: number, rot: number, a: number): void => {
    if (a <= 0.004 || scale <= 0.001) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);
    ctx.drawImage(star.canvas, (-sw * scale) / 2, (-sh * scale) / 2, sw * scale, sh * scale);
    ctx.restore();
  };

  // 落位之后：外围继续冒影子（放大量比飞行时小，且不转）
  if (elapsed >= landAt) {
    const pulses = Math.max(0, Math.round(u.spec.landPulses));
    const dur = Math.max(0.05, u.spec.landDur);
    for (let i = 0; i < pulses; i++) {
      const q = (elapsed - landAt - i * dur * 0.72) / dur;
      if (q < 0 || q >= 1) continue;
      const e = easeOutCubic(q);
      paint(
        homeX,
        homeY,
        1 + (Math.max(1, u.spec.landGrow) - 1) * e,
        0,
        alpha * u.spec.landAlpha * (1 - smooth(q)),
      );
    }
    paint(homeX, homeY, 1, 0, alpha);
    return;
  }

  // 飞行前：字块正中变大 + 旋转
  if (elapsed < growEnd) {
    if (elapsed < at) return;
    const q = (elapsed - at) / growDur;
    // 用 smooth 而不是 easeOutCubic：后者 60% 的时长就已经长到 95%，
    // 尾段看着像"停住了"，会和 `starHold` 叠成一段说不清来源的停顿
    const e = smooth(q);
    paint(0, 0, Math.max(0.02, big * e), spin * e, alpha * smooth(clamp01(q / 0.22)));
    return;
  }

  // 起飞瞬间留在正中的残余影子：纯色圆角星，继续变大 + 继续旋转 + 淡出
  const gq = (elapsed - flyStart) / Math.max(0.02, u.spec.ghostDur);
  if (gq < 1) {
    const ge = easeOutCubic(gq);
    const ghostTo = Math.max(big, u.spec.ghostGrow);
    drawSolidStar(
      ctx,
      0,
      0,
      inkSize * (big + (ghostTo - big) * ge),
      spin + ((u.spec.ghostSpin * Math.PI) / 180) * ge,
      tint,
      // 头 8% 淡入：起步那一瞬主星还压在正中，直接满不透明会露出"两枚星错位"
      alpha * u.spec.ghostAlpha * smooth(clamp01(gq / 0.08)) * (1 - smooth(gq)),
    );
  }

  // 飞行：正中 → `!` 正下方，逐渐缩回终态，旋转同步转正
  // 用 easeOut：起步就动，停顿只由 `starHold` 决定（easeInOut 自带一段"没动"的错觉）
  const f = easeOutCubic((elapsed - flyStart) / flyDur);
  paint(homeX * f, homeY * f, big + (1 - big) * f, spin * (1 - f), alpha);
}

interface EndingParticle {
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  spin: number;
  life: number;
  delay: number;
  at: number;
  drag: number;
}

/** 染色星图（按母图身份 + 颜色缓存；`multiply` 上色，配合 `lighter` 出加色效果） */
const starSprites = new WeakMap<CanvasImageSource, Map<string, HTMLCanvasElement>>();

function starSprite(img: CanvasImageSource, color: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  let map = starSprites.get(img);
  if (!map) {
    map = new Map();
    starSprites.set(img, map);
  }
  const hit = map.get(color);
  if (hit) return hit;
  const [sx, sy, sw, sh] = PAR_STAR;
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = color;
  g.fillRect(0, 0, sw, sh);
  map.set(color, canvas);
  return canvas;
}

function paletteFor(wave: number, spec: EndingSpec): readonly string[] {
  const style = spec.palette;
  if (style !== 'cycle') return PALETTES[style];
  return PALETTES[WAVE_PALETTE[wave] ?? 'mix'];
}

/** 齐爆的散点位置：绕画面中心的椭圆上均匀分布（避开正中，免得全被字块挡住） */
function scatterPoints(n: number, seed: number, u: EndingUnits): Array<[number, number]> {
  const rnd = mulberry32(seed);
  const pts: Array<[number, number]> = [];
  const rx = u.w * 0.335;
  const ry = u.h * 0.3;
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.28;
    pts.push([
      u.w / 2 + Math.cos(ang) * rx * (0.86 + rnd() * 0.22),
      u.hp('stampY') + Math.sin(ang) * ry * (0.86 + rnd() * 0.22),
    ]);
  }
  return pts;
}

/** 5 波爆点：中心 → 24% / 42% 各一处 → 62% 起 4 处齐爆 → 80% 起 5 处齐爆 */
function burstWaves(u: EndingUnits): Array<{
  wave: number;
  at: number;
  points: Array<[number, number]>;
  n: number;
  speed: number;
}> {
  const count = u.spec.partCount;
  return [
    { wave: 0, at: 0.02 * u.spec.stampDur, points: [[u.w / 2, u.hp('stampY')]], n: count, speed: 1 },
    {
      wave: 1,
      at: (u.spec.burst2At / 100) * u.spec.stampDur,
      points: [[u.wp('burst2X'), u.hp('burst2Y')]],
      n: count * 0.46,
      speed: 0.86,
    },
    {
      wave: 2,
      at: (u.spec.burst3At / 100) * u.spec.stampDur,
      points: [[u.wp('burst3X'), u.hp('burst3Y')]],
      n: count * 0.4,
      speed: 0.8,
    },
    {
      wave: 3,
      at: (u.spec.burst4At / 100) * u.spec.stampDur,
      points: scatterPoints(Math.max(1, Math.round(u.spec.burst4Points)), 41, u),
      n: count * 0.3,
      speed: 0.72,
    },
    {
      wave: 4,
      at: (u.spec.burst5At / 100) * u.spec.stampDur,
      points: scatterPoints(Math.max(1, Math.round(u.spec.burst5Points)), 97, u),
      n: count * 0.26,
      speed: 0.66,
    },
  ];
}

let particleCache: { key: string; list: EndingParticle[] } | null = null;

function particles(u: EndingUnits): EndingParticle[] {
  const key = `${u.w}x${u.h}`;
  if (particleCache && particleCache.key === key) return particleCache.list;
  const out: EndingParticle[] = [];
  burstWaves(u).forEach((grp, gi) => {
    const colors = paletteFor(grp.wave, u.spec);
    grp.points.forEach((pt, pi) => {
      const rnd = mulberry32(3000 + gi * 131 + pi * 17);
      const count = Math.max(1, Math.round(grp.n));
      for (let i = 0; i < count; i++) {
        const ang = rnd() * Math.PI * 2;
        // 同一组共用一个减速度 ⇒ 扩散成一圈（烟花），而不是一团随机散点
        const sp = (960 + rnd() * 380) * u.spec.partSpeed * grp.speed;
        const color = colors[Math.floor(rnd() * colors.length)] ?? '#ffffff';
        out.push({
          ox: pt[0],
          oy: pt[1],
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp * 0.86,
          size: u.hp('partSize') * (0.65 + rnd() * 0.6) * (grp.wave >= 3 ? 0.85 : 1),
          color,
          spin: (rnd() - 0.5) * 7,
          life: 0.78 + rnd() * 0.22,
          delay: rnd() * 0.04,
          at: grp.at,
          drag: 1.75,
        });
      }
    });
  });
  particleCache = { key, list: out };
  return out;
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  u: EndingUnits,
  input: EndingFrameInput,
  elapsed: number,
): void {
  const img = input.assets.particles;
  if (!img) return;
  const list = particles(u);
  const at = (p: EndingParticle, age: number): [number, number] => {
    const travel = (1 - Math.exp(-p.drag * age)) / p.drag;
    return [p.ox + p.vx * travel, p.oy + p.vy * travel];
  };

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of list) {
    const age = elapsed - p.at - p.delay;
    if (age < 0 || age > p.life) continue;
    const fade = Math.pow(1 - age / p.life, 1.15);
    const size = p.size * (0.6 + 0.4 * (1 - age / p.life));
    const [x, y] = at(p, age);
    const [px, py] = at(p, Math.max(0, age - 0.06));

    // 短拖尾：让星点是"飞出去"的，而不是一个个贴上去的
    ctx.globalAlpha = fade * 0.5;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = Math.max(1, size * 0.16);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(x, y);
    ctx.stroke();

    const sprite = starSprite(img, p.color);
    if (!sprite) continue;
    ctx.globalAlpha = fade;
    ctx.translate(x, y);
    ctx.rotate(p.spin * age);
    ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  ctx.restore();

  // 起爆闪：每组爆点后 ~0.26s 的一团柔光
  for (const grp of burstWaves(u)) {
    const age = elapsed - grp.at;
    if (age < 0 || age > 0.26) continue;
    for (const pt of grp.points) {
      const a = Math.pow(1 - age / 0.26, 2) * 0.2;
      const r = u.hp('partSize') * (3 + age * 26);
      const gr = ctx.createRadialGradient(pt[0], pt[1], 0, pt[0], pt[1], r);
      gr.addColorStop(0, `rgba(255,248,224,${a})`);
      gr.addColorStop(0.45, `rgba(190,235,255,${a * 0.45})`);
      gr.addColorStop(1, 'rgba(190,235,255,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(pt[0] - r, pt[1] - r, r * 2, r * 2);
    }
  }
}

// ---------------------------------------------------------------- 结算

interface CardRect {
  w: number;
  right: number;
  left: number;
  top: number;
  h: number;
  bottom: number;
}

function cardMetrics(u: EndingUnits): CardRect {
  const w = u.hp('cardW');
  const right = u.w - u.hp('cardRight');
  const top = u.hp('cardTop');
  const h = u.hp('rowFirst') + 4 * u.hp('rowPitch') + u.hp('labelH') / 2 + u.hp('padBottom');
  return { w, right, left: right - w, top, h, bottom: top + h };
}

function rowCy(index: number, card: CardRect, u: EndingUnits): number {
  return card.top + u.hp('rowFirst') + index * u.hp('rowPitch');
}

function comboRect(card: CardRect, u: EndingUnits): { x: number; y: number; w: number; h: number } {
  return {
    x: card.left + u.hp('comboX'),
    y: card.top + u.hp('comboY'),
    w: u.hp('comboW'),
    h: u.hp('comboH'),
  };
}

/** 顶栏：星徽 + 难度 + 曲名 + Lv（**没有** SS / 得分 / 排名） */
function drawBar(ctx: CanvasRenderingContext2D, u: EndingUnits, input: EndingFrameInput): void {
  const x = u.wp('barX');
  const y = u.hp('barY');
  const w = u.wp('barW');
  const h = u.hp('barH');
  const cy = y + h / 2;

  withShadow(ctx, h * 0.5, h * 0.12, 0.4, () => {
    ctx.fillStyle = '#fdfdfd';
    roundRect(ctx, x, y, w, h, u.hp('barR'));
    ctx.fill();
  });

  // 星徽：按结算形态取图集里的那一格（虹彩 / 粉 / 金），缺图集则不画。
  // 三格同一比例尺、同中心（保留相对大小），`starSize` 按最大那格算。
  const menu = input.assets.menu;
  const badge = BADGE_SPRITES[input.stamp];
  if (menu && badge) {
    const k = u.hp('starSize') / BADGE_INK_W;
    const bw = badge[2] * k;
    const bh = badge[3] * k;
    ctx.drawImage(menu, badge[0], badge[1], badge[2], badge[3], x + u.hp('starDX') - bw / 2, cy - bh / 2, bw, bh);
  }

  // 难度徽章（**正体**，不斜）
  const df = u.hp('diffFont');
  const dh = u.hp('diffH');
  ctx.font = `700 ${df}px ${HEADER_SANS}`;
  const dw = ctx.measureText(input.difficultyName).width + u.hp('diffPadX') * 2;
  const dx = x + u.hp('diffX');
  ctx.fillStyle = input.difficultyColor;
  roundRect(ctx, dx, cy - dh / 2, dw, dh, dh * 0.16);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(input.difficultyName, dx + dw / 2, cy + 1);
  ctx.textAlign = 'left';

  // 曲名（给 Lv 块留位）
  const titleX = x + u.hp('titleX');
  const lvRight = x + w - u.hp('lvRight');
  const lvBlockW = u.hp('lvNumFont') * 3 + u.hp('lvLabelFont') * 3;
  const titleMax = lvRight - lvBlockW - titleX;
  fitText(ctx, input.title, u.spec.titleWeight, u.hp('titleFont'), titleMax);
  ctx.fillStyle = '#4c4c4c';
  ctx.textBaseline = 'middle';
  ctx.fillText(ellipsize(ctx, input.title, titleMax), titleX, cy + 1);

  // Lv.（数字与字标同色同重）
  const lvText = input.level == null ? '–' : String(input.level);
  ctx.textAlign = 'right';
  ctx.font = `600 ${u.hp('lvNumFont')}px ${HEADER_SANS}`;
  ctx.fillStyle = '#4c4c4c';
  ctx.fillText(lvText, lvRight, cy + 2);
  const numW = ctx.measureText(lvText).width;
  ctx.font = `600 ${u.hp('lvLabelFont')}px ${HEADER_SANS}`;
  ctx.fillText('Lv.', lvRight - numW - u.hp('lvLabelFont') * 0.5, cy + 2);
  ctx.textAlign = 'left';
}

/**
 * 白卡 + 内部件各自入场：
 * `cardA` 卡体、`rowAt(i)` 每一行、`comboA` MAX 盒、`apA` AP 标。
 */
function drawCard(
  ctx: CanvasRenderingContext2D,
  u: EndingUnits,
  input: EndingFrameInput,
  card: CardRect,
  cardA: number,
  rowAt: (index: number) => number,
  comboA: number,
  apA: number,
): void {
  if (cardA > 0.002) {
    ctx.save();
    ctx.globalAlpha = cardA;
    withShadow(ctx, 34, 12, 0.42, () => {
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, card.left, card.top, card.w, card.h, u.hp('cardR'));
      ctx.fill();
    });
    ctx.restore();
  }

  for (let i = 0; i < ROWS.length; i++) {
    const p = rowAt(i);
    if (p <= 0.002) continue;
    ctx.save();
    ctx.globalAlpha = p;
    ctx.translate(0, (1 - p) * u.h * 0.016);
    drawRow(ctx, u, input, card, i);
    ctx.restore();
  }

  drawCombo(ctx, u, input, card, comboA);
  drawAp(ctx, u, input, card, apA);
}

function drawRow(
  ctx: CanvasRenderingContext2D,
  u: EndingUnits,
  input: EndingFrameInput,
  card: CardRect,
  index: number,
): void {
  const name = ROWS[index]!;
  const img = input.assets.judge;
  const labelH = u.hp('labelH');
  const labelX = card.left + u.hp('labelX');
  const cy = rowCy(index, card, u);
  const box = JUDGE_SPRITES[name];

  if (img && box) {
    const lw = (labelH * box[2]) / box[3];
    ctx.drawImage(img, box[0], box[1], box[2], box[3], labelX, cy - labelH / 2, lw, labelH);

    // 行线：两端渐隐、中间实线
    const ly = cy + u.hp('lineOffset');
    const lx = labelX + u.hp('lineInset');
    const len = u.hp('lineLen');
    const g = ctx.createLinearGradient(lx, 0, lx + len, 0);
    g.addColorStop(0, 'rgba(88,88,88,0)');
    g.addColorStop(0.18, 'rgba(88,88,88,0.85)');
    g.addColorStop(0.82, 'rgba(88,88,88,0.85)');
    g.addColorStop(1, 'rgba(88,88,88,0)');
    ctx.fillStyle = g;
    ctx.fillRect(lx, ly, len, Math.max(1, u.h / 540));
  }

  const value = formatCount(input.counts[ROW_COUNTS[index]!]);
  drawCount(ctx, u, value, card.left + u.hp('countRight'), cy + u.hp('countDY'), u.hp('countFont'), 'right');
}

/** 计数：前导 0 转灰，末位恒深色 */
function drawCount(
  ctx: CanvasRenderingContext2D,
  u: EndingUnits,
  value: string,
  anchor: number,
  cy: number,
  px: number,
  align: 'left' | 'right' | 'center',
): void {
  ctx.save();
  ctx.font = `${u.spec.countWeight} ${px}px ${HEADER_SANS}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const widths = [...value].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0);
  let x = align === 'right' ? anchor - total : align === 'center' ? anchor - total / 2 : anchor;
  for (let i = 0; i < value.length; i++) {
    const isLeadingZero = value[i] === '0' && i < value.length - 1;
    ctx.fillStyle = isLeadingZero ? '#c9c9c9' : '#3b3b3b';
    ctx.fillText(value[i]!, x, cy + 1);
    x += widths[i]!;
  }
  ctx.restore();
}

function drawCombo(
  ctx: CanvasRenderingContext2D,
  u: EndingUnits,
  input: EndingFrameInput,
  card: CardRect,
  a: number,
): void {
  if (a <= 0.002) return;
  const r = comboRect(card, u);
  const darkH = r.h * u.spec.comboDark;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const sc = 0.92 + 0.08 * a;
  const radius = u.hp('cardR');

  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(cx, cy);
  ctx.scale(sc, sc);
  ctx.translate(-cx, -cy);

  withShadow(ctx, 8, 2, 0.14, () => {
    ctx.fillStyle = '#5b5b5b';
    roundRect(ctx, r.x, r.y, r.w, r.h, radius);
    ctx.fill();
  });

  ctx.fillStyle = '#ffffff';
  roundRect(ctx, r.x, r.y + darkH, r.w, r.h - darkH, radius);
  ctx.fill();

  // 深色区盖住白区上缘的圆角
  ctx.fillStyle = '#5b5b5b';
  ctx.fillRect(r.x, r.y + darkH - radius, r.w, radius);

  ctx.strokeStyle = '#9a9a9a';
  ctx.lineWidth = Math.max(1, u.h / 540);
  roundRect(ctx, r.x, r.y, r.w, r.h, radius);
  ctx.stroke();

  const label = input.assets.maxCombo;
  if (label) {
    // 韩服 `MenuAtlas.png` 的真两行白字：按高度铺满深色带，水平居中
    const side = imageSide(label);
    const lh = darkH * 0.78;
    const lw = (lh * side.w) / Math.max(1, side.h);
    ctx.drawImage(label, r.x + r.w / 2 - lw / 2, r.y + (darkH - lh) / 2, lw, lh);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${u.hp('comboFont')}px ${HEADER_SANS}`;
    ctx.fillText('MAX', r.x + r.w / 2, r.y + darkH * 0.34);
    ctx.fillText('COMBO', r.x + r.w / 2, r.y + darkH * 0.72);
  }

  drawCount(
    ctx,
    u,
    formatCount(input.maxCombo),
    r.x + r.w / 2,
    r.y + darkH + (r.h - darkH) / 2,
    u.hp('comboValueFont'),
    'center',
  );
  ctx.restore();
}

/**
 * 白卡右下角的 AP / FC 标：**小号材质**（`mark-ap` / `mark-fc`），缺件走纯字；`clear` 不画。
 * 与中央章那套大图**不共用**（用户 2026-10-27：结算的图更小，章的大更高清）。
 */
function drawAp(
  ctx: CanvasRenderingContext2D,
  u: EndingUnits,
  input: EndingFrameInput,
  card: CardRect,
  a: number,
): void {
  if (input.stamp === 'clear' || a <= 0.002) return;
  const r = comboRect(card, u);
  const h = u.hp('apH');
  const cx = r.x + r.w / 2 + u.hp('apDX');
  const cy = r.y + r.h + u.hp('apGap') + h / 2;
  const sc = 0.9 + 0.1 * a;
  const img = markImage(input);

  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(cx, cy);
  ctx.scale(sc, sc);
  if (img) {
    const side = imageSide(img);
    const w = (h * side.w) / Math.max(1, side.h);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
  } else {
    // 缺件不造假：纯字，位置 / 高度与图版一致
    ctx.fillStyle = '#4c4c4c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${h * 0.72}px ${HEADER_SANS}`;
    ctx.fillText(input.stamp === 'ap' ? 'ALL PERFECT!' : 'FULL COMBO', 0, h * 0.04);
  }
  ctx.restore();
}

/**
 * 结算入场编排：背景封面 → 顶栏 → 白卡 → 五行逐条 → MAX 盒 → AP 标。
 * `q` 是一条 0..1 的入场时间轴（按 `transDur` 缩放），每件各占其中一段。
 */
function drawSettlement(
  ctx: CanvasRenderingContext2D,
  u: EndingUnits,
  input: EndingFrameInput,
  elapsed: number,
): void {
  const base = u.spec.transDur * 0.4;
  if (elapsed < base) return;
  const span = Math.max(0.45, u.spec.transDur * 0.6);
  const q = clamp01((elapsed - base) / span);
  const at = (a: number, b: number): number => smooth(clamp01((q - a) / (b - a)));

  const coverP = at(0, 0.4);
  const barP = at(0.06, 0.42);
  const cardP = at(0.08, 0.32);
  const row0 = 0.26;
  const rowStep = 0.055;
  const rowAt = (i: number): number => at(row0 + i * rowStep, row0 + i * rowStep + 0.26);
  const comboP = at(0.42, 0.66);
  const apP = at(0.56, 0.8);

  const cover = input.cover ?? openingPlaceholderCover(input.coverHue);
  const bleed = cover ? bleedCanvas(cover, u) : null;
  if (bleed && coverP > 0.002) {
    ctx.save();
    ctx.globalAlpha = coverP;
    ctx.translate(-(1 - coverP) * u.w * 0.04, 0);
    ctx.drawImage(bleed, 0, 0);
    drawCoverProp(ctx, u, cover!);
    ctx.restore();
  }

  if (barP > 0.002) {
    ctx.save();
    ctx.globalAlpha = barP;
    ctx.translate(0, -(1 - barP) * u.h * 0.035);
    drawBar(ctx, u, input);
    ctx.restore();
  }

  const card = cardMetrics(u);
  const cx = card.left + card.w / 2;
  const cy = card.top + card.h / 2;
  const s = 0.982 + 0.018 * cardP;
  ctx.save();
  ctx.translate(cx, cy + (1 - cardP) * u.h * 0.03);
  ctx.scale(s, s);
  ctx.translate(-cx, -cy);
  drawCard(ctx, u, input, card, cardP, rowAt, comboP, apP);
  ctx.restore();
}

/** 封面实体：白框 + 投影 + 方形裁切（左半幅的"舞台道具"） */
function drawCoverProp(ctx: CanvasRenderingContext2D, u: EndingUnits, cover: CanvasImageSource): void {
  const s = u.hp('coverSize');
  const cx = u.wp('coverX');
  const cy = u.hp('coverY');
  const frame = u.hp('coverFrame');
  const x = cx - s / 2;
  const y = cy - s / 2;

  withShadow(ctx, s * 0.12, s * 0.02, u.spec.coverShadow, () => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - frame, y - frame, s + frame * 2, s + frame * 2);
  });

  drawSquareCover(ctx, cover, x, y, s);
}

/** 黑幕：盖住 → 停一拍 → 抬起（抬完 0.62T，剩下 0.38T 正好留给组件逐个入场） */
function curtainAlpha(elapsed: number, transDur: number): number {
  const inT = transDur * 0.22;
  const holdT = transDur * 0.3;
  const outT = transDur * 0.62;
  if (elapsed < inT) return smooth(elapsed / inT);
  if (elapsed < holdT) return 1;
  if (elapsed < outT) return 1 - smooth((elapsed - holdT) / (outT - holdT));
  return 0;
}

// ---------------------------------------------------------------- 入口

/**
 * 画结尾段的第 `elapsed` 秒（从谱面结束那刻起算）。
 *
 * **不碰调用方的变换与 alpha**：进出各自 save/restore，内部一律按整帧坐标画
 * （舞台那张离屏图自己在建的时候就按 `stage.x / stage.y` 定位过）。
 */
export function drawEndingFrameAt(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  input: EndingFrameInput,
  elapsed: number,
  /** 参数表覆盖（原型 / 调参用；缺省 = `ENDING_SPEC`，行为不变） */
  specOverride?: Partial<EndingSpec>,
): void {
  const spec: EndingSpec = { ...ENDING_SPEC, ...specOverride };
  const u = endingUnits(w, h, spec);
  const t = Math.max(0, elapsed);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // 整帧铺底：舞台只覆盖场地矩形，留边那圈（≤1px）不能是透明
  ctx.fillStyle = SIM_FALLBACK_BG;
  ctx.fillRect(0, 0, w, h);
  drawStage(ctx, u, input, t);

  if (t < spec.stampDur) {
    if (input.stamp !== 'clear') {
      // 粒子画在字样**后面**：火花从徽章背后炸开，不糊住笔画
      drawParticles(ctx, u, input, t);
      drawStampWord(ctx, u, input, t);
    }
  } else {
    const e = t - spec.stampDur;
    // 最后一波余烬延续到幕布升起前
    if (input.stamp !== 'clear' && e < EMBERS_SECONDS) drawParticles(ctx, u, input, t);
    drawSettlement(ctx, u, input, e);
    const a = curtainAlpha(e, spec.transDur);
    if (a > 0.001) {
      ctx.globalAlpha = a;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);
    }
  }

  ctx.restore();
}
