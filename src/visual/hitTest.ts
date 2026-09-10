// 命中测试纯函数（ADR-0003 候选 B）：把 FinalVirtualCanvas 内的 findItemAt / 圈选判定
// 抽出为可单测模块，依赖 geometry + viewport + notes，与 React 组件解耦。
import type { ChartNote, SelectionItem, SlideNote } from '../chart/types';
import type { ChartGeometry, GeometryViewport } from '../chart/geometry/ChartGeometry';
import { LANE_WIDTH, directionalLanes } from '../chart/geometry/ChartGeometry';
import { makeCoords } from './coords';
import type { SelectionBox } from './types';

// 命中尺寸常量（与 render.ts 的渲染图标尺寸保持一致）
const NOTE_ICON_SIZE = 36;
const SLIDE_ICON_SIZE = 36;

/** 点在多边形内判定（射线法） */
export function pointInQuad(px: number, py: number, quad: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const xi = quad[i][0], yi = quad[i][1];
    const xj = quad[j][0], yj = quad[j][1];
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface HitTestDeps {
  geometry: ChartGeometry;
  viewport: GeometryViewport;
  beatDisplay: number;
  notes: readonly ChartNote[];
  /** 节奏图示大小比例（issue 39 #1，0.1..2.0；默认 1）：命中半径与渲染图标同步缩放 */
  noteSize?: number;
}

/**
 * 命中测试：返回点击位置命中的选择条目（任意音符类型）。
 * - 普通音符/方向键 → {kind:'note'}
 * - 滑条结点 → {kind:'slideNode', connIndex}
 * - 滑条连接带区域 → {kind:'slideRegion', connIndex}
 * - **BPM 线不在此判定**（issue 59）：BPM 绘制在音符层**之下**，且 56 定过「指针态单击 BPM 不选中 /
 *   BPM 不参与 hover」，故本函数跳过 BPM —— BPM 一律由 `findBpmLineAt` 按"整条线"在最后判定，
 *   自然得到"音符 / 滑条（含段）> BPM 线"的优先级。
 */
export function findItemAt(cx: number, cy: number, deps: HitTestDeps): SelectionItem | null {
  const c = makeCoords(deps.geometry, deps.viewport, deps.beatDisplay, deps.notes);
  const ns = deps.noteSize ?? 1;
  const slideNodeRadius = (SLIDE_ICON_SIZE * ns / 2) * deps.viewport.scale + 4 * deps.viewport.scale;
  const noteRadius = (NOTE_ICON_SIZE * ns / 2) * deps.viewport.scale + 4 * deps.viewport.scale;
  // 连接带区域与渲染同步 × noteSize（render.renderSlideBody 的带宽已含 ns）
  const halfLaneWidth = (LANE_WIDTH * deps.viewport.scale * ns) / 2;

  for (let i = 0; i < deps.notes.length; i++) {
    const note = deps.notes[i];

    if (note.type === "Slide" || note.type === "Long") {
      // Long ≡ Slide（同构），结点字段（含 hidden）取 ConnectionNote
      const connections = (note as SlideNote).connections;
      // 先检测是否命中结点（端点或中间结点）
      for (let ci = 0; ci < connections.length; ci++) {
        const conn = connections[ci];
        // issue 56 A6/C1：hidden 结点不可命中（不可选中、不可 hover、无描边反馈）
        if (conn.hidden) continue;
        const pos = c.virtualToCanvas(c.getNoteVirtualX(conn.lane), c.getNoteVirtualY(conn.beat, conn.subBeat || 0));
        const dx = pos.x - cx, dy = pos.y - cy;
        if (dx * dx + dy * dy <= slideNodeRadius * slideNodeRadius) {
          return { kind: 'slideNode', noteIndex: i, connIndex: ci };
        }
      }
      // 再检测是否命中连接带区域（平行四边形）
      for (let ci = 0; ci < connections.length - 1; ci++) {
        const c1 = connections[ci], c2 = connections[ci + 1];
        const p1 = c.virtualToCanvas(c.getNoteVirtualX(c1.lane), c.getNoteVirtualY(c1.beat, c1.subBeat || 0));
        const p2 = c.virtualToCanvas(c.getNoteVirtualX(c2.lane), c.getNoteVirtualY(c2.beat, c2.subBeat || 0));
        const quad = [
          [p1.x - halfLaneWidth, p1.y],
          [p1.x + halfLaneWidth, p1.y],
          [p2.x + halfLaneWidth, p2.y],
          [p2.x - halfLaneWidth, p2.y],
        ];
        if (pointInQuad(cx, cy, quad)) {
          return { kind: 'slideRegion', noteIndex: i, connIndex: ci };
        }
      }
    } else if (note.type === "Single" || note.type === "LDirectional" || note.type === "RDirectional") {
      // issue 62：方向键整组都可命中（框到哪儿都能点中/拖起），与 issue 56 A4 的
      // "选中描边 = 整组一个矩形"同口径；半径沿用单键口径（箭头挂件那几 px 不算命中区）。
      const lanes = note.type === 'Single'
        ? [note.lane]
        : directionalLanes(note.lane, note.type, note.length);
      const cy0 = c.getNoteVirtualY(note.beat, note.subBeat || 0);
      for (const lane of lanes) {
        const pos = c.virtualToCanvas(c.getNoteVirtualX(lane), cy0);
        const dx = pos.x - cx, dy = pos.y - cy;
        if (dx * dx + dy * dy <= noteRadius * noteRadius) {
          return { kind: 'note', noteIndex: i };
        }
      }
    }
    // BPM：不在此判定（见函数注释）——交由 findBpmLineAt 按整条线在最后判定
  }
  return null;
}

/**
 * BPM 线**整体**命中（issue 59）——BPM 唯一的命中入口。
 * BPM 视觉上是横跨轨道的一整条线，画在音符层**之下**；因此判定顺序恒为
 * **音符 / 方向键 / 滑条结点 / 滑条段 → 最后才是 BPM 线**（调用方先用 findItemAt，未命中再问这里）。
 * 用途：删除工具（删该线）、音符代码工具（打开其代码）、右键删除（56 定的三条通路之一）。
 * 不进 hover（56 Q14=A：BPM 不参与 hover 反馈），指针态单击也不选中（56 Q14）。
 */
export function findBpmLineAt(cx: number, cy: number, deps: HitTestDeps): SelectionItem | null {
  const c = makeCoords(deps.geometry, deps.viewport, deps.beatDisplay, deps.notes);
  const { trackBgX, trackBgWidth } = c.trackGeometry(deps.viewport.scale);
  if (cx < trackBgX || cx > trackBgX + trackBgWidth) return null;
  const tol = 6 * deps.viewport.scale;
  for (let i = 0; i < deps.notes.length; i++) {
    const note = deps.notes[i];
    if (note.type !== "BPM") continue;
    const y = c.virtualToCanvas(0, c.getNoteVirtualY(note.beat)).y;
    if (Math.abs(cy - y) <= tol) return { kind: 'note', noteIndex: i };
  }
  return null;
}

/** BPM 线是否被框"整条覆盖"（X 横跨轨道左缘→右缘 ∧ Y 含该线）—— 判据唯一实现（画布坐标） */
function bpmLineCoveredByBox(box: SelectionBox, deps: HitTestDeps): (note: ChartNote) => boolean {
  const c = makeCoords(deps.geometry, deps.viewport, deps.beatDisplay, deps.notes);
  const minX = Math.min(box.x1, box.x2);
  const maxX = Math.max(box.x1, box.x2);
  const minY = Math.min(box.y1, box.y2);
  const maxY = Math.max(box.y1, box.y2);
  const { trackBgX, trackBgWidth } = c.trackGeometry(deps.viewport.scale);
  return (note: ChartNote) => {
    if (note.type !== 'BPM') return false;
    const y = c.virtualToCanvas(0, c.getNoteVirtualY(note.beat)).y;
    return minX <= trackBgX && maxX >= trackBgX + trackBgWidth && minY <= y && maxY >= y;
  };
}

/**
 * 圈选中的 BPM 线 —— **仅供删除路径**（issue 71）。
 * BPM 线不可被"选中"（见 `computeItemsInBox`），但删除工具的框选是**批量执行**而非建选区，
 * 仍应能一次删掉被整条框住的 BPM 线（用户 2026-09-10 拍板 A）。
 */
export function computeBpmLinesInBox(box: SelectionBox, deps: HitTestDeps): SelectionItem[] {
  const covered = bpmLineCoveredByBox(box, deps);
  const out: SelectionItem[] = [];
  deps.notes.forEach((note, index) => {
    if (covered(note)) out.push({ kind: 'note', noteIndex: index });
  });
  return out;
}

/**
 * 圈选：按命中子部分选中框内音符（框到结点→结点；框到区域→区域）。
 * 普通音符框到任意虚拟点→note；滑条框到结点→slideNode、框到两端点→slideRegion。
 * **BPM 线不入选（issue 71）**：BPM 不是音符，选中它没有意义 —— 复制/剪切/批量替换/导出选中集合
 * 都不该带上它。它只对「删除工具（单击/框选）」与「右键删除」两条通路生效：
 * 前者经 `computeBpmLinesInBox` 单独收集（不进选区），后者经 `findBpmLineAt`。
 */
export function computeItemsInBox(box: SelectionBox, deps: HitTestDeps): SelectionItem[] {
  const c = makeCoords(deps.geometry, deps.viewport, deps.beatDisplay, deps.notes);
  const minX = Math.min(box.x1, box.x2);
  const maxX = Math.max(box.x1, box.x2);
  const minY = Math.min(box.y1, box.y2);
  const maxY = Math.max(box.y1, box.y2);
  const tl = c.canvasToVirtual(minX, minY);
  const br = c.canvasToVirtual(maxX, maxY);
  const vminX = Math.min(tl.x, br.x);
  const vmaxX = Math.max(tl.x, br.x);
  const vminY = Math.min(tl.y, br.y);
  const vmaxY = Math.max(tl.y, br.y);
  const result: SelectionItem[] = [];

  deps.notes.forEach((note, index) => {
    if (note.type === "Slide" || note.type === "Long") {
      const conns = (note as SlideNote).connections;
      conns.forEach((conn, ci) => {
        if (conn.hidden) return; // issue 56 A6：hidden 结点不入选区
        const x = c.getNoteVirtualX(conn.lane);
        const y = c.getNoteVirtualY(conn.beat, conn.subBeat || 0);
        if (x >= vminX && x <= vmaxX && y >= vminY && y <= vmaxY) {
          result.push({ kind: 'slideNode', noteIndex: index, connIndex: ci });
        }
      });
      for (let ci = 0; ci < conns.length - 1; ci++) {
        const c1 = conns[ci], c2 = conns[ci + 1];
        const p1 = { x: c.getNoteVirtualX(c1.lane), y: c.getNoteVirtualY(c1.beat, c1.subBeat || 0) };
        const p2 = { x: c.getNoteVirtualX(c2.lane), y: c.getNoteVirtualY(c2.beat, c2.subBeat || 0) };
        if (p1.x >= vminX && p1.x <= vmaxX && p1.y >= vminY && p1.y <= vmaxY &&
            p2.x >= vminX && p2.x <= vmaxX && p2.y >= vminY && p2.y <= vmaxY) {
          result.push({ kind: 'slideRegion', noteIndex: index, connIndex: ci });
        }
      }
    } else if (note.type === "BPM") {
      // issue 71：BPM 线**不入框选选区**（它不是音符，选中无意义）。
      // 需要它的只有删除路径 —— 走 `computeBpmLinesInBox`（判据同源：整条覆盖）。
      return;
    } else {
      const pts = deps.geometry.noteVirtualPoints(note, deps.viewport.scale, deps.beatDisplay);
      if (pts.some(p => p.x >= vminX && p.x <= vmaxX && p.y >= vminY && p.y <= vmaxY)) {
        result.push({ kind: 'note', noteIndex: index });
      }
    }
  });
  return result;
}
