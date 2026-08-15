import type { ChartNote, SlideNote, LDirectionalNote, RDirectionalNote } from '../notes/Charts';
import { slideEndpointManager } from './SlideEndpointManager';
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
function connectionToNote(conn: SlideNote["connections"][number]): ChartNote {
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
export { connectionToNote };

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

/**
 * 滑条与滑条组合处理
 * 根据NOTE_REPLACEMENT_TEST.md中的规则实现
 */
export interface SlideCombinationResult {
    shouldCombine: boolean;
    newNotes: ChartNote[];
    message?: string;
}

/**
 * 处理滑条与滑条的组合
 * @param notes 当前所有音符
 * @param newSlideConnections 新滑条的连接点数组（用户点击的顺序）
 * @returns 组合结果
 */
export function handleSlideToSlideCombination(
    notes: ChartNote[],
    newSlideConnections: Array<{ beat: number; lane: number; subBeat?: number }>
): SlideCombinationResult {
    if (newSlideConnections.length !== 2) {
        return { shouldCombine: false, newNotes: notes, message: "滑条连接点数量不正确" };
    }

    // 首先判断新滑条的起点和终点（起点beat值一定小于终点）
    const [firstClick, secondClick] = newSlideConnections;
    let newSlideStart: { beat: number; lane: number; subBeat?: number };
    let newSlideEnd: { beat: number; lane: number; subBeat?: number };

    if (firstClick.beat < secondClick.beat) {
        // 第一次点击的beat值更小，是起点
        newSlideStart = firstClick;
        newSlideEnd = secondClick;
    } else if (firstClick.beat > secondClick.beat) {
        // 第二次点击的beat值更小，是起点
        newSlideStart = secondClick;
        newSlideEnd = firstClick;
    } else {
        // beat值相同，比较subBeat
        const firstSubBeat = firstClick.subBeat || 0;
        const secondSubBeat = secondClick.subBeat || 0;
        if (firstSubBeat < secondSubBeat) {
            newSlideStart = firstClick;
            newSlideEnd = secondClick;
        } else {
            newSlideStart = secondClick;
            newSlideEnd = firstClick;
        }
    }

    const newNotes = [...notes];

    // 先处理音符覆盖替换：删除被滑条端点覆盖的其他音符
    removeOverlappedNotes(newNotes, newSlideStart);
    removeOverlappedNotes(newNotes, newSlideEnd);

    // 更新端点管理器（issue 36：必须在 removeOverlappedNotes 之后——splice 会移位后续音符下标，
    // 用旧数组下标定位滑条会合并错目标（改到别的音符）甚至对非滑条取 connections 直接崩溃）
    slideEndpointManager.updateEndpoints(newNotes);

    // 情况1：现有滑条终点 + 新滑条起点：将现有滑条终点转换为途径结点，合并滑条
    const existingEndPoint = slideEndpointManager.findEndPoint(newSlideStart.beat, newSlideStart.lane, newSlideStart.subBeat);
    if (existingEndPoint) {
        const slideNote = newNotes[existingEndPoint.noteIndex] as SlideNote;
        const connection = slideNote.connections[existingEndPoint.connectionIndex];

        // 将现有滑条的终点转换为途径结点（issue 35 F6：不可变构造，不得在位变异共享数组）
        const pathwayConnection = {
            beat: connection.beat,
            lane: connection.lane,
            subBeat: connection.subBeat,
            hidden: false
        };
        const updatedConnections = slideNote.connections.map((c, i) =>
            i === existingEndPoint.connectionIndex ? pathwayConnection : c
        );
        // 添加新滑条的终点
        updatedConnections.push(newSlideEnd);
        newNotes[existingEndPoint.noteIndex] = { ...slideNote, connections: updatedConnections };

        return {
            shouldCombine: true,
            newNotes,
            message: "现有滑条终点 + 新滑条起点：合并滑条"
        };
    }

    // 情况2：现有滑条起点 + 新滑条终点：将现有滑条起点转换为途径结点，合并滑条
    const existingStartPoint = slideEndpointManager.findStartPoint(newSlideEnd.beat, newSlideEnd.lane, newSlideEnd.subBeat);
    //打印找到的起点坐标
    if (existingStartPoint) {
        const slideNote = newNotes[existingStartPoint.noteIndex] as SlideNote;
        const connection = slideNote.connections[existingStartPoint.connectionIndex];

        // 将现有滑条的起点转换为途径结点（issue 35 F6：不可变构造，不得在位变异共享数组）
        const pathwayConnection = {
            beat: connection.beat,
            lane: connection.lane,
            subBeat: connection.subBeat,
            hidden: false
        };
        const updatedConnections = slideNote.connections.map((c, i) =>
            i === existingStartPoint.connectionIndex ? pathwayConnection : c
        );
        // 将新滑条的起点添加到现有滑条的最前面
        updatedConnections.unshift(newSlideStart);
        newNotes[existingStartPoint.noteIndex] = { ...slideNote, connections: updatedConnections };

        return {
            shouldCombine: true,
            newNotes,
            message: "现有滑条起点 + 新滑条终点：合并滑条"
        };
    }

    // 情况3：现有滑条终点 + 新滑条终点：忽略不处理，认为这是2个独立的滑条
    const existingEndPoint2 = slideEndpointManager.findEndPoint(newSlideEnd.beat, newSlideEnd.lane, newSlideEnd.subBeat);
    if (existingEndPoint2) {
        return {
            shouldCombine: false,
            newNotes,
            message: "现有滑条终点 + 新滑条终点：忽略不处理"
        };
    }

    // 情况4：现有滑条起点 + 新滑条起点：忽略不处理，认为这是2个独立的滑条
    const existingStartPoint2 = slideEndpointManager.findStartPoint(newSlideStart.beat, newSlideStart.lane, newSlideStart.subBeat);
    if (existingStartPoint2) {
        return {
            shouldCombine: false,
            newNotes,
            message: "现有滑条起点 + 新滑条起点：忽略不处理"
        };
    }

    return { shouldCombine: false, newNotes, message: "没有找到可组合的滑条" };
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
 * @returns newNotes 应用覆盖后的音符数组；newStartIndex 为原数组末尾下标（粘贴内容起始，供选中）
 */
export function pasteChartNotes(
    notes: ChartNote[],
    clipboard: ChartNote[],
    anchorBeat: number,
    anchorLane: number
): { newNotes: ChartNote[]; newStartIndex: number } {
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

    return { newNotes, newStartIndex };
}

