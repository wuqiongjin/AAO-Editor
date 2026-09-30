// 静态预览 = 面板折行全景（ADR-0016 §1.1），宽图导出是它的副产物（§7）。
//
// 面板里画的**就是**编辑器那套渲染（`src/rendering`），本域不新写第二种画笔：
//   - `panelLayout`   面板模型的排布数学（一个缩放旋钮 / 面板数 / 窗口 / 可见区间 / 指针→秒 / 宽图与上限）
//   - `panelPainter`  一份共享离屏 target 逐面板代画（`renderChart` / `RenderTarget`）
//   - `displayProfile` 预览显示档（默认精简：只整拍线 / 无沟槽文字 / 无起止线）
//   - `StaticPreviewView` 画面（横向滚动 + 懒绘制 + 记账 + hover）
//   - `exportPanels`  宽图导出（固定档出图 + 落盘）
//   - `saveBinary`    二进制另存通道（Electron 桥 / 浏览器降级；07 的视频导出复用）
export {
  MIN_PANEL_H,
  PANEL_LANES,
  PANEL_W_PER_ES,
  PREVIEW_ES_STANDARD,
  PREVIEW_ZOOM_STEPS,
  SHEET_LIMITS,
  esForZoom,
  makePanelGeometry,
  makePanelLayout,
  panelPointerAt,
  panelPosRange,
  panelScrollY,
  panelWidthForEs,
  planSheetExport,
  sheetCellRect,
  visiblePanelRange,
  type PanelLayout,
  type PanelLayoutInput,
  type PreviewZoom,
  type SheetLimits,
  type SheetPlan,
  type SheetPlanFail,
  type SheetPlanOk,
  type SheetPlanRequest,
} from './panelLayout';
export {
  createPanelPainter,
  type PanelPainter,
  type PanelPainterFactory,
  type PanelPainterParams,
  type PanelSceneInput,
} from './panelPainter';
export {
  DEFAULT_PREVIEW_PROFILE,
  PREVIEW_LABEL_SCALE,
  resolvePreviewDisplay,
  type PreviewDisplayProfile,
  type PreviewGridDetail,
} from './displayProfile';
export { default as StaticPreviewView, type StaticPreviewViewProps } from './StaticPreviewView';
export {
  EXPORT_DPR,
  EXPORT_PANEL_H,
  EXPORT_ZOOM,
  SHEET_IMAGE_MIME,
  canvasToPngBytes,
  exportSheetAs,
  makeExportLayout,
  planSheet,
  renderSheet,
  type SheetExportOutcome,
  type SheetExportRequest,
  type SheetRefused,
  type SheetRendered,
  type SheetRenderOutcome,
  type SheetSaved,
} from './exportPanels';
export {
  downloadBinary,
  getPreviewSaveBridge,
  saveBinaryAs,
  type PreviewSaveBridge,
  type SaveBinaryOutcome,
  type SaveBinaryRequest,
} from './saveBinary';
