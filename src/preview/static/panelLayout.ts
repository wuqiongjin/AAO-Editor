// 静态预览的**面板模型**（chart-preview 03；ADR-0016 §1.1 / §7）：排布数学全部是纯函数。
//
// 一处 `panelW × panelH` 的渲染目标 = 一个面板，覆盖布局轴（ADR-0010：pos = 秒 × virtualPxPerSecond）
// 上定长的一段 `[k·W, (k+1)·W)`，其中 `W = panelH / es`（`es` = 生效缩放）。面板按序号横向排开，
// 面板内时间向上（判定线 = 画布底边，与既有渲染方向天然一致，无需翻转）。
//
// **一个旋钮**（2026-09-30 二轮定案）：只给「缩放」档，其余全部由它推出 ——
//   - 面板宽 = 13 车道宽 = `390 × es`（7 条轨道 + 两侧各 3 车道留白，照 Bestdori 的 13/10；
//     面板宽不再手调，缩放↑ 轨道自然变宽）；
//   - 每面板秒数 = `panelH / es / 440` —— 缩放↑ 每面板时间缩短、面板数变多、横向滑条出现；
//   - 面板高**跟容器高**（Bestdori 语义）：窗口矮 → 面板矮 → 每面板秒数少 → 面板数多。
//
// 视图（StaticPreviewView）与导出（exportPanels）共用这一份，**不各写一套**（ADR-0016 §7「同一份面板模型」）。
// 无 React、无 canvas：这里只算数。
import { ChartGeometry, LANE_WIDTH, type SurfaceSize } from '../../chart/geometry/ChartGeometry';
import { getBpmEvents } from '../../audio/AudioTiming';
import type { ChartNote } from '../../chart/types';

/** 面板高下限（CSS px）：容器尚未测量（0）时不让 `W` 退化成 0 / 除零 */
export const MIN_PANEL_H = 120;

/** 一屏面板占几条车道宽（Bestdori `panelWidth = 13 × laneWidth`：7 条轨道 + 两侧各 3 条留白） */
export const PANEL_LANES = 13;
/** 面板宽 / es = 13 × 30 = 390 虚拟 px */
export const PANEL_W_PER_ES = PANEL_LANES * LANE_WIDTH;

/**
 * 面板宽（CSS px）由缩放推出 —— 不再有独立的「面板宽」参数。
 * **取整**：位图缓冲恒是整数（`round(css × dpr)`），面板宽/左缘取整后 1:1 命中，
 * 不再出现"面板落在半像素上再被重采样"的糊（2026-09-30 验收回修）。
 */
export function panelWidthForEs(es: number): number {
  return Math.round(PANEL_W_PER_ES * es);
}

/** 缩放下限（与 `ChartGeometry` 的 MIN_SCALE 同值）：面板档下 fitScale 恒不触发（228es < 390es） */
const MIN_PANEL_ES = 0.1;

/**
 * 缩放区间（**连续可调**：滑杆 + 预览区内 Ctrl/⌘+滚轮；1 = 100% → 面板 289 CSS px 宽）。
 * 下限 30% 时面板 87 px 宽、上限 300% 时面板 866 px 宽：两端都还在"看得出是谱面"的范围里。
 */
export const PREVIEW_ZOOM_RANGE = { min: 0.3, max: 3, step: 0.05 } as const;
/**
 * 默认缩放档（2026-10-02 二次重定基，ADR-0017 §5）：1 = 滑杆读数 100% —— 物理观感 = **当前舒适档**
 * （面板 289 CSS px 宽 = 08 四轮 185% 观感 × 1.2）。
 *
 * 重定基史：08 四轮曾把默认值钉在 1.85，前提「预览 UI 没有百分比标签」有误：工具栏滑杆本就渲染
 * 百分比读数（`PreviewStaticToolbar` 的 `slider-value`），默认 1.85 会直接亮出「185%」——用户判定其怪。
 * 第一次（当日稍早）：`PREVIEW_ES_STANDARD` 抬到 1.85/3（100% = 当时舒适档），默认档回 1；
 * 第二次（票 10 布局扩大落地）：舞台 1121×509 → 1390×603 后实测定档「音符 +20%、一屏秒数持平
 * （8.91 ≈ 旧 8.74）」，基准再抬 1.2× —— 「默认位置 = 100% = 舒适档」不变式始终保持。
 * 零迁移仍成立：zoom 只活在页面 React state（不持久化），没有已存值要搬。
 */
export const DEFAULT_PREVIEW_ZOOM = 1;

/**
 * 归一化缩放值：夹进区间 + 取到百分位（滑杆按 `step` 走档、滚轮给连续值，两者共用这一把尺）。
 * 百分位量化是防浮点噪声（0.30000000000000004），不是限制档位 —— 缩放是连续可调的。
 */
export function normalizePreviewZoom(zoom: number): number {
  const { min, max } = PREVIEW_ZOOM_RANGE;
  if (!Number.isFinite(zoom)) return DEFAULT_PREVIEW_ZOOM;
  return Math.round(Math.min(max, Math.max(min, zoom)) * 100) / 100;
}

/**
 * 标准缩放的 es（2026-10-02 二次重定基）：`(1.85 / 3) × 1.2 = 0.74` → 面板 289 CSS px 宽（390 × es）。
 * 语义：滑杆 100% = **用户舒适档** —— 物理观感 = 票 10 布局扩大前默认档的 1.2×
 * （音符 27.7 → 33.2 物理 px；新舞台 1390×603 下一屏 8.91 秒 ≈ 扩大前 8.74）。
 * Bestdori 静态预览默认档（面板 130 px 宽 / 537 高 ≈3.66 秒）改由 zoom ≈ 0.45 命中，不再是基准；
 * 导出的「289 × 3,222」固定档（宽 2026-10-05 加大 issue 13 / 高 2026-10-06 加 6× issue 14）
 * **不吃这份基准**：值取自本基准定档当日的数，但由 `EXPORT_ES` / `EXPORT_PANEL_H` 独立常量钉住（ADR-0016 §7）。
 */
export const PREVIEW_ES_STANDARD = 0.74;

/** 缩放档 → es */
export function esForZoom(zoom: number): number {
  return PREVIEW_ES_STANDARD * zoom;
}

/** 建面板专用的几何（surface = 本面板尺寸）：谱面长度第一性是秒（ADR-0005），走 `{ seconds }` 档 */
export function makePanelGeometry(
  notes: ChartNote[],
  chartDurationSeconds: number,
  surface: SurfaceSize,
  verticalRatio: number,
): ChartGeometry {
  return new ChartGeometry(getBpmEvents(notes), { seconds: chartDurationSeconds }, surface, verticalRatio);
}

/** 一格面板的生效参数 */
export interface PanelLayout {
  /** 几何（surface 必须 = 本面板的 `{ w: panelW, h: panelH }`）：面板的 pos↔秒 换算都走它 */
  geometry: ChartGeometry;
  panelW: number;
  panelH: number;
  /** 生效缩放（= `esForZoom(zoom)`；面板档下不会被 fitScale 钳制） */
  es: number;
  /** 每面板覆盖的布局轴长度（虚拟 px）= `panelH / es` */
  windowVirtualY: number;
  /** 每面板秒数 = `windowVirtualY / virtualPxPerSecond` */
  secondsPerPanel: number;
  /** 面板数 = `ceil(chartEndVirtualY / windowVirtualY)` */
  panelCount: number;
  /** 面板行总宽（CSS px）= `panelCount × panelW` */
  totalWidth: number;
}

export interface PanelLayoutInput {
  notes: ChartNote[];
  /** 谱面长度（秒，ADR-0005 第一性） */
  chartDuration: number;
  verticalRatio: number;
  /** 面板高（CSS px）：预览 = 容器高；导出 = 固定档 */
  panelH: number;
  /** **请求**缩放（未钳制）：`esForZoom(zoom)` 或导出档直接给；生效值看 `PanelLayout.es` */
  es: number;
}

/** 由（谱面 + 面板高 + 请求缩放）得到面板模型：几何、面板宽、面板数、每面板秒数全在这里定 */
export function makePanelLayout(input: PanelLayoutInput): PanelLayout {
  const es = Math.max(MIN_PANEL_ES, input.es);
  const panelH = Math.max(1, input.panelH);
  const panelW = panelWidthForEs(es);
  const geometry = makePanelGeometry(input.notes, input.chartDuration, { w: panelW, h: panelH }, input.verticalRatio);
  const windowVirtualY = panelH / es;
  // 浮点安全：整除数（chartEndVirtualY 恰为 W 的整数倍）不该多出一个空面板
  const panelCount = Math.max(0, Math.ceil(geometry.chartEndVirtualY / windowVirtualY - 1e-9));
  return {
    geometry,
    panelW,
    panelH,
    es,
    windowVirtualY,
    secondsPerPanel: windowVirtualY / geometry.virtualPxPerSecond,
    panelCount,
    totalWidth: panelCount * panelW,
  };
}

// ---------------------------------------------------------------- 面板 ↔ 布局轴

/** 面板 k 在布局轴上的窗口（虚拟 px）：`[k·W, (k+1)·W)` */
export function panelPosRange(layout: PanelLayout, k: number): { posMin: number; posMax: number } {
  return { posMin: k * layout.windowVirtualY, posMax: (k + 1) * layout.windowVirtualY };
}

/**
 * 面板 k 的 `viewport.scrollY`（虚拟 px）。
 *
 * 推导：画布顶 (canvasY=0) 对应 pos = baseline − scrollY，而我们要它就等于面板窗口上缘 (k+1)·W；
 * 代入 baseline = chartEndVirtualY + panelH/es，得 scrollY = chartEndVirtualY − k·W。
 * （面板 0 = 谱面最开头那段；序号越大越靠后 —— 与「面板按序号横向排开」同序。）
 */
export function panelScrollY(layout: PanelLayout, k: number): number {
  return layout.geometry.chartEndVirtualY - k * layout.windowVirtualY;
}

/** 面板内指针 y（CSS px，面板局部坐标）→ 布局轴 pos / 秒（`y→秒` 恒单值：走布局轴直读） */
export function panelPointerAt(layout: PanelLayout, k: number, canvasY: number): { pos: number; seconds: number } {
  const virtualY = panelScrollY(layout, k) + canvasY / layout.es;
  return {
    pos: layout.geometry.posOfVirtualY(virtualY, layout.es),
    seconds: layout.geometry.virtualYToSeconds(virtualY, layout.es),
  };
}

// ---------------------------------------------------------------- 可见区间

/**
 * 可见面板区间（ADR-0016 §1.1）：`[floor(scrollLeft/panelW), floor((scrollLeft+viewW)/panelW)]`，
 * 两端各钳进 `[0, panelCount-1]`。`hi < lo` = 这一屏没有面板（面板数为 0 / 尺寸未知）。
 */
export function visiblePanelRange(
  layout: PanelLayout,
  scrollLeft: number,
  viewWidth: number,
): { lo: number; hi: number } {
  if (layout.panelCount <= 0) return { lo: 0, hi: -1 };
  const left = Number.isFinite(scrollLeft) ? Math.max(0, scrollLeft) : 0;
  const width = Number.isFinite(viewWidth) && viewWidth > 0 ? viewWidth : 0;
  const lo = Math.min(layout.panelCount - 1, Math.max(0, Math.floor(left / layout.panelW + 1e-9)));
  const hi = Math.min(layout.panelCount - 1, Math.max(lo, Math.floor((left + width) / layout.panelW + 1e-9)));
  return { lo, hi };
}

// ---------------------------------------------------------------- 宽图（长图导出）

/**
 * 画布上限（照 06 票待实测的 Chromium 基线：单边 65,535 px、面积 2^28）。
 * 06 实测出真数后只改这里，`planSheetExport` 的算法不动。
 */
export const SHEET_LIMITS = { maxSidePx: 65535, maxAreaPx: 2 ** 28 } as const;

export interface SheetLimits {
  maxSidePx: number;
  maxAreaPx: number;
}

export interface SheetPlanRequest {
  panelCount: number;
  panelW: number;
  panelH: number;
  /** 目标像素密度（导出**固定档**，不读窗口） */
  dpr: number;
  /**
   * 头部横带高（chart-preview 14）：整张图 = 横带 + 面板区，横带计入高与面积上限。
   * 缺省 0 = 不带横带 —— **这也是产品档**：`settings.export.enabled` 关掉时 `planSheet` 就传 0，
   * 导出物是纯面板区的宽图（2026-10-07 用户定案，取代 ADR-0016 §7 旧口径「一律图文版、
   * 没有纯面板宽图这个产品档」）。
   */
  headerH?: number;
  limits?: SheetLimits;
}

export interface SheetPlanOk {
  ok: true;
  /** 一格面板的尺寸（回抄给 `sheetCellRect` 用） */
  panelW: number;
  panelH: number;
  dpr: number;
  /** 头部横带高（0 = 无横带）；面板区从 `headerH` 起算 */
  headerH: number;
  cols: number;
  rows: number;
  /** 图像逻辑尺寸（CSS px） */
  sheetW: number;
  sheetH: number;
  /** 位图缓冲尺寸（px）× dpr，四舍五入 */
  bufferW: number;
  bufferH: number;
  /** 是否因上限把 dpr 降了一档（UI 该说一句） */
  downscaled: boolean;
}

export interface SheetPlanFail {
  ok: false;
  /** 卡在哪一条上限上（请求 dpr 与降档 dpr 都过不去时才失败） */
  reason: 'side' | 'area';
  detail: string;
}

export type SheetPlan = SheetPlanOk | SheetPlanFail;

/** 位图缓冲尺寸（与渲染域 `bufferSizeFor` 同口径：round(css × dpr)） */
function bufferFor(cssSize: number, dpr: number): number {
  return Math.round(cssSize * dpr);
}

/**
 * 宽图排布 + 尺寸上限校验（**超限先降密度，再超才折行，绝不画爆**）：
 * 1. 默认**单行**：宽 = 面板数 × 面板宽（高度 = 一格，图文版再 + `headerH` 横带），宽度放得下就一行到底；
 * 2. 宽度越单边上限才折行（列数取满 = 行数最少）；面积只跟 dpr 与面板数有关，折行救不了；
 * 3. 请求 dpr 过不去 → 降到 dpr 1 重排（降密度方案）；
 * 4. 都不行 → `ok: false`（调用方拒绝出图，不硬画）。
 */
export function planSheetExport(req: SheetPlanRequest): SheetPlan {
  const limits: SheetLimits = req.limits ?? SHEET_LIMITS;
  if (req.panelCount <= 0) {
    return { ok: false, reason: 'side', detail: '没有面板可导出' };
  }
  // 头部横带（图文版）：计入高与面积，不影响列 / 行（那是宽度方向的事）
  const headerH = Math.max(0, Math.round(req.headerH ?? 0));
  const candidates = req.dpr > 1 ? [req.dpr, 1] : [req.dpr];
  let lastReason: 'side' | 'area' = 'side';
  let lastDetail = '';
  for (const dpr of candidates) {
    // 列数取"宽度上限允许的最大值"= 行数最少（单行优先）；高度方向由 overSide 兜住
    const colCap = Math.max(1, Math.floor(limits.maxSidePx / (req.panelW * dpr)));
    const cols = Math.min(req.panelCount, colCap);
    const rows = Math.ceil(req.panelCount / cols);
    const sheetW = cols * req.panelW;
    const sheetH = headerH + rows * req.panelH;
    const bufferW = bufferFor(sheetW, dpr);
    const bufferH = bufferFor(sheetH, dpr);
    const overSide = bufferW > limits.maxSidePx || bufferH > limits.maxSidePx;
    const overArea = bufferW * bufferH > limits.maxAreaPx;
    if (!overSide && !overArea) {
      return {
        ok: true,
        panelW: req.panelW,
        panelH: req.panelH,
        dpr,
        headerH,
        cols,
        rows,
        sheetW,
        sheetH,
        bufferW,
        bufferH,
        downscaled: dpr < req.dpr,
      };
    }
    lastReason = overArea ? 'area' : 'side';
    lastDetail = overArea
      ? `${bufferW}×${bufferH} px² 超过面积上限 ${limits.maxAreaPx}（dpr ${dpr}）`
      : `${bufferW}×${bufferH} 超过单边上限 ${limits.maxSidePx} px（dpr ${dpr}）`;
  }
  return { ok: false, reason: lastReason, detail: lastDetail };
}

/**
 * 宽图里第 k 格的目标矩形（CSS px，逻辑尺寸坐标系；调用方按自己的 transform 画）。
 * 图文版（chart-preview 14）：`headerH`（头部横带）之下才是面板区 —— 面板行整体下移。
 */
export function sheetCellRect(
  plan: { cols: number; panelW: number; panelH: number; headerH: number },
  k: number,
): { x: number; y: number; w: number; h: number } {
  const col = k % plan.cols;
  const row = Math.floor(k / plan.cols);
  return { x: col * plan.panelW, y: plan.headerH + row * plan.panelH, w: plan.panelW, h: plan.panelH };
}
