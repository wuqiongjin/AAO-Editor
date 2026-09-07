// ADR-0008 §4：Slide 框选组合（纯模块）。
// 与两击直放并存：Slide 工具态框选（或"已有选区 + Ctrl+E"）把框内音符吸入成一条滑条。
// 组合与 ADR-0001 §1.2 覆盖/替换规则无关——框内任何键型一律吸入；
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
  const conn: ConnectionNote = { beat: note.beat, lane: note.lane, subBeat: note.subBeat || 0 };
  const flick = note.type === 'Single' && !!note.flick;
  const skill = note.type === 'Single' && !!note.skill;
  if (role === 'end') {
    if (flick) conn.flick = true;
    if (skill) conn.skill = true;
  } else if (role === 'start') {
    // 滑键不可作起点（ADR-0001 §5）→ flick 剥除；技能键起始保留
    if (skill) conn.skill = true;
  }
  // middle：统一化（剥所有标记）
  return conn;
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
 * 把选区中的键型音符组合成一条滑条（ADR-0008 §4）。
 * - 吸入对象 = items 中 kind:'note' 且类型为 单键/方向键 的音符；
 *   滑条子部分（slideNode/slideRegion）、整条滑条、BPM/System 一律忽略（不参与、不消耗）。
 * - 被吸音符本体消耗（删除），按归一表转为连接结点；N<2 → 无事发生。
 * - 接合：组合链端点与既有滑条端点重合 → 走 ADR-0001 §3 合并（共享端点降为中间结点）。
 * - 无就地变异：未受影响音符复用原引用（ADR-0001 §4 结构共享约束）。
 */
export function combineSelectionIntoSlide(
  notes: ChartNote[],
  items: SelectionItem[],
): SlideCombineResult {
  const idxs = new Set<number>();
  for (const it of items) {
    if (it.kind !== 'note') continue;
    if (isAbsorbable(notes[it.noteIndex])) idxs.add(it.noteIndex);
  }
  if (idxs.size < 2) {
    return { shouldCombine: false, newNotes: notes, message: '可组合音符不足 2 个' };
  }

  const entries = [...idxs].map(i => {
    const n = notes[i] as AbsorbableNote;
    return { i, beat: n.beat, subBeat: n.subBeat || 0, lane: n.lane };
  });
  const ordered = sortAbsorbable(entries);
  const last = ordered.length - 1;
  const conns = ordered.map((e, k) =>
    connectionFromAbsorbedNote(notes[e.i] as AbsorbableNote, k === 0 ? 'start' : k === last ? 'end' : 'middle'));

  const rest = notes.filter((_, i) => !idxs.has(i));
  const { connections, type, consumed } = mergeChainWithSlides(rest, conns);
  const consumedSet = new Set(consumed);
  const newNotes = [...rest.filter((_, i) => !consumedSet.has(i)), { type, connections } as SlideNote];
  return {
    shouldCombine: true,
    newNotes,
    slideIndex: newNotes.length - 1,
    message: `框选组合 ${conns.length} 个音符成滑条`,
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
function mergeChainWithSlides(
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
        type = n.type;
        consumed.push(pool[i].idx);
        pool.splice(i, 1);
        merged = true;
        break;
      }
      if (sameConn(head, out[out.length - 1])) {
        const pathway: ConnectionNote = { beat: head.beat, lane: head.lane, subBeat: head.subBeat || 0, hidden: false };
        out = [...out.slice(0, -1), pathway, ...cs.slice(1)];
        type = n.type;
        consumed.push(pool[i].idx);
        pool.splice(i, 1);
        merged = true;
        break;
      }
    }
  }
  return { connections: out, type, consumed };
}
