// 谱面预览域 barrel（ADR-0016 §3）：静态预览（面板折行 + 宽图导出）与
// 动态预览（仿真场 + 离线导出）两条子线，各自住在 static/ 与 video/。
//
// 页面装配在 `src/pages/preview/`；本域**不得** import pages/（单向依赖：preview → rendering/chart/audio/playback）。
export type { PreviewMode, PreviewTarget } from './types';
export {
  DEFAULT_PREVIEW_ZOOM,
  EXPORT_HEADER_H,
  EXPORT_PANEL_H,
  PREVIEW_ES_STANDARD,
  PREVIEW_ZOOM_RANGE,
  StaticPreviewView,
  esForZoom,
  exportSheetAs,
  makePanelLayout,
  normalizePreviewZoom,
  panelWidthForEs,
  planSheet,
  renderSheet,
  waitForPaint,
} from './static';
export type {
  PanelLayout,
  PanelPainterFactory,
  PanelSceneInput,
  SheetExportOutcome,
  SheetExportRequest,
  SheetHeaderInput,
  SheetPlan,
  SheetRendered,
  StaticPreviewViewProps,
} from './static';
export { DEFAULT_PREVIEW_MARKERS } from './static';
export type { VideoPreviewRequest } from './video';
