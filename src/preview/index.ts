// 谱面预览域 barrel（ADR-0016 §3）：静态预览（面板折行 + 宽图导出）与
// 动态预览（仿真场 + 离线导出）两条子线，各自住在 static/ 与 video/。
//
// 页面装配在 `src/pages/preview/`；本域**不得** import pages/（单向依赖：preview → rendering/chart/audio/playback）。
export type { PreviewMode, PreviewTarget } from './types';
export {
  EXPORT_PANEL_H,
  PREVIEW_ES_STANDARD,
  PREVIEW_ZOOM_STEPS,
  StaticPreviewView,
  esForZoom,
  exportSheetAs,
  makePanelLayout,
  panelWidthForEs,
  planSheet,
  renderSheet,
} from './static';
export type {
  PanelLayout,
  PanelPainterFactory,
  PanelSceneInput,
  PreviewDisplayProfile,
  PreviewGridDetail,
  PreviewZoom,
  SheetExportOutcome,
  SheetExportRequest,
  SheetPlan,
  SheetRendered,
  StaticPreviewViewProps,
} from './static';
export { DEFAULT_PREVIEW_PROFILE } from './static';
export type { VideoPreviewRequest } from './video';
