import type { ChartNote, SlideNote, LDirectionalNote, RDirectionalNote } from '../notes/Charts';
import { slideEndpointManager } from './SlideEndpointManager';

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
 * 处理滑条音符的覆盖替换规则
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
    const connectionIndex = existingNote.connections.findIndex(conn =>
        conn.beat === beat && conn.lane === lane && (conn.subBeat || 0) === (subBeat || 0)
    );

    if (connectionIndex !== -1) {
        const connection = existingNote.connections[connectionIndex];
        const isStartPoint = connectionIndex === 0;
        const isEndPoint = connectionIndex === existingNote.connections.length - 1;
        const isPathway = !isStartPoint && !isEndPoint;

        // 根据详细设计文档的规则进行处理
        if (newNoteType === "Single") {
            // 滑条起点/途径结点/终点 + 单键音符：忽略不处理
            if (isPathway || isStartPoint) {
                return { shouldReplace: false, newNotes, message: "忽略不处理" };
            }
            // 滑条终点(flick = true) + 单键音符：替换滑键样式为endpoint样式
            if (isEndPoint && connection.flick) {
                connection.flick = false;
                return { shouldReplace: true, newNotes, message: "替换滑键样式为endpoint样式" };
            }
            // 滑条终点(skill = true) + 单键音符：替换技能键样式为endpoint样式
            if (isEndPoint && connection.skill) {
                connection.skill = false;
                return { shouldReplace: true, newNotes, message: "替换技能键样式为endpoint样式" };
            }
            return { shouldReplace: false, newNotes, message: "忽略不处理" };
        } else if (newNoteType === "flick") {
            // 滑条起点/途径结点 + 滑键音符：忽略不处理
            if (isPathway || isStartPoint) {
                return { shouldReplace: false, newNotes, message: "忽略不处理" };
            }
            // 滑条终点 + 滑键音符：替换endpoint样式为滑键样式
            if (isEndPoint) {
                connection.flick = true;
                connection.skill = false;
                return { shouldReplace: true, newNotes, message: "替换endpoint样式为滑键样式" };
            }
            return { shouldReplace: false, newNotes, message: "忽略不处理" };
        } else if (newNoteType === "skill") {
            // 滑条起点/终点 + 技能键音符：替换endpoint样式为技能键音符样式
            if (isStartPoint || isEndPoint) {
                connection.skill = true;
                connection.flick = false;
                return { shouldReplace: true, newNotes, message: "替换endpoint样式为技能键音符样式" };
            }
            // 途径结点 + 技能键音符：忽略不处理
            if (isPathway) {
                return { shouldReplace: false, newNotes, message: "忽略不处理" };
            }
            return { shouldReplace: false, newNotes, message: "忽略不处理" };
        } else if (newNoteType === "ldirectional" || newNoteType === "rdirectional") {
            // 滑条起点/途径结点/终点 + 方向键：忽略不处理
            return { shouldReplace: false, newNotes, message: "忽略不处理" };
        }
    }

    return { shouldReplace: false, newNotes, message: "未找到匹配的连接点" };
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
                // 同类型，组合处理
                if (directionalNote.length < 3) {
                    directionalNote.length += 1;
                    return { shouldReplace: true, newNotes, message: "方向键长度+1" };
                } else {
                    directionalNote.length = 1;
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

    // 更新端点管理器
    slideEndpointManager.updateEndpoints(notes);

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

    // 情况1：现有滑条终点 + 新滑条起点：将现有滑条终点转换为途径结点，合并滑条
    const existingEndPoint = slideEndpointManager.findEndPoint(newSlideStart.beat, newSlideStart.lane, newSlideStart.subBeat);
    if (existingEndPoint) {
        const slideNote = newNotes[existingEndPoint.noteIndex] as SlideNote;
        const connection = slideNote.connections[existingEndPoint.connectionIndex];

        // 将现有滑条的终点转换为途径结点
        const pathwayConnection = {
            beat: connection.beat,
            lane: connection.lane,
            subBeat: connection.subBeat,
            hidden: false
        };
        slideNote.connections[existingEndPoint.connectionIndex] = pathwayConnection;

        // 添加新滑条的终点
        slideNote.connections.push(newSlideEnd);

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

        // 将现有滑条的起点转换为途径结点
        const pathwayConnection = {
            beat: connection.beat,
            lane: connection.lane,
            subBeat: connection.subBeat,
            hidden: false
        };
        slideNote.connections[existingStartPoint.connectionIndex] = pathwayConnection;

        // 将新滑条的起点添加到现有滑条的最前面
        slideNote.connections.unshift(newSlideStart);

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
    console.log("检查位置覆盖:", position);
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
                console.log(`删除被覆盖的音符: ${note.type} at (${position.beat}, ${position.lane})`);
            }
        }
        // 注意：不处理滑条类型的音符，让滑条组合逻辑来处理
    }
}

