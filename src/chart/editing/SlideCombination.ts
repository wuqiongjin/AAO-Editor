// ADR-0008 §4：Slide 框选组合（纯模块）。
// 与两击直放并存：Slide 工具态框选（或"已有选区 + Ctrl+E"）把框内音符与滑条结点吸入成一条滑条。
// 组合与 ADR-0001 §1.2 覆盖/替换规则无关——框内任何键型一律吸入；滑条按结点级吸入，宿主未覆盖段拆条保留（§4 三轮修订）。
// 排序 = beat+subBeat 升序、同拍按 lane 升序；同拍横向段在此路径合法（zigzag 样例即由此重现）。
// 形态归一表（connectionFromAbsorbedNote）与排序规则由单测逐行锁表（tests/unit/SlideCombination.test.ts），
// 未来变动走 ADR-0008 流程后改本表。
import type {
  ChartNote, SelectionItem, SlideNote, ConnectionNote,
  SingleNote, LDirectionalNote, RDirectionalNote,
} from '../types';

/** 可被吸入组合的音符（"键型"音符）：单键（含 flick/skill 标记）与方向键 */
export type AbsorbableNote = SingleNote | LDirectionalNote | RDirectionalNote;

export const isAbsorbable = (n: ChartNote | undefined): n is AbsorbableNote =>
  !!n && (n.type === 'Single' || n.type === 'LDirectional' || n.type === 'RDirectional');

export type NodeRole = 'start' | 'middle' | 'end';

/** 排序规则（ADR-0008 §4）：beat+subBeat 升序，同拍按 lane 升序 */
export const sortAbsorbable = <T extends { beat: number; subBeat?: number; lane: number }>(
  arr: readonly T[],
): T[] =>
  [...arr].sort((a, b) =>
    (a.beat - b.beat) || ((a.subBeat || 0) - (b.subBeat || 0)) || (a.lane - b.lane));

/**
 * 形态归一表（ADR-0008 §4，逐行锁单测）：被吸音符 × 结点位置 → 滑条连接结点。
 *
 * | 被吸音符   | 起始端点           | 中间结点       | 末尾端点 |
 * | 单键       | 普通端点           | 中间结点       | 普通端点 |
 * | 滑键flick  | 降为普通端点(剥标) | 统一化(剥标)   | 保留flick |
 * | 技能键skill| 保留skill          | 统一化(剥标)   | 保留skill |
 * | 方向键     | 普通端点           | 统一化         | 普通端点 |
 *
 * 方向键的 length 不随吸入保留；flick+skill 并存时按行叠加（起点留 skill、剥 flick）。
 */
export function connectionFromAbsorbedNote(note: AbsorbableNote, role: NodeRole): ConnectionNote {
  return connFromPoint(
    {
      beat: note.beat, lane: note.lane, subBeat: note.subBeat || 0,
      flick: note.type === 'Single' && !!note.flick,
      skill: note.type === 'Single' && !!note.skill,
    },
    role,
  );
}

/** 链结点位置点（键音符与滑条连接点的公共投影）；归一表按 role 施加 */
interface ChainPoint {
  beat: number; lane: number; subBeat: number;
  flick: boolean; skill: boolean;
  /** 仅当来源是滑条既有连接点时携带（保持原 hidden 语义）；重合合并后 = false（可见接合点） */
  hidden?: boolean;
}

function connFromPoint(p: ChainPoint, role: NodeRole): ConnectionNote {
  const conn: ConnectionNote = { beat: p.beat, lane: p.lane, subBeat: p.subBeat };
  // hidden 只在中间结点保留；若隐点落到链端点 → 升为可见端点（无 hidden 字段）
  if (p.hidden !== undefined && role === 'middle') conn.hidden = p.hidden;
  if (role === 'end') {
    if (p.flick) conn.flick = true;
    if (p.skill) conn.skill = true;
  } else if (role === 'start') {
    // 滑键不可作起点（ADR-0001 §5）→ flick 剥除；技能键起始保留
    if (p.skill) conn.skill = true;
  }
  // middle：统一化（剥所有标记）
  return conn;
}

const isSlideLike = (n: ChartNote | undefined) => !!n && (n.type === 'Slide' || n.type === 'Long');

/** 结点退化为独立音符（ADR-0001 §1.2 拆条退化语义）：保 flick/skill，Long 残段同规则降为 Single */
export function connectionToNote(conn: ConnectionNote): ChartNote {
  const note: { beat: number; lane: number; subBeat: number; type: "Single"; flick?: boolean; skill?: boolean } = {
    beat: conn.beat,
    lane: conn.lane,
    subBeat: conn.subBeat || 0,
    type: "Single"
  };
  if (conn.flick) note.flick = true;
  if (conn.skill) note.skill = true;
  return note;
}

export interface SlideCombineResult {
  shouldCombine: boolean;
  newNotes: ChartNote[];
  /** 组合滑条在 newNotes 中的下标（push 在数组末尾；仅 shouldCombine 时有效） */
  slideIndex?: number;
  message?: string;
}

const sameConn = (
  a: { beat: number; lane: number; subBeat?: number },
  b: { beat: number; lane: number; subBeat?: number },
) => a.beat === b.beat && a.lane === b.lane && (a.subBeat || 0) === (b.subBeat || 0);

/**
 * 把选区组合成一条滑条（ADR-0008 §4，2026-09-07 三轮修订 = 结点级吸入 + 宿主拆条）。
 * 吸入来源 = ①kind:'note' 键型音符（本体消耗）；②滑条结点——slideNode 条目覆盖的结点参与成链，
 * 宿主未覆盖连续段按拆条语义保留（≥2 结点 = 子滑条保原 type，=1 结点 = 退化独立 Single）；
 * 完整覆盖或 kind:'note' 整条选中（Ctrl+E 路径）→ 全链入、本体消耗、无残留。
 * slideRegion、BPM/System 不参与不消耗。来源对象（键音符 + 被触碰滑条）<2 → 无事发生。
 * 同位结点重合 → 合并单结点（hidden:false 可见接合点）；接合走 mergeChainWithSlides。
 * 结果 type：任一被吸入/消耗滑条为 Long → Long。
 * 无就地变异：未受影响音符复用原引用（ADR-0001 §4 结构共享约束）。
 */
export function combineSelectionIntoSlide(
  notes: ChartNote[],
  items: SelectionItem[],
): SlideCombineResult {
  const keyIdxs = new Set<number>();
  const fullSlideIdxs = new Set<number>();
  const nodeCover = new Map<number, Set<number>>();
  for (const it of items) {
    if (it.kind === 'note') {
      if (isAbsorbable(notes[it.noteIndex])) keyIdxs.add(it.noteIndex);
      else if (isSlideLike(notes[it.noteIndex])) fullSlideIdxs.add(it.noteIndex);
    } else if (it.kind === 'slideNode' && isSlideLike(notes[it.noteIndex])) {
      if (!nodeCover.has(it.noteIndex)) nodeCover.set(it.noteIndex, new Set());
      nodeCover.get(it.noteIndex)!.add(it.connIndex);
    }
  }
  // 全部结点都被框到 = 完整覆盖（框选语义），等价整条选中：本体消耗、无残留
  for (const [i, covered] of nodeCover) {
    if (covered.size === (notes[i] as SlideNote).connections.length) {
      fullSlideIdxs.add(i);
      nodeCover.delete(i);
    }
  }
  // 来源计数（§4 修订）：键音符 + 整条消耗滑条 + 被触碰（部分覆盖）滑条 ≥2
  if (keyIdxs.size + fullSlideIdxs.size + nodeCover.size < 2) {
    return { shouldCombine: false, newNotes: notes, message: '组合来源不足 2 个' };
  }

  const points: ChainPoint[] = [];
  for (const i of keyIdxs) {
    const n = notes[i] as AbsorbableNote;
    points.push({
      beat: n.beat, lane: n.lane, subBeat: n.subBeat || 0,
      flick: n.type === 'Single' && !!n.flick,
      skill: n.type === 'Single' && !!n.skill,
    });
  }
  for (const i of fullSlideIdxs) {
    for (const c of (notes[i] as SlideNote).connections) {
      points.push({
        beat: c.beat, lane: c.lane, subBeat: c.subBeat || 0,
        flick: !!c.flick, skill: !!c.skill, hidden: c.hidden,
      });
    }
  }
  for (const [i, covered] of nodeCover) {
    const cs = (notes[i] as SlideNote).connections;
    for (const ci of covered) {
      const c = cs[ci];
      points.push({
        beat: c.beat, lane: c.lane, subBeat: c.subBeat || 0,
        flick: !!c.flick, skill: !!c.skill, hidden: c.hidden,
      });
    }
  }
  const ordered = sortAbsorbable(points);
  // 同位置重合 → 合并单结点（标记 OR 汇集，接合点可见）
  const dedup: ChainPoint[] = [];
  for (const p of ordered) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.beat === p.beat && prev.subBeat === p.subBeat && prev.lane === p.lane) {
      prev.flick = prev.flick || p.flick;
      prev.skill = prev.skill || p.skill;
      prev.hidden = false;
    } else {
      dedup.push({ ...p });
    }
  }
  if (dedup.length < 2) {
    return { shouldCombine: false, newNotes: notes, message: '组合来源不足 2 个' };
  }
  const last = dedup.length - 1;
  const conns = dedup.map((p, k) => connFromPoint(p, k === 0 ? 'start' : k === last ? 'end' : 'middle'));

  // 残留重建：键音符/整条消耗滑条移除；部分覆盖滑条 → 未覆盖连续段拆条（≥2=子滑条，=1=退化 Single）
  const consumedNow = new Set<number>([...keyIdxs, ...fullSlideIdxs]);
  const rest: ChartNote[] = [];
  for (let i = 0; i < notes.length; i++) {
    if (consumedNow.has(i)) continue;
    const covered = nodeCover.get(i);
    if (!covered) { rest.push(notes[i]); continue; }
    const slide = notes[i] as SlideNote;
    const runs: ConnectionNote[][] = [];
    let cur: ConnectionNote[] = [];
    slide.connections.forEach((c, ci) => {
      if (covered.has(ci)) {
        if (cur.length) { runs.push(cur); cur = []; }
      } else {
        cur.push(c);
      }
    });
    if (cur.length) runs.push(cur);
    for (const run of runs) {
      rest.push(run.length >= 2 ? { ...slide, connections: run } : connectionToNote(run[0]));
    }
  }
  const hasLong = [...fullSlideIdxs, ...nodeCover.keys()].some(i => notes[i].type === 'Long');
  const merged = mergeChainWithSlides(rest, conns);
  const connections = merged.connections;
  const type = merged.type === 'Long' || hasLong ? 'Long' as const : 'Slide' as const;
  const consumedSet = new Set(merged.consumed);
  const newNotes = [...rest.filter((_, i) => !consumedSet.has(i)), { type, connections } as SlideNote];
  return {
    shouldCombine: true,
    newNotes,
    slideIndex: newNotes.length - 1,
    message: `框选组合 ${conns.length} 个来源成滑条`,
  };
}

/**
 * 接合（ADR-0008 §4"组合产生的端点若与既有滑条端点重合，仍走 ADR-0001 §3 合并"）：
 * - 既有滑条【末尾端点】== 链【起始】→ 合并（既有在前，共享点降为中间结点 hidden:false）
 * - 既有滑条【起始端点】== 链【末尾】→ 合并（既有在后）
 * - 端点同向重合（起点+起点 / 终点+终点）→ 不合并（§3 情况 3/4），保持独立滑条
 * 循环直至无匹配（链合并后新端点可能又与另一条滑条重合 → 级联）。
 * 合并消耗既有滑条本体；链首/尾结点的 flick/skill 标记在降为中间结点时剥除（与两击路径一致）。
 */
export function mergeChainWithSlides(
  notes: ChartNote[],
  chain: ConnectionNote[],
): { connections: ConnectionNote[]; type: 'Slide' | 'Long'; consumed: number[] } {
  let out = [...chain];
  let type: 'Slide' | 'Long' = 'Slide';
  const pool = notes.map((n, i) => ({ n, idx: i })); // 工作副本（仅 splice；idx=在 notes 中的原下标）
  const consumed: number[] = [];
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < pool.length; i++) {
      const n = pool[i].n;
      if (n.type !== 'Slide' && n.type !== 'Long') continue;
      const cs = n.connections;
      if (cs.length < 2) continue;
      const head = cs[0];
      const tail = cs[cs.length - 1];
      if (sameConn(tail, out[0])) {
        const pathway: ConnectionNote = { beat: tail.beat, lane: tail.lane, subBeat: tail.subBeat || 0, hidden: false };
        out = [...cs.slice(0, -1), pathway, ...out.slice(1)];
        if (n.type === 'Long') type = 'Long';
        consumed.push(pool[i].idx);
        pool.splice(i, 1);
        merged = true;
        break;
      }
      if (sameConn(head, out[out.length - 1])) {
        const pathway: ConnectionNote = { beat: head.beat, lane: head.lane, subBeat: head.subBeat || 0, hidden: false };
        out = [...out.slice(0, -1), pathway, ...cs.slice(1)];
        if (n.type === 'Long') type = 'Long';
        consumed.push(pool[i].idx);
        pool.splice(i, 1);
        merged = true;
        break;
      }
    }
  }
  return { connections: out, type, consumed };
}
