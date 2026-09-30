// 坐标薄封装：FinalVirtualCanvas 内联的几何换算，统一收敛为对 ChartGeometry 的直调。
// 渲染与命中测试共用，去掉组件闭包对 geometry/viewport/beatDisplay/notes 的重复捕获。
import type { ChartGeometry, GeometryBounds, GeometryPoint, GeometryViewport } from '../chart/geometry/ChartGeometry';
import { mirrorLane } from '../chart/editing/NoteEditing';
import type { ChartNote } from '../chart/types';

export interface Coords {
  trackGeometry: (scale: number) => ReturnType<ChartGeometry['trackGeometry']>;
  beatToVirtualY: (beat: number) => number;
  /** 虚拟Y → 秒（布局轴直读，issue 104 修法 3：hover 读数用它，倒流区里不经"拍"） */
  virtualYToSeconds: (virtualY: number) => number;
  /** 秒 → 虚拟Y：播放起点等**时间锚定**元素的落点（issue 152：起点存秒，不经拍） */
  secondsToVirtualY: (seconds: number) => number;
  /** 虚拟Y → beat = **最大 beat 解**（需要拍时的默认取解口径；多值处不可当作唯一真值） */
  virtualYToBeat: (virtualY: number) => number;
  virtualToCanvas: (x: number, y: number) => GeometryPoint;
  canvasToVirtual: (x: number, y: number) => GeometryPoint;
  getNoteVirtualY: (beat: number, subBeat?: number) => number;
  getNoteVirtualX: (lane: number) => number;
  getViewportBounds: () => GeometryBounds;
  getVisibleNotes: () => { note: ChartNote; index: number }[];
  getLaneBeatFromCanvas: (cx: number, cy: number) => { lane: number; preciseBeat: number } | null;
}

/**
 * 由 geometry + viewport + beatDisplay + notes 构造坐标换算集。
 * `mirror` = **预览镜像**（chart-preview 08，照 Bestdori `styleMirror`）：车道左右互换
 * （`lane → mirrorLane(lane)`，与编辑器镜像工具同一实现）。只影响**绘制侧**的车道 → x 映射，
 * 不动 `geometry` 自己的命中/圈选换算（编辑器不设本开关）。
 */
export function makeCoords(
  geometry: ChartGeometry,
  viewport: GeometryViewport,
  beatDisplay: number,
  notes: readonly ChartNote[],
  mirror = false,
): Coords {
  const scale = viewport.scale;
  // issue 10 性能：trackGeometry 只依赖 (scale, surface)，闭包内缓存一次，
  // 避免密集音符下每帧数千次 virtualToCanvas 重复计算 + 对象分配（GC 压力）。
  const cachedTrackGeometry = geometry.trackGeometry(scale);
  const cachedViewportBounds = geometry.viewportBounds(viewport);
  // issue 70 候选 2（实测）：renderChart 一帧内取可见集 4 次（BPM 标线 / 同时点击线 /
  // BPM 数值 / 选中描边），每次都新建数组并线性扫描全部 span。Coords 的生命周期 = 一帧
  // （渲染与命中各自现造），故在此惰性缓存一次即可——**不跨帧、不失效**，语义完全不变。
  // 实测单帧 0.31ms → 见 tests/perf/RendererPerf.test.ts「候选 2 测量」组。
  let cachedVisibleNotes: { note: ChartNote; index: number }[] | null = null;
  return {
    trackGeometry: (s) => (s === scale ? cachedTrackGeometry : geometry.trackGeometry(s)),
    beatToVirtualY: (beat) => geometry.beatToVirtualY(beat, scale),
    virtualYToSeconds: (y) => geometry.virtualYToSeconds(y, scale),
    secondsToVirtualY: (seconds) => geometry.secondsToVirtualY(seconds, scale),
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
    getNoteVirtualX: (lane) => geometry.noteVirtualX(mirror ? mirrorLane(lane) : lane),
    getViewportBounds: () => cachedViewportBounds,
    getVisibleNotes: () => (cachedVisibleNotes ??= geometry.visibleNotes(notes, viewport, beatDisplay)),
    getLaneBeatFromCanvas: (cx, cy) => geometry.laneBeatFromCanvas(cx, cy, viewport, beatDisplay),
  };
}
