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
  // issue 10 性能：trackGeometry 只依赖 (scale, surface)，闭包内缓存一次，
  // 避免密集音符下每帧数千次 virtualToCanvas 重复计算 + 对象分配（GC 压力）。
  const cachedTrackGeometry = geometry.trackGeometry(scale);
  const cachedViewportBounds = geometry.viewportBounds(viewport);
  return {
    trackGeometry: (s) => (s === scale ? cachedTrackGeometry : geometry.trackGeometry(s)),
    beatToVirtualY: (beat) => geometry.beatToVirtualY(beat, scale),
    virtualYToBeat: (y) => geometry.virtualYToBeat(y, scale),
    virtualToCanvas: (x, y) => {
      const es = geometry.effectiveScale(scale);
      return { x: cachedTrackGeometry.trackBgX + (x - viewport.scrollX) * es, y: (y - viewport.scrollY) * es };
    },
    canvasToVirtual: (x, y) => {
      const es = geometry.effectiveScale(scale);
      return { x: (x - cachedTrackGeometry.trackBgX) / es + viewport.scrollX, y: y / es + viewport.scrollY };
    },
    getNoteVirtualY: (beat, subBeat = 0) => geometry.noteVirtualY(beat, subBeat, scale, beatDisplay),
    getNoteVirtualX: (lane) => geometry.noteVirtualX(lane),
    getViewportBounds: () => cachedViewportBounds,
    getVisibleNotes: () => geometry.visibleNotes(notes, viewport, beatDisplay),
    getLaneBeatFromCanvas: (cx, cy) => geometry.laneBeatFromCanvas(cx, cy, viewport, beatDisplay),
  };
}
