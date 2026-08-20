// 命中测试纯函数（ADR-0003 候选 B）：把 FinalVirtualCanvas 内的 findItemAt / 圈选判定
// 抽出为可单测模块，依赖 geometry + viewport + notes，与 React 组件解耦。
import type { ChartNote, SelectionItem } from '../notes/Charts';
import type { ChartGeometry, GeometryViewport } from '../utils/ChartGeometry';
import { LANE_WIDTH } from '../utils/ChartGeometry';
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
 * - 普通音符/方向键/BPM → {kind:'note'}
 * - 滑条结点 → {kind:'slideNode', connIndex}
 * - 滑条连接带区域 → {kind:'slideRegion', connIndex}
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
      const connections = (note as ChartNote & { connections: { lane: number; beat: number; subBeat?: number }[] }).connections;
      // 先检测是否命中结点（端点或中间结点）
      for (let ci = 0; ci < connections.length; ci++) {
        const conn = connections[ci];
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
      const pos = c.virtualToCanvas(c.getNoteVirtualX(note.lane), c.getNoteVirtualY(note.beat, note.subBeat || 0));
      const dx = pos.x - cx, dy = pos.y - cy;
      if (dx * dx + dy * dy <= noteRadius * noteRadius) {
        return { kind: 'note', noteIndex: i };
      }
    } else if (note.type === "BPM") {
      const pos = c.virtualToCanvas(c.getNoteVirtualX(0), c.getNoteVirtualY(note.beat));
      const dx = pos.x - cx, dy = pos.y - cy;
      if (dx * dx + dy * dy <= noteRadius * noteRadius) {
        return { kind: 'note', noteIndex: i };
      }
    }
  }
  return null;
}

/**
 * 圈选：按命中子部分选中框内音符（框到结点→结点；框到区域→区域）。
 * 普通音符框到任意虚拟点→note；滑条框到结点→slideNode、框到两端点→slideRegion。
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
      const conns = (note as ChartNote & { connections: { lane: number; beat: number; subBeat?: number }[] }).connections;
      conns.forEach((conn, ci) => {
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
    } else {
      const pts = deps.geometry.noteVirtualPoints(note, deps.viewport.scale, deps.beatDisplay);
      if (pts.some(p => p.x >= vminX && p.x <= vmaxX && p.y >= vminY && p.y <= vmaxY)) {
        result.push({ kind: 'note', noteIndex: index });
      }
    }
  });
  return result;
}
