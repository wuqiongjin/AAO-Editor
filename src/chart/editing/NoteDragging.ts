// ADR-0008 §6：指针态拖拽移动已放置音符（纯模块，可单测）。
// 语义：吸附落点 = beat 栅格 × lane 整格（换算在画布侧完成）；整体位移 = 单一 delta；
// 非法落点（越界/碰撞/不支持）→ ok=false，画布据此隐藏幽灵并回弹。
// 无就地变异：受影响音符构造新对象，其余复用原引用（ADR-0001 §4 结构共享，数组下标不变 →
// 选择条目下标直接有效）。
import type { ChartNote, SelectionItem, SlideNote, LongNote } from '../types';

export interface DragDelta {
  /** 拍位移（已是栅格整数倍） */
  dBeat: number;
  /** 轨道位移（整数） */
  dLane: number;
}

export interface DragMoveResult {
  ok: boolean;
  /** ok=true 时的新谱面；ok=false 时为原数组引用 */
  notes: ChartNote[];
  /** ok=true 时拖拽集合在新数组中的等价条目（下标不变，结构共享保证） */
  items: SelectionItem[];
  reason?: 'out-of-bounds' | 'collision' | 'unsupported';
}

const isKey = (n: ChartNote) => n.type === 'Single' || n.type === 'LDirectional' || n.type === 'RDirectional';
const isSlideish = (n: ChartNote): n is SlideNote | LongNote => n.type === 'Slide' || n.type === 'Long';

const TOTAL_LANES = 7; // 与 NoteEditing.TOTAL_LANES 一致（此处内联避免引动历史模块）
const EPS = 1e-6;

const posKey = (beat: number, subBeat: number, lane: number) => `${beat}|${subBeat}|${lane}`;
const sumBeat = (beat: number, subBeat: number) => beat + subBeat;

/**
 * 拖拽落点判定 + 构造（纯函数）。
 * items = 画布侧过滤后的拖拽集合（可能含 kind:'note' 键型/整条滑条 与 kind:'slideNode'）。
 * 同一条滑条既有整条条目又有子结点条目 → 按整条处置（子结点条目忽略）。
 * 同一滑条多个子结点被分别拖动 → 各自位移后用最终邻居位置互校（防退化交叉）。
 */
export function planDragMove(
  notes: ChartNote[],
  items: SelectionItem[],
  delta: DragDelta,
  bounds: { chartEndBeat: number },
): DragMoveResult {
  const noChange: DragMoveResult = { ok: false, notes, items: [], reason: 'unsupported' };
  if (delta.dBeat === 0 && delta.dLane === 0) return { ok: true, notes, items };

  // 归组：noteIndex → 拖拽方式（whole=整条移动；nodes=指定 conn 下标集合）
  type Plan = { kind: 'whole' } | { kind: 'nodes'; conns: Set<number> };
  const plans = new Map<number, Plan>();
  let hasDraggable = false;
  for (const it of items) {
    const n = notes[it.noteIndex];
    if (!n) continue;
    if (it.kind === 'slideRegion') continue; // 区域不可单独拖（画布侧已过滤，防御）
    if (it.kind === 'note') {
      if (!isKey(n) && !isSlideish(n)) continue; // BPM/System 不支持
      plans.set(it.noteIndex, { kind: 'whole' });
      hasDraggable = true;
    } else {
      // slideNode
      if (!isSlideish(n)) continue;
      const existing = plans.get(it.noteIndex);
      if (existing?.kind === 'whole') continue; // 整条优先
      if (!existing) plans.set(it.noteIndex, { kind: 'nodes', conns: new Set([it.connIndex]) });
      else existing.conns.add(it.connIndex);
      hasDraggable = true;
    }
  }
  if (!hasDraggable) return noChange;

  const dragItems = items.filter(it => plans.has(it.noteIndex));

  // 占用表：所有键型音符与滑条结点的"未动"最终位置
  const occupied = new Set<string>();
  const movingOld = new Set<string>(); // 拖拽元素的原位置（碰撞豁免）
  notes.forEach((n, i) => {
    const plan = plans.get(i);
    if (!plan) {
      if (isKey(n)) occupied.add(posKey(n.beat, n.subBeat || 0, n.lane));
      else if (isSlideish(n)) n.connections.forEach(c => occupied.add(posKey(c.beat, c.subBeat || 0, c.lane)));
      return;
    }
    if (isKey(n)) movingOld.add(posKey(n.beat, n.subBeat || 0, n.lane));
    else if (isSlideish(n)) {
      n.connections.forEach((c, ci) => {
        const k = posKey(c.beat, c.subBeat || 0, c.lane);
        if (plan.kind === 'whole') movingOld.add(k);
        else if (plan.conns.has(ci)) movingOld.add(k);
        else occupied.add(k);
      });
    }
  });

  const inLane = (lane: number) => lane >= 0 && lane < TOTAL_LANES;
  const inBeat = (beat: number, sub: number) =>
    sumBeat(beat, sub) >= -EPS && sumBeat(beat, sub) <= bounds.chartEndBeat + EPS;

  const newNotes = [...notes];
  // 逐条构造；位置冲突即刻失败（回退原数组）
  let failed: 'out-of-bounds' | 'collision' | 'unsupported' | undefined;
  const addMoved = (beat: number, sub: number, lane: number): boolean => {
    const k = posKey(beat, sub, lane);
    if (occupied.has(k)) return false; // 撞上未动元素
    occupied.add(k);
    return true;
  };

  for (const [i, plan] of plans) {
    const n = notes[i];
    if (isKey(n)) {
      const beat = n.beat + delta.dBeat;
      const lane = n.lane + delta.dLane;
      if (!inLane(lane) || !inBeat(beat, n.subBeat || 0)) { failed = 'out-of-bounds'; break; }
      if (!addMoved(beat, n.subBeat || 0, lane)) { failed = 'collision'; break; }
      newNotes[i] = { ...n, beat, lane };
    } else if (isSlideish(n)) {
      if (plan.kind === 'whole') {
        const conns = n.connections.map(c => ({ ...c, beat: c.beat + delta.dBeat, lane: c.lane + delta.dLane }));
        if (conns.some(c => !inLane(c.lane) || !inBeat(c.beat, c.subBeat || 0))) { failed = 'out-of-bounds'; break; }
        let ok = true;
        for (const c of conns) if (!addMoved(c.beat, c.subBeat || 0, c.lane)) { ok = false; break; }
        if (!ok) { failed = 'collision'; break; }
        newNotes[i] = { ...n, connections: conns };
      } else {
        // 单/多结点位移：先算最终位置（未动邻居保持原位），再互校顺序 + 边界 + 碰撞
        const conns = n.connections.map((c, ci) =>
          plan.conns.has(ci) ? { ...c, beat: c.beat + delta.dBeat, lane: c.lane + delta.dLane } : { ...c });
        let bad = false;
        for (const ci of plan.conns) {
          const c = conns[ci];
          if (!inLane(c.lane) || !inBeat(c.beat, c.subBeat || 0)) { bad = true; break; }
          const prev = conns[ci - 1];
          const next = conns[ci + 1];
          // 结点必须严格保持在前后邻居之间（防交叉/退化段；端点只有单侧约束）
          if (prev && sumBeat(c.beat, c.subBeat || 0) <= sumBeat(prev.beat, prev.subBeat || 0) + EPS) { bad = true; break; }
          if (next && sumBeat(c.beat, c.subBeat || 0) >= sumBeat(next.beat, next.subBeat || 0) - EPS) { bad = true; break; }
        }
        if (bad) { failed = 'out-of-bounds'; break; } // 越界含"越过邻居"
        let ok = true;
        for (const ci of plan.conns) {
          const c = conns[ci];
          if (!addMoved(c.beat, c.subBeat || 0, c.lane)) { ok = false; break; }
        }
        if (!ok) { failed = 'collision'; break; }
        newNotes[i] = { ...n, connections: conns };
      }
    }
  }
  if (failed) return { ok: false, notes, items: [], reason: failed };
  return { ok: true, notes: newNotes, items: dragItems };
}

/**
 * 拖拽集合是否可作为拖拽起点（画布按下时判定，避免无意义拖拽）：
 * 过滤后存在可拖条目 = true。
 */
export function draggableFromItems(notes: ChartNote[], items: SelectionItem[]): SelectionItem[] {
  return items.filter(it => {
    const n = notes[it.noteIndex];
    if (!n) return false;
    if (it.kind === 'note') return isKey(n) || isSlideish(n);
    if (it.kind === 'slideNode') return isSlideish(n);
    return false; // slideRegion 不可拖
  });
}
