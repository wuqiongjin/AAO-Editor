import type { ChartNote, SelectionItem, SlideNote } from '../types';
import { connectionToNote } from './SlideCombination';
import { spanConnIndices, regionIdentity } from './SlideSegments';
import { mirrorNote, mirrorLane } from './NoteEditing';
import { DEFAULT_BPM } from '../../audio/AudioTiming';

/**
 * 滑条子部分选择与编辑规则（ADR-0001 §6）
 * 以 SelectionItem 为单位，支持滑条的区域/端点/中间结点独立编辑，
 * 也兼容整条音符（{kind:'note'}，含 Ctrl+左键选中的整条滑条）。
 */

/** 滑条 / 长条同构判定（Slide 与 Long 结构完全等价，见 types.ts） */
export const isSlide = (n: ChartNote): n is SlideNote => n.type === 'Slide' || n.type === 'Long';

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
 * - kind 'slideRegion' → 拆滑条（在该区域处拆成两段，两端结点保留为新端点）；
 *   段内含 hidden → 只清段内 hidden（issue 80）
 * - kind 'slideNode' → 删**中间可见**结点 = **原位转 hidden**（issue 92，bestdori 口径两段式删除的第一步：
 *   再对含 hidden 的段删一次才真正移除，用户不写代码即可创造 hidden）；删端点 = 移除端点（issue 80 口径）
 * 同一滑条内多个子部分删除会合并处理。
 *
 * **例外（issue 59 / ADR-0001 保底）**：beat 0 的 BPM 线**不可删除** —— 谱面必须有初始 BPM，
 * 对它执行删除退化为「重置为初始状态」（bpm = DEFAULT_BPM）。用户改过值（如 180）后再删，
 * 看到的就是数值回到 120，而不是整条线消失。删除工具点击 / 右键 / 框选后 Delete 三条通路同此语义。
 */
export function deleteSelection(notes: ChartNote[], items: SelectionItem[]): ChartNote[] {
  return removeSelection(notes, items);
}

/**
 * 从 notes 中移除指定选择条目，重建数组（无就地变异）
 * 滑条的处理：收集需移除的结点（slideNode 端点 / 段内 hidden 清理）、需原位转 hidden 的
 * 中间可见结点（issue 92）与需拆分的区域（slideRegion），然后按统一算法拆分——
 * 跳过被移除结点（相邻结点保持连接），在拆分点之后断开成新的滑条段。
 */
function removeSelection(notes: ChartNote[], items: SelectionItem[]): ChartNote[] {
  const fullRemove = new Set<number>(); // 整条删除的 noteIndex
  const nodeRemove = new Map<number, Set<number>>(); // noteIndex -> 需移除的 connIndex 集合
  const nodeToHidden = new Map<number, Set<number>>(); // noteIndex -> 需原位转 hidden 的 connIndex 集合（issue 92）
  const splitAfter = new Map<number, Set<number>>(); // noteIndex -> 需在该 connIndex 之后拆分的集合（区域）

  for (const it of items) {
    if (it.kind === 'note') {
      fullRemove.add(it.noteIndex);
    } else if (it.kind === 'slideNode') {
      // issue 92（bestdori 口径）：删**中间可见**结点 = 原位转 hidden（保留 beat/lane/标记，仅设 hidden）；
      // 端点结点与已 hidden 的结点维持移除口径（hidden 不可命中，此分支只为纯函数层的直接调用兜底）。
      const target = notes[it.noteIndex];
      const slide = target && isSlide(target) ? target : null;
      const isMiddleVisible = slide !== null
        && it.connIndex > 0
        && it.connIndex < slide.connections.length - 1
        && !slide.connections[it.connIndex]?.hidden;
      if (isMiddleVisible) {
        const set = nodeToHidden.get(it.noteIndex) ?? new Set<number>();
        set.add(it.connIndex);
        nodeToHidden.set(it.noteIndex, set);
      } else {
        const set = nodeRemove.get(it.noteIndex) ?? new Set<number>();
        set.add(it.connIndex);
        nodeRemove.set(it.noteIndex, set);
      }
    } else {
      // slideRegion（issue 80 定案）：**段内含 hidden → 只清掉段内的 hidden**，段本身保留、两端点直连；
      // 段上无 hidden → 维持现状：在该连接带处拆分（connIndex 之后断开）。
      // （反复点即可逐步清空：先清隐藏、再断带子。）
      const target = notes[it.noteIndex];
      const slide = target && isSlide(target) ? target : null;
      const sp = slide ? regionIdentity(slide.connections, it.connIndex)?.span ?? null : null;
      if (slide && sp && sp.end - sp.start > 1) {
        const hidden = nodeRemove.get(it.noteIndex) ?? new Set<number>();
        for (let k = sp.start + 1; k < sp.end; k++) {
          if (slide.connections[k]?.hidden) hidden.add(k);
        }
        nodeRemove.set(it.noteIndex, hidden);
        continue;
      }
      const set = splitAfter.get(it.noteIndex) ?? new Set<number>();
      set.add(it.connIndex);
      splitAfter.set(it.noteIndex, set);
    }
  }

  const result: ChartNote[] = [];
  notes.forEach((note, i) => {
    if (fullRemove.has(i)) {
      // beat 0 的 BPM 线不可删 → 退化为重置为初始状态（bpm = 120），见 deleteSelection 注释
      if (note.type === 'BPM' && note.beat === 0) result.push({ ...note, bpm: DEFAULT_BPM });
      return;
    }
    if (isSlide(note) && (nodeRemove.has(i) || splitAfter.has(i) || nodeToHidden.has(i))) {
      // issue 92：先对副本原位转 hidden（仅设 hidden:true，其余字段不动），再走统一拆分算法——
      // 转 hidden 后滑条自然落入既有 hidden 口径（hidden 对段透明、删段清 hidden、段首尾收口）。
      const toHide = nodeToHidden.get(i);
      const slide2 = toHide
        ? { ...note, connections: note.connections.map((c, k) => (toHide.has(k) ? { ...c, hidden: true } : c)) }
        : note;
      result.push(...splitSlide(slide2, nodeRemove.get(i) ?? new Set(), splitAfter.get(i) ?? new Set()));
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
 *
 * issue 77 #9：含 hidden 结点时改走 `splitSlideHiddenAware`（hidden 对"段"透明）；
 * 无 hidden 的滑条完全沿用下面的旧路径（既有行为与锁测不变）。
 */
function splitSlide(
  note: SlideNote,
  nodeRemove: Set<number>,
  splitAfter: Set<number>
): ChartNote[] {
  if (note.connections.some(c => c.hidden)) {
    return splitSlideHiddenAware(note, nodeRemove, splitAfter);
  }
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

/** 可见（非 hidden）结点的真实下标序列。hidden 不参与分界（issue 77 #9）。 */
function visibleConnIndices(conns: SlideNote["connections"]): number[] {
  const out: number[] = [];
  conns.forEach((c, i) => { if (!c.hidden) out.push(i); });
  return out;
}

/**
 * 材质化 + 合法性收口（issue 77 #9）：段首/段尾不得是 hidden（ADR-0001 §1.2），
 * 否则会产出「首/尾结点 hidden」的非法滑条（`validateChartCode` 会报错）。
 * 全隐藏 / 空段 → null（丢弃该段）。
 */
function materializeSegmentSafe(
  type: "Slide" | "Long",
  seg: SlideNote["connections"],
): ChartNote | null {
  let s = seg;
  while (s.length > 0 && s[0].hidden) s = s.slice(1);
  while (s.length > 0 && s[s.length - 1].hidden) s = s.slice(0, -1);
  if (s.length === 0) return null;
  return materializeSegment(type, s);
}

/**
 * 含 hidden 结点的滑条拆分：hidden 对"段"**透明**（issue 77 #9）。
 *
 * - `[A, hidden, B]` 视作**一整段** A→B（两个 region 下标都归到同一条可见链分界）；
 * - 只有一段（可见结点 ≤ 2）时删这段 = **删整条**（用户 2026-09-10 定案：不该被 hidden 切成两截）；
 * - 被删段内的 hidden 随段一起消失；hidden 永不成为新段的首/尾。
 */
function splitSlideHiddenAware(
  note: SlideNote,
  nodeRemove: Set<number>,
  splitAfter: Set<number>
): ChartNote[] {
  const conns = note.connections;
  const vis = visibleConnIndices(conns);

  // ① region 下标 → 可见链上的分界 j
  const bounds = new Set<number>();
  for (const ci of splitAfter) {
    let v = -1;
    for (let k = 0; k <= ci && k < conns.length; k++) if (!conns[k].hidden) v++;
    if (v >= 0 && v <= vis.length - 2) bounds.add(v);
  }
  if (bounds.size > 0 && vis.length <= 2) return []; // 只有一段 → 整条删

  // ② 被移除的结点 + 被删段内的 hidden；切分点 = 该段的**可见**末端
  const dropped = new Set<number>(nodeRemove);
  const cutAfter = new Set<number>();
  for (const b of bounds) {
    cutAfter.add(vis[b]);
    for (let k = vis[b] + 1; k < vis[b + 1]; k++) dropped.add(k);
  }

  const out: ChartNote[] = [];
  let seg: SlideNote["connections"] = [];
  for (let i = 0; i < conns.length; i++) {
    if (dropped.has(i)) continue;
    seg.push(conns[i]);
    if (cutAfter.has(i)) {
      const m = materializeSegmentSafe(note.type, seg);
      if (m) out.push(m);
      seg = [];
    }
  }
  const tail = materializeSegmentSafe(note.type, seg);
  if (tail) out.push(tail);
  return out;
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
          // issue 77 二轮：段 = **逻辑段**（跨过 hidden 的整段）→ 整段一起被覆盖/翻转
          spanConnIndices(note.connections, it.connIndex).forEach(k => covered.add(k));
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
          // issue 77 二轮：段 = **逻辑段**（跨过 hidden 的整段）→ 整段一起被覆盖/翻转
          spanConnIndices(note.connections, it.connIndex).forEach(k => covered.add(k));
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

/**
 * 批量操作后的选区重映射（ADR-0008 §2 原则 4"批量应用后选区保留"）：
 * 批量键型替换/组合会增删移动数组元素，旧 noteIndex/connIndex 全部失效。
 * 按【位置】在新旧数组间迁移：位置仍能找到同 kind 的目标则保留（新下标），
 * 找不到（被消耗/被拆分）则整条丢弃。BPM/System 按 type+beat 匹配。
 */
export function remapSelection(oldNotes: ChartNote[], items: SelectionItem[], newNotes: ChartNote[]): SelectionItem[] {
  const posKey = (beat: number, lane: number, subBeat: number) => `${beat}|${lane}|${subBeat}`;
  // 新数组索引表：键型音符位置 → 下标；滑条/长条位置 → {下标, connIndex}
  const keyIdx = new Map<string, number>();
  const connIdx = new Map<string, { noteIndex: number; connIndex: number }>();
  newNotes.forEach((n, i) => {
    if (n.type === 'Single' || n.type === 'LDirectional' || n.type === 'RDirectional') {
      keyIdx.set(posKey(n.beat, n.lane, n.subBeat || 0), i);
    } else if (isSlide(n)) {
      n.connections.forEach((c, ci) => {
        const k = posKey(c.beat, c.lane, c.subBeat || 0);
        if (!connIdx.has(k)) connIdx.set(k, { noteIndex: i, connIndex: ci });
      });
    }
  });
  const findConn = (beat: number, lane: number, subBeat: number) => connIdx.get(posKey(beat, lane, subBeat));

  const out: SelectionItem[] = [];
  for (const it of items) {
    const old = oldNotes[it.noteIndex];
    if (!old) continue;
    if (old.type === 'Slide' || old.type === 'Long') {
      if (it.kind === 'note') {
        // 整条滑条：仍有一条滑条【起始结点】在旧起始位置 → 保留整条选择
        const oc = old.connections[0];
        const loc = oc ? findConn(oc.beat, oc.lane, oc.subBeat || 0) : undefined;
        if (loc && loc.connIndex === 0) out.push({ kind: 'note', noteIndex: loc.noteIndex });
        continue;
      }
      if (it.kind === 'slideNode') {
        const c = old.connections[it.connIndex];
        if (!c) continue;
        const loc = findConn(c.beat, c.lane, c.subBeat || 0);
        if (loc) out.push({ kind: 'slideNode', noteIndex: loc.noteIndex, connIndex: loc.connIndex });
        continue;
      }
      // slideRegion：两段结点仍在同一条滑条且相邻 → 迁移到新 connIndex
      const c1 = old.connections[it.connIndex], c2 = old.connections[it.connIndex + 1];
      if (!c1 || !c2) continue;
      const l1 = findConn(c1.beat, c1.lane, c1.subBeat || 0);
      const l2 = findConn(c2.beat, c2.lane, c2.subBeat || 0);
      if (l1 && l2 && l1.noteIndex === l2.noteIndex && l2.connIndex === l1.connIndex + 1) {
        out.push({ kind: 'slideRegion', noteIndex: l1.noteIndex, connIndex: l1.connIndex });
      }
      continue;
    }
    if (old.type === 'BPM' || old.type === 'System') {
      const i = newNotes.findIndex(n => n.type === old.type && n.beat === old.beat);
      if (i !== -1) out.push({ kind: 'note', noteIndex: i });
      continue;
    }
    // 键型音符
    const i = keyIdx.get(posKey(old.beat, old.lane, old.subBeat || 0));
    if (i !== undefined) out.push({ kind: 'note', noteIndex: i });
  }
  return out;
}
