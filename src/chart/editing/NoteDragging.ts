// ADR-0008 §6：指针态拖拽移动已放置音符（纯模块，可单测）。
// 语义：吸附落点 = beat 栅格 × lane 整格（换算在画布侧完成）；整体位移 = 单一 delta；
// 非法落点（越界/不可裁决的碰撞/不支持）→ ok=false，画布据此隐藏幽灵并回弹。
// 落点碰撞不一律回弹，按 ADR-0001 既有规则裁决（§6 四轮修订）：滑条端点↔滑条端点 = §3 接合；
// 键音符↔键音符 = §1.1 替换；滑条端点→键音符 = 覆盖删除（removeOverlappedNotes 同语义）。
// 无就地变异：受影响音符构造新对象，其余复用原引用（ADR-0001 §4 结构共享）。
import type { ChartNote, SelectionItem, SlideNote, LongNote } from '../types';
import { mergeChainWithSlides } from './SlideCombination';

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
  /** ok=true 时拖拽集合在新数组中的等价条目（下标可能因覆盖/接合而变，已重映射） */
  items: SelectionItem[];
  /** 幽灵预览要绘制的音符（下标已随覆盖/接合变动，不能由新旧数组逐位比对得出） */
  ghost?: ChartNote[];
  reason?: 'out-of-bounds' | 'collision' | 'unsupported';
}

const isKey = (n: ChartNote) => n.type === 'Single' || n.type === 'LDirectional' || n.type === 'RDirectional';
const isSlideish = (n: ChartNote): n is SlideNote | LongNote => n.type === 'Slide' || n.type === 'Long';

const TOTAL_LANES = 7; // 与 NoteEditing.TOTAL_LANES 一致（此处内联避免引动历史模块）
const EPS = 1e-6;

const posKey = (beat: number, subBeat: number, lane: number) => `${beat}|${subBeat}|${lane}`;
const sumBeat = (beat: number, subBeat: number) => beat + subBeat;

/** 工作数组元素：note + 其在入参 notes 中的原下标（覆盖/接合会增删元素，靠它重映射选区） */
interface Tagged { note: ChartNote; orig: number }

/**
 * 拖拽落点判定 + 构造（纯函数）。
 * items = 画布侧过滤后的拖拽集合（可能含 kind:'note' 键型/整条滑条 与 kind:'slideNode'）。
 * 同一条滑条既有整条条目又有子结点条目 → 按整条处置（子结点条目忽略）。
 * 同一滑条多个子结点被分别拖动 → 各自位移后用最终邻居位置互校（防退化交叉）。
 * 落点碰撞裁决表（§6 四轮修订，规则全部复用 ADR-0001 既有实现）：
 * | 拖拽件 \ 落点既有 | 键音符            | 滑条端点         | 滑条中间结点 |
 * | 键音符            | §1.1 替换(目标消耗)| 回弹             | 回弹         |
 * | 滑条端点          | 覆盖删除(§6.3)     | §3 接合(异条)    | 回弹         |
 * | 滑条中间结点      | 回弹               | 回弹             | 回弹         |
 * 拖拽件之间互撞（含同一位置被两件认领）→ 回弹（组内不自覆盖、不互接合）。
 */
export function planDragMove(
  notes: ChartNote[],
  items: SelectionItem[],
  delta: DragDelta,
  bounds: { chartEndBeat: number },
): DragMoveResult {
  const noChange: DragMoveResult = { ok: false, notes, items: [], reason: 'unsupported' };
  const fail = (reason: 'out-of-bounds' | 'collision' | 'unsupported'): DragMoveResult =>
    ({ ok: false, notes, items: [], reason });
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

  const inLane = (lane: number) => lane >= 0 && lane < TOTAL_LANES;
  const inBeat = (beat: number, sub: number) =>
    sumBeat(beat, sub) >= -EPS && sumBeat(beat, sub) <= bounds.chartEndBeat + EPS;

  // ① 位移后的音符 + 越界 / 邻居序校验（无就地变异）
  const moved = new Map<number, ChartNote>();
  for (const [i, plan] of plans) {
    const n = notes[i];
    if (isKey(n)) {
      const beat = n.beat + delta.dBeat;
      const lane = n.lane + delta.dLane;
      if (!inLane(lane) || !inBeat(beat, n.subBeat || 0)) return fail('out-of-bounds');
      moved.set(i, { ...n, beat, lane });
    } else if (isSlideish(n)) {
      const conns = n.connections.map((c, ci) =>
        plan.kind === 'whole' || plan.conns.has(ci)
          ? { ...c, beat: c.beat + delta.dBeat, lane: c.lane + delta.dLane }
          : { ...c });
      const touched = plan.kind === 'whole' ? conns.map((_, ci) => ci) : [...plan.conns];
      for (const ci of touched) {
        const c = conns[ci];
        if (!inLane(c.lane) || !inBeat(c.beat, c.subBeat || 0)) return fail('out-of-bounds');
      }
      if (plan.kind !== 'whole') {
        for (const ci of plan.conns) {
          const c = conns[ci];
          const prev = conns[ci - 1];
          const next = conns[ci + 1];
          // 结点必须严格保持在前后邻居之间（防交叉/退化段；端点只有单侧约束）
          if (prev && sumBeat(c.beat, c.subBeat || 0) <= sumBeat(prev.beat, prev.subBeat || 0) + EPS) return fail('out-of-bounds');
          if (next && sumBeat(c.beat, c.subBeat || 0) >= sumBeat(next.beat, next.subBeat || 0) - EPS) return fail('out-of-bounds');
        }
      }
      moved.set(i, { ...n, connections: conns });
    }
  }

  // ② 未动对象占位表（被拖走的位置让出；部分拖动的滑条，其未动结点仍占位）
  const occ = new Map<string, { orig: number; isKey: boolean; endpoint: boolean }>();
  notes.forEach((n, i) => {
    const plan = plans.get(i);
    if (isKey(n)) {
      if (plan) return; // 原位置让出
      occ.set(posKey(n.beat, n.subBeat || 0, n.lane), { orig: i, isKey: true, endpoint: false });
    } else if (isSlideish(n)) {
      const last = n.connections.length - 1;
      n.connections.forEach((c, ci) => {
        if (plan && (plan.kind === 'whole' || plan.conns.has(ci))) return;
        occ.set(posKey(c.beat, c.subBeat || 0, c.lane), { orig: i, isKey: false, endpoint: ci === 0 || ci === last });
      });
    }
  });

  // ③ 落点裁决：可覆盖/可接合 → 记录；不可裁决 → 回弹
  const claimed = new Set<string>();   // 拖拽件认领的落点（互撞 = 回弹，组内不自覆盖）
  const covered = new Set<number>();   // 被覆盖消耗的音符（notes 原下标）
  const joins: number[] = [];          // 需要走 §3 接合的拖拽滑条（notes 原下标）
  const joinedBy = new Set<number>();  // 已被认领的接合目标（防两件抢同一条）
  for (const [i, plan] of plans) {
    const nn = moved.get(i)!;
    if (isKey(nn)) {
      const k = posKey(nn.beat, nn.subBeat || 0, nn.lane);
      if (claimed.has(k)) return fail('collision');
      claimed.add(k);
      const t = occ.get(k);
      if (!t) continue;
      if (t.isKey) { covered.add(t.orig); continue; } // §1.1 替换：目标被拖拽件取代
      return fail('collision');                        // 键 → 滑条结点：§1.2 属放置语义，移动不适用
    }
    const conns = (nn as SlideNote).connections;
    const last = conns.length - 1;
    const touched = plan.kind === 'whole' ? conns.map((_, ci) => ci) : [...plan.conns];
    for (const ci of touched) {
      const c = conns[ci];
      const k = posKey(c.beat, c.subBeat || 0, c.lane);
      if (claimed.has(k)) return fail('collision');
      claimed.add(k);
      const t = occ.get(k);
      if (!t) continue;
      if (t.isKey) {
        if (ci !== 0 && ci !== last) return fail('collision'); // 仅端点覆盖键音符（§6.3 同语义）
        covered.add(t.orig);
        continue;
      }
      if (t.endpoint && (ci === 0 || ci === last) && t.orig !== i && !joinedBy.has(t.orig)) {
        joinedBy.add(t.orig);
        joins.push(i);
        continue;
      }
      return fail('collision');
    }
  }

  // ④ 应用：覆盖消耗 → 端点接合（级联）→ 重映射选区 / 幽灵
  let work: Tagged[] = notes.map((n, i) => ({ note: moved.get(i) || n, orig: i }));
  if (covered.size > 0) work = work.filter(w => !covered.has(w.orig));
  for (const orig of joins) {
    const pos = work.findIndex(w => w.orig === orig);
    if (pos < 0) continue;
    const dragType = work[pos].note.type;
    const chain = (work[pos].note as SlideNote).connections.map(c => ({ ...c }));
    // 排除自身：链端点与自身端点天然相等，不排除会自合并
    const merged = mergeChainWithSlides(work.map(w => w.note), chain, [pos]);
    if (merged.consumed.length === 0) continue;
    const type: 'Slide' | 'Long' = merged.type === 'Long' || dragType === 'Long' ? 'Long' : 'Slide';
    const consumedSet = new Set(merged.consumed);
    const out: Tagged[] = [];
    work.forEach((w, k) => {
      // 合并结果写回被拖滑条所在位置；其余被消耗滑条移除
      if (k === pos) {
        out.push({ note: { type, connections: merged.connections } as ChartNote, orig });
        return;
      }
      if (consumedSet.has(k)) return;
      out.push(w);
    });
    work = out;
  }

  const newNotes = work.map(w => w.note);
  const idxOf = new Map<number, number>();
  work.forEach((w, k) => idxOf.set(w.orig, k));
  const newItems = dragItems.map(it =>
    ({ ...it, noteIndex: idxOf.get(it.noteIndex) ?? it.noteIndex }) as SelectionItem);
  const ghost = [...new Set(newItems.map(it => it.noteIndex))].map(k => newNotes[k]);
  return { ok: true, notes: newNotes, items: newItems, ghost };
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
