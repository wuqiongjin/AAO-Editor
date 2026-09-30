// renderer 纯模块统一出口（ADR-0003 候选 B + 候选 3）：
// 谱面渲染 + 命中测试 + 坐标换算，从 FinalVirtualCanvas 组件中拆出，可独立单测；
// 候选 3 起，绘制入口是「渲染目标」——`createRenderTarget` 拥有 surface / dpr / 两层离屏缓存，
// `frameFor(target, view)` 构建一帧，`target.renderFrame(view)` 一次调用出帧（离屏导出 / 预览的地基）。
export { renderChart, frameFor, renderGrid, renderNotes, renderPlaybackMarker, renderSelectionBox, renderSelectionOverlay, renderSlideBuffer, renderToolPreview, renderBpmLabels, renderTimeMarks } from './render';
export { createRenderTarget, type RenderTarget, type RenderTargetOptions } from './RenderTarget';
export { createStaticLayerCache, normalizeBackgroundOpacity, type StaticLayerCache } from './pipeline/staticLayerCache';
export { createNoteLayerCache, type NoteLayerCache } from './pipeline/noteLayerCache';
export { resolveCanvasDpr, bufferSizeFor, imageQualityDensity } from './rasterScale';
export { displayOptionsFromSettings } from './displayOptions';
export { makeCoords, type Coords } from './coords';
export { findItemAt, findBpmLineAt, computeItemsInBox, computeBpmLinesInBox, pointInQuad, type HitTestDeps } from './hitTest/hitTest';
export type {
  RenderCtx, FrameView, ViewportState, SelectionBox, SlideBuffer, HoverPos,
  RenderDisplayOptions, RenderBackgroundImage,
} from './types';
