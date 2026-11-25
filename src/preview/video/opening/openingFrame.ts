// 视频开场的**一帧绘制**（chart-preview 30；ADR-0016 §5.1）。
//
//   drawOpeningFrameAt = ④ 段里的开场画面本身（整块画布，几何按帧高比例）
//   drawOpeningFieldBackground = ③ 段里"只有表演背景图"的那层
//   drawOpeningTrack           = ④ 段里淡入的**整块轨道**（场地图的扇形车道 + 判定线）
//
// 两条口径：
//   - **整屏 alpha 只有一个 setter**（第七轮教训）：本文件入口设一次 `globalAlpha`，
//     子流程一概不碰（要改就在自己的 save/restore 里改）；否则会出现"只有装饰在淡"。
//   - **轨道 = 场地图 + 判定线两张一起**（用户第六轮原话："不单单只判定线，还有后面这大块
//     空间的轨道都要一起过渡"）；三张图的矩形直接复用 `simGeometry`，不抄第二份。
import type { SimFieldMetrics } from '../sim/simGeometry';
import { fieldImageRect, playLineRect } from '../sim/simGeometry';
import { drawSimBackground, type StageCoverIntroStyle } from '../sim/simField';
import { drawOpeningDecor, type DecorSpacing } from './openingDecor';
import { OPENING_ITEM_IDS, type OpeningItemId } from './openingItems';
import { HEADER_SANS } from '../../fontStack';
import { t, type MessageKey } from '../../../i18n';
import {
  OPENING_BADGE_HEIGHT_FACTOR,
  OPENING_BAND_COLOR,
  OPENING_BAND_TEXT,
  OPENING_BG,
  OPENING_FRAME_LINE,
  OPENING_STACK,
  OPENING_TIMING,
  OPENING_TITLE_FONT,
  openingSecondsOf,
  openingStackMetrics,
  openingTrackInAt,
  type OpeningStack,
  type OpeningTiming,
} from './openingSpec';

/**
 * 歌曲信息附加字段（全部可选：作词 / 作曲 / 编曲 / 谱师，空项不占位）。
 * 这是**绘制层**的入参（票 39 定的形状）：`charter` 装的是工程里的「谱师署名」，
 * 不是 Bestdori 社区帖作者（那是 `PostCandidate.charter`）—— 术语边界见 ADR-0024 §1。
 */
export interface OpeningCredits {
  /** 作词 */
  lyricist?: string | null;
  /** 作曲 */
  composer?: string | null;
  /** 编曲 */
  arranger?: string | null;
  /** 谱师署名 */
  charter?: string | null;
}

/** 一帧要画的开场（封面已由编排层解码好；`items` 已是有序的"实际画哪些项"） */
export interface OpeningFrameInput {
  title: string;
  /** 难度名（全大写英文，由页面给；preview 域不 import 工程域） */
  difficultyName: string;
  /** 难度色（由页面给，全应用唯一标准） */
  difficultyColor: string;
  artist: string;
  cover: CanvasImageSource | null;
  /** 无封面时占位块的色相（由页面按工程 id 派生） */
  coverHue: number;
  items: readonly OpeningItemId[];
  /** 可选的附加字段（作词/作曲/编曲/谱师），每首歌曲可选填任意子集，空项不占位 */
  credits?: OpeningCredits | null;
}

/** 场地的三张素材（结构对齐 `SimFrameAssets`，免得开场这一层依赖仿真场的类型） */
export interface OpeningFieldImages {
  background: CanvasImageSource | null;
  field: CanvasImageSource | null;
  playLine: CanvasImageSource | null;
  /**
   * 相框层（chart-preview 84）：字段名与 `SimFrameAssets` 一致、结构上也只要求
   * `{ cover }` ⇒ 导出侧直接把 `frame.assets` 递进来，③段自动带上相框封面
   * （"导出与预览一致"），这一层不必依赖仿真场的类型。
   */
  stageFrame?: { cover: CanvasImageSource | null } | null;
  /** 自定义表演背景取景（票 42）；有值时开场③段也不画相框 */
  liveBgFit?: 'cover' | 'contain';
}

// ---------------- 文字 ----------------

function setLetterSpacing(ctx: CanvasRenderingContext2D, value: string): void {
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = value;
}

function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) out = out.slice(0, -1);
  return `${out}…`;
}

/**
 * 按**墨迹框**（`actualBoundingBox*`）居中 —— 不用 `textBaseline='middle'`（它按字面框居中，
 * 字会压在视觉中心下方 ≈0.14 em），也不用 `textAlign='center'`（它算进 letterSpacing 的尾随空隙）。
 */
function inkCentered(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number): void {
  if (!text) return;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(text);
  const left = m.actualBoundingBoxLeft;
  const right = m.actualBoundingBoxRight;
  const asc = m.actualBoundingBoxAscent;
  const desc = m.actualBoundingBoxDescent;
  if (!Number.isFinite(left + right + asc + desc) || left + right <= 0) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy);
    return;
  }
  ctx.fillText(text, cx - (right - left) / 2, cy + (asc - desc) / 2);
}

/** 超宽先自适应缩字号（下限基准 60%），仍放不下才截断 */
function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  basePx: number,
  maxW: number,
  color: string,
  weight: number,
): void {
  let px = basePx;
  for (let i = 0; i < 60; i++) {
    ctx.font = `${weight} ${px}px ${HEADER_SANS}`;
    if (ctx.measureText(text).width <= maxW || px <= basePx * 0.6) break;
    px = Math.max(basePx * 0.6, px - basePx * 0.02);
  }
  ctx.font = `${weight} ${px}px ${HEADER_SANS}`;
  ctx.fillStyle = color;
  inkCentered(ctx, truncateToWidth(ctx, text, maxW), cx, cy);
}

/**
 * 4 行附加字段的**声明式列表**：key 同时是 `OpeningItemId`（一枚开关 gate 一行）与 credits 键。
 * 标签走 i18n（票 79 Q13=B）：zh-CN 全角冒号、en 半角冒号空格，模板在
 * `preview.opening.credit.line`，四个词统一为角色名 Lyricist / Composer / Arranger / Charter。
 */
const CREDIT_FIELDS: readonly (readonly [keyof OpeningCredits, MessageKey])[] = [
  ['lyricist', 'preview.opening.credit.lyricist'],
  ['composer', 'preview.opening.credit.composer'],
  ['arranger', 'preview.opening.credit.arranger'],
  ['charter', 'preview.opening.credit.charter'],
];

/**
 * 提取有效的附加字段行（票 79）。
 * - 顺序固定：作词 → 作曲 → 编曲 → 谱师；
 * - `items` = 开着的开场信息项（缺省 = 全开）：每枚开关 gate 自己那一行；
 * - 值为空 / 纯空白 / 该项关掉 ⇒ 不画也不占位（票 39「空项不占位」口径）。
 */
export function extractCreditLines(
  credits?: OpeningCredits | null,
  items: readonly OpeningItemId[] = OPENING_ITEM_IDS,
): string[] {
  if (!credits) return [];
  const lines: string[] = [];
  for (const [key, labelKey] of CREDIT_FIELDS) {
    if (!items.includes(key)) continue;
    const raw = credits[key];
    const val = typeof raw === 'string' ? raw.trim() : '';
    if (val) {
      lines.push(t('preview.opening.credit.line', { label: t(labelKey), value: val }));
    }
  }
  return lines;
}

/**
 * 逐行墨迹居中（用户 2026-11-22 推翻票 39 方案 B，回到方案 A）：
 * 每一行都按墨迹框在画面中轴居中；多行不再首字对齐。
 */
function drawCreditsBlock(
  ctx: CanvasRenderingContext2D,
  lines: readonly string[],
  cx: number,
  startY: number,
  fontPx: number,
  lineH: number,
  maxW: number,
): void {
  ctx.save();
  ctx.font = `400 ${fontPx}px ${HEADER_SANS}`;
  ctx.fillStyle = '#f0f2f5';
  lines.forEach((line, idx) => {
    const text = truncateToWidth(ctx, line, maxW);
    const lineCy = startY + idx * lineH + lineH / 2;
    inkCentered(ctx, text, cx, lineCy);
  });
  ctx.restore();
}

/** 难度徽章：微圆角实底胶囊 + 白字全大写 */
function drawBadge(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  top: number,
  fontPx: number,
  color: string,
): void {
  const bh = Math.round(fontPx * OPENING_BADGE_HEIGHT_FACTOR);
  ctx.font = `700 ${fontPx}px ${HEADER_SANS}`;
  setLetterSpacing(ctx, '0.06em');
  const w = Math.round(ctx.measureText(text).width + fontPx * 2.2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(Math.round(cx - w / 2), top, w, bh, Math.round(bh * 0.18));
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  inkCentered(ctx, text, cx, top + bh / 2);
  setLetterSpacing(ctx, '0px');
}

// ---------------- 封面 ----------------

/** 占位块缓存（同一 hue 只画一次；逐帧重建会白烧 300 次渐变） */
let placeholderCache: { hue: number; canvas: HTMLCanvasElement } | null = null;

/**
 * 无封面时的占位块：`coverHue` 派生的深色渐变（口径同长图头带）。
 * 结尾段（票 52）的结算左栏复用同一张占位，不另造第二套。
 */
export function openingPlaceholderCover(hue: number): HTMLCanvasElement | null {
  // 无 DOM（单测 / node）时不造占位块：返回 null ⇒ 封面位留空，不炸
  if (typeof document === 'undefined') return null;
  if (placeholderCache && placeholderCache.hue === hue) return placeholderCache.canvas;
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createLinearGradient(0, 0, size, size);
  const hh = ((hue % 360) + 360) % 360;
  grad.addColorStop(0, `hsl(${hh}, 42%, 34%)`);
  grad.addColorStop(1, `hsl(${(hh + 36) % 360}, 42%, 17%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  placeholderCache = { hue, canvas: c };
  return c;
}

/** 方形裁切（居中取短边）；开场封面与结尾段结算的封面实体共用 */
export function drawSquareCover(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  x: number,
  y: number,
  size: number,
): void {
  const iw = Number((img as HTMLImageElement).width ?? (img as HTMLCanvasElement).width ?? 0);
  const ih = Number((img as HTMLImageElement).height ?? (img as HTMLCanvasElement).height ?? 0);
  if (!iw || !ih) return;
  const side = Math.min(iw, ih);
  ctx.drawImage(img, (iw - side) / 2, (ih - side) / 2, side, side, x, y, size, size);
}

// ---------------- 整屏 ----------------

/**
 * 画开场画面（`alpha` = 整屏三段 alpha）。
 * **整屏 alpha 就在这里设一次**，装饰 / 垫层 / 封面 / 徽章 / 白条 / 艺人行全部继承它 ⇒ 同时机。
 *
 * `seconds` = 开场内的视频秒（票 50 · A 轻推的堆叠缓出用它）；缺省 = 已推完，
 * 即**最终版式**（单测 / 定格帧不必关心入场过程）。
 */
export function drawOpeningFrameAt(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  input: OpeningFrameInput,
  alpha: number,
  seconds: number = Number.POSITIVE_INFINITY,
  /** 垫层轻推的覆盖参数（原型 / 调参用；缺省 = 票 50 定稿） */
  stack: OpeningStack = OPENING_STACK,
  /** 装饰布点口径（原型 A/B 对照用；缺省 = 票 81 落默认的 C 版，绘制层级不变） */
  decorSpacing: DecorSpacing = 'middle',
): void {
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
  ctx.fillStyle = OPENING_BG;
  ctx.fillRect(0, 0, w, h);

  const creditLines = extractCreditLines(input.credits, input.items);
  const m = openingStackMetrics(w, h, input.items, creditLines.length, stack.distance);
  const cx = w / 2;
  // 垫层缓出（票 50 · A 轻推）：露出厚度从 0 长到 `stackD`，单层向右上推出
  const stackD = Math.round(m.stackD * openingStackDriftAt(seconds, stack));
  // 装饰层在最下（可被封面 / 白条切边），整链相对白条上缘定位
  const bandTop = Number.isNaN(m.bandY) ? m.top + m.cover : m.bandY;
  // 装饰压在封面下面的那些枚直接跳过（封面 / 垫层是不透明的，画了也看不见）。
  // **只按封面 + 垫层的实际方形剔除**，不额外外扩 —— 外扩会把"该露在封面旁边"的装饰也吃掉。
  drawOpeningDecor(ctx, w, h, bandTop, {
    x: m.coverX,
    y: m.top - stackD,
    w: m.cover + stackD,
    h: m.cover + stackD,
  }, decorSpacing);

  // 难度色堆叠垫层：**只画露出来的 L 形**（第五轮）—— 画整个方形的话，封面缺位 / 还没浮现时
  // 会在封面的位置露出一整块纯色方块
  const sx0 = m.coverX + m.stackInset;
  const sy0 = m.top - stackD;
  const sx1 = sx0 + m.cover + stackD - m.stackInset;
  const sy1 = sy0 + m.cover + stackD - m.stackInset;
  if (stackD > 0 && sx1 > sx0) {
    ctx.fillStyle = input.difficultyColor;
    const leftEdge = Math.max(sx0, m.coverX);
    if (sx1 > leftEdge) ctx.fillRect(leftEdge, sy0, sx1 - leftEdge, Math.min(stackD, sy1 - sy0));
    const rx0 = Math.max(sx0, m.coverX + m.cover);
    if (sx1 > rx0 && sy1 > sy0) ctx.fillRect(rx0, sy0, sx1 - rx0, sy1 - sy0);
  }

  const cover = input.cover ?? openingPlaceholderCover(input.coverHue);
  if (cover) drawSquareCover(ctx, cover, m.coverX, m.top, m.cover);
  // 细白框（垫层在白框之外）
  const framePx = Math.max(1, Math.round(h * OPENING_FRAME_LINE));
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = framePx;
  ctx.strokeRect(m.coverX + framePx / 2, m.top + framePx / 2, m.cover - framePx, m.cover - framePx);

  if (!Number.isNaN(m.badgeTop)) {
    drawBadge(ctx, input.difficultyName, cx, m.badgeTop, m.badgeFont, input.difficultyColor);
  }

  if (!Number.isNaN(m.bandY)) {
    ctx.fillStyle = OPENING_BAND_COLOR;
    ctx.fillRect(0, m.bandY, w, m.bandH);
    setLetterSpacing(ctx, '0.01em');
    drawFittedText(
      ctx,
      input.title,
      cx,
      m.bandY + m.bandH / 2,
      Math.round(OPENING_TITLE_FONT * h),
      w * 0.88,
      OPENING_BAND_TEXT,
      400,
    );
    setLetterSpacing(ctx, '0px');
  }

  if (!Number.isNaN(m.artistCy) && input.artist) {
    drawFittedText(ctx, input.artist, cx, m.artistCy, m.artistFont, w * 0.8, '#ffffff', 500);
  }

  if (!Number.isNaN(m.creditsTop) && creditLines.length > 0) {
    drawCreditsBlock(ctx, creditLines, cx, m.creditsTop, m.creditFont, m.creditLineH, w * 0.85);
  }

  ctx.restore();
}

// ---------------- 场地的两层（③ 背景 / ④ 轨道） ----------------

/**
 * ③ 只有**表演背景图**这一层（bgskin 主图；文件名按包 ID 查清单 —— `liveBG_normal.png` /
 * `liveBG.png` 两种命名并存，chart-preview 41 起不硬编码）。
 *
 * `brightness` = `settings.preview.bgBrightness`（票 43）：开场③段与正片共用同一个背景绘制函数，
 * 亮度必须在这里也落一次，否则"导出开场是原图、正片是压暗"。
 */
export function drawOpeningFieldBackground(
  ctx: CanvasRenderingContext2D,
  m: SimFieldMetrics,
  imgs: OpeningFieldImages,
  brightness: number = 1,
  /** 相框封面的淡入（缺省 0 = ③ 只有空相框；④ 由调用方喂 `openingTrackAlphaAt(t)`） */
  coverAlpha: number = 0,
  /** 相框封面的登场动效进度（缺省 1 = 已落定；④ 喂 `openingCoverIntroAt(t)`） */
  coverIntro: number = 1,
  /** 登场动效的力度覆盖（原型调参用；缺省 = `STAGE_COVER_INTRO_STYLE`） */
  coverIntroStyle?: Partial<StageCoverIntroStyle>,
): void {
  ctx.save();
  drawSimBackground(ctx, m, imgs.background, brightness, 1, {
    stageFrame: imgs.liveBgFit ? null : imgs.stageFrame ?? null,
    coverAlpha,
    coverIntro,
    coverIntroStyle,
    liveFit: imgs.liveBgFit,
  });
  ctx.restore();
}

/** ④ 淡入的**整块轨道** = 场地图（扇形车道）+ 判定线，两张一起 */
export function drawOpeningTrack(
  ctx: CanvasRenderingContext2D,
  m: SimFieldMetrics,
  imgs: OpeningFieldImages,
  alpha: number,
): void {
  if (alpha <= 0.004) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  if (imgs.field) {
    const r = fieldImageRect(m);
    ctx.drawImage(imgs.field, r.x, r.y, r.w, r.h);
  }
  if (imgs.playLine) {
    const r = playLineRect(m);
    ctx.drawImage(imgs.playLine, r.x, r.y, r.w, r.h);
  }
  ctx.restore();
}

/** 该视频秒落在开场四段的哪一段（帧循环用；`t >= OPENING_SECONDS` 返回 `'sim'`） */
export type OpeningSegment = 'fadeIn' | 'hold' | 'fadeOut' | 'trackIn' | 'sim';

export function openingSegmentAt(t: number, timing: OpeningTiming = OPENING_TIMING): OpeningSegment {
  if (t < timing.fadeIn) return 'fadeIn';
  if (t < timing.fadeIn + timing.hold) return 'hold';
  if (t < openingTrackInAt(timing)) return 'fadeOut';
  if (t < openingSecondsOf(timing)) return 'trackIn';
  return 'sim';
}

/** 开场画面在该视频秒的 alpha（fadeIn 渐显 / hold 恒 1 / fadeOut 渐隐；其余不画） */
export function openingAlphaAt(t: number, timing: OpeningTiming = OPENING_TIMING): number {
  const seg = openingSegmentAt(t, timing);
  if (seg === 'fadeIn') return timing.fadeIn > 0 ? t / timing.fadeIn : 1;
  if (seg === 'hold') return 1;
  if (seg === 'fadeOut') {
    const a = timing.fadeOut > 0 ? (t - timing.fadeIn - timing.hold) / timing.fadeOut : 1;
    return 1 - Math.min(1, Math.max(0, a));
  }
  return 0;
}

/**
 * 相框封面「登场」动效的时长（秒）：④ 开头这一小段走完落定 + 扫光 + 屏沿。
 * 2026-11-23 用户定档：0.7 → 1.1 → **2.0**（原型里拉满、说"延长时间"那一版更稳）。
 * 注意 2.0 > ④ 段时长（`trackIn` 1.8）⇒ 最后 0.2s 会落在切到打歌之后，但那时 p = 0.9、
 * 缩放差 0.02%、扫光 / 屏沿都只剩残影（≤3%），接缝看不出来。
 * 力度参数见 `STAGE_COVER_INTRO_STYLE`；原型「封面登场」一组可实时调时长 / 起始缩放 / 扫光 / 屏沿。
 */
export const OPENING_COVER_INTRO_SECONDS = 2.0;

/**
 * 相框封面的登场进度（票 84 回修）：③ 恒 0（只有空相框）、④ 开头 `seconds` 秒从 0 走到 1。
 * 之后恒 1 —— 正片与实时预览都不会重放这套动效。
 */
export function openingCoverIntroAt(
  t: number,
  timing: OpeningTiming = OPENING_TIMING,
  seconds: number = OPENING_COVER_INTRO_SECONDS,
): number {
  const at = openingTrackInAt(timing);
  if (t < at) return 0;
  return Math.min(1, (t - at) / Math.max(0.05, seconds));
}

/** 轨道层在该视频秒的 alpha（④ 里 0 → 1；⑤ 起恒 1 —— 正常仿真帧自己画场地） */
export function openingTrackAlphaAt(t: number, timing: OpeningTiming = OPENING_TIMING): number {
  const at = openingTrackInAt(timing);
  if (t < at) return 0;
  if (timing.trackIn <= 0) return 1;
  return Math.min(1, (t - at) / timing.trackIn);
}

/**
 * 堆叠垫层的**缓出**进度（票 50 · 定案 A 轻推）：`OPENING_STACK_DRIFT_AT` 起
 * `OPENING_STACK_DRIFT_SECONDS` 秒内 0 → 1（缓出三次曲线），垫层从封面正后方向右上推出。
 *
 * 传 `Infinity`（`drawOpeningFrameAt` 的缺省）= 已推完 —— 单测与定格帧看的是**最终版式**。
 */
export function openingStackDriftAt(t: number, stack: OpeningStack = OPENING_STACK): number {
  const p = (t - stack.at) / Math.max(1e-6, stack.seconds);
  if (!Number.isFinite(p)) return 1;
  const x = Math.min(1, Math.max(0, p));
  return 1 - Math.pow(1 - x, 3);
}
