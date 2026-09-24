// 命中测试纯函数（ADR-0003 候选 B）：把 FinalVirtualCanvas 内的 findItemAt / 圈选判定
// 抽出为可单测模块，依赖 geometry + viewport + notes，与 React 组件解耦。
import type { ChartNote, SelectionItem, SlideNote } from '../chart/types';
import type { ChartGeometry, GeometryViewport } from '../chart/geometry/ChartGeometry';
import { LANE_WIDTH, directionalLanes } from '../chart/geometry/ChartGeometry';
import { projectedSlideSpans } from '../chart/editing/SlideSegments';
import { bandPolygonAt } from './slideBandGeometry';
import { makeCoords } from './coords';
import type { SelectionBox } from './types';

// 命中尺寸常量 —— **与渲染同源**（`./noteMetrics`，issue 82）：两侧共用一份，
// 不再各写一份硬编码副本（旧副本正是"命中盒比墨迹大一倍"的温床）。
import {
  NOTE_ICON_SIZE, SLIDE_ICON_SIZE,
  NOTE_HEIGHT_SCALE, SLIDE_HEIGHT_SCALE,
} from './noteMetrics';

/**
 * issue 82：命中盒 = **音符墨迹矩形 + 极小余量**，取代旧的「图标半宽(18) + 4」的**圆**判定。
 *
 * 旧口径半径恒为 22 设计 px，而音符墨迹是 36 × 21.6（纵向半高仅 10.8）——
 * **纵向判定范围是墨迹的 2 倍**，于是"离音符很远就亮起 hover"。
 *
 * 余量取 2 设计 px（随 `viewport.scale` 缩放）：保留一点手感，但不再明显超出墨迹。
 * 余量**不随 noteSize 收缩**是刻意的 —— noteSize 极小时（如 0.1）墨迹只有几 px，
 * 再按比例缩余量会点不中；固定 2px 保证一个最小可点击区。
 *
 * 注：选中描边矩形用的是皮肤**实测墨迹**（`render` 的 `cfg.out?.w/h`），与本常量可能差几 px，
 * 量级一致即可 —— 描边贴的是真实精灵，命中取的是设计尺寸。
 */
const HIT_PADDING = 2;

/** 键型音符 / 滑条结点的命中盒半宽半高（画布 px） */
function hitHalfSize(iconSize: number, heightScale: number, noteSize: number, scale: number) {
  const s = noteSize * scale;
  return {
    hw: (iconSize * s) / 2 + HIT_PADDING * scale,
    hh: (iconSize * heightScale * s) / 2 + HIT_PADDING * scale,
  };
}

/** 点是否落在以 (cx0, cy0) 为中心、半宽 hw / 半高 hh 的墨迹矩形内（含边界） */
function inHitBox(px: number, py: number, cx0: number, cy0: number, hw: number, hh: number): boolean {
  return Math.abs(px - cx0) <= hw && Math.abs(py - cy0) <= hh;
}

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
 * 图层优先级（issue 85 定案）：**键型音符 > 滑条结点 > 滑条段**。
 * Slide 整条（段 + 结点）在绘制上被压到键型音符之下（`ChartGeometry.visibleNotes` 的输出顺序），
 * 命中必须与绘制同序，否则"看着在上面的却点不到 / hover 亮的是被盖住的那个"。
 * Slide ↔ Slide 之间按**放置先后**：后放置者在上（= 数组下标更大），由倒序遍历自然得到。
 */
const RANK_KEY_NOTE = 2;   // 键型音符（单键/方向键）
const RANK_SLIDE_NODE = 1; // 滑条结点
const RANK_SLIDE_REGION = 0; // 滑条连接带（段）

function hitRank(item: SelectionItem): number {
  if (item.kind === 'note') return RANK_KEY_NOTE;
  if (item.kind === 'slideNode') return RANK_SLIDE_NODE;
  return RANK_SLIDE_REGION;
}

/**
 * **同级**候选的绘制序键（越大 = 画得越晚 = 越在上层），与 `ChartGeometry.visibleNotes` 的输出顺序同源：
 * - 键型音符：点音符按 **beat 升序**排列（`points.sort((a,b)=>a.beat-b.beat)`，beat 已含 subBeat 折算），
 *   同拍保持 notes 下标升序 → 序键 = 拍位。只比对"下标更大"是不够的（下标与拍位可以不同序）。
 * - 滑条 / 长条：`spans` 按下标顺序追加 → 序键 = 下标（= 放置先后）。
 *
 * 两级不会互相比较：rank 不同就不会走到这里。
 */
function drawOrderKey(notes: readonly ChartNote[], item: SelectionItem, beatDisplay: number): number {
  if (item.kind !== 'note') return item.noteIndex;
  const n = notes[item.noteIndex] as { beat?: number; subBeat?: number } | undefined;
  if (!n) return item.noteIndex;
  const beat = n.beat ?? 0;
  const subBeat = n.subBeat ?? 0;
  return beat + (subBeat > 0 ? subBeat / beatDisplay : 0);
}

/**
 * 命中测试：返回点击位置命中的选择条目（任意音符类型）。
 * - 普通音符/方向键 → {kind:'note'}
 * - 滑条结点 → {kind:'slideNode', connIndex}
 * - 滑条连接带区域 → {kind:'slideRegion', connIndex}
 * - **重叠时按图层择优**（issue 85）：键型音符 > 滑条结点 > 滑条段；同级取**后放置者**。
 * - **BPM 线不在此判定**（issue 59）：BPM 绘制在音符层**之下**，且 56 定过「指针态单击 BPM 不选中 /
 *   BPM 不参与 hover」，故本函数跳过 BPM —— BPM 一律由 `findBpmLineAt` 按"整条线"在最后判定，
 *   自然得到"音符 / 滑条（含段）> BPM 线"的优先级。
 */
export function findItemAt(cx: number, cy: number, deps: HitTestDeps): SelectionItem | null {
  const c = makeCoords(deps.geometry, deps.viewport, deps.beatDisplay, deps.notes);
  const ns = deps.noteSize ?? 1;
  // issue 82：命中盒 = 墨迹矩形 + 2px 余量（见 HIT_PADDING 注释），取代旧的圆形半径判定
  const slideNodeHit = hitHalfSize(SLIDE_ICON_SIZE, SLIDE_HEIGHT_SCALE, ns, deps.viewport.scale);
  const noteHit = hitHalfSize(NOTE_ICON_SIZE, NOTE_HEIGHT_SCALE, ns, deps.viewport.scale);
  // 连接带区域与渲染同步 × noteSize（render.renderSlideBody 的带宽已含 ns）
  const halfLaneWidth = (LANE_WIDTH * deps.viewport.scale * ns) / 2;

  /** 单个音符的命中结果（滑条内部仍是**结点优先于段**，issue 56/77 定案不变） */
  const hitOne = (i: number): SelectionItem | null => {
    const note = deps.notes[i];
    if (note.type === "BPM" || note.type === "System" || note.type === "Opaque") return null;

    if (note.type === "Slide" || note.type === "Long") {
      // Long ≡ Slide（同构），结点字段（含 hidden）取 ConnectionNote
      const connections = (note as SlideNote).connections;
      // 先检测是否命中结点（端点或中间结点）
      for (let ci = 0; ci < connections.length; ci++) {
        const conn = connections[ci];
        // issue 56 A6/C1：hidden 结点不可命中（不可选中、不可 hover、无描边反馈）
        if (conn.hidden || conn.beat < 0) continue;
        const pos = c.virtualToCanvas(c.getNoteVirtualX(conn.lane), c.getNoteVirtualY(conn.beat, conn.subBeat || 0));
        if (inHitBox(cx, cy, pos.x, pos.y, slideNodeHit.hw, slideNodeHit.hh)) {
          return { kind: 'slideNode', noteIndex: i, connIndex: ci };
        }
      }
      // 再检测是否命中连接带区域（平行四边形）。
      // issue 77 二轮：命中单位 = **逻辑段**（跨过 hidden 的整段）—— 段内任一子块命中，
      // 都返回该段起点下标（hidden 不切割段，hover/选中才不会被切成两半）。
      // 横截面口径 = `slideBandGeometry` 车道横向（与带体实绘、选中/hover 描边同源，issue 09 验收反馈六轮）。
      const proj = projectedSlideSpans(connections);
      for (const sp of proj.regions) {
        for (let ci = sp.start; ci < sp.end; ci++) {
          const c1 = proj.conns[ci]!, c2 = proj.conns[ci + 1]!;
          const p1 = c.virtualToCanvas(c.getNoteVirtualX(c1.lane), c.getNoteVirtualY(c1.beat, c1.subBeat || 0));
          const p2 = c.virtualToCanvas(c.getNoteVirtualX(c2.lane), c.getNoteVirtualY(c2.beat, c2.subBeat || 0));
          if (pointInQuad(cx, cy, bandPolygonAt([p1, p2], halfLaneWidth))) {
            return { kind: 'slideRegion', noteIndex: i, connIndex: sp.connIndex };
          }
        }
      }
    } else if (note.type === "Single" || note.type === "LDirectional" || note.type === "RDirectional") {
      if (note.beat < 0) return null;
      // issue 62：方向键整组都可命中（框到哪儿都能点中/拖起），与 issue 56 A4 的
      // "选中描边 = 整组一个矩形"同口径；半径沿用单键口径（箭头挂件那几 px 不算命中区）。
      const lanes = note.type === 'Single'
        ? [note.lane]
        : directionalLanes(note.lane, note.type, note.length);
      const cy0 = c.getNoteVirtualY(note.beat, note.subBeat || 0);
      for (const lane of lanes) {
        const pos = c.virtualToCanvas(c.getNoteVirtualX(lane), cy0);
        if (inHitBox(cx, cy, pos.x, pos.y, noteHit.hw, noteHit.hh)) {
          return { kind: 'note', noteIndex: i };
        }
      }
    }
    // BPM：不在此判定（见函数注释）——交由 findBpmLineAt 按整条线在最后判定
    return null;
  };

  // issue 85：**倒序**遍历 + 取图层更高者。同级取先遇到的那个（= 下标更大 = 放置更晚 = 画在上层），
  // 与 `visibleNotes` 的绘制顺序严格一致（旧实现是"正序首个命中即返回"，与绘制顺序相反）。
  let best: SelectionItem | null = null;
  let bestRank = -1;
  let bestKey = -Infinity;
  for (let i = deps.notes.length - 1; i >= 0; i--) {
    const hit = hitOne(i);
    if (!hit) continue;
    const rank = hitRank(hit);
    if (rank > bestRank) {
      best = hit;
      bestRank = rank;
      bestKey = drawOrderKey(deps.notes, hit, deps.beatDisplay);
      continue;
    }
    if (rank < bestRank) continue;
    // 同级：取绘制序更靠上者。倒序遍历下"先遇到的下标更大"，故只有序键**严格更大**才替换，
    // 序键相等时保留先遇到的（= 后放置者，与绘制顺序一致）。
    const key = drawOrderKey(deps.notes, hit, deps.beatDisplay);
    if (key > bestKey) {
      best = hit;
      bestKey = key;
    }
  }
  return best;
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
      // issue 77 二轮：段按**逻辑段**入框（跨过 hidden 的整段 = 段内全部结点含 hidden 都要在框内）
      // issue 106：取点走**显示投影**、段身份仍用**原下标**（与 findItemAt / 选中描边同源，
      // 否则非单调滑条上"框到的段"与"点中的段"不是同一个 SelectionItem）
      const proj = projectedSlideSpans(conns);
      for (const sp of proj.regions) {
        let allIn = true;
        for (let ci = sp.start; ci <= sp.end; ci++) {
          const cc = proj.conns[ci]!;
          const x = c.getNoteVirtualX(cc.lane);
          const y = c.getNoteVirtualY(cc.beat, cc.subBeat || 0);
          if (!(x >= vminX && x <= vmaxX && y >= vminY && y <= vmaxY)) { allIn = false; break; }
        }
        if (allIn) result.push({ kind: 'slideRegion', noteIndex: index, connIndex: sp.connIndex });
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
