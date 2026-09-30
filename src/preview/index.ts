// 谱面预览域 barrel（ADR-0016 §3）：静态预览（面板折行 + 长图导出）与
// 动态预览（仿真场 + 离线导出）两条子线，各自住在 static/ 与 video/。
//
// 本票（chart-preview 02）只立骨架与类型契约；页面装配在 `src/pages/preview/`。
export type { PreviewMode, PreviewTarget } from './types';
export type { PreviewPanelLayout, StaticPreviewRequest } from './static';
export type { VideoPreviewRequest } from './video';
