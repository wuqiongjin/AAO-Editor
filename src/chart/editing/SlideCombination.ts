// ADR-0008 §4：Slide 框选组合（纯模块）。
// 与两击直放并存：Slide 工具态框选（或"已有选区 + Ctrl+E"）把框内音符与滑条结点吸入成一条滑条。
// 组合与 ADR-0001 §1.2 覆盖/替换规则无关——框内任何键型一律吸入；滑条按结点级吸入，宿主未覆盖段拆条保留（§4 三轮修订）。
// 排序 = beat+subBeat 升序、同拍按 lane 升序；同拍横向段在此路径合法（zigzag 样例即由此重现）。
// 形态归一表（connectionFromAbsorbedNote）与排序规则由单测逐行锁表（tests/unit/chart/editing/SlideCombination.test.ts），
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

/**
 * 排序规则（ADR-0008 §4，逐行锁单测）：beat+subBeat 升序，同拍按 lane 升序。
 * **生产路径必须复用它**（K 路归并的块间比较器取此规则），否则锁表锁的是死代码。
 */
export const compareAbsorbable = <T extends { beat: number; subBeat?: number; lane: number }>(
  a: T, b: T,
): number => (a.beat - b.beat) || ((a.subBeat || 0) - (b.subBeat || 0)) || (a.lane - b.lane);

export const sortAbsorbable = <T extends { beat: number; subBeat?: number; lane: number }>(
  arr: readonly T[],
): T[] => [...arr].sort(compareAbsorbable);

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
 *
 * **被吸音符 → 链结点的投影（上表第 0 步）与生产共用**：`chainPointFromNote` 既供本表使用，
 * 也供 `combineSelectionIntoSlide` 的 K 路归并构造块使用——否则改了本表而生产路径另起炉灶，
 * 单测全绿但行为已变（锁表失效）。
 */
export function chainPointFromNote(note: AbsorbableNote): ChainPoint {
  return {
    beat: note.beat, lane: note.lane, subBeat: note.subBeat || 0,
    flick: note.type === 'Single' && !!note.flick,
    skill: note.type === 'Single' && !!note.skill,
  };
}

export function connectionFromAbsorbedNote(note: AbsorbableNote, role: NodeRole): ConnectionNote {
  return connFromPoint(chainPointFromNote(note), role);
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
 * 把选区组合成一条滑条（ADR-0008 §4，2026-09-08 五轮修订 = **触碰即整条入链**）。
 * 吸入来源 = ①kind:'note' 键型音符（本体消耗）；②滑条——**任一结点入框（slideNode）或整条选中
 * 即整条入链、本体消耗**（不再区分完整/部分覆盖，也不再拆条：组合 = 往滑条里并东西，不是切东西）。
 * 排序 = **K 路保序归并**：每个被触碰滑条的结点序列是一整块（块内保原顺序，不重排宿主形状），
 * 键音符各为单例块，块间按 §4 排序规则（beat→subBeat→lane）取最小头 —— 于是"框 A + 中间的新音符"
 * → `A→新音符→B`（宿主残段不再被拆成孤立音符）。
 * slideRegion、BPM/System 不参与不消耗。来源对象（键音符 + 被触碰滑条）<2 → 无事发生。
 * 同位结点重合 → 合并单结点（hidden:false 可见接合点）；与未被触碰的既有滑条仍走 §3 接合。
 * 结果 type：任一被吸入/消耗/接合滑条为 Long → Long。
 * 无就地变异：未受影响音符复用原引用（ADR-0001 §4 结构共享约束）。
 */
export function combineSelectionIntoSlide(
  notes: ChartNote[],
  items: SelectionItem[],
): SlideCombineResult {
  const keyIdxs = new Set<number>();
  const slideIdxs = new Set<number>();
  for (const it of items) {
    if (it.kind === 'note') {
      if (isAbsorbable(notes[it.noteIndex])) keyIdxs.add(it.noteIndex);
      else if (isSlideLike(notes[it.noteIndex])) slideIdxs.add(it.noteIndex);
    } else if (it.kind === 'slideNode' && isSlideLike(notes[it.noteIndex])) {
      slideIdxs.add(it.noteIndex); // 触碰即整条入链（五轮修订）
    }
    // slideRegion：不参与不消耗
  }
  // 来源计数（§4）：键音符 + 被触碰滑条 ≥2
  if (keyIdxs.size + slideIdxs.size < 2) {
    return { shouldCombine: false, newNotes: notes, message: '组合来源不足 2 个' };
  }

  // 成链块：键音符 = 单例块；被触碰滑条 = 保序块（宿主形状不被重排）
  const blocks: ChainPoint[][] = [];
  for (const i of keyIdxs) {
    blocks.push([chainPointFromNote(notes[i] as AbsorbableNote)]);
  }
  for (const i of slideIdxs) {
    blocks.push((notes[i] as SlideNote).connections.map(c => ({
      beat: c.beat, lane: c.lane, subBeat: c.subBeat || 0,
      flick: !!c.flick, skill: !!c.skill, hidden: c.hidden,
    })));
  }
  // K 路归并：块内保序，块间按 §4 排序规则（compareAbsorbable，与 sortAbsorbable 同一份）取最小头
  const cursor = blocks.map(() => 0);
  const ordered: ChainPoint[] = [];
  for (;;) {
    let best = -1;
    for (let b = 0; b < blocks.length; b++) {
      if (cursor[b] >= blocks[b].length) continue;
      if (best < 0 || compareAbsorbable(blocks[b][cursor[b]], blocks[best][cursor[best]]) < 0) best = b;
    }
    if (best < 0) break;
    ordered.push(blocks[best][cursor[best]++]);
  }
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

  // 残留重建（五轮修订 = 无拆条）：来源（键音符 + 被触碰滑条）本体消耗，其余原样保留（结构共享）
  const consumedNow = new Set<number>([...keyIdxs, ...slideIdxs]);
  const rest: ChartNote[] = [];
  const restOrig: number[] = []; // rest 下标 → notes 原下标
  for (let i = 0; i < notes.length; i++) {
    if (consumedNow.has(i)) continue;
    rest.push(notes[i]);
    restOrig.push(i);
  }
  // 与未被触碰的既有滑条仍走 §3 接合（链端点重合 → 级联合并）
  const merged = mergeChainWithSlides(rest, conns);
  const mergedSet = new Set(merged.consumed);
  const hasLong = [
    ...slideIdxs, ...merged.consumed.map(k => restOrig[k]),
  ].some(i => notes[i]?.type === 'Long');
  const type = merged.type === 'Long' || hasLong ? 'Long' as const : 'Slide' as const;
  const newNotes = [
    ...rest.filter((_, k) => !mergedSet.has(k)),
    { type, connections: merged.connections } as SlideNote,
  ];
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
 * @param exclude 不参与合并的 notes 下标（拖拽接合时排除被拖滑条自身，防自合并）
 */
export function mergeChainWithSlides(
  notes: ChartNote[],
  chain: ConnectionNote[],
  exclude: readonly number[] = [],
): { connections: ConnectionNote[]; type: 'Slide' | 'Long'; consumed: number[] } {
  const skip = new Set(exclude);
  let out = [...chain];
  let type: 'Slide' | 'Long' = 'Slide';
  const pool = notes.map((n, i) => ({ n, idx: i })); // 工作副本（仅 splice；idx=在 notes 中的原下标）
  const consumed: number[] = [];
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < pool.length; i++) {
      if (skip.has(pool[i].idx)) continue;
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
