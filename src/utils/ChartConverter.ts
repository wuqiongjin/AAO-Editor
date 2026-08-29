import type { ChartNote, SingleNote, LDirectionalNote, RDirectionalNote, SlideNote, BpmNote } from '../chart/types';

// 谱面代码类型定义
export interface ChartCodeBPM {
    beat: number;
    type: "BPM";
    bpm: number;
}

export interface ChartCodeSingle {
    beat: number;
    lane: number;
    type: "Single";
    flick?: boolean;
    skill?: boolean;
}

export interface ChartCodeDirectional {
    beat: number;
    lane: number;
    type: "Directional";
    direction: "Left" | "Right";
    width: number;
    flick?: boolean;
    skill?: boolean;
}

export interface ChartCodeSlideConnection {
    beat: number;
    lane: number;
    hidden?: boolean;
    flick?: boolean;
    skill?: boolean;
}

export interface ChartCodeSlide {
    type: "Slide";
    connections: ChartCodeSlideConnection[];
}

export type ChartCodeNote = ChartCodeBPM | ChartCodeSingle | ChartCodeDirectional | ChartCodeSlide;

/**
 * 将谱面音符的编辑操作转换为谱面代码
 */
export function convertNotesToChartCode(notes: ChartNote[]): ChartCodeNote[] {
    const chartCode: ChartCodeNote[] = [];

    for (const note of notes) {
        switch (note.type) {
            case "BPM":
                chartCode.push(convertBpmNote(note as BpmNote));
                break;
            case "Single":
                chartCode.push(convertSingleNote(note as SingleNote));
                break;
            case "LDirectional":
                chartCode.push(convertLDirectionalNote(note as LDirectionalNote));
                break;
            case "RDirectional":
                chartCode.push(convertRDirectionalNote(note as RDirectionalNote));
                break;
            case "Slide":
            case "Long":
                chartCode.push(convertSlideNote(note as SlideNote));
                break;
            case "System":
                // 系统音符暂不转换
                break;
        }
    }

    // 按节拍时间排序
    return chartCode.sort((a, b) => {
        const beatA = getBeatFromNote(a);
        const beatB = getBeatFromNote(b);
        return beatA - beatB;
    });
}

/**
 * 获取音符的节拍位置
 */
function getBeatFromNote(note: ChartCodeNote): number {
    if (note.type === "Slide") {
        return note.connections[0]?.beat || 0;
    }
    return note.beat;
}

/**
 * 转换BPM音符
 */
function convertBpmNote(note: BpmNote): ChartCodeBPM {
    return {
        beat: note.beat,
        type: "BPM",
        bpm: note.bpm
    };
}

/**
 * 转换单键音符
 */
function convertSingleNote(note: SingleNote): ChartCodeSingle {
    const result: ChartCodeSingle = {
        beat: note.beat,
        lane: note.lane,
        type: "Single"
    };

    if (note.flick) {
        result.flick = true;
    }

    if (note.skill) {
        result.skill = true;
    }

    return result;
}

/**
 * 转换左方向滑键音符
 */
function convertLDirectionalNote(note: LDirectionalNote): ChartCodeDirectional {
    const result: ChartCodeDirectional = {
        beat: note.beat,
        lane: note.lane,
        type: "Directional",
        direction: "Left",
        width: note.length
    };

    if (note.flick) {
        result.flick = true;
    }

    if (note.skill) {
        result.skill = true;
    }

    return result;
}

/**
 * 转换右方向滑键音符
 */
function convertRDirectionalNote(note: RDirectionalNote): ChartCodeDirectional {
    const result: ChartCodeDirectional = {
        beat: note.beat,
        lane: note.lane,
        type: "Directional",
        direction: "Right",
        width: note.length
    };

    if (note.flick) {
        result.flick = true;
    }

    if (note.skill) {
        result.skill = true;
    }

    return result;
}

/**
 * 转换滑条音符
 */
function convertSlideNote(note: SlideNote): ChartCodeSlide {
    const connections: ChartCodeSlideConnection[] = note.connections.map(conn => {
        const result: ChartCodeSlideConnection = {
            beat: conn.beat,
            lane: conn.lane
        };

        if (conn.hidden) {
            result.hidden = true;
        }

        if (conn.flick) {
            result.flick = true;
        }

        if (conn.skill) {
            result.skill = true;
        }

        return result;
    });

    return {
        type: "Slide",
        connections
    };
}


/**
 * 将谱面代码转换为JSON字符串
 */
export function chartCodeToJSON(chartCode: ChartCodeNote[]): string {
    return JSON.stringify(chartCode, null, 4);
}

/**
 * 从JSON字符串解析谱面代码
 */
export function parseChartCodeFromJSON(jsonString: string): ChartCodeNote[] {
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        console.error('解析谱面代码JSON失败:', error);
        return [];
    }
}

/**
 * 将谱面代码转换回编辑器音符
 */
export function convertChartCodeToNotes(chartCode: ChartCodeNote[]): ChartNote[] {
    const notes: ChartNote[] = [];

    for (const codeNote of chartCode) {
        switch (codeNote.type) {
            case "BPM":
                notes.push({
                    beat: codeNote.beat,
                    type: "BPM",
                    bpm: codeNote.bpm
                });
                break;

            case "Single":
                const singleNote: SingleNote = {
                    beat: codeNote.beat,
                    lane: codeNote.lane,
                    type: "Single"
                };
                if (codeNote.flick) {
                    singleNote.flick = true;
                }
                if (codeNote.skill) {
                    singleNote.skill = true;
                }
                notes.push(singleNote);
                break;

            case "Directional": {
                const directionalNote = codeNote.direction === "Left"
                    ? {
                        beat: codeNote.beat,
                        lane: codeNote.lane,
                        type: "LDirectional" as const,
                        length: codeNote.width
                    }
                    : {
                        beat: codeNote.beat,
                        lane: codeNote.lane,
                        type: "RDirectional" as const,
                        length: codeNote.width
                    };

                if (codeNote.flick) {
                    (directionalNote as any).flick = true;
                }
                if (codeNote.skill) {
                    (directionalNote as any).skill = true;
                }
                notes.push(directionalNote);
                break;
            }

            case "Slide": {
                const slideNote: SlideNote = {
                    type: "Slide",
                    connections: codeNote.connections.map(conn => ({
                        beat: conn.beat,
                        lane: conn.lane,
                        hidden: conn.hidden,
                        flick: conn.flick,
                        skill: conn.skill
                    }))
                };
                notes.push(slideNote);
                break;
            }
        }
    }

    return notes;
}

/**
 * 验证谱面代码格式
 */
export function validateChartCode(chartCode: ChartCodeNote[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (let i = 0; i < chartCode.length; i++) {
        const note = chartCode[i];

        // 检查必需字段
        if (!note.type) {
            errors.push(`音符 ${i}: 缺少 type 字段`);
            continue;
        }

        switch (note.type) {
            case "BPM":
                if (typeof note.beat !== 'number') {
                    errors.push(`BPM音符 ${i}: beat 必须是数字`);
                }
                if (typeof note.bpm !== 'number' || note.bpm <= 0) {
                    errors.push(`BPM音符 ${i}: bpm 必须是正数`);
                }
                break;

            case "Single":
                if (typeof note.beat !== 'number') {
                    errors.push(`单键音符 ${i}: beat 必须是数字`);
                }
                if (typeof note.lane !== 'number' || note.lane < 0 || note.lane > 6) {
                    errors.push(`单键音符 ${i}: lane 必须在 0-6 范围内`);
                }
                break;

            case "Directional":
                if (typeof note.beat !== 'number') {
                    errors.push(`方向滑键音符 ${i}: beat 必须是数字`);
                }
                if (typeof note.lane !== 'number' || note.lane < 0 || note.lane > 6) {
                    errors.push(`方向滑键音符 ${i}: lane 必须在 0-6 范围内`);
                }
                if (!['Left', 'Right'].includes(note.direction)) {
                    errors.push(`方向滑键音符 ${i}: direction 必须是 Left 或 Right`);
                }
                if (typeof note.width !== 'number' || note.width < 1 || note.width > 3) {
                    errors.push(`方向滑键音符 ${i}: width 必须在 1-3 范围内`);
                }
                break;

            case "Slide":
                if (!Array.isArray(note.connections) || note.connections.length < 2) {
                    errors.push(`滑条音符 ${i}: connections 必须是至少包含2个元素的数组`);
                } else {
                    note.connections.forEach((conn, connIndex) => {
                        if (typeof conn.beat !== 'number') {
                            errors.push(`滑条音符 ${i} 连接点 ${connIndex}: beat 必须是数字`);
                        }
                        if (typeof conn.lane !== 'number' || conn.lane < 0 || conn.lane > 6) {
                            errors.push(`滑条音符 ${i} 连接点 ${connIndex}: lane 必须在 0-6 范围内`);
                        }
                    });
                }
                break;

            default:
                errors.push(`音符 ${i}: 未知的 type "${(note as any).type}"`);
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * 谱面代码是否包含第 0 拍的 BPM 音符（ADR-0001 谱面必须有初始 BPM）。
 * 保底语义的唯一权威判定：空/未指定初始 BPM 的代码应回到默认 120bpm 状态。
 */
export function hasBeat0Bpm(chartCode: ChartCodeNote[]): boolean {
    return chartCode.some(note => note.type === 'BPM' && note.beat === 0);
}
