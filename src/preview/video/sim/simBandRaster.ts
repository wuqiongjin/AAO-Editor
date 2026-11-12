/**
 * 仿真场带体的**材质与逐像素光栅**（chart-preview 65）。
 *
 * 与画布的关系：横截面口径（`|x−cx|/half` 的连续 α 剖面）、17 点等距采样、回折切分
 * (`splitBandAtFolds`) 全部复用 `rendering/slideBandGeometry`，不在本文件另立一套；
 * 仿真场多出来的两件事单独留在这里 —— ① 半宽随接近值 A **逐点变化**（画布是常数半宽），
 * ② 光栅分辨率分档 + 一张共享缓冲一次回写（实时与导出共用同一份 `drawSimFrameAt`）。
 *
 * 为什么必须逐像素：原型实测（research §5）「按段生成渐变」必然在接缝处不连续（C 边缘阶梯、
 * D 相位重置），只有沿整条中心线连续求值才对得上游戏实机的 SP 绿条。
 * 为什么分档（票 66）：50% 光栅 + `imageSmoothingQuality='high'` 的 2× 放大把亮缘过渡
 * 抹宽一倍，用户实机反馈「边缘糊」。调研 §6 的 100% / 50% 成本差 3~4×，故实时按每帧
 * 可见带体量走 100% / 50% 两档（8ms 预算 + EMA 滞回），导出离线无实时时钟 ⇒ 固定 100%。
 * 25% 画质、75% 中间档、拆层补锐均被否决（票 66「本轮实现口径」）。
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
/**
 * 光栅低档 = 设备像素 × 0.5（票 65 的固定值；票 66 起它只是 LOD 的低档，不再是默认）。
 * 实时常规谱走 `SIM_BAND_RASTER_SCALE_FULL`，只有一帧带体多到算不动才降到这一档。
 */
export const SIM_BAND_RASTER_SCALE = 0.5;
/** 光栅全档 = 设备像素 1:1（导出固定、实时常规谱） */
export const SIM_BAND_RASTER_SCALE_FULL = 1;
/** 票 66 定死的两档；75% 等中间档已否决（非整数重采样有伪影），不给任意比例留口子 */
export type SimBandRasterScale = typeof SIM_BAND_RASTER_SCALE_FULL | typeof SIM_BAND_RASTER_SCALE;
/**
 * 8ms 材质层预算对应的「100% 光栅预计像素」（票 66 四档实测拟合，详见
 * `docs/research/chart-preview-sim-slide-band-material.md` §10）。
 */
export const SIM_BAND_LOD_BUDGET_PIXELS = 800_000;
/** 滞回上阈：100% 档的 EMA 超过它才降 50%（预算 +12.5% 余量，别贴着预算切） */
export const SIM_BAND_LOD_ENTER_LOW_PIXELS = SIM_BAND_LOD_BUDGET_PIXELS * 1.125;
/** 滞回下阈：50% 档的 EMA 低于它才回 100%（预算 −18.75%；中间是死区，避免锐度闪） */
export const SIM_BAND_LOD_EXIT_LOW_PIXELS = SIM_BAND_LOD_BUDGET_PIXELS * 0.8125;
/** EMA 平滑系数：约 10 帧时间常数（60fps ≈ 0.17s） */
const SIM_BAND_LOD_EMA_ALPHA = 0.1;

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

// ───────────────────────────── 光栅分档（票 66） ─────────────────────────────

/**
 * 一帧可见带体在**场地 CSS 坐标**下的覆盖面积（Σ 梯形面积 = Σ 2·half·|dy|）。
 * 它是扫描线内核要访问的像素数的解析估计（按 100% 光栅），再乘
 * `(设备像素密度 × 光栅比例)²` 就是该档的预计成本；不用跑一遍内核就能判定档位。
 * 同拍水平段（|dy| = 0）面积为 0，与 `drawBandQuad` 的零面积判据一致。
 */
export function simBandCoverageCss(groups: readonly SimBandRasterGroup[]): number {
  let area = 0;
  for (const group of groups) {
    for (const q of group.quads) {
      const w0 = Math.abs(q[1]!.x - q[0]!.x);
      const w1 = Math.abs(q[2]!.x - q[3]!.x);
      area += ((w0 + w1) / 2) * Math.abs(q[3]!.y - q[0]!.y);
    }
  }
  return area;
}

/** 每个画布一份的 LOD 状态（实时逐帧推进；导出给显式比例、不进这条状态机） */
export interface SimBandRasterLodState {
  /** EMA 平滑后的「100% 口径压力像素」 */
  pixels: number;
  /** 当前光栅档位 */
  scale: SimBandRasterScale;
}

/**
 * 逐帧推进 LOD：EMA 平滑 + 双阈值滞回。
 * 首帧（含 seek 后的第一帧）直接以真实覆盖量起算，否则 seek 进密集段会连着十几帧
 * 按 100% 硬扛；之后靠 EMA 把帧间抖动压住，靠上下阈避免锐度来回跳。
 * `densityX/Y` 取画布变换的缩放（实时 = `min(设备 DPR, 画质档)`，导出恒 1），
 * 连续值 1 / 1.25 / 1.5 / 2 都走同一条公式，不给 dpr2 单写分支。
 *
 * 压力值**恒按 100% 口径**算（`coverageCss × densityX × densityY`），不乘 `scale²`：
 * 阈值本来就是从 100% 成本标定的；若乘上当前档位，降到 50% 的下一帧压力立刻掉到 1/4，
 * 会当场弹回 100% 再降回来，滞回就失去意义。当前档位只影响绘制，不影响压力。
 */
export function nextSimBandRasterLodState(
  prev: SimBandRasterLodState,
  coverageCss: number,
  densityX: number,
  densityY: number,
): SimBandRasterLodState {
  const fullScalePixels = coverageCss * densityX * densityY;
  const pixels = prev.pixels <= 0
    ? fullScalePixels
    : prev.pixels + (fullScalePixels - prev.pixels) * SIM_BAND_LOD_EMA_ALPHA;
  const scale = prev.scale === SIM_BAND_RASTER_SCALE_FULL
    ? (pixels > SIM_BAND_LOD_ENTER_LOW_PIXELS ? SIM_BAND_RASTER_SCALE : SIM_BAND_RASTER_SCALE_FULL)
    : (pixels < SIM_BAND_LOD_EXIT_LOW_PIXELS ? SIM_BAND_RASTER_SCALE_FULL : SIM_BAND_RASTER_SCALE);
  return { pixels, scale };
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

/** 共享结点的判定阈值（CSS px）：同一结点由同一组 `(lane, A)` 算出，只会有浮点末位差 */
const SIM_BAND_CHAIN_EPS = 0.5;

/**
 * 四边形 → 若干条**首尾相接**的中心线链（首点取 a 边中点，之后每段取 b 边中点；共享结点不重复）。
 *
 * 倒流折返谱里，可见窗口会掐掉折点上的同刻换轨段（以及已过线 / 未进场的段）：掐掉后
 * `quads[i]` 的 a 边与 `quads[i-1]` 的 b 边在屏幕上并不重合。此时若仍拼成一条链，就会
 * 画出一条根本不存在的满高斜带、并把真实那一臂的端点弄丢（每段被"接到上一段的轨位"）。
 * 这里按屏幕坐标判重合，不重合即**断链**，让每一段各自从自己的 a 边起画。
 * 正常谱（含首尾相接的折返 V）恒只有一条链，行为与断链前逐像素一致。
 */
export function simBandCenterlineChains(quads: readonly SimPoint[][]): SimBandNode[][] {
  const chains: SimBandNode[][] = [];
  let nodes: SimBandNode[] = [];
  let prevBx = 0;
  let prevBy = 0;
  for (const q of quads) {
    const ax = (q[0]!.x + q[1]!.x) / 2;
    const ay = q[0]!.y;
    const ahalf = Math.abs(q[1]!.x - q[0]!.x) / 2;
    const b: SimBandNode = {
      x: (q[3]!.x + q[2]!.x) / 2,
      y: q[3]!.y,
      half: Math.abs(q[2]!.x - q[3]!.x) / 2,
    };
    if (nodes.length === 0) {
      nodes.push({ x: ax, y: ay, half: ahalf });
    } else if (Math.abs(ax - prevBx) > SIM_BAND_CHAIN_EPS || Math.abs(ay - prevBy) > SIM_BAND_CHAIN_EPS) {
      chains.push(nodes);
      nodes = [{ x: ax, y: ay, half: ahalf }];
    }
    nodes.push(b);
    prevBx = b.x;
    prevBy = b.y;
  }
  if (nodes.length >= 2) chains.push(nodes);
  return chains;
}

/**
 * 把整帧所有可见滑条光栅进**同一张缓冲**。
 *
 * - 每条滑条先按 `simBandCenterlineChains` 在**不共享端点处断链**（可见窗口掐掉的折点
 *   不会再被接成幻影斜带），再按 `splitBandAtFolds` 把各链切成 y 单调 run（倒流区折返的
 *   两臂各自扫，像素内 `1−(1−a₁)(1−a₂)` 合成 ⇒ issue 45 的「不抵消成洞」与 issue 46 的
 *   「自叠 / 交叉叠亮」同源）；
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
    const chains = simBandCenterlineChains(group.quads);
    let y0 = Infinity;
    let y1 = -Infinity;
    // 纵向因子仍按**整条可见带体**求一次（断链只切几何，不重置相位；票 65 定案 #3）
    for (const nodes of chains) {
      for (const n of nodes) {
        if (n.y < y0) y0 = n.y;
        if (n.y > y1) y1 = n.y;
      }
    }
    const span = y1 - y0;
    if (span < 1e-6) continue;
    // `splitBandAtFolds` 只切片、不改元素 ⇒ 结点上的 half 原样带进每个 run；
    // 每条链各自切 run，折返两臂仍在同一缓冲里 screen 叠亮
    const runs = chains.flatMap((nodes) => splitBandAtFolds(nodes)) as SimBandNode[][];
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
/** 每个实时 ctx 一份 LOD 状态（导出给显式比例，不进这张表） */
const LOD = new WeakMap<CanvasRenderingContext2D, SimBandRasterLodState>();

/** 显式比例优先（导出）；否则按这一帧的可见带体量推进 LOD 状态机 */
function resolveSimBandRasterScale(
  ctx: CanvasRenderingContext2D,
  groups: readonly SimBandRasterGroup[],
  sx: number,
  sy: number,
): SimBandRasterScale {
  const prev = LOD.get(ctx) ?? { pixels: 0, scale: SIM_BAND_RASTER_SCALE_FULL };
  const next = nextSimBandRasterLodState(prev, simBandCoverageCss(groups), sx, sy);
  LOD.set(ctx, next);
  return next.scale;
}

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
  if (!scratch.buffer || scratch.buffer.cw !== cw || scratch.buffer.ch !== ch
    || scratch.buffer.rx !== rx || scratch.buffer.ry !== ry) {
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
 *
 * `requestedScale`（票 66）：给定时该帧固定该档（导出恒 1），省略时按每帧可见带体量
 * 走 100% / 50% 自适应。放大倍数 = `1/scale`，故只有低档才需要开双线性平滑。
 */
export function drawSimBandRaster(
  ctx: CanvasRenderingContext2D,
  groups: readonly SimBandRasterGroup[],
  normal: SimBandRasterMaterial,
  sp: SimBandRasterMaterial,
  baseAlpha: number,
  metrics: SimFieldMetrics,
  requestedScale?: SimBandRasterScale,
): boolean {
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const sx = t && Number.isFinite(t.a) && t.a > 0 ? t.a : 1;
  const sy = t && Number.isFinite(t.d) && t.d > 0 ? t.d : 1;
  const tx = t && Number.isFinite(t.e) ? t.e : 0;
  const ty = t && Number.isFinite(t.f) ? t.f : 0;
  // 空带体帧也要推进 EMA（覆盖量 0 ⇒ 压力往下衰减），否则长时间无带体后 seek 进密集段
  // 会拿旧的高压值起算。放在 early-return 之前是有意的。
  const scale = requestedScale ?? resolveSimBandRasterScale(ctx, groups, sx, sy);
  if (groups.length === 0 || baseAlpha <= 0) return false;
  const rx = sx * scale;
  const ry = sy * scale;
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
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, cw, ch, tx, ty, metrics.w * sx, metrics.h * sy);
  ctx.restore();
  return true;
}
