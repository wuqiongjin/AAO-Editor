// renderer 纯模块统一出口（ADR-0003 候选 B）：
// 谱面渲染 + 命中测试 + 坐标换算，从 FinalVirtualCanvas 组件中拆出，可独立单测。
export { renderChart, renderGrid, renderNotes, renderPlaybackMarker, renderSelectionBox, renderSelectionOverlay, renderSlideBuffer, renderToolPreview, renderBpmLabels } from './render';
export { makeCoords, type Coords } from './coords';
export { findItemAt, findBpmLineAt, computeItemsInBox, computeBpmLinesInBox, pointInQuad, type HitTestDeps } from './hitTest';
export type { RenderCtx, ViewportState, SelectionBox, SlideBuffer, HoverPos } from './types';
