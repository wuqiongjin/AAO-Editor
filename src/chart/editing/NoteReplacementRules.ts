import type { ChartNote, ConnectionNote, SelectionItem, SlideNote, LDirectionalNote, RDirectionalNote } from '../types';
import { connectionToNote, mergeChainWithSlides } from './SlideCombination';
import { shiftGroupToAnchor } from './NoteEditing';

/**
 * 音符覆盖替换规则工具类
 * 处理所有音符类型的覆盖替换逻辑
 */

export interface NoteReplacementResult {
    shouldReplace: boolean;
    newNotes: ChartNote[];
    message?: string;
}

/**
 * 处理音符覆盖替换规则
 * @param notes 当前所有音符
 * @param beat 目标位置beat
 * @param lane 目标位置lane
 * @param subBeat 目标位置subBeat
 * @param newNoteType 新音符类型
 * @returns 替换结果
 */
export function handleNoteReplacement(
    notes: ChartNote[],
    beat: number,
    lane: number,
    subBeat: number,
    newNoteType: string
): NoteReplacementResult {
    const newNotes = [...notes];

    // 统一 newNoteType：单键工具 id 为小写 "single"，模块内部与音符类型一致用 "Single"
    if (newNoteType === "single") {
        newNoteType = "Single";
    }

    // 查找同一位置是否已有音符
    const existingNoteIndex = newNotes.findIndex(note => {
        if (note.type === "Single" || note.type === "LDirectional" || note.type === "RDirectional") {
            return note.beat === beat && note.lane === lane && (note.subBeat || 0) === (subBeat || 0);
        } else if (note.type === "Slide" || note.type === "Long") {
            // 检查滑条音符的连接点
            return note.connections.some((conn: any) =>
                conn.beat === beat && conn.lane === lane && (conn.subBeat || 0) === (subBeat || 0)
            );
        }
        return false;
    });

    if (existingNoteIndex !== -1) {
        const existingNote = newNotes[existingNoteIndex];

        // 处理滑条音符的覆盖替换规则
        if (existingNote.type === "Slide" || existingNote.type === "Long") {
            return handleSlideNoteReplacement(newNotes, existingNoteIndex, beat, lane, subBeat, newNoteType);
        } else {
            // 处理单键音符和方向键的覆盖替换规则
            return handleSingleAndDirectionalReplacement(newNotes, existingNoteIndex, beat, lane, subBeat, newNoteType);
        }
    } else {
        // 没有现有音符，直接添加新音符
        return addNewNote(newNotes, beat, lane, subBeat, newNoteType);
    }
}

/** 键型批量应用的落点目标（ADR-0008 §2 框选矩阵：框内逐个位置应用替换规则） */
export interface KeyPlacementTarget {
    beat: number;
    lane: number;
    subBeat: number;
}

/**
 * 从框选条目提取键型批量落点（ADR-0008 §2"键型放置框选 = 框内音符逐个应用 ADR-0001 替换规则"）：
 * - kind 'note' 且为键型音符（单键/方向键）→ 音符自身位置
 * - kind 'slideNode' → 该滑条结点位置（flick/skill/方向键对结点的处置由 §1.2 表决定）
 * - 整条滑条 / slideRegion / BPM / System → 跳过（不参与批量替换）
 */
export function keyTargetsFromItems(notes: ChartNote[], items: SelectionItem[]): KeyPlacementTarget[] {
    const out: KeyPlacementTarget[] = [];
    for (const it of items) {
        const note = notes[it.noteIndex];
        if (!note) continue;
        if (it.kind === 'note') {
            if (note.type === 'Single' || note.type === 'LDirectional' || note.type === 'RDirectional') {
                out.push({ beat: note.beat, lane: note.lane, subBeat: note.subBeat || 0 });
            }
        } else if (it.kind === 'slideNode') {
            const conn = (note as SlideNote).connections?.[it.connIndex];
            if (conn) out.push({ beat: conn.beat, lane: conn.lane, subBeat: conn.subBeat || 0 });
        }
        // slideRegion：忽略（区域中心非栅格落点；结点已逐个进批量）
    }
    return out;
}

/**
 * 键型批量应用（ADR-0008 §2 框选矩阵 / §8"框选批量应用 = 一个可回退快照"）：
 * 对每个落点顺序应用 handleNoteReplacement（后一个基于前一个结果，位置互异故次序无关）。
 * 无任何落点生效时返回原数组引用（调用方据此跳过写历史）。
 */
export function batchApplyKeyType(
    notes: ChartNote[],
    targets: KeyPlacementTarget[],
    tool: string
): NoteReplacementResult {
    let cur = notes;
    let changed = false;
    for (const t of targets) {
        const r = handleNoteReplacement(cur, t.beat, t.lane, t.subBeat, tool);
        if (r.shouldReplace) {
            cur = r.newNotes;
            changed = true;
        }
    }
    return changed
        ? { shouldReplace: true, newNotes: cur }
        : { shouldReplace: false, newNotes: notes, message: '无可应用落点' };
}

/**
 * 处理滑条音符的覆盖替换规则（规则见 ADR-0001 第 1.2 节）
 * - 单键：任意滑条结点忽略
 * - 滑键：仅尾部端点加 flick；头部/中间忽略
 * - 技能键：两端都加 skill；中间忽略
 * - 方向键：中间节点拆两侧 / 端点拆端（2 结点滑条整条删除）
 */
function handleSlideNoteReplacement(
    newNotes: ChartNote[],
    existingNoteIndex: number,
    beat: number,
    lane: number,
    subBeat: number,
    newNoteType: string
): NoteReplacementResult {
    const existingNote = newNotes[existingNoteIndex] as SlideNote;
    const conns = existingNote.connections;
    const connectionIndex = conns.findIndex(conn =>
        conn.beat === beat && conn.lane === lane && (conn.subBeat || 0) === (subBeat || 0)
    );

    if (connectionIndex === -1) {
        return { shouldReplace: false, newNotes, message: "未找到匹配的连接点" };
    }

    const isStartPoint = connectionIndex === 0;
    const isEndPoint = connectionIndex === conns.length - 1;

    // 单键：任意滑条结点都忽略
    if (newNoteType === "Single") {
        return { shouldReplace: false, newNotes, message: "忽略不处理" };
    }

    // 滑键：仅尾部端点加 flick（只加不清，flick 与 skill 可并存，见 ADR §1.2/§5）；头部/中间忽略
    if (newNoteType === "flick") {
        if (isEndPoint) {
            const updated = conns.map((c, i) =>
                i === connectionIndex ? { ...c, flick: true } : c
            );
            newNotes[existingNoteIndex] = { ...existingNote, connections: updated };
            return { shouldReplace: true, newNotes, message: "尾部端点加滑键标记" };
        }
        return { shouldReplace: false, newNotes, message: "忽略不处理" };
    }

    // 技能键：仅在点击的端点加 skill（只加不清）；中间忽略
    if (newNoteType === "skill") {
        if (isStartPoint || isEndPoint) {
            const updated = conns.map((c, i) =>
                i === connectionIndex ? { ...c, skill: true } : c
            );
            newNotes[existingNoteIndex] = { ...existingNote, connections: updated };
            return { shouldReplace: true, newNotes, message: "端点加技能键标记" };
        }
        return { shouldReplace: false, newNotes, message: "忽略不处理" };
    }

    // 方向键：中间节点拆两侧 / 端点拆端
    if (newNoteType === "ldirectional" || newNoteType === "rdirectional") {
        return splitSlideAtNode(newNotes, existingNoteIndex, beat, lane, subBeat, newNoteType, connectionIndex);
    }

    return { shouldReplace: false, newNotes, message: "未知的音符类型组合" };
}

/**
 * 将单个滑条连接点退化为独立音符（ADR-0001 1.2.2：2 结点滑条端点被覆盖时另一端点退化）
 * 依据连接点的标记：skill → 技能键、flick → 滑键、无标记 → 普通单键
 */


/**
 * 删除滑条子段（ADR-0001 §6 独立 feature + 用户定案 2026-08-08）
 * - connIndex === null → 删除整个滑条区域（连接带），效果等同右键删除整条滑条
 * - connIndex 指向中间结点 → 仅移除该结点，其余结点保持连接（不拆滑条）
 * - connIndex 指向端点 → 移除端点，相邻中间结点升级为新端点；仅剩 1 结点时该结点按其标记退化为独立音符
 * @returns 新的 notes 数组（无就地变异，可被历史快照深拷贝逐步撤销）
 */
export function deleteSlideSegment(
    notes: ChartNote[],
    noteIndex: number,
    connIndex: number | null
): ChartNote[] {
    const newNotes = [...notes];
    const note = newNotes[noteIndex];
    if (!note || (note.type !== "Slide" && note.type !== "Long")) return newNotes;

    const conns = (note as SlideNote).connections;

    // 删除整个滑条区域
    if (connIndex === null) {
        newNotes.splice(noteIndex, 1);
        return newNotes;
    }

    // 删除单个结点（端点或中间结点），其它结点保持连接
    const newConns = conns.filter((_, i) => i !== connIndex);

    if (newConns.length === 1) {
        // 仅剩 1 结点 → 按其标记退化为独立音符（ADR 1.2.2 退化规则）
        newNotes.splice(noteIndex, 1);
        newNotes.push(connectionToNote(newConns[0]));
    } else {
        newNotes[noteIndex] = { ...note, connections: newConns };
    }
    return newNotes;
}

/**
 * 方向键放置到滑条结点上的拆条逻辑（ADR-0001 1.2.1 中间拆两侧 / 1.2.2 端点拆端）
 * @param connectionIndex 被放置方向键的结点下标
 */
function splitSlideAtNode(
    newNotes: ChartNote[],
    existingNoteIndex: number,
    beat: number,
    lane: number,
    subBeat: number,
    newNoteType: string,
    connectionIndex: number
): NoteReplacementResult {
    const existingNote = newNotes[existingNoteIndex] as SlideNote;
    const conns = existingNote.connections;
    const slideType = (existingNote.type as string) === "Long" ? "Long" : "Slide";
    const directionalType = (newNoteType === "ldirectional" ? "LDirectional" : "RDirectional") as "LDirectional" | "RDirectional";
    const independentNote = { beat, lane, subBeat, type: directionalType, length: 1 };

    // 移除原滑条（不就地变异原对象，改用构造的新片段）
    newNotes.splice(existingNoteIndex, 1);
    const isStartPoint = connectionIndex === 0;
    const isEndPoint = connectionIndex === conns.length - 1;

    if (isEndPoint) {
        // 去掉尾部端点，相邻中间节点升级为新端点；仅剩 1 个结点（另一端）时退化为独立音符（ADR 1.2.2）
        const remaining = conns.slice(0, connectionIndex);
        if (remaining.length === 1) {
            newNotes.push(connectionToNote(remaining[0]));
        } else if (remaining.length >= 2) {
            newNotes.push({ type: slideType, connections: remaining });
        }
        newNotes.push(independentNote);
        return { shouldReplace: true, newNotes, message: "端点方向键拆条" };
    }

    if (isStartPoint) {
        // 去掉头部端点，相邻中间节点升级为新端点；仅剩 1 个结点（另一端）时退化为独立音符（ADR 1.2.2）
        const remaining = conns.slice(connectionIndex + 1);
        if (remaining.length === 1) {
            newNotes.push(connectionToNote(remaining[0]));
        } else if (remaining.length >= 2) {
            newNotes.push({ type: slideType, connections: remaining });
        }
        newNotes.push(independentNote);
        return { shouldReplace: true, newNotes, message: "端点方向键拆条" };
    }

    // 中间节点：拆成两侧两条（左段 [起点..前一中间节点]、右段 [后一中间节点..终点]）；
    // 某一侧仅剩 1 个结点（无相邻滑条结点）时，该结点退化为独立音符（ADR 1.2.1）
    const left = conns.slice(0, connectionIndex);
    const right = conns.slice(connectionIndex + 1);
    if (left.length === 1) {
        newNotes.push(connectionToNote(left[0]));
    } else if (left.length >= 2) {
        newNotes.push({ type: slideType, connections: left });
    }
    if (right.length === 1) {
        newNotes.push(connectionToNote(right[0]));
    } else if (right.length >= 2) {
        newNotes.push({ type: slideType, connections: right });
    }
    newNotes.push(independentNote);
    return { shouldReplace: true, newNotes, message: "中间节点方向键拆条" };
}

/**
 * 处理单键音符和方向键的覆盖替换规则
 */
function handleSingleAndDirectionalReplacement(
    newNotes: ChartNote[],
    existingNoteIndex: number,
    beat: number,
    lane: number,
    subBeat: number,
    newNoteType: string
): NoteReplacementResult {
    const existingNote = newNotes[existingNoteIndex];

    if (existingNote.type === "Single") {
        if (newNoteType === "Single") {
            // 单键音符 + 单键音符：替换
            newNotes[existingNoteIndex] = {
                beat,
                lane,
                subBeat,
                type: "Single"
            };
            return { shouldReplace: true, newNotes, message: "替换单键音符" };
        } else if (newNoteType === "flick") {
            // 单键音符 + 滑键音符：替换为滑键样式
            newNotes[existingNoteIndex] = {
                beat,
                lane,
                subBeat,
                type: "Single",
                flick: true,
                skill: false
            };
            return { shouldReplace: true, newNotes, message: "替换为滑键样式" };
        } else if (newNoteType === "skill") {
            // 单键音符 + 技能键音符：替换为技能键样式
            newNotes[existingNoteIndex] = {
                beat,
                lane,
                subBeat,
                type: "Single",
                skill: true,
                flick: false
            };
            return { shouldReplace: true, newNotes, message: "替换为技能键样式" };
        } else if (newNoteType === "ldirectional" || newNoteType === "rdirectional") {
            // 单键音符 + 方向键：替换为方向键
            newNotes[existingNoteIndex] = {
                beat,
                lane,
                subBeat,
                type: newNoteType === "ldirectional" ? "LDirectional" : "RDirectional",
                length: 1
            };
            return { shouldReplace: true, newNotes, message: "替换为方向键" };
        }
    } else if (existingNote.type === "LDirectional" || existingNote.type === "RDirectional") {
        // 方向键 + 其他音符：根据类型处理
        if (newNoteType === "Single") {
            // 方向键 + 单键音符：替换
            newNotes[existingNoteIndex] = {
                beat,
                lane,
                subBeat,
                type: "Single"
            };
            return { shouldReplace: true, newNotes, message: "替换为单键音符" };
        } else if (newNoteType === "flick") {
            // 方向键 + 滑键音符：替换为滑键样式
            newNotes[existingNoteIndex] = {
                beat,
                lane,
                subBeat,
                type: "Single",
                flick: true,
                skill: false
            };
            return { shouldReplace: true, newNotes, message: "替换为滑键样式" };
        } else if (newNoteType === "skill") {
            // 方向键 + 技能键音符：替换为技能键样式
            newNotes[existingNoteIndex] = {
                beat,
                lane,
                subBeat,
                type: "Single",
                skill: true,
                flick: false
            };
            return { shouldReplace: true, newNotes, message: "替换为技能键样式" };
        } else if (newNoteType === "ldirectional" || newNoteType === "rdirectional") {
            // 方向键 + 方向键：组合处理
            const directionalNote = existingNote as LDirectionalNote | RDirectionalNote;
            const expectedType = newNoteType === "ldirectional" ? "LDirectional" : "RDirectional";
            if (directionalNote.type === expectedType) {
                // 同类型，组合处理（issue 35 F6：构造新对象，不得在位变异共享引用——
                // 否则结构共享历史撤销后长度不回退，且瓦片增量失效 diff 失效）
                if (directionalNote.length < 3) {
                    newNotes[existingNoteIndex] = { ...directionalNote, length: directionalNote.length + 1 };
                    return { shouldReplace: true, newNotes, message: "方向键长度+1" };
                } else {
                    newNotes[existingNoteIndex] = { ...directionalNote, length: 1 };
                    return { shouldReplace: true, newNotes, message: "方向键长度重置为1" };
                }
            } else {
                // 不同类型，覆盖处理
                newNotes[existingNoteIndex] = {
                    beat,
                    lane,
                    subBeat,
                    type: expectedType,
                    length: 1
                };
                return { shouldReplace: true, newNotes, message: "替换为不同类型方向键" };
            }
        }
    }

    return { shouldReplace: false, newNotes, message: "未知的音符类型组合" };
}

/**
 * 添加新音符
 */
function addNewNote(
    newNotes: ChartNote[],
    beat: number,
    lane: number,
    subBeat: number,
    newNoteType: string
): NoteReplacementResult {
    if (newNoteType === "Single") {
        newNotes.push({ beat, lane, subBeat, type: "Single" });
    } else if (newNoteType === "flick") {
        newNotes.push({ beat, lane, subBeat, type: "Single", flick: true });
    } else if (newNoteType === "skill") {
        newNotes.push({ beat, lane, subBeat, type: "Single", skill: true });
    } else if (newNoteType === "ldirectional") {
        newNotes.push({ beat, lane, subBeat, type: "LDirectional", length: 1 });
    } else if (newNoteType === "rdirectional") {
        newNotes.push({ beat, lane, subBeat, type: "RDirectional", length: 1 });
    }

    return { shouldReplace: true, newNotes, message: "添加新音符" };
}

export interface SlideCombinationResult {
    shouldCombine: boolean;
    newNotes: ChartNote[];
    message?: string;
}

/**
 * 滑条与滑条组合处理（两击路径，ADR-0008 §4 三轮修订 = 级联合并）
 * 用户两击确定的连接点（点击顺序不定，按 beat+subBeat 归一为链 [起, 止]）：
 * - 先按端点删除被覆盖的键型音符（滑条/长条不在此处理，由结点级接合负责）；
 * - 再经 mergeChainWithSlides **双向级联**：链头接既有滑条尾、链尾接既有滑条头，
 *   循环直至无可合并（A→B + 两击 B→C + C→D → 一步成 A→B→C→D；旧实现只并一侧）。
 * - 接合处共享点降为途径结点 hidden:false；端点同向重合（头+头/尾+尾）不合并（ADR-0001 §3 情况 3/4）。
 * - 有消耗时结果**写回首条被消耗滑条的原下标**（SlideExtendRepro 锁：瓦片失效锚定原位置）；
 *   无消耗 = false（调用方按独立新滑条放置）。
 * @param notes 当前所有音符
 * @param newSlideConnections 新滑条的连接点数组（用户点击的顺序，恰好 2 个）
 */
export function handleSlideToSlideCombination(
    notes: ChartNote[],
    newSlideConnections: Array<{ beat: number; lane: number; subBeat?: number }>
): SlideCombinationResult {
    if (newSlideConnections.length !== 2) {
        return { shouldCombine: false, newNotes: notes, message: "滑条连接点数量不正确" };
    }

    const [a, b] = newSlideConnections;
    // 点击顺序不定 → 按 §4 排序规则归一为链 [起, 止]（beat → subBeat → lane 升序）。
    // 注意：差值必须先算完再与 0 比较——旧写法 `(a.beat-b.beat) || (…) <= 0` 受运算优先级
    // 影响，beat 差非 0 时恒按点击顺序取 [a,b]，导致先点后拍（C→B）时链反序、两侧都不接合。
    const order = (a.beat - b.beat) || ((a.subBeat || 0) - (b.subBeat || 0)) || (a.lane - b.lane);
    const [start, end] = order <= 0 ? [a, b] : [b, a];

    const newNotes = [...notes];
    // 端点覆盖替换：删除与链端点重合的键型音符（与既有行为一致）
    removeOverlappedNotes(newNotes, start);
    removeOverlappedNotes(newNotes, end);

    const chain: ConnectionNote[] = [
        { beat: start.beat, lane: start.lane, subBeat: start.subBeat },
        { beat: end.beat, lane: end.lane, subBeat: end.subBeat },
    ];
    const merged = mergeChainWithSlides(newNotes, chain);
    if (merged.consumed.length === 0) {
        return { shouldCombine: false, newNotes, message: "没有找到可组合的滑条" };
    }

    // 合并结果写回首条被消耗滑条的原下标（在位替换，其余保序；结构共享不动未涉及音符）
    const consumedSet = new Set(merged.consumed);
    const anchor = Math.min(...merged.consumed);
    const result: ChartNote[] = [];
    newNotes.forEach((n, i) => {
        if (consumedSet.has(i)) {
            if (i === anchor) result.push({ type: merged.type, connections: merged.connections } as SlideNote);
            return;
        }
        result.push(n);
    });
    return {
        shouldCombine: true,
        newNotes: result,
        message: `两击接合：级联合并 ${merged.consumed.length} 条滑条`,
    };
}

/**
 * 删除被滑条覆盖的其他音符
 * @param notes 音符数组
 * @param position 滑条连接点位置
 */
export function removeOverlappedNotes(
    notes: ChartNote[],
    position: { beat: number; lane: number; subBeat?: number }
): void {
    // 只处理非滑条类型的音符，滑条类型的音符由滑条组合逻辑处理
    for (let i = notes.length - 1; i >= 0; i--) {
        const note = notes[i];

        if (note.type === "Single" || note.type === "LDirectional" || note.type === "RDirectional") {
            // 检查单键音符和方向键是否与滑条连接点位置重叠
            if (note.beat === position.beat &&
                note.lane === position.lane &&
                (note.subBeat || 0) === (position.subBeat || 0)) {
                // 删除被覆盖的音符
                notes.splice(i, 1);
            }
        }
        // 注意：不处理滑条类型的音符，让滑条组合逻辑来处理
    }
}

/**
 * 粘贴剪贴板音符组，遵守 ADR-0001 覆盖规则（修复直接 concat 导致同坐标重叠音符）
 * - 空位 → 原样粘贴（保留 flick/skill/subBeat/方向键 length 等字段）
 * - 与既有普通音符重叠 → 按放置覆盖规则处理（替换 / 方向键 length+1 / 替换为方向键，ADR §1.1）
 * - 与滑条结点重叠 → 单键忽略、滑键仅尾部加 flick、技能键两端加 skill、方向键拆条（ADR §1.2）
 * - 滑条本身 → 清理其连接点覆盖的普通音符后作为独立实体加入，不与既有滑条组合（ADR §6.3）
 * @returns newNotes 应用覆盖后的音符数组；newStartIndex 为原数组末尾下标（兼容保留）；
 *          **written = 本次粘贴实际写入/改动的下标**（按引用身份判定）。
 *          注意 written **不**等于 `[newStartIndex, newStartIndex+n)`：重叠时是就地替换/拆条，
 *          不 push、且可能多写（拆条）或少写，故不能按下标连续性假设选区。
 */
export function pasteChartNotes(
    notes: ChartNote[],
    clipboard: ChartNote[],
    anchorBeat: number,
    anchorLane: number
): { newNotes: ChartNote[]; newStartIndex: number; written: number[] } {
    const pasted = shiftGroupToAnchor(clipboard, anchorBeat, anchorLane);
    let newNotes = [...notes];
    const newStartIndex = newNotes.length;

    for (const note of pasted) {
        // 滑条/长条：独立实体粘贴（ADR §6.3 不与既有滑条组合）；按"滑条放置"语义清理其连接点覆盖的普通音符
        if (note.type === "Slide" || note.type === "Long") {
            for (const conn of (note as SlideNote).connections) {
                removeOverlappedNotes(newNotes, conn);
            }
            newNotes.push(structuredClone(note));
            continue;
        }

        // BPM/System：覆盖规则不适用；同位置直接替换，否则新增
        if (note.type === "BPM" || note.type === "System") {
            const idx = newNotes.findIndex(n => n.type === note.type && n.beat === note.beat);
            if (idx !== -1) {
                newNotes[idx] = structuredClone(note);
            } else {
                newNotes.push(structuredClone(note));
            }
            continue;
        }

        // 普通音符 / 方向键（唯一含 lane 的音符类型）：提取坐标
        const beat: number = (note as { beat: number }).beat;
        const lane: number = (note as { lane: number }).lane;
        const subBeat: number = (note as { subBeat?: number }).subBeat || 0;

        // 查找同位置既有音符（含滑条结点）
        const existingIndex = newNotes.findIndex(n => {
            if (n.type === "Single" || n.type === "LDirectional" || n.type === "RDirectional") {
                return n.beat === beat && n.lane === lane && (n.subBeat || 0) === subBeat;
            }
            if (n.type === "Slide" || n.type === "Long") {
                return (n as SlideNote).connections.some(c =>
                    c.beat === beat && c.lane === lane && (c.subBeat || 0) === subBeat
                );
            }
            return false;
        });

        if (existingIndex === -1) {
            // 空位：原样粘贴（保留 flick/skill/length 标记）
            newNotes.push(structuredClone(note));
            continue;
        }

        // 有既有音符：应用覆盖替换规则（ADR §1）
        const tool = note.type === "Single"
            ? (note.flick ? "flick" : (note.skill ? "skill" : "single"))
            : note.type.toLowerCase(); // "ldirectional" | "rdirectional"
        const result = handleNoteReplacement(newNotes, beat, lane, subBeat, tool);
        if (result.shouldReplace) newNotes = result.newNotes;

        // 方向键：覆盖/拆条产生的新方向键保持粘贴件的 length（若 >1）
        if ((note.type === "LDirectional" || note.type === "RDirectional") && note.length > 1) {
            const idx = newNotes.findIndex(n =>
                n.type === note.type && n.beat === beat && n.lane === lane && (n.subBeat || 0) === subBeat
            );
            const existing = idx !== -1 ? newNotes[idx] : null;
            if (existing && (existing.type === "LDirectional" || existing.type === "RDirectional") && existing.length === 1) {
                newNotes[idx] = { ...existing, length: note.length };
            }
        }
    }

    // 实际写入/改动的下标：新数组里引用不在原数组中的那些（新增或替换产生的新对象，含拆条产物）
    const original = new Set(notes);
    const written: number[] = [];
    newNotes.forEach((n, i) => { if (!original.has(n)) written.push(i); });
    return { newNotes, newStartIndex, written };
}

