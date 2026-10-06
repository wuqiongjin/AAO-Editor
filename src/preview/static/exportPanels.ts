// 宽图导出（chart-preview 03；ADR-0016 §7）：**同一份面板模型**离屏逐面板出图 → 横向拼成一张**宽图**。
//
// - 形态：**单行宽图**（高 = 一格面板，宽 = 面板数 × 面板宽，随谱面变长而变长）；
//   只有宽度超出画布单边上限时才折行（再不行降密度 dpr 2 → 1），绝不画爆（`planSheetExport`）。
// - **导出与预览解耦**（2026-09-30 二轮定案）：布局与叠加项走自己的**固定档**（面板 289 × 3,222、dpr 2、
//   精简显示档），不跟预览当前的缩放 / 开关走——也不跟预览的缩放基准走（`EXPORT_ES` 独立
//   常量，2026-10-02 预览重定基后尤其重要）；音符外观（皮肤 / 大小 / 配色）沿用作者的画布设置。
//   档位 2026-10-05 加大（issue 13，治"导出图非常糊"）：旧档 130 × 537 是 Bestdori 缩略档，音符
//   CSS 尺寸（es 比）只有预览默认档的 45%；新档取值 = 预览默认档的生效缩放在**定档当日**的数（0.74），此后各钉各的。
//   档高 2026-10-06 再乘 6（537 → 3,222，issue 14，治"横向太长"）：每列 ≈9.9 秒，3 分钟谱 110 列 → 19 列。
//   `resolveCanvasDpr` 也不参与（它会读 `window.devicePixelRatio`）。
// - 复用 `panelLayout`（排布数学）+ `panelPainter`（面板里画的还是编辑器那套渲染）：不是"第二种画法"。
import { bufferSizeFor, displayOptionsFromSettings } from '../../rendering';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '../../rendering/skin/noteSkin';
import CanvasSpriteIcon from '../../ui/CanvasSpriteIcon';
import type { PreviewSettings } from '../../chart/config/AppSettings';
import { resolvePreviewDisplay } from './displayProfile';
import {
  makePanelLayout,
  planSheetExport,
  sheetCellRect,
  type PanelLayout,
  type SheetPlan,
  type SheetPlanOk,
} from './panelLayout';
import { createPanelPainter, type PanelSceneInput } from './panelPainter';
import { saveBinaryAs, type SaveBinaryOutcome } from './saveBinary';

/**
 * 导出档：面板高（CSS px）—— 宽图的"高固定"就固定在这。2026-10-06 格高定案 **3,222 = 6 × 537**
 * （issue 14，grill Q5 用户拍板）：537 时每列只装 ≈1.65 秒，长谱横向列数过多（3 分钟谱 110 列、
 * 59:1 瘦条）；×6 后每列 ≈9.9 秒。上限仍是画布上限（复算见本文件 `EXPORT_ES` 注释与 ADR-0016 §7）。
 */
export const EXPORT_PANEL_H = 3222;
/** 导出档：像素密度 —— 固定 2，不读 `window.devicePixelRatio`（ADR-0016 §7） */
export const EXPORT_DPR = 2;
/**
 * 导出档：生效缩放 —— **直接给 es**（不走 `esForZoom`）→ 面板宽 = 390 × 0.74 = 289 CSS px。
 * 取值 2026-10-05 加大（issue 13，用户「导出的图片感觉非常糊」）：旧值 1/3 的面板 130 px 是 Bestdori
 * 缩略档，导出图里音符的 CSS 尺寸（es 比）只有预览默认档的 **45%**；新值 = 预览默认档（`PREVIEW_ES_STANDARD`）**定档
 * 当日**的数，两者观感可比（实测见票）。**独立常量是与预览基准解耦的关键**：这是"取过的数"，不是"跟随的
 * 引用"——预览基准再上移也不带导出物漂移（ADR-0016 §7「导出与预览解耦」；接线锁在
 * `PreviewBinarySaveWiring.test`，那里同时锁着"本文件不许 import 预览基准"）。
 *
 * 实测（2026-10-06 格高 3,222 后复跑，真实语料 805 张谱面，末音符秒数口径）：本档 dpr 2 下
 * 100% 单行、0 拒绝、仅最长 715.3s 一条降密度（73 面板）；3 分钟谱 = 19 面板 → 缓冲
 * 10,982 × 6,444 px。硬上限 ≈226 面板（≈37 分钟；73 面板起降密度，>226 拒绝——面积先于单边
 * 触顶，折行在 3,222 高下不可达）。
 */
export const EXPORT_ES = 0.74;
/**
 * 导出档的标注（**固定精简**，不跟 `settings.preview` 走）：票 03 定案「导出与预览解耦」——
 * 用户改的是自己看谱的习惯，不该顺手改掉导出物的样子。宽度靠谱长说话，标线越少越清楚。
 */
export const EXPORT_MARKERS: PreviewSettings = {
  bpmMarks: false,
  timeMarks: 'off',
  beatMarks: 1,
  comboMarks: false,
  mirror: false,
};
/** 导出图片的 MIME / 扩展名 */
export const SHEET_IMAGE_MIME = 'image/png';

export interface SheetExportRequest {
  scene: PanelSceneInput;
  /** 建议文件名（页面按谱面名拼） */
  suggestedName: string;
}

/** 导出档的面板模型：**与预览当前缩放无关**（页面拿它做尺寸预告，出图用它，两处同一份） */
export function makeExportLayout(scene: PanelSceneInput): PanelLayout {
  return makePanelLayout({
    notes: scene.notes,
    chartDuration: scene.chartDuration,
    verticalRatio: scene.verticalRatio,
    panelH: EXPORT_PANEL_H,
    es: EXPORT_ES,
  });
}

/** 导出档的排布 + 上限校验（尺寸预告与出图共用；超限时给降密度方案或拒绝的原因） */
export function planSheet(scene: PanelSceneInput): { layout: PanelLayout; plan: SheetPlan } {
  const layout = makeExportLayout(scene);
  return {
    layout,
    plan: planSheetExport({
      panelCount: layout.panelCount,
      panelW: layout.panelW,
      panelH: layout.panelH,
      dpr: EXPORT_DPR,
    }),
  };
}

export interface SheetRendered {
  ok: true;
  /** 宽图（逻辑尺寸 = sheetW × sheetH；缓冲 = × dpr） */
  canvas: HTMLCanvasElement;
  plan: SheetPlanOk;
  /** 面板数 / 每面板秒数（反馈文案用） */
  panelCount: number;
  secondsPerPanel: number;
  elapsedMs: number;
}

export interface SheetRefused {
  ok: false;
  plan: Extract<SheetPlan, { ok: false }>;
  elapsedMs: number;
}

export type SheetRenderOutcome = SheetRendered | SheetRefused;

// ---------------------------------------------------------------- 主线程让出（issue 16）

/**
 * 出图分块（issue 16）：每出满这么多格面板让出一次主线程。
 * 取 4：最常见的短谱（十几格）也能让出数次，单块出图工作量又足够小（块太长照样冻）。
 */
const EXPORT_PANEL_CHUNK = 4;

/**
 * 让出一拍主线程（issue 16）：逐面板出图切成若干短任务，长谱导出期间页面不至于整段冻住。
 * 优先 `scheduler.yield()`（新任务继承优先级，恢复快），不支持就退回宏任务 `setTimeout 0`。
 */
function yieldToMainThread(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 等到「当前这一帧真正画出来」（issue 16）：`setExporting(true)` 之后、开干之前调一次，
 * 让「导出中」的按钮字先出现在屏幕上，而不是被随后那段同步长任务压在首帧前。
 * 单等 rAF 不够（排在它后面的微任务仍在绘制前跑），所以帧后再排一个宏任务才放行。
 */
export function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

/**
 * 离屏出图（宽图）。**先等皮肤图集就绪**——一次性出图没有"下一帧补上"的机会
 * （工作台与预览靠重绘兜底，这里只能等）。
 */
export async function renderSheet(req: SheetExportRequest): Promise<SheetRenderOutcome> {
  const t0 = performance.now();
  const { scene } = req;
  const noteIcons = buildActiveNoteIcons(normalizeNoteSkinSelection(scene.noteSkin));
  await CanvasSpriteIcon.ensureImagesLoaded(noteIcons.preloadSrcs()).catch(() => undefined);

  const { layout, plan } = planSheet(scene);
  if (!plan.ok) return { ok: false, plan, elapsedMs: performance.now() - t0 };

  const canvas = document.createElement('canvas');
  const { w: bufferW, h: bufferH } = bufferSizeFor({ w: plan.sheetW, h: plan.sheetH }, plan.dpr);
  canvas.width = bufferW;
  canvas.height = bufferH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      ok: false,
      plan: { ok: false, reason: 'side', detail: '离屏画布不可用（无法创建 2d 上下文）' },
      elapsedMs: performance.now() - t0,
    };
  }
  ctx.setTransform(plan.dpr, 0, 0, plan.dpr, 0, 0);
  const painter = createPanelPainter({
    layout,
    scene,
    // 固定精简标注档（EXPORT_MARKERS，不跟 settings.preview 走）+ 作者画布设置的其余字段
    display: resolvePreviewDisplay(displayOptionsFromSettings(scene.settingsDisplay), EXPORT_MARKERS),
    noteIcons,
    spriteIcon: new CanvasSpriteIcon(),
    dpr: plan.dpr,
  });
  // 逐面板出图的这一段是纯同步长任务（一口气跑完 = 整页冻到导出结束）：每满一块让出一次
  // （issue 16）。分块只切任务边界，不改出图顺序，也不动格子算法。
  for (let k = 0; k < layout.panelCount; k++) {
    const cell = sheetCellRect(plan, k);
    painter.blitInto(k, ctx, cell.x, cell.y);
    if ((k + 1) % EXPORT_PANEL_CHUNK === 0) await yieldToMainThread();
  }
  return {
    ok: true,
    canvas,
    plan,
    panelCount: layout.panelCount,
    secondsPerPanel: layout.secondsPerPanel,
    elapsedMs: performance.now() - t0,
  };
}

/** 画布 → PNG 字节（`toBlob` → `arrayBuffer`） */
export async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, SHEET_IMAGE_MIME));
  if (!blob) throw new Error('导出失败：画布无法编码为 PNG');
  return new Uint8Array(await blob.arrayBuffer());
}

export interface SheetSaved {
  ok: true;
  /** 用户在系统对话框里取消了 */
  cancelled: boolean;
  via: SaveBinaryOutcome['via'];
  plan: SheetPlanOk;
  elapsedMs: number;
}

export type SheetExportOutcome = SheetSaved | SheetRefused;

/** 出图 + 落盘（页面按钮走这条：一次调用完成"渲染 + 另存"） */
export async function exportSheetAs(req: SheetExportRequest): Promise<SheetExportOutcome> {
  const t0 = performance.now();
  const rendered = await renderSheet(req);
  if (!rendered.ok) return rendered;
  const bytes = await canvasToPngBytes(rendered.canvas);
  const saved = await saveBinaryAs({
    bytes,
    suggestedName: req.suggestedName,
    mime: SHEET_IMAGE_MIME,
  });
  return {
    ok: true,
    cancelled: saved.cancelled,
    via: saved.via,
    plan: rendered.plan,
    elapsedMs: performance.now() - t0,
  };
}
