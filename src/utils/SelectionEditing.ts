import type { ChartNote, SelectionItem, SlideNote } from '../notes/Charts';
import { connectionToNote } from './NoteReplacementRules';
import { mirrorNote, mirrorLane } from './NoteEditing';

/**
 * 滑条子部分选择与编辑规则（ADR-0001 §6）
 * 以 SelectionItem 为单位，支持滑条的区域/端点/中间结点独立编辑，
 * 也兼容整条音符（{kind:'note'}，含 Ctrl+左键选中的整条滑条）。
 */

const isSlide = (n: ChartNote): n is SlideNote => n.type === 'Slide' || n.type === 'Long';

// 把 items 按 noteIndex 分组，返回 Map
const groupByNote = (items: SelectionItem[]): Map<number, SelectionItem[]> => {
  const map = new Map<number, SelectionItem[]>();
  for (const it of items) {
    const arr = map.get(it.noteIndex) ?? [];
    arr.push(it);
    map.set(it.noteIndex, arr);
  }
  return map;
};

/**
 * 删除选择条目（ADR-0001 §6.2）
 * - kind 'note' → 删除整条音符
 * - kind 'slideRegion' → 拆滑条（在该区域处拆成两段，两端结点保留为新端点）
 * - kind 'slideNode' → 移除该结点（剩余单结点时退化为独立音符）
 * 同一滑条内多个子部分删除会合并处理。
 */
export function deleteSelection(notes: ChartNote[], items: SelectionItem[]): ChartNote[] {
  return removeSelection(notes, items);
}

/**
 * 从 notes 中移除指定选择条目，重建数组（无就地变异）
 * 滑条的处理：收集需移除的结点（slideNode）与需拆分的区域（slideRegion），
 * 然后按统一算法拆分——跳过被移除结点（相邻结点保持连接），
 * 在拆分点之后断开成新的滑条段。
 */
function removeSelection(notes: ChartNote[], items: SelectionItem[]): ChartNote[] {
  const fullRemove = new Set<number>(); // 整条删除的 noteIndex
  const nodeRemove = new Map<number, Set<number>>(); // noteIndex -> 需移除的 connIndex 集合
  const splitAfter = new Map<number, Set<number>>(); // noteIndex -> 需在该 connIndex 之后拆分的集合（区域）

  for (const it of items) {
    if (it.kind === 'note') {
      fullRemove.add(it.noteIndex);
    } else if (it.kind === 'slideNode') {
      const set = nodeRemove.get(it.noteIndex) ?? new Set<number>();
      set.add(it.connIndex);
      nodeRemove.set(it.noteIndex, set);
    } else {
      // slideRegion：在该连接带处拆分（connIndex 之后断开）
      const set = splitAfter.get(it.noteIndex) ?? new Set<number>();
      set.add(it.connIndex);
      splitAfter.set(it.noteIndex, set);
    }
  }

  const result: ChartNote[] = [];
  notes.forEach((note, i) => {
    if (fullRemove.has(i)) return;
    if (isSlide(note) && (nodeRemove.has(i) || splitAfter.has(i))) {
      result.push(...splitSlide(note, nodeRemove.get(i) ?? new Set(), splitAfter.get(i) ?? new Set()));
      return;
    }
    result.push(note);
  });
  return result;
}

/**
 * 对一条滑条执行"拆滑条 + 移除结点"（ADR-0001 §6.2）
 * @param nodeRemove 需移除的结点下标（跳过该结点，相邻结点保持连接）
 * @param splitAfter 需在该下标之后拆分的点（区域断开成两段）
 * 每段：>=2 结点 → 保留为滑条；==1 结点 → 按标记退化为独立音符
 */
function splitSlide(
  note: SlideNote,
  nodeRemove: Set<number>,
  splitAfter: Set<number>
): ChartNote[] {
  const conns = note.connections;
  const out: ChartNote[] = [];
  let seg: typeof conns = [];
  for (let idx = 0; idx < conns.length; idx++) {
    if (nodeRemove.has(idx)) continue; // 移除结点，段继续
    seg.push(conns[idx]);
    if (splitAfter.has(idx)) {
      out.push(materializeSegment(note.type, seg));
      seg = [];
    }
  }
  if (seg.length > 0) out.push(materializeSegment(note.type, seg));
  return out;
}

function materializeSegment(type: "Slide" | "Long", seg: SlideNote["connections"]): ChartNote {
  if (seg.length === 1) return connectionToNote(seg[0]);
  return { type, connections: seg } as SlideNote;
}

/**
 * 复制选择条目 → 物质化为 ChartNote[] 存入剪贴板（ADR-0001 §6.3）
 * - 整条音符 → 该音符本身
 * - 滑条单个结点 → 独立音符（按其标记退化）
 * - 滑条区域（2 结点）或 >1 个结点 → 连续连接区域段（跳过中间结点也取连续段）
 */
export function copySelection(notes: ChartNote[], items: SelectionItem[]): ChartNote[] {
  const out: ChartNote[] = [];
  for (const [noteIndex, its] of groupByNote(items)) {
    const note = notes[noteIndex];
    if (!note) continue;

    if (isSlide(note)) {
      // 整条滑条被选中（Ctrl+左键）
      if (its.some(it => it.kind === 'note')) {
        out.push(structuredClone(note));
        continue;
      }
      // 收集被覆盖的 conn 下标
      const covered = new Set<number>();
      for (const it of its) {
        if (it.kind === 'slideNode') covered.add(it.connIndex);
        else if (it.kind === 'slideRegion') {
          covered.add(it.connIndex);
          covered.add(it.connIndex + 1);
        }
      }
      if (covered.size === 0) continue;
      if (covered.size === 1) {
        const i = [...covered][0];
        out.push(connectionToNote(note.connections[i]));
      } else {
        // 连续区域段（ADR §6.3 / Q15=A：跳过中间结点也取连续段）
        const min = Math.min(...covered);
        const max = Math.max(...covered);
        const conns = note.connections.slice(min, max + 1).map(c => ({ ...c }));
        out.push({ type: note.type, connections: conns } as SlideNote);
      }
    } else {
      // 非滑条音符：仅 kind 'note' 有效
      out.push(structuredClone(note));
    }
  }
  return out;
}

/**
 * 剪切选择条目 → { 剪贴板物质化内容, 移除后的 notes }
 * 剪切 = 复制该区域 + 删除该区域（ADR-0001 §6.3，与"删除"对区域的语义统一：拆滑条）。
 */
export function cutSelection(notes: ChartNote[], items: SelectionItem[]): { clipboard: ChartNote[]; newNotes: ChartNote[] } {
  const clipboard = copySelection(notes, items);
  const newNotes = removeSelection(notes, items);
  return { clipboard, newNotes };
}

/**
 * 镜像选择条目（ADR-0001 §6.3）：只翻转子部分的 lane
 * - 整条音符 → 整体镜像
 * - 滑条结点/区域 → 仅翻转被选中的结点 lane，不联动滑条其它结点
 */
export function mirrorSelection(notes: ChartNote[], items: SelectionItem[]): ChartNote[] {
  const newNotes = notes.map(n => n);
  for (const [noteIndex, its] of groupByNote(items)) {
    const note = newNotes[noteIndex];
    if (!note) continue;

    if (isSlide(note)) {
      if (its.some(it => it.kind === 'note')) {
        newNotes[noteIndex] = mirrorNote(note);
        continue;
      }
      const covered = new Set<number>();
      for (const it of its) {
        if (it.kind === 'slideNode') covered.add(it.connIndex);
        else if (it.kind === 'slideRegion') {
          covered.add(it.connIndex);
          covered.add(it.connIndex + 1);
        }
      }
      if (covered.size === 0) continue;
      const connections = note.connections.map((c, ci) =>
        covered.has(ci) ? { ...c, lane: mirrorLane(c.lane) } : c
      );
      newNotes[noteIndex] = { ...note, connections };
    } else {
      newNotes[noteIndex] = mirrorNote(note);
    }
  }
  return newNotes;
}

/**
 * 提取选择条目对应的所有音符下标（去重，用于状态栏/信息面板等按整条音符展示）
 */
export function selectionNoteIndices(items: SelectionItem[]): number[] {
  return [...new Set(items.map(it => it.noteIndex))];
}
