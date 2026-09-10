// ADR-0008 §6：指针态拖拽移动已放置音符（纯模块，可单测）。
// 语义：吸附落点 = beat 栅格 × lane 整格（换算在画布侧完成）；整体位移 = 单一 delta；
// 非法落点（越界/不可裁决的碰撞/不支持）→ ok=false，画布据此隐藏幽灵并回弹。
// 落点碰撞不一律回弹，按 ADR-0001 既有规则裁决（§6 四轮修订）：滑条端点↔滑条端点 = §3 接合；
// 键音符↔键音符 = §1.1 替换；滑条端点→键音符 = 覆盖删除（removeOverlappedNotes 同语义）。
// 无就地变异：受影响音符构造新对象，其余复用原引用（ADR-0001 §4 结构共享）。
import type { ChartNote, SelectionItem, SlideNote, LongNote } from '../types';
import { quantizeBeat } from '../geometry/ChartGeometry';
import { mergeChainWithSlides } from './SlideCombination';

/**
 * 拖拽的拍位移（issue 61）：**量化对象 = 被拖对象的落点**，不是光标。
 *
 * 旧实现在画布侧算 `dBeat = snap(cursor_now) − snap(cursor_press)` 再把这个"光标吸附拍位差"
 * 加到音符自己的拍位上。音符落在非当前网格（1/8 吸附放的，之后切到 1/4）时，
 * `snap(按下点) − 音符真实拍位` 这个相位偏移被永久带进落点 → 每次位移确实是 1/4 的整数倍，
 * 但只能在 1/8 的相位线上走，永远踩不到当前网格线。
 *
 * 新算法：先把抓取偏移（按下时光标相对对象中心的偏移，保住"按住哪儿拖哪儿"的手感）从当前
 * 光标拍位里减掉，再量化到当前网格 → 落点恒在网格上；对象已在网格上时结果与旧算法完全一致。
 *
 * @param anchorBeat 被按住那件对象的**真实**拍位（`beat + subBeat/beatDisplay`）
 * @param rawPressBeat 按下时光标的**未量化**拍位
 * @param rawCurBeat 当前光标的**未量化**拍位
 */
export function dragDeltaBeat(input: {
  anchorBeat: number;
  rawPressBeat: number;
  rawCurBeat: number;
  beatDisplay: number;
}): number {
  const grab = input.rawPressBeat - input.anchorBeat;
  const target = quantizeBeat(input.rawCurBeat - grab, input.beatDisplay);
  return target - input.anchorBeat;
}

/**
 * 该对象在虚拟时间轴上的**真实拍位**（含 subBeat 折算，口径与 `ChartGeometry.noteVirtualY` 一致）。
 * 拖拽锚点用它：按住哪件对象，就以哪件对象的拍位为量化基准（issue 61）。
 * BPM/System 不可拖 → null。
 */
export function itemTrueBeat(notes: readonly ChartNote[], item: SelectionItem, beatDisplay: number): number | null {
  const n = notes[item.noteIndex];
  if (!n) return null;
  const bd = beatDisplay > 0 ? beatDisplay : 1;
  if (item.kind === 'slideNode') {
    if (n.type !== 'Slide' && n.type !== 'Long') return null;
    const conn = (n as SlideNote).connections[item.connIndex];
    return conn ? conn.beat + (conn.subBeat && conn.subBeat > 0 ? conn.subBeat / bd : 0) : null;
  }
  if (item.kind === 'slideRegion') return null;
  if (n.type === 'Single' || n.type === 'LDirectional' || n.type === 'RDirectional') {
    return n.beat + (n.subBeat && n.subBeat > 0 ? n.subBeat / bd : 0);
  }
  if (n.type === 'Slide' || n.type === 'Long') {
    const first = (n as SlideNote).connections[0];
    return first ? first.beat + (first.subBeat && first.subBeat > 0 ? first.subBeat / bd : 0) : null;
  }
  return null; // BPM / System
}

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
/**
 * 真实拍位：subBeat 的单位是 **1/beatDisplay**（与 ChartGeometry.noteVirtualY、
 * hitTest 索引同口径），不能当作拍的小数部分直接相加。
 */
const sumBeat = (beat: number, subBeat: number, beatDisplay: number) =>
  beat + (subBeat > 0 ? subBeat / beatDisplay : 0);

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
  /** chartEndBeat = 谱面末端；beatDisplay = 子拍细分（subBeat 的单位分母，用于真实拍位换算） */
  bounds: { chartEndBeat: number; beatDisplay: number },
): DragMoveResult {
  const noChange: DragMoveResult = { ok: false, notes, items: [], reason: 'unsupported' };
  const fail = (reason: 'out-of-bounds' | 'collision' | 'unsupported'): DragMoveResult =>
    ({ ok: false, notes, items: [], reason });
  if (delta.dBeat === 0 && delta.dLane === 0) return { ok: true, notes, items };
  const beatDisplay = bounds.beatDisplay > 0 ? bounds.beatDisplay : 1;

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
  const inBeat = (beat: number, sub: number) => {
    const b = sumBeat(beat, sub, beatDisplay);
    return b >= -EPS && b <= bounds.chartEndBeat + EPS;
  };

  // ① 位移后的音符 + 越界 / 邻居序校验（无就地变异）
  // 顺带累积**落点窗口**（② 占位表的裁剪依据，见下方 ② 的正确性说明）：
  // 只在既有类型分支里加一行标记，不为此再开一遍全谱循环。
  let winLo = Infinity, winHi = -Infinity;
  const markWindow = (beat: number, sub: number) => {
    const b = sumBeat(beat, sub, beatDisplay);
    if (b < winLo) winLo = b;
    if (b > winHi) winHi = b;
  };
  const moved = new Map<number, ChartNote>();
  for (const [i, plan] of plans) {
    const n = notes[i];
    if (isKey(n)) {
      const beat = n.beat + delta.dBeat;
      const lane = n.lane + delta.dLane;
      markWindow(beat, n.subBeat || 0);
      // issue 66 §4b：方向键是整组，但**只有根轨必须留在 0..6 内**——组尾溢出视觉合法
      // （放置链路口径已经允许在 lane 6 放 length=3 的右方向键让组尾溢出右侧）；
      // 拖拽落点保留同一口径：根轨在界内即合法，组尾越界照实落点、不回弹。
      // 单键还是只占一根 = `lanes = [lane]`，越界即非法。
      if (!inLane(lane) || !inBeat(beat, n.subBeat || 0)) return fail('out-of-bounds');
      moved.set(i, { ...n, beat, lane });
    } else if (isSlideish(n)) {
      const conns = n.connections.map((c, ci) =>
        plan.kind === 'whole' || plan.conns.has(ci)
          ? { ...c, beat: c.beat + delta.dBeat, lane: c.lane + delta.dLane }
          : { ...c });
      // 取**全部**结点（比"仅受动结点"宽）→ 窗口仍是落点键的超集，安全
      for (const c of conns) markWindow(c.beat, c.subBeat || 0);
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
          if (prev && sumBeat(c.beat, c.subBeat || 0, beatDisplay) <= sumBeat(prev.beat, prev.subBeat || 0, beatDisplay) + EPS) return fail('out-of-bounds');
          if (next && sumBeat(c.beat, c.subBeat || 0, beatDisplay) >= sumBeat(next.beat, next.subBeat || 0, beatDisplay) - EPS) return fail('out-of-bounds');
        }
      }
      moved.set(i, { ...n, connections: conns });
    }
  }

  // ② 未动对象占位表（被拖走的位置让出；部分拖动的滑条，其未动结点仍占位）
  //
  // issue 70 候选 2（实测）：原实现为**全谱**每个对象建一个 posKey 字符串 + Map.set
  // （5000 音符 ≈ 1.25ms/次），而查询只发生在拖拽件的落点上（≤ 几十次键比较）。
  // 本函数被**每次 mousemove** 调用算拖拽幽灵，故这是「单次交互响应成本」的最大项。
  //
  // 优化：先按**落点窗口**做一次纯数值预筛，只为窗口内的对象建表。
  // 正确性：占位键 = `beat|subBeat|lane` **精确相等**才可能命中，故真实拍位落在窗口外的
  // 对象不可能与任何落点键相等 —— 跳过它们是保守超集裁剪，不漏不误判（EPS 只放宽不收紧）。
  const occ = new Map<string, { orig: number; isKey: boolean; endpoint: boolean }>();
  const inWindow = (beat: number, sub: number) => {
    const b = sumBeat(beat, sub, beatDisplay);
    return b >= winLo - EPS && b <= winHi + EPS;
  };
  notes.forEach((n, i) => {
    const plan = plans.get(i);
    if (isKey(n)) {
      if (plan) return; // 原位置让出
      if (!inWindow(n.beat, n.subBeat || 0)) return;
      occ.set(posKey(n.beat, n.subBeat || 0, n.lane), { orig: i, isKey: true, endpoint: false });
    } else if (isSlideish(n)) {
      const last = n.connections.length - 1;
      // 整条都不在窗口内 → 一个键都不必建（先纯数值扫一遍，避免逐结点建键）
      let anyInWindow = false;
      for (const c of n.connections) {
        if (inWindow(c.beat, c.subBeat || 0)) { anyInWindow = true; break; }
      }
      if (!anyInWindow) return;
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
export function draggableFromItems(notes: readonly ChartNote[], items: readonly SelectionItem[]): SelectionItem[] {
  return items.filter(it => {
    const n = notes[it.noteIndex];
    if (!n) return false;
    if (it.kind === 'note') return isKey(n) || isSlideish(n);
    if (it.kind === 'slideNode') return isSlideish(n);
    return false; // slideRegion 不可拖
  });
}
