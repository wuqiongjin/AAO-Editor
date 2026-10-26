// 结尾段的**一帧绘制**（chart-preview 52）：中央章（字样 + 5 波粒子）→ 黑幕转场 → 结算画面。
//
// 版式照票 52「最终版式」的整份 JSON（参数在 `endingSpec.ts`），绘制顺序照原型
// `public/proto/ending.html` 的 `draw()`：
//
//   ① 舞台（= **仿真场末帧**，取景沿用 `simField` 的 `backgroundRect`；轨道 / 判定线仍在）
//   ② 章：粒子（画在字样**后面**）→ 字样羽化擦入
//   ③ 转场：结算组件逐个入场，黑幕盖 0.22T → 停 0.30T → 抬完 0.62T
//   ④ 结算：左半封面满幅 + 向右渐隐、封面实体、顶栏、白卡（五行 + MAX COMBO）、AP 标
//
// 三条口径（都是用户拍过的）：
//   - **整帧 1920×1080**：结尾 UI 按帧高缩放，不嵌进场地矩形（嵌进去会整体缩 0.2%）。
//   - **缺件不造假**：`all_perfect.png` / `judge.png` / 粒子图集缺哪件，那一处就走纯字 / 不画；
//     不画假徽章（票 52 Q12）。
//   - **不开第二份渲染真相**：章的舞台直接调 `drawSimFrameAt` 画谱面末帧，并按导出一次缓存成
//     一张离屏图（逐帧重画 1080p 场地是纯浪费）；UI 层与仿真场互不共享画笔。
import { HEADER_SANS } from '../../fontStack';
import { drawSimFrameAt, SIM_FALLBACK_BG, type SimFrameInput } from '../sim/simField';
import { drawSquareCover, openingPlaceholderCover } from '../opening/openingFrame';
import {
  ENDING_SPEC,
  ENDING_STAMP_SECONDS,
  ENDING_TRANS_SECONDS,
  endingUnits,
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

/** 章舞台（仿真场末帧）：按 `EndingStageInput` 对象身份缓存，一次导出只画一次 */
const stageCache = new WeakMap<EndingStageInput, { w: number; h: number; canvas: HTMLCanvasElement }>();

function stageCanvas(input: EndingFrameInput, w: number, h: number): HTMLCanvasElement | null {
  // 无 DOM（单测 / node）时不造离屏图：绘制侧只铺兜底底色，不炸
  if (typeof document === 'undefined') return null;
  const hit = stageCache.get(input.stage);
  if (hit && hit.w === w && hit.h === h) return hit.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.setTransform(1, 0, 0, 1, input.stage.x, input.stage.y);
  drawSimFrameAt(g, input.stage.frame, input.stage.seconds);
  stageCache.set(input.stage, { w, h, canvas });
  return canvas;
}

/** 结算左半幅的背景封面（虚化 + 压暗 + 向右渐隐）：一张图，按封面身份缓存 */
let bleedCache: { cover: CanvasImageSource; w: number; h: number; canvas: HTMLCanvasElement } | null =
  null;

function bleedCanvas(cover: CanvasImageSource, u: EndingUnits): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (bleedCache && bleedCache.cover === cover && bleedCache.w === u.w && bleedCache.h === u.h) {
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

  g.filter = `blur(${ENDING_SPEC.bgBlur}px) saturate(0.9) brightness(${ENDING_SPEC.bgBright / 100})`;
  g.drawImage(cover, 0, 0, dw, u.h);
  g.filter = 'none';

  // 压暗（只压在封面层上）
  const scrim = g.createLinearGradient(0, 0, u.wp('bgFadeTo'), 0);
  scrim.addColorStop(0, `rgba(8,12,20,${ENDING_SPEC.bgScrim / 100})`);
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
  bleedCache = { cover, w: u.w, h: u.h, canvas };
  return canvas;
}

/** 章字样层（原图或纯字）+ 擦入用的遮罩层 */
interface WordLayer {
  stamp: EndingStamp;
  img: CanvasImageSource | null;
  w: number;
  h: number;
  layer: HTMLCanvasElement;
  mask: HTMLCanvasElement;
}

let wordCache: WordLayer | null = null;

function wordLayer(input: EndingFrameInput, wPx: number): WordLayer | null {
  if (typeof document === 'undefined') return null;
  const img = input.stamp === 'ap' ? input.assets.stamp : null;
  if (wordCache && wordCache.stamp === input.stamp && wordCache.img === img && wordCache.w === wPx) {
    return wordCache;
  }
  const w = Math.max(1, Math.round(wPx));
  const h = Math.max(1, Math.round(w * WORD_ASPECT));
  const layer = document.createElement('canvas');
  layer.width = w;
  layer.height = h;
  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = h;
  const g = layer.getContext('2d');
  if (!g) return null;

  if (img) {
    g.drawImage(img, 0, 0, w, h);
  } else {
    // 缺 AP 图 / FC 没有官方字样 ⇒ **纯字**（票 52 Q12：缺件不造假徽章）
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

  wordCache = { stamp: input.stamp, img, w, h, layer, mask };
  return wordCache;
}

// ---------------------------------------------------------------- 舞台

function drawStage(ctx: CanvasRenderingContext2D, u: EndingUnits, input: EndingFrameInput): void {
  const layer = stageCanvas(input, u.w, u.h);
  if (layer) {
    ctx.drawImage(layer, 0, 0);
    return;
  }
  ctx.fillStyle = SIM_FALLBACK_BG;
  ctx.fillRect(0, 0, u.w, u.h);
}

// ---------------------------------------------------------------- 中央章

/**
 * 章字样：羽化擦入（软边 + 轻微上浮 / 缩放）→ 停满强度 → 淡出。
 *
 * 擦入用 `destination-in` + **绝对坐标**渐变（`pos−feather → pos`，两侧由 canvas 自动夹住）：
 * 早期版本按进度分档构造渐变，`p ≈ 0` 那一帧会退化成整幅渐变 —— 看起来就是"闪一下"。
 */
function drawStampWord(
  ctx: CanvasRenderingContext2D,
  u: EndingUnits,
  input: EndingFrameInput,
  elapsed: number,
): void {
  const word = wordLayer(input, u.wp('stampW'));
  if (!word) return;
  const inSec = Math.max(0.05, ENDING_SPEC.stampIn);
  const p = clamp01(elapsed / inSec);
  const fadeStart = ENDING_STAMP_SECONDS - Math.max(0, ENDING_SPEC.stampOut);
  const alpha =
    elapsed >= fadeStart ? 1 - smooth((elapsed - fadeStart) / Math.max(0.01, ENDING_SPEC.stampOut)) : 1;
  if (alpha <= 0.003) return;

  const g = word.mask.getContext('2d');
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, word.w, word.h);
  g.drawImage(word.layer, 0, 0);

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
  ctx.globalAlpha = alpha;
  ctx.translate(u.w / 2, u.hp('stampY') + lift);
  ctx.scale(scale, scale);

  // 字块后面的柔光（不是星，不遮挡笔画）
  if (ENDING_SPEC.wordGlow > 0.001 && p < 0.85) {
    const glowA = ENDING_SPEC.wordGlow * (1 - smooth((p - 0.5) / 0.35)) * 0.55;
    if (glowA > 0.002) {
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, word.w * 0.55);
      gr.addColorStop(0, `rgba(190,240,255,${glowA})`);
      gr.addColorStop(1, 'rgba(190,240,255,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(-word.w * 0.6, -word.h * 0.9, word.w * 1.2, word.h * 1.8);
    }
  }

  ctx.drawImage(word.mask, -word.w / 2, -word.h / 2);
  ctx.restore();
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

function paletteFor(wave: number): readonly string[] {
  const style = ENDING_SPEC.palette;
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
  const count = ENDING_SPEC.partCount;
  return [
    { wave: 0, at: 0.02 * ENDING_STAMP_SECONDS, points: [[u.w / 2, u.hp('stampY')]], n: count, speed: 1 },
    {
      wave: 1,
      at: (ENDING_SPEC.burst2At / 100) * ENDING_STAMP_SECONDS,
      points: [[u.wp('burst2X'), u.hp('burst2Y')]],
      n: count * 0.46,
      speed: 0.86,
    },
    {
      wave: 2,
      at: (ENDING_SPEC.burst3At / 100) * ENDING_STAMP_SECONDS,
      points: [[u.wp('burst3X'), u.hp('burst3Y')]],
      n: count * 0.4,
      speed: 0.8,
    },
    {
      wave: 3,
      at: (ENDING_SPEC.burst4At / 100) * ENDING_STAMP_SECONDS,
      points: scatterPoints(Math.max(1, Math.round(ENDING_SPEC.burst4Points)), 41, u),
      n: count * 0.3,
      speed: 0.72,
    },
    {
      wave: 4,
      at: (ENDING_SPEC.burst5At / 100) * ENDING_STAMP_SECONDS,
      points: scatterPoints(Math.max(1, Math.round(ENDING_SPEC.burst5Points)), 97, u),
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
    const colors = paletteFor(grp.wave);
    grp.points.forEach((pt, pi) => {
      const rnd = mulberry32(3000 + gi * 131 + pi * 17);
      const count = Math.max(1, Math.round(grp.n));
      for (let i = 0; i < count; i++) {
        const ang = rnd() * Math.PI * 2;
        // 同一组共用一个减速度 ⇒ 扩散成一圈（烟花），而不是一团随机散点
        const sp = (960 + rnd() * 380) * ENDING_SPEC.partSpeed * grp.speed;
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

  const star = input.assets.badgeStar;
  if (star) {
    const ss = u.hp('starSize');
    ctx.drawImage(star, x + u.hp('starDX') - ss / 2, cy - ss / 2, ss, ss);
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
  fitText(ctx, input.title, ENDING_SPEC.titleWeight, u.hp('titleFont'), titleMax);
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
  drawCount(ctx, value, card.left + u.hp('countRight'), cy + u.hp('countDY'), u.hp('countFont'), 'right');
}

/** 计数：前导 0 转灰，末位恒深色 */
function drawCount(
  ctx: CanvasRenderingContext2D,
  value: string,
  anchor: number,
  cy: number,
  px: number,
  align: 'left' | 'right' | 'center',
): void {
  ctx.save();
  ctx.font = `${ENDING_SPEC.countWeight} ${px}px ${HEADER_SANS}`;
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
  const darkH = r.h * ENDING_SPEC.comboDark;
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

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${u.hp('comboFont')}px ${HEADER_SANS}`;
  ctx.fillText('MAX', r.x + r.w / 2, r.y + darkH * 0.34);
  ctx.fillText('COMBO', r.x + r.w / 2, r.y + darkH * 0.72);

  drawCount(
    ctx,
    formatCount(input.maxCombo),
    r.x + r.w / 2,
    r.y + darkH + (r.h - darkH) / 2,
    u.hp('comboValueFont'),
    'center',
  );
  ctx.restore();
}

/** AP / FC 标：有图用图，没图（FC / 缺件）走纯字；`clear` 不画 */
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
  const img = input.stamp === 'ap' ? input.assets.stamp : null;

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
  const base = ENDING_TRANS_SECONDS * 0.4;
  if (elapsed < base) return;
  const span = Math.max(0.45, ENDING_TRANS_SECONDS * 0.6);
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

  withShadow(ctx, s * 0.12, s * 0.02, ENDING_SPEC.coverShadow, () => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - frame, y - frame, s + frame * 2, s + frame * 2);
  });

  drawSquareCover(ctx, cover, x, y, s);
}

/** 黑幕：盖住 → 停一拍 → 抬起（抬完 0.62T，剩下 0.38T 正好留给组件逐个入场） */
function curtainAlpha(elapsed: number): number {
  const inT = ENDING_TRANS_SECONDS * 0.22;
  const holdT = ENDING_TRANS_SECONDS * 0.3;
  const outT = ENDING_TRANS_SECONDS * 0.62;
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
): void {
  const u = endingUnits(w, h);
  const t = Math.max(0, elapsed);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  drawStage(ctx, u, input);

  if (t < ENDING_STAMP_SECONDS) {
    if (input.stamp !== 'clear') {
      // 粒子画在字样**后面**：火花从徽章背后炸开，不糊住笔画
      drawParticles(ctx, u, input, t);
      drawStampWord(ctx, u, input, t);
    }
  } else {
    const e = t - ENDING_STAMP_SECONDS;
    // 最后一波余烬延续到幕布升起前
    if (input.stamp !== 'clear' && e < EMBERS_SECONDS) drawParticles(ctx, u, input, t);
    drawSettlement(ctx, u, input, e);
    const a = curtainAlpha(e);
    if (a > 0.001) {
      ctx.globalAlpha = a;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);
    }
  }

  ctx.restore();
}
