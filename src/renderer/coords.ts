// 坐标薄封装：FinalVirtualCanvas 内联的几何换算，统一收敛为对 ChartGeometry 的直调。
// 渲染与命中测试共用，去掉组件闭包对 geometry/viewport/beatDisplay/notes 的重复捕获。
import type { ChartGeometry, GeometryBounds, GeometryPoint, GeometryViewport } from '../utils/ChartGeometry';
import type { ChartNote } from '../notes/Charts';

export interface Coords {
  trackGeometry: (scale: number) => ReturnType<ChartGeometry['trackGeometry']>;
  beatToVirtualY: (beat: number) => number;
  virtualYToBeat: (virtualY: number) => number;
  virtualToCanvas: (x: number, y: number) => GeometryPoint;
  canvasToVirtual: (x: number, y: number) => GeometryPoint;
  getNoteVirtualY: (beat: number, subBeat?: number) => number;
  getNoteVirtualX: (lane: number) => number;
  getViewportBounds: () => GeometryBounds;
  getVisibleNotes: () => { note: ChartNote; index: number }[];
  getLaneBeatFromCanvas: (cx: number, cy: number) => { lane: number; preciseBeat: number } | null;
}

/** 由 geometry + viewport + beatDisplay + notes 构造坐标换算集 */
export function makeCoords(geometry: ChartGeometry, viewport: GeometryViewport, beatDisplay: number, notes: readonly ChartNote[]): Coords {
  const scale = viewport.scale;
  return {
    trackGeometry: (s) => geometry.trackGeometry(s),
    beatToVirtualY: (beat) => geometry.beatToVirtualY(beat, scale),
    virtualYToBeat: (y) => geometry.virtualYToBeat(y, scale),
    virtualToCanvas: (x, y) => geometry.virtualToCanvas(x, y, viewport),
    canvasToVirtual: (x, y) => geometry.canvasToVirtual(x, y, viewport),
    getNoteVirtualY: (beat, subBeat = 0) => geometry.noteVirtualY(beat, subBeat, scale, beatDisplay),
    getNoteVirtualX: (lane) => geometry.noteVirtualX(lane),
    getViewportBounds: () => geometry.viewportBounds(viewport),
    getVisibleNotes: () => geometry.visibleNotes(notes, viewport, beatDisplay),
    getLaneBeatFromCanvas: (cx, cy) => geometry.laneBeatFromCanvas(cx, cy, viewport, beatDisplay),
  };
}
