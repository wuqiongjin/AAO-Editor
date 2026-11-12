/**
 * 仿真场带体的**材质与逐像素光栅**（chart-preview 65）。
 *
 * 与画布的关系：横截面口径（`|x−cx|/half` 的连续 α 剖面）、17 点等距采样、回折切分
 * (`splitBandAtFolds`) 全部复用 `rendering/slideBandGeometry`，不在本文件另立一套；
 * 仿真场多出来的两件事单独留在这里 —— ① 半宽随接近值 A **逐点变化**（画布是常数半宽），
 * ② 光栅分辨率固定 50% + 一张共享缓冲一次回写（实时与导出共用同一份 `drawSimFrameAt`）。
 *
 * 为什么必须逐像素：原型实测（research §5）「按段生成渐变」必然在接缝处不连续（C 边缘阶梯、
 * D 相位重置），只有沿整条中心线连续求值才对得上游戏实机的 SP 绿条。
 * 为什么 50%：调研 §6 的光栅分辨率 × 优化内核对照（100% 24.1ms → 50% 8.2ms，1w 音符
 * 1334×750 dpr1），25% 画质被用户否决；首期固定 50%，实时与导出同用（票 65 定案）。
 *
 * 材质在 `loadSimAssets` 阶段一次 `getImageData` 取样并展开成 LUT，帧循环里只读数组：
 * 横截面 LUT（中心→边缘）+ 纵向 LUT（整条一次）+ Uint32 打包体色，内循环无函数调用。
 */
import { sampleProfileAt, splitBandAtFolds } from '../../../rendering/slideBandGeometry';
import { clamp01, SIM_BAND_COLORS, SIM_BAND_MATERIAL, type SimBandMaterial } from './simGeometry';
import type { SimFieldMetrics, SimPoint } from './simGeometry';
import type { BandPoint } from '../../../rendering/slideBandGeometry';

/** 横截面等距采样点数（与画布 `STRIP_STYLE_FRACS` 同口径） */
export const SIM_BAND_PROFILE_POINTS = 17;
/** 横截面 LUT 项数：f = i/1024，含两端 */
export const SIM_BAND_CROSS_LUT_SIZE = 1025;
/** 纵向 LUT 项数：u = i/256，含两端 */
export const SIM_BAND_LONGITUDINAL_LUT_SIZE = 257;
/** 光栅分辨率 = 设备像素 × 0.5（票 65 定案：首期固定，画质已验收、无 LOD 切换跳变） */
export const SIM_BAND_RASTER_SCALE = 0.5;

/** Uint32 视图的字节序（浏览器基本都是小端；大端平台换一套打包/取 α 的位运算） */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/**
 * 预加载好的带体材质（LUT + 体色）。`loadSimAssets` 建好、随 `SimFrameAssets` 走到每一帧；
 * 缺图 / 无 DOM 时用 skin00 实测兜底（`SIM_BAND_RASTER_MATERIAL{,_SP}`）。
 */
export interface SimBandRasterMaterial {
  /** 横截面 α LUT（中心→边缘，等距 1025 项） */
  cross: Float32Array;
  /** 纵向 α 因子 LUT（整条一次，均值 1；SP 的贴图纵向恒定 ⇒ 恒 1） */
  longitudinal: Float32Array;
  /** 体色 RGB（0..255，非预乘；像素验收与剖面断言都读它） */
  rgb: readonly [number, number, number];
  /** Uint32 打包体色，直接写进 RGBA 缓冲 */
  color: number;
}

/** 一次 `getImageData` 读出的原始贴图剖面（未展开 LUT，便于逐点断言与换肤复核） */
export interface SimBandImageSample {
  /** 兼容字段：旧的体 / 亮缘标量材质（`sampleBandMaterial` 的返回值） */
  material: SimBandMaterial;
  /** 17 点横截面 α（左右对称列平均，中心→边缘） */
  profile: number[];
  /** 纵向中心列 α 的均值归一因子（17 点，均值 1） */
  longitudinal: number[];
  /** 贴图中心像素 RGB */
  rgb: readonly [number, number, number];
}

/** skin00 `longNoteLine2.png` 横截面实测（与画布 `STRIP_STYLE_DEFAULT` 同源）：中心暗 → 亮缘 → 软边 */
const SP_PROFILE = [0.38, 0.38, 0.39, 0.40, 0.41, 0.43, 0.45, 0.48, 0.52, 0.56, 0.61, 0.67, 0.74, 0.82, 0.89, 0.62, 0.25];
/** skin00 `longNoteLine.png` 横截面实测：平顶 + 细亮缘 + 软边 */
const NORMAL_PROFILE = [0.38, 0.38, 0.38, 0.38, 0.38, 0.38, 0.38, 0.38, 0.38, 0.38, 0.38, 0.38, 0.38, 0.78, 0.95, 0.62, 0.25];
/** skin00 普通带纵向中心列（9 点实测：两端实、中间虚；进 LUT 时归一化到均值 1） */
const NORMAL_LONGITUDINAL = [0.75, 0.67, 0.55, 0.44, 0.38, 0.42, 0.54, 0.66, 0.75];
/** skin00 SP 带纵向中心列恒 0.38 ⇒ 归一化后恒 1（seamless） */
const SP_LONGITUDINAL = [0.38, 0.38, 0.38, 0.38, 0.38, 0.38, 0.38, 0.38, 0.38];

const hexRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** 等距序列的线性插值（u ∈ [0,1]；纵向 LUT 展开用） */
function sampleSeriesAt(series: readonly number[], u: number): number {
  const n = series.length - 1;
  if (n <= 0) return series[0] ?? 1;
  const x = Math.min(Math.max(u, 0), 1) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const t = x - i;
  return series[i]! * (1 - t) + series[i + 1]! * t;
}

/** 纵向因子归一化：贴图 α(x,y) ≈ 横截面 α(x) × 纵向因子(y)，列平均已含纵向均值 ⇒ 因子均值必须 = 1 */
function normalizeLongitudinal(raw: readonly number[]): number[] {
  const mean = raw.reduce((s, v) => s + v, 0) / Math.max(1, raw.length);
  return mean > 1e-6 ? raw.map((v) => v / mean) : raw.map(() => 1);
}

function packColor(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb;
  return LITTLE_ENDIAN
    ? ((r | (g << 8) | (b << 16)) >>> 0)
    : (((r << 24) | (g << 16) | (b << 8)) >>> 0);
}

/** 由一次采样（或缺图兜底）展开两份 LUT —— 只在 `loadSimAssets` 里跑，不进帧循环 */
export function buildSimBandRasterMaterial(sample: SimBandImageSample | null, sp: boolean): SimBandRasterMaterial {
  const profile = sample?.profile ?? (sp ? SP_PROFILE : NORMAL_PROFILE);
  const longitudinal = sample
    ? normalizeLongitudinal(sample.longitudinal)
    : normalizeLongitudinal(sp ? SP_LONGITUDINAL : NORMAL_LONGITUDINAL);
  const rgb: readonly [number, number, number] = sample?.rgb
    ?? (sp ? hexRgb(SIM_BAND_COLORS.sp) : hexRgb(SIM_BAND_COLORS.band));
  const cross = new Float32Array(SIM_BAND_CROSS_LUT_SIZE);
  for (let i = 0; i < cross.length; i++) cross[i] = sampleProfileAt(profile, i / (cross.length - 1));
  const along = new Float32Array(SIM_BAND_LONGITUDINAL_LUT_SIZE);
  for (let i = 0; i < along.length; i++) along[i] = sampleSeriesAt(longitudinal, i / (along.length - 1));
  return { cross, longitudinal: along, rgb, color: packColor(rgb) };
}

/** 缺图 / 无 DOM 时的兜底材质（skin00 实测剖面 + 既有兜底绿） */
export const SIM_BAND_RASTER_MATERIAL = buildSimBandRasterMaterial(null, false);
export const SIM_BAND_RASTER_MATERIAL_SP = buildSimBandRasterMaterial(null, true);

/**
 * 读一张带体贴图：**一次 `getImageData`** 同时给出旧的标量材质、17 点横截面剖面、
 * 纵向中心列和体色 —— `loadSimAssets` 只调它一次，不再为剖面 / 颜色各回读一遍。
 *
 * 横截面口径与画布 `bandStripStyle` 完全一致（左右对称列平均）；纵向取中心列 α，
 * 归一化到均值 1（见 `normalizeLongitudinal`），普通带因此「两端实、中间虚」、
 * SP 带纵向恒定。无 DOM / 无 2d 上下文 / 跨域污染 → null，调用方走兜底材质。
 */
export function readSimBandImage(
  img: HTMLImageElement | null,
  createCanvas?: () => HTMLCanvasElement | null,
): SimBandImageSample | null {
  if (!img) return null;
  const canvas = createCanvas
    ? createCanvas()
    : (typeof document !== 'undefined' ? document.createElement('canvas') : null);
  if (!canvas) return null;
  try {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    const colAvg = (x: number): number => {
      const xx = Math.max(0, Math.min(w - 1, x));
      let s = 0;
      for (let y = 0; y < h; y++) s += d[(y * w + xx) * 4 + 3]!;
      return s / h / 255;
    };
    const mid = w >> 1;
    // 兼容字段：旧的「体部平均 α + 亮缘峰值 α」（口径一字不改，见 simAssets.sampleBandMaterial）
    const lo = Math.floor(mid - w * 0.3);
    const hi = Math.ceil(mid + w * 0.3);
    let bodySum = 0;
    let bodyN = 0;
    for (let x = lo; x <= hi; x++) {
      bodySum += colAvg(x);
      bodyN++;
    }
    let rimAlpha = 0;
    for (let x = 1; x < w - 1; x++) rimAlpha = Math.max(rimAlpha, colAvg(x));
    const material: SimBandMaterial = {
      bodyAlpha: clamp01(bodyN > 0 ? bodySum / bodyN : colAvg(mid)),
      rimAlpha: clamp01(rimAlpha),
      rimFrac: SIM_BAND_MATERIAL.rimFrac,
    };
    const profile = Array.from({ length: SIM_BAND_PROFILE_POINTS }, (_, i) => {
      const off = Math.round((i / (SIM_BAND_PROFILE_POINTS - 1)) * (w / 2 - 1));
      return (colAvg(mid - off) + colAvg(mid + off)) / 2;
    });
    const longitudinal = Array.from({ length: SIM_BAND_PROFILE_POINTS }, (_, i) => {
      const y = Math.round((i / (SIM_BAND_PROFILE_POINTS - 1)) * (h - 1));
      return d[(y * w + mid) * 4 + 3]! / 255;
    });
    const midRow = Math.floor(h / 2) * w;
    const rgb: readonly [number, number, number] = [
      d[(midRow + mid) * 4]!,
      d[(midRow + mid) * 4 + 1]!,
      d[(midRow + mid) * 4 + 2]!,
    ];
    return { material, profile, longitudinal, rgb };
  } catch {
    return null; // 画布被污染 / 上下文不可用：兜底材质顶上
  }
}

// ───────────────────────────── 逐像素光栅内核 ─────────────────────────────

/** 一条滑条的可见带体（谱面数组序；`quads` 是 `simField` 的可见窗口 / 过线端插值产物） */
export interface SimBandRasterGroup {
  /** 所属滑条的分组号（同一条滑条的段连续） */
  slide: number;
  /** SP 材质（整条传染，ADR-0009 §5） */
  sp: boolean;
  /** 同一条滑条的可见四边形，按段顺序连续 */
  quads: SimPoint[][];
}

/** 中心线结点（半宽逐点变化：伪透视下越远的带越窄） */
interface SimBandNode extends BandPoint {
  half: number;
}

/** 一张共享 RGBA 缓冲（每帧 `view.fill(0)` 清零，尺寸只随场地 / 密度变化） */
export interface SimBandRasterBuffer {
  cw: number;
  ch: number;
  /** 设备像素 → 光栅像素的 x / y 比例（= 变换缩放 × 0.5） */
  rx: number;
  ry: number;
  bytes: Uint8ClampedArray;
  /** 与 `bytes` 同一段内存的 Uint32 视图：一次写入 RGBA */
  view: Uint32Array;
}

export function makeSimBandRasterBuffer(cw: number, ch: number, rx: number, ry: number): SimBandRasterBuffer {
  const bytes = new Uint8ClampedArray(cw * ch * 4);
  return { cw, ch, rx, ry, bytes, view: new Uint32Array(bytes.buffer) };
}

/** 四边形 → 连续中心线结点（首点取 a 边中点，之后每段取 b 边中点；共享结点不重复） */
function nodesOf(quads: readonly SimPoint[][]): SimBandNode[] {
  const nodes: SimBandNode[] = [];
  for (let i = 0; i < quads.length; i++) {
    const q = quads[i]!;
    if (i === 0) {
      nodes.push({ x: (q[0]!.x + q[1]!.x) / 2, y: q[0]!.y, half: Math.abs(q[1]!.x - q[0]!.x) / 2 });
    }
    nodes.push({ x: (q[3]!.x + q[2]!.x) / 2, y: q[3]!.y, half: Math.abs(q[2]!.x - q[3]!.x) / 2 });
  }
  return nodes;
}

/**
 * 把整帧所有可见滑条光栅进**同一张缓冲**。
 *
 * - 每条滑条先按 `splitBandAtFolds` 切成 y 单调 run（倒流区折返的两臂各自扫，像素内
 *   `1−(1−a₁)(1−a₂)` 合成 ⇒ issue 45 的「不抵消成洞」与 issue 46 的「自叠 / 交叉叠亮」同源）；
 * - 纵向因子按**整条** `[y0,y1]` 求一次（不是每个逻辑段，避免结点竹节；票 65 定案 #3）；
 * - 每条 run 只扫自己的 y 区间（逐条 bbox 限幅），内循环无函数调用、Uint32 单次写入；
 * - 不同滑条真重叠时 RGB 取后写者 = 谱面数组序「后放置者在上」，α 用 screen 叠亮。
 */
export function rasterSimBandGroups(
  groups: readonly SimBandRasterGroup[],
  normal: SimBandRasterMaterial,
  sp: SimBandRasterMaterial,
  baseAlpha: number,
  buf: SimBandRasterBuffer,
): void {
  const { cw, ch, rx, ry, view } = buf;
  const crossMax = SIM_BAND_CROSS_LUT_SIZE - 1;
  const alongMax = SIM_BAND_LONGITUDINAL_LUT_SIZE - 1;
  for (const group of groups) {
    const mat = group.sp ? sp : normal;
    const cross = mat.cross;
    const along = mat.longitudinal;
    const color = mat.color;
    const nodes = nodesOf(group.quads);
    if (nodes.length < 2) continue;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const n of nodes) {
      if (n.y < y0) y0 = n.y;
      if (n.y > y1) y1 = n.y;
    }
    const span = y1 - y0;
    if (span < 1e-6) continue;
    // `splitBandAtFolds` 只切片、不改元素 ⇒ 结点上的 half 原样带进每个 run
    const runs = splitBandAtFolds(nodes) as SimBandNode[][];
    for (const raw of runs) {
      const run = raw[0]!.y > raw[raw.length - 1]!.y ? [...raw].reverse() : raw;
      const jStart = Math.max(0, Math.floor(run[0]!.y * ry));
      const jEnd = Math.min(ch, Math.ceil(run[run.length - 1]!.y * ry));
      let j = 0;
      for (let row = jStart; row < jEnd; row++) {
        const yCss = (row + 0.5) / ry;
        while (j < run.length - 2 && run[j + 1]!.y < yCss) j++;
        const a = run[j]!;
        const b = run[j + 1]!;
        if (yCss < a.y || yCss > b.y) continue;
        const dy = b.y - a.y;
        const t = dy > 1e-9 ? (yCss - a.y) / dy : 0;
        const cx = (a.x + (b.x - a.x) * t) * rx;
        const half = (a.half + (b.half - a.half) * t) * rx;
        if (half <= 0) continue;
        const u = (yCss - y0) / span;
        const alongIndex = Math.max(0, Math.min(alongMax, (u * alongMax) | 0));
        const amp = baseAlpha * along[alongIndex]! * 255;
        const left = cx - half;
        const right = cx + half;
        const i0 = Math.max(0, Math.floor(left));
        const i1 = Math.min(cw - 1, Math.ceil(right));
        const invHalf = crossMax / half;
        const rowOff = row * cw;
        for (let i = i0; i <= i1; i++) {
          const ic = i + 0.5;
          let dist = ic - cx;
          if (dist < 0) dist = -dist;
          if (dist >= half) continue;
          const covLeft = ic - left;
          const covRight = right - ic;
          const cov = covLeft < covRight ? covLeft : covRight;
          if (cov <= 0) continue;
          const coverage = cov > 1 ? 1 : cov;
          const li = Math.min(crossMax, (dist * invHalf) | 0);
          let a8 = (cross[li]! * coverage * amp) | 0;
          if (a8 <= 0) continue;
          if (a8 > 255) a8 = 255;
          const p = rowOff + i;
          const old = LITTLE_ENDIAN ? view[p]! >>> 24 : view[p]! & 255;
          const na = old === 0 ? a8 : 255 - (((255 - old) * (255 - a8)) / 255 | 0);
          view[p] = (LITTLE_ENDIAN ? ((na << 24) | color) : (color | na)) >>> 0;
        }
      }
    }
  }
}

// ───────────────────────────── 一张缓冲一次回写 ─────────────────────────────

interface SimBandRasterScratch {
  canvas: HTMLCanvasElement | null;
  offctx: CanvasRenderingContext2D | null;
  buffer: SimBandRasterBuffer | null;
  image: ImageData | null;
}

/** 每个 ctx 一份缓冲（实时预览 / 视频导出各一张画布，互不顶掉尺寸） */
const SCRATCH = new WeakMap<CanvasRenderingContext2D, SimBandRasterScratch>();

/**
 * 离屏画布工厂的测试替身。node 单测没有 DOM，靠它把「一次 putImageData / 一次 drawImage」
 * 变成可记录的调用；生产路径恒走 `document.createElement('canvas')`。
 */
let canvasFactoryForTests: (() => HTMLCanvasElement | null) | null = null;
export function __setSimBandRasterCanvasFactoryForTests(
  factory: (() => HTMLCanvasElement | null) | null,
): void {
  canvasFactoryForTests = factory;
}

function ensureScratch(ctx: CanvasRenderingContext2D, cw: number, ch: number, rx: number, ry: number): SimBandRasterScratch {
  let scratch = SCRATCH.get(ctx);
  if (!scratch) {
    const canvas = canvasFactoryForTests
      ? canvasFactoryForTests()
      : (typeof document !== 'undefined' ? document.createElement('canvas') : null);
    scratch = { canvas, offctx: canvas?.getContext('2d') ?? null, buffer: null, image: null };
    SCRATCH.set(ctx, scratch);
  }
  if (!scratch.offctx || !scratch.canvas) return scratch;
  if (!scratch.buffer || scratch.buffer.cw !== cw || scratch.buffer.ch !== ch) {
    scratch.buffer = makeSimBandRasterBuffer(cw, ch, rx, ry);
    scratch.canvas.width = cw;
    scratch.canvas.height = ch;
    scratch.image = scratch.offctx.createImageData(cw, ch);
  }
  return scratch;
}

/**
 * 一帧的带体层：算 → 写一张 RGBA → `putImageData` 一次 → `drawImage` 一次。
 * 返回是否画出（无 DOM / 离屏上下文不可用 / 没有可见滑条 = false，帧里只是没有带体层）。
 *
 * `ctx` 的变换是「场地 CSS 坐标 → 设备像素」：`simPlayback` 为缩放、`frameDriver` 为平移，
 * 故回贴目标取 `(t.e, t.f, metrics.w × t.a, metrics.h × t.d)`，两条链路共用这一份换算。
 */
export function drawSimBandRaster(
  ctx: CanvasRenderingContext2D,
  groups: readonly SimBandRasterGroup[],
  normal: SimBandRasterMaterial,
  sp: SimBandRasterMaterial,
  baseAlpha: number,
  metrics: SimFieldMetrics,
): boolean {
  if (groups.length === 0 || baseAlpha <= 0) return false;
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const sx = t && Number.isFinite(t.a) && t.a > 0 ? t.a : 1;
  const sy = t && Number.isFinite(t.d) && t.d > 0 ? t.d : 1;
  const tx = t && Number.isFinite(t.e) ? t.e : 0;
  const ty = t && Number.isFinite(t.f) ? t.f : 0;
  const rx = sx * SIM_BAND_RASTER_SCALE;
  const ry = sy * SIM_BAND_RASTER_SCALE;
  const cw = Math.max(1, Math.round(metrics.w * rx));
  const ch = Math.max(1, Math.round(metrics.h * ry));
  const scratch = ensureScratch(ctx, cw, ch, rx, ry);
  const { offctx, buffer, image, canvas } = scratch;
  if (!offctx || !buffer || !image || !canvas) return false;

  buffer.view.fill(0);
  rasterSimBandGroups(groups, normal, sp, baseAlpha, buffer);
  image.data.set(buffer.bytes);
  offctx.putImageData(image, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = SIM_BAND_RASTER_SCALE < 1;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, cw, ch, tx, ty, metrics.w * sx, metrics.h * sy);
  ctx.restore();
  return true;
}
