// 宽图导出（chart-preview 03；ADR-0016 §7）：**同一份面板模型**离屏逐面板出图 → 横向拼成一张**宽图**。
//
// - 形态：**单行宽图**（高 = 一格面板，宽 = 面板数 × 面板宽，随谱面变长而变长）；
//   只有宽度超出画布单边上限时才折行（再不行降密度 dpr 2 → 1），绝不画爆（`planSheetExport`）。
// - **导出与预览解耦**（2026-09-30 二轮定案）：布局与叠加项走自己的**固定档**（面板 130 × 537 = Bestdori
//   缩略档、dpr 2、精简显示档），不跟预览当前的缩放 / 开关走——也不跟预览的缩放基准走（`EXPORT_ES` 独立
//   常量，2026-10-02 预览重定基后尤其重要）；音符外观（皮肤 / 大小 / 配色）沿用作者的画布设置。
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

/** 导出档：面板高（CSS px）—— 宽图的"高固定"就固定在这（照 research §3.1 标准档 537） */
export const EXPORT_PANEL_H = 537;
/** 导出档：像素密度 —— 固定 2，不读 `window.devicePixelRatio`（ADR-0016 §7） */
export const EXPORT_DPR = 2;
/**
 * 导出档：生效缩放 —— **直接给 es**（不走 `esForZoom`）→ 面板宽 = 390 × 1/3 = 130 CSS px。
 * 独立常量是与预览基准解耦的关键：2026-10-02 预览重定基（100% = 面板 241 px）不该带着导出物一起漂移
 * （ADR-0016 §7「导出与预览解耦」；接线锁在 `PreviewBinarySaveWiring.test`）。
 */
export const EXPORT_ES = 1 / 3;
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
  for (let k = 0; k < layout.panelCount; k++) {
    const cell = sheetCellRect(plan, k);
    painter.blitInto(k, ctx, cell.x, cell.y);
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
