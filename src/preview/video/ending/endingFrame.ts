// 结尾段的**一帧绘制**（chart-preview 52 / 55）：中央章（字样 + 多波粒子）→ 黑幕转场 → 结算画面。
//
// 版式照票 52「最终版式」的整份 JSON（参数在 `endingSpec.ts`），绘制顺序照原型
// `public/proto/scenes.html` 的 `render()`：
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
import { HUD_SPRITES, scoreRankAt, type ScoreRank } from '../sim/simHud';
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
  /** 中央章形态：`clear` = 无章、无角标（票 55 起**仍放普通烟花**） */
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
  /** 归一最终分（票 73：0–1,000,000；AUTO 全 PERFECT = 满分） */
  score: number;
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

/**
 * 结算 Score 行的标签（票 73 定稿）：**固定 `Score`、不做多语言**。
 * 官方图集里没有这两个字，由 Canvas 按曲名同一条字体链自绘（用户明确开的唯一文字例外）。
 */
const RESULT_LABEL = 'Score';

/** 官方 `MenuAtlas` 里已经定位的大号字母切图；其余 10 档缺切图 ⇒ 纯字降级，不许伪造 */
const RANK_LETTER_SPRITES: Partial<Record<ScoreRank, readonly [number, number, number, number]>> = {
  SS: HUD_SPRITES.rankLetter,
};

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

/**
 * `palette` 切到 `warm` / `cool` / `pink` / `mix` 时用的 4 套固定配色，每套 5 色。
 * 默认 `cycle` 不走这里，走 `ENDING_SPEC.burstC1..5`（原型里可取色）。
 */
const PALETTES = {
  warm: ['#ffe27a', '#ffb36b', '#fff3cf', '#ff8f5e', '#ffd05a'],
  cool: ['#8fe9ff', '#7df0c8', '#bcd4ff', '#a8b8ff', '#ffffff'],
  pink: ['#ff9fd2', '#d7a4ff', '#ffc2e6', '#e3b0ff', '#ffffff'],
  mix: ['#ffe25a', '#7df0c8', '#ff9fd2', '#8fe9ff', '#ffffff'],
} as const;

function burstPool(spec: EndingSpec): readonly string[] {
  const style = spec.palette;
  if (style !== 'cycle') return PALETTES[style] ?? PALETTES.mix;
  return [spec.burstC1, spec.burstC2, spec.burstC3, spec.burstC4, spec.burstC5];
}

/** 颜色解析：同时接 `#rrggbb` / `#rgb` / `rgb(...)` / `rgba(...)` */
function parseColor(color: string): [number, number, number] {
  const s = color.trim();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = Number.parseInt(v, 16);
    if (Number.isFinite(n)) return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1]!.split(',').map((x) => Number.parseFloat(x));
    return [p[0] ?? 255, p[1] ?? 255, p[2] ?? 255];
  }
  return [255, 255, 255];
}

/** 影子星的代表色往深处压一点，用作双层烟花的彩色本体（票 55 E10） */
function shadeColor(color: string, k: number): string {
  const [r, g, b] = parseColor(color);
  const f = (v: number): number => Math.round(clamp01((v * k) / 255) * 255);
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}

function rgbaOf(color: string, alpha: number): string {
  const [r, g, b] = parseColor(color);
  return `rgba(${r},${g},${b},${clamp01(alpha)})`;
}

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

/** 拆字结果：从左到右的字形（不含星标、不含 `!`）+ 星标 + `!` */
interface GlyphSplit {
  glyphs: GlyphSprite[];
  star: GlyphSprite | null;
  /** `!`（闪电 + 圆点，在图上粘成一枚）—— 从字母队列摘出，单独演飞镖式入场 */
  bang: GlyphSprite | null;
  /** 摘出 `!` 之前的字形数：字母队列仍按它算 stagger，前面的时序一帧不改 */
  waveCount: number;
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
  /** 逐字母用：单独演的 `!`（拆不出 = null，退回老路径随队列落） */
  bang: GlyphSprite | null;
  /** 含 `!` 在内的原字形数，用来冻结字母队列时序 */
  waveCount: number;
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

  // `!`（闪电 + 圆点）粘成一枚、排在队列最右。把它从字母层摘出去单独演（票 55），
  // 但 `waveCount` 记的是摘之前的枚数 —— 字母队列的 stagger 照旧，前面的字一帧不差。
  let bang: GlyphSprite | null = null;
  if (glyphs.length >= 3) {
    const last = glyphs[glyphs.length - 1]!;
    if (last.nx > 0.78) bang = glyphs.pop()!;
  }
  return { glyphs, star, bang, waveCount: glyphs.length + (bang ? 1 : 0) };
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
    bang: split?.bang ?? null,
    waveCount: split?.waveCount ?? 0,
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
    // 结尾段不画判定字 / 打歌顶栏：那是打歌时的东西，结算只剩舞台
    judge: null,
    hud: false,
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

  // `waveCount` 是摘出 `!` 之前的枚数：判定「能否拆」仍按原口径，别把摘字误判成拆不开
  if (word.waveCount >= 2) {
    // 层级：双层烟花在字样后面（票 55 E9）
    drawStampHalo(ctx, u, word, elapsed, alpha);
    drawGlyphWave(ctx, u, word, elapsed, alpha);
    drawStampStar(ctx, u, word, elapsed, alpha);
    drawStampBang(ctx, u, word, elapsed, alpha);
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
  // 队列长度含被摘出去的 `!`：stagger 仍按原枚数算，前面字母的时序一帧不改
  const n = Math.max(word.glyphs.length, word.waveCount || 0);
  const stagger = n > 1 ? (span - dur) / (n - 1) : 0;
  const drop = (u.spec.letterDrop / 100) * word.h;
  const bounce = Math.max(0, u.spec.letterBounce);
  const inAlpha = clamp01(u.spec.letterInAlpha);
  const halfW = word.w / 2;
  const halfH = word.h / 2;

  for (let i = 0; i < word.glyphs.length; i++) {
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
  /**
   * 星标基准按**字块高**定，不按各图自己的 `inkW`：两张章里那颗小星原图不等大
   * （字芯宽 AP 69px / FC 62px），按图取会让 FC 的落位星 / 影子星 / 两层烟花整圈小一圈。
   * `norm` 把各图的星贴片拉到同一基准，AP ≈ 1×、FC ≈ 1.11×。
   */
  const inkSize = Math.max(1, word.h * u.spec.starSizeRef);
  const norm = inkSize / Math.max(1, star.inkW * word.w);
  const sw = star.nw * word.w * norm;
  const sh = star.nh * word.h * norm;
  // 终态位置 = 原图里那个位置（落定后与"!"重新拼回同一张图）
  const homeX = (star.nx + star.nw / 2) * word.w - word.w / 2;
  const homeY = (star.ny + star.nh / 2) * word.h - word.h / 2;

  // 与 `!`、两层烟花共用同一份时间轴：改 `stampIn` / `starGrow` 时不会再各自漂
  const T = starTimeline(u);
  const { at, growDur, growEnd, flyStart, flyDur, landAt, ghostDur } = T;
  const big = T.big;
  const spin = T.spin;

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
  const gq = (elapsed - flyStart) / ghostDur;
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

/** 星标 / 影子星 / `!` / 两层烟花**共用**的时间轴：只有这一处推导 `landAt` */
interface StarTimeline {
  at: number;
  growDur: number;
  growEnd: number;
  flyStart: number;
  flyDur: number;
  landAt: number;
  big: number;
  spin: number;
  ghostDur: number;
}

function starTimeline(u: EndingUnits): StarTimeline {
  const inSec = Math.max(0.05, u.spec.stampIn);
  const at = Math.max(0, (u.spec.starAt / 100) * inSec);
  const growDur = Math.max(0.02, (u.spec.starGrow / 100) * inSec);
  const flyDur = Math.max(0.02, (u.spec.starFly / 100) * inSec);
  const growEnd = at + growDur;
  const flyStart = growEnd + (Math.max(0, u.spec.starHold) / 100) * inSec;
  return {
    at,
    growDur,
    growEnd,
    flyStart,
    flyDur,
    landAt: flyStart + flyDur,
    big: Math.max(0.2, u.spec.starBig),
    spin: (u.spec.starSpin * Math.PI) / 180,
    ghostDur: Math.max(0.02, u.spec.ghostDur),
  };
}

/**
 * `!` 的飞镖式入场（票 55）：不进字母队列，锚在星标落定前后。
 * 支点取字形左下角而不是中心，才有「镖尖插住、镖尾还在晃」的观感。
 */
function drawStampBang(
  ctx: CanvasRenderingContext2D,
  u: EndingUnits,
  word: WordLayer,
  elapsed: number,
  alpha: number,
): void {
  const g = word.bang;
  if (!g) return;
  const T = starTimeline(u);
  const start = T.landAt + u.spec.bangAt;
  const wipe = Math.max(0.02, u.spec.bangWipe);
  const settle = Math.max(0.02, u.spec.bangSettle);
  const age = elapsed - start;
  if (age < 0) return;

  const gw = g.nw * word.w;
  const gh = g.nh * word.h;
  // `drawStampWord` 已把原点移到字块中心，下面都是字块相对坐标
  const px = g.nx * word.w - word.w / 2;
  const py = (g.ny + g.nh) * word.h - word.h / 2;
  const fromX = u.hp('bangFromX');
  const fromY = u.hp('bangFromY');
  const overX = u.hp('bangOverX');
  const overY = u.hp('bangOverY');

  let dx = 0;
  let dy = 0;
  let rot = 0;
  let a = alpha;
  if (age < wipe) {
    const q = clamp01(age / wipe);
    const e = easeOutCubic(q);
    dx = fromX + (-overX - fromX) * e;
    dy = -fromY + (overY + fromY) * e;
    a = alpha * smooth(clamp01(q / 0.4));
  } else {
    const q = clamp01((age - wipe) / settle);
    const e = easeOutCubic(q);
    dx = -overX * (1 - e);
    dy = overY * (1 - e);
    const decay = Math.pow(1 - q, Math.max(0.05, u.spec.bangDamp));
    rot =
      ((u.spec.bangWobble * Math.PI) / 180) *
      decay *
      Math.sin(q * Math.PI * 2 * Math.max(0.5, u.spec.bangWobbles));
  }

  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(px + dx, py + dy);
  if (rot) ctx.rotate(rot);
  ctx.drawImage(g.canvas, 0, -gh, gw, gh);
  ctx.restore();
}

/**
 * 菱形层本体：不是正规菱形，四条边往外鼓（「鼓起来肚子」）。
 * 菱形自身不旋转（票 55 E10）。
 */
function drawBulgeDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  color: string,
  alpha: number,
  bulge: number,
): void {
  if (alpha <= 0.004 || w <= 0 || h <= 0) return;
  const hw = w / 2;
  const hh = h / 2;
  // 一条二次曲线给不出「四个尖 + 鼓肚子」：控制点往外推会把尖磨圆，往里收又没肚子。
  // 改三次：靠尖的那个控制点几乎沿切线走（保住尖角），靠中段的那个往外推（鼓出肚子）。
  const near = 0.34;
  const far = 0.6 + 0.35 * bulge;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, -hh);
  ctx.bezierCurveTo(hw * near, -hh * far, hw * far, -hh * near, hw, 0);
  ctx.bezierCurveTo(hw * far, hh * near, hw * near, hh * far, 0, hh);
  ctx.bezierCurveTo(-hw * near, hh * far, -hw * far, hh * near, -hw, 0);
  ctx.bezierCurveTo(-hw * far, -hh * near, -hw * near, -hh * far, 0, -hh);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/**
 * 中心的两层烟花：都画在**字样后面**（票 55 E9，层级跟普通烟花一样）。
 * 菱形层是从中心扩散的另一层爆炸，**不是**影子星的顶点（用户第三轮更正）。
 * 两层彩色本体都取「影子星颜色压深一点」，另一种是纯白。
 */
function drawStampHalo(
  ctx: CanvasRenderingContext2D,
  u: EndingUnits,
  word: WordLayer,
  elapsed: number,
  alpha: number,
): void {
  const star = word.star;
  if (u.spec.haloOn < 0.5 || !star) return;
  const T = starTimeline(u);
  const tint =
    u.spec.ghostTint && u.spec.ghostTint !== 'auto' ? u.spec.ghostTint : starTint(star.canvas);
  const ink = shadeColor(tint, clamp01(u.spec.haloDarken));
  const white = '#ffffff';
  // 与 `drawStampStar` 同一个归一化基准：AP / FC 的两层烟花才会一样大
  const inkSize = Math.max(1, word.h * u.spec.starSizeRef);

  // ① 外围圆环
  const age = elapsed - T.flyStart;
  const total = T.ghostDur + Math.max(0, u.spec.haloSurvive);
  if (age >= 0 && age <= total) {
    // 终点取 `haloGrow` 而不是 `ghostGrow`：影子星长到 10× 时早已淡出画外
    const ghostTo = Math.max(T.big, u.spec.haloGrow);
    const ge = easeOutCubic(clamp01(age / T.ghostDur));
    const starSize = inkSize * (T.big + (ghostTo - T.big) * ge);
    const rot = T.spin + ((u.spec.ghostSpin * Math.PI) / 180) * ge;
    const fadeIn = smooth(clamp01(age / (total * 0.12)));
    const fadeOut =
      1 - smooth(clamp01((age - T.ghostDur * 0.6) / Math.max(0.02, total - T.ghostDur * 0.6)));
    const a = alpha * u.spec.haloAlpha * fadeIn * fadeOut;
    if (a > 0.004) {
      const ringR = (starSize / 2) * u.spec.haloRingRadius;
      const ringW = Math.max(1, u.hp('haloRingWidth'));
      ctx.save();
      ctx.globalAlpha = a * u.spec.haloRingAlpha;
      ctx.strokeStyle = ink;
      ctx.lineWidth = ringW;
      ctx.beginPath();
      ctx.arc(0, 0, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      const n = Math.max(0, Math.round(u.spec.haloRingStars));
      const starR = ringR * (1 + u.spec.haloRingOffset) + ringW * 0.8;
      const ringStarPx = u.hp('haloRingStarSize');
      for (let i = 0; i < n; i++) {
        const ang = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2 + rot * 0.35;
        drawSolidStar(
          ctx,
          Math.cos(ang) * starR,
          Math.sin(ang) * starR,
          ringStarPx,
          0,
          i % 2 ? white : ink,
          a * 0.9,
        );
      }
    }
  }

  // ② 菱形爆炸
  const diaAt = T.flyStart + Math.max(0, u.spec.haloDiaAt);
  const diaDur = Math.max(0.02, u.spec.haloDiaDur);
  const diaFade = Math.max(0.02, u.spec.haloDiaFade);
  const diaAge = elapsed - diaAt;
  // 淡出起点与扩散重叠（票 55 第四轮）：旧口径「先到位、再淡」用户不要。
  const fadeAt = clamp01(u.spec.haloDiaFadeAt) * diaDur;
  if (diaAge < 0 || diaAge > fadeAt + diaFade) return;
  const dq = clamp01(diaAge / diaDur);
  const R = inkSize * (u.spec.haloDiaFrom + (u.spec.haloDiaTo - u.spec.haloDiaFrom) * easeOutCubic(dq));
  const appear = smooth(clamp01(diaAge / (diaDur * 0.25)));
  // 线性衰减而不是 smooth：smooth 起步太平，会在最外侧"停"一小段，看着仍像到位后才淡
  const vanish = Math.pow(1 - clamp01((diaAge - fadeAt) / diaFade), 1.15);
  const da = alpha * u.spec.haloAlpha * appear * vanish;
  if (da <= 0.004) return;

  const n = Math.max(0, Math.round(u.spec.haloDiaCount));
  const jitter = clamp01(u.spec.haloDiaJitter);
  const layout = u.spec.haloDiaLayout;
  // 固定种子：导出逐帧可复现
  const rnd = mulberry32(Math.round(u.spec.haloDiaSeed) * 7919 + n * 31);
  const diaH = u.hp('haloDiaSize');
  const spokes = 6;
  const perSpoke = Math.max(1, Math.ceil(n / spokes));
  for (let i = 0; i < n; i++) {
    let ang: number;
    let rk: number;
    if (layout === 'scatter') {
      ang = rnd() * Math.PI * 2;
      rk = 0.55 + 0.45 * rnd();
    } else if (layout === 'spokes') {
      const g = i % spokes;
      const k = Math.floor(i / spokes);
      ang = -Math.PI / 2 + (g / spokes) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
      rk = 0.35 + 0.65 * (k / Math.max(1, perSpoke - 1));
    } else {
      ang =
        -Math.PI / 2 +
        (i / Math.max(1, n)) * Math.PI * 2 +
        (rnd() - 0.5) * ((Math.PI * 2) / Math.max(1, n)) * jitter * 2;
      rk = 1;
    }
    const rr = R * (rk + (rnd() - 0.5) * 2 * jitter * 0.22);
    const sizeK = 0.72 + rnd() * 0.56;
    drawBulgeDiamond(
      ctx,
      Math.cos(ang) * rr,
      Math.sin(ang) * rr,
      diaH * 0.72 * sizeK,
      diaH * sizeK,
      i % 2 ? white : ink,
      da * (0.7 + 0.3 * rnd()),
      0.9,
    );
  }
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

interface BurstWave {
  wave: number;
  at: number;
  points: Array<[number, number]>;
  /** 每个爆点各自的起爆时刻（错峰，不再一口气齐爆） */
  ats: number[];
  /** 每个爆点单色：波里有几点就出现几色，5 点波才凑齐 5 色 */
  colors: string[];
  /** 每个爆点的星数 */
  n: number;
  speed: number;
}

/** 散点位置：绕画面中心的椭圆上均布（避开正中，免得全被字块挡住），各波错相位 */
function scatterPoints(
  n: number,
  seed: number,
  u: EndingUnits,
  phase = 0,
): Array<[number, number]> {
  const rnd = mulberry32(seed);
  const pts: Array<[number, number]> = [];
  const rx = u.w * (u.spec.burstScatterX / 100);
  const ry = u.h * (u.spec.burstScatterY / 100);
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + phase + (i / n) * Math.PI * 2 + (rnd() - 0.5) * u.spec.burstJitter;
    pts.push([
      u.w / 2 + Math.cos(ang) * rx * (0.86 + rnd() * 0.22),
      u.hp('stampY') + Math.sin(ang) * ry * (0.86 + rnd() * 0.22),
    ]);
  }
  return pts;
}

/** 最多 6 波；用哪几波由 `burstWaveCount` 定，时刻 / 点数读 `burst2..6At/Points`。 */
function burstWaves(u: EndingUnits): BurstWave[] {
  const s = u.spec;
  const count = Math.max(0, s.partCount) * Math.max(0, s.burstDensity);
  const pool = burstPool(s);
  const defs: Array<{
    at: number;
    points: Array<[number, number]>;
    n: number;
    speed: number;
  }> = [
    { at: 0.02 * s.stampDur, points: [[u.w / 2, u.hp('stampY')]], n: count, speed: 1 },
    {
      at: (s.burst2At / 100) * s.stampDur,
      points: [[u.wp('burst2X'), u.hp('burst2Y')]],
      n: count * 0.6,
      speed: 0.86,
    },
    {
      at: (s.burst3At / 100) * s.stampDur,
      points: [[u.wp('burst3X'), u.hp('burst3Y')]],
      n: count * 0.55,
      speed: 0.8,
    },
    {
      at: (s.burst4At / 100) * s.stampDur,
      points: scatterPoints(Math.max(1, Math.round(s.burst4Points)), 41, u, 0),
      n: count * 0.34,
      speed: 0.72,
    },
    {
      at: (s.burst5At / 100) * s.stampDur,
      points: scatterPoints(Math.max(1, Math.round(s.burst5Points)), 97, u, 0.35),
      n: count * 0.3,
      speed: 0.68,
    },
    {
      at: (s.burst6At / 100) * s.stampDur,
      points: scatterPoints(Math.max(1, Math.round(s.burst6Points)), 151, u, 0.7),
      n: count * 0.34,
      speed: 0.64,
    },
  ];
  const waves = Math.max(1, Math.min(defs.length, Math.round(s.burstWaveCount)));
  const stagger = Math.max(0, s.burstStagger);
  return defs.slice(0, waves).map(
    (d, gi): BurstWave => ({
      wave: gi,
      at: d.at,
      points: d.points,
      ats: d.points.map((_, pi) => d.at + pi * stagger),
      colors: d.points.map((_, pi) => pool[(gi + pi) % pool.length] ?? '#ffffff'),
      n: d.n,
      speed: d.speed,
    }),
  );
}

let particleCache: { key: string; list: EndingParticle[] } | null = null;

function particles(u: EndingUnits): EndingParticle[] {
  // key 必须带上 spec：否则同分辨率下调 `partCount` / `burst*` 会复用旧表，滑杆看着没反应
  const key = `${u.w}x${u.h}|${JSON.stringify(u.spec)}`;
  if (particleCache && particleCache.key === key) return particleCache.list;
  const out: EndingParticle[] = [];
  burstWaves(u).forEach((grp, gi) => {
    grp.points.forEach((pt, pi) => {
      const rnd = mulberry32(3000 + gi * 131 + pi * 17);
      const count = Math.max(1, Math.round(grp.n));
      // 一个爆点一种颜色：整点所有星星共用它，不再点内混色
      const color = grp.colors[pi] ?? '#ffffff';
      const at = grp.ats[pi] ?? grp.at;
      for (let i = 0; i < count; i++) {
        const ang = rnd() * Math.PI * 2;
        // 同一组共用一个减速度 ⇒ 扩散成一圈（烟花），而不是一团随机散点
        const sp = (960 + rnd() * 380) * u.spec.partSpeed * grp.speed;
        out.push({
          ox: pt[0],
          oy: pt[1],
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp * 0.86,
          size: u.hp('partSize') * (0.65 + rnd() * 0.6) * (grp.wave >= 3 ? 0.85 : 1),
          color,
          spin: (rnd() - 0.5) * 7,
          life: Math.max(0.05, u.spec.partLife) + rnd() * 0.35,
          delay: rnd() * 0.04,
          at,
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
    const fade = Math.pow(1 - age / p.life, Math.max(0.05, u.spec.partFadePow));
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

  for (const grp of burstWaves(u)) {
    grp.points.forEach((pt, pi) => {
      const age = elapsed - (grp.ats[pi] ?? grp.at);
      if (age < 0 || age > 0.26) return;
      const a = Math.pow(1 - age / 0.26, 2) * 0.2;
      const r = u.hp('partSize') * (3 + age * 26);
      const color = grp.colors[pi] ?? '#ffffff';
      const gr = ctx.createRadialGradient(pt[0], pt[1], 0, pt[0], pt[1], r);
      gr.addColorStop(0, rgbaOf(color, a));
      gr.addColorStop(0.45, rgbaOf(color, a * 0.45));
      gr.addColorStop(1, rgbaOf(color, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(pt[0] - r, pt[1] - r, r * 2, r * 2);
    });
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

/** 顶栏：星徽 + 难度 + 曲名 + Lv（票 73 起右上另有一枚 SCORE RANK 徽章） */
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
 * 白卡首行（票 73）：圆星章 + 固定 `Score` + 归一最终分 + 点线分隔。
 * 位置按卡宽等比（`u.hp` 在 16:9 帧上与原型 `card.w/720` 等价）；
 * 圆星章缺件就**留空**（不画假章），标签 / 分数按用户定案自绘。
 */
function drawResultRow(
  ctx: CanvasRenderingContext2D,
  u: EndingUnits,
  input: EndingFrameInput,
  card: CardRect,
  alpha: number,
): void {
  if (alpha <= 0.002) return;
  const padX = u.hp('resultPadX');
  const rowH = u.hp('resultRowH');
  const fpx = u.hp('resultFont');
  const cy = card.top + rowH * 0.5 + u.hp('resultRowDY');
  const medalH = fpx * 1.15;
  const tx = card.left + padX + medalH + fpx * 0.3;
  const sx = card.left + card.w - padX;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textBaseline = 'middle';
  const img = input.assets.rhythmGameUI;
  if (img) {
    const m = HUD_SPRITES.medal;
    ctx.drawImage(img, m[0], m[1], m[2], m[3], card.left + padX, cy - medalH / 2, medalH, medalH);
  }
  ctx.textAlign = 'left';
  ctx.font = `600 ${fpx}px ${HEADER_SANS}`;
  ctx.fillStyle = '#3b3b3b';
  ctx.fillText(RESULT_LABEL, tx, cy + 1);

  // 分数：整串右对齐、粉字白描边、无前导零
  ctx.textAlign = 'right';
  ctx.font = `800 ${u.hp('resultScoreFont')}px ${HEADER_SANS}`;
  ctx.lineWidth = Math.max(2, fpx * 0.14);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(String(input.score), sx, cy + 1);
  ctx.fillStyle = '#e8417f';
  ctx.fillText(String(input.score), sx, cy + 1);

  const dy = card.top + rowH - fpx * 0.76;
  const dot = Math.max(1.5, fpx * 0.1);
  ctx.fillStyle = '#cfcfcf';
  for (let x = card.left + padX; x < card.left + card.w - padX; x += dot * 2.6) {
    ctx.beginPath();
    ctx.arc(x, dy, dot * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 右上 SCORE RANK 徽章（票 73）：官方 `MenuAtlas` 太阳纹圆盘 + 大号字母 + `SCORE RANK` 缎带。
 * 11 档与打歌 6 档独立；只有 SS 的大号字母切图已登记，其余档 / 缺图集走**纯字**降级。
 */
function drawRankBadge(
  ctx: CanvasRenderingContext2D,
  u: EndingUnits,
  input: EndingFrameInput,
  alpha: number,
): void {
  if (alpha <= 0.002) return;
  const rank = scoreRankAt(input.score);
  const menu = input.assets.menu;
  const size = u.wp('rankSize');
  const x = u.w - u.wp('rankRight') - size;
  const y = u.wp('rankTop');
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${size * 0.34}px ${HEADER_SANS}`;
  ctx.fillStyle = '#3b3b3b';
  if (!menu) {
    ctx.fillText(rank, x + size / 2, y + size / 2);
    ctx.restore();
    return;
  }

  const d = HUD_SPRITES.rankDisc;
  const dh = (d[3] / d[2]) * size;
  ctx.drawImage(menu, d[0], d[1], d[2], d[3], x, y, size, dh);

  const letter = RANK_LETTER_SPRITES[rank];
  const lw = size * u.spec.rankLetterScale;
  if (letter) {
    const lh = (letter[3] / letter[2]) * lw;
    ctx.drawImage(menu, letter[0], letter[1], letter[2], letter[3],
      x + (size - lw) / 2, y + (dh - lh) / 2, lw, lh);
  } else {
    ctx.fillText(rank, x + size / 2, y + dh / 2);
  }

  const rb = HUD_SPRITES.ribbon;
  const rw = u.wp('ribbonW');
  const rh = (rb[3] / rb[2]) * rw;
  ctx.drawImage(menu, rb[0], rb[1], rb[2], rb[3],
    x + (size - rw) / 2, y + dh + u.wp('ribbonBelow'), rw, rh);
  ctx.restore();
}

/**
 * 白卡 + 内部件各自入场：
 * `cardA` 卡体、`rowAt(i)` 每一行、`comboA` MAX 盒、`apA` AP 标、`scoreP` Score 行。
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
  scoreP: number,
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

  // Score 行在五行判定之前画：它占的是卡片顶部那一行，时序与卡片本体同一把尺
  drawResultRow(ctx, u, input, card, scoreP);
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
  // AP / FC 各自倍率：原始两图同为 40px 高，但 256×40 与 221×40 的视觉分量不同（票 55 B）
  const scale = input.stamp === 'ap' ? u.spec.markApScale : u.spec.markFcScale;
  const h = u.hp('apH') * Math.max(0.05, scale);
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
  // 票 73：Score 行与 SCORE RANK 徽章各占入场轴的一段（卡片本体 0.08→0.32、五行 0.26→0.52）。
  // 生产里黑幕是在 drawSettlement **之后**盖的，所以这两件天然画在幕下，不必再乘一次 alpha。
  const scoreP = at(u.spec.resultInAt / 100, (u.spec.resultInAt + u.spec.resultInDur) / 100);
  const rankP = at(u.spec.rankInAt / 100, (u.spec.rankInAt + u.spec.rankInDur) / 100);

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
  drawCard(ctx, u, input, card, cardP, rowAt, comboP, apP, scoreP);
  ctx.restore();
  // 徽章画在整帧右上角（不随白卡缩放），单独一条淡入
  drawRankBadge(ctx, u, input, rankP);
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

  // CLEAR 没有中央章 / 影子星，但**要有普通烟花**（票 55 C：沿用同一套波表与配色）
  const bursts = spec.clearBurst > 0.5 || input.stamp !== 'clear';
  if (t < spec.stampDur) {
    if (bursts) {
      // 粒子画在字样**后面**：火花从徽章背后炸开，不糊住笔画
      drawParticles(ctx, u, input, t);
    }
    if (input.stamp !== 'clear') drawStampWord(ctx, u, input, t);
  } else {
    const e = t - spec.stampDur;
    // 最后一波余烬延续到幕布升起前
    if (bursts && e < EMBERS_SECONDS) drawParticles(ctx, u, input, t);
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
