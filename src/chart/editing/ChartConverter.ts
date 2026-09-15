import type { ChartNote, SingleNote, LDirectionalNote, RDirectionalNote, SlideNote, BpmNote } from '../types';

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

/**
 * 滑条 / 长条：`"Long"` 是 `"Slide"` 的**别名**（同一结构、同一处理），不是独立类型。
 * 依据：Bestdori 侧两者同构同 handler（vendored `lib/src/bestdori/index.ts` 的 BestdoriLongNote，
 * `convert.ts` 的 `Long: longAndSlide / Slide: longAndSlide`）；本编辑器侧 `src/chart/types.ts`
 * 亦注明 SlideNote 与 LongNote 结构完全等价、画布全程并列处理。
 * 故：代码里写 `"Long"` 合法，校验与解析都按 Slide 走，归一为内部 SlideNote；
 * 序列化方向不变（内部长条也写 `"Slide"`），往返稳定、不产生不对称。
 */
export interface ChartCodeSlide {
    type: "Slide" | "Long";
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
    // Slide / Long 同构（"Long" 是 "Slide" 的别名），都用首结点定位
    if ('connections' in note) {
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

            // "Long" 是 "Slide" 的别名：归一为内部 SlideNote（与序列化方向一致）
            case "Slide":
            case "Long": {
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

/** 轨道取值范围（lane 共 7 道） */
const LANE_MIN = 0;
const LANE_MAX = 6;

/**
 * 单条校验错误（issue 59 §1.1）：带**定位路径**，UI 一次列完。
 * - noteIndex：出错音符在谱面代码数组中的下标；整体级错误（非某条音符）用 -1。
 * - connIndex：滑条结点下标（仅滑条内部错误）。
 */
export interface ValidationError {
    noteIndex: number;
    connIndex?: number;
    field?: string;
    reason: string;
    expected?: string;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

/**
 * 校验期把音符当作"未知结构的原始对象"看：谱面代码来自 JSON.parse，
 * 可能是任何东西（含脏字段），不能假设它符合 ChartCodeNote。
 */
type RawNote = Record<string, unknown>;

/** beat 必须是有限数字 */
function checkBeat(
    note: RawNote, noteIndex: number, connIndex: number | undefined, label: string, errors: ValidationError[]
): void {
    if (typeof note.beat !== 'number' || !Number.isFinite(note.beat)) {
        errors.push({
            noteIndex, connIndex, field: 'beat',
            reason: `${label} beat 必须是数字`, expected: '有限数字（如 4 或 4.5）',
        });
    }
}

/** lane 必须在 0-6 */
function checkLane(
    note: RawNote, noteIndex: number, connIndex: number | undefined, label: string, errors: ValidationError[]
): void {
    if (typeof note.lane !== 'number' || !Number.isFinite(note.lane) || note.lane < LANE_MIN || note.lane > LANE_MAX) {
        errors.push({
            noteIndex, connIndex, field: 'lane',
            reason: `${label} lane 必须在 ${LANE_MIN}-${LANE_MAX} 范围内`, expected: `${LANE_MIN}-${LANE_MAX}`,
        });
    }
}

/** 非滑条类型不得残留 connections（字段集必须与 type 匹配，issue 59 §1.2） */
function checkNoConnections(note: RawNote, noteIndex: number, label: string, errors: ValidationError[]): void {
    if (note.connections !== undefined) {
        errors.push({
            noteIndex, field: 'connections',
            reason: `${label} 不得残留 connections 字段`,
            expected: '删除 connections（它只属于 type:"Slide"）',
        });
    }
}

/**
 * 验证谱面代码格式（issue 59 §1）：**一次收集全部错误**，不首条即停。
 * 口径：只拦"无意义 / 无法解释"的输入（类型缺字段、beat / lane 非法、BPM 非法等），
 * 由调用方决定"整份拒"（导入 / 应用）。**滑条可见结点不足（< 2）与首尾 hidden 不在此拦**——
 * issue 106 定案：这类外部数据按实机口径处置（画布 `displaySlide` 投影掐首尾 hidden；
 * 可见 1 个 → 按单键形态显示；可见 0 个 → 画布上没有任何效果），数据原样保留。
 */
export function validateChartCode(chartCode: ChartCodeNote[]): ValidationResult {
    const errors: ValidationError[] = [];

    // 整体级：连数组都不是（外部粘来的脏代码）
    if (!Array.isArray(chartCode)) {
        return {
            valid: false,
            errors: [{ noteIndex: -1, reason: '谱面代码必须是数组', expected: '[{ … }, …]' }],
        };
    }

    for (let i = 0; i < chartCode.length; i++) {
        const raw: unknown = chartCode[i];

        // 检查必需字段
        if (raw === null || typeof raw !== 'object') {
            errors.push({ noteIndex: i, reason: '音符必须是对象', expected: '{ "type": … }' });
            continue;
        }
        const note = raw as RawNote;
        if (!note.type) {
            errors.push({ noteIndex: i, field: 'type', reason: '缺少 type 字段', expected: 'BPM / Single / Directional / Slide / Long' });
            continue;
        }

        switch (note.type) {
            case "BPM":
                checkBeat(note, i, undefined, 'BPM音符', errors);
                if (typeof note.bpm !== 'number' || !Number.isFinite(note.bpm) || note.bpm <= 0) {
                    errors.push({ noteIndex: i, field: 'bpm', reason: 'BPM音符 bpm 必须是正数', expected: '> 0' });
                }
                break;

            case "Single":
                checkBeat(note, i, undefined, '单键音符', errors);
                checkLane(note, i, undefined, '单键音符', errors);
                checkNoConnections(note, i, '单键音符', errors);
                break;

            case "Directional":
                checkBeat(note, i, undefined, '方向滑键音符', errors);
                checkLane(note, i, undefined, '方向滑键音符', errors);
                if (typeof note.direction !== 'string' || !['Left', 'Right'].includes(note.direction)) {
                    errors.push({
                        noteIndex: i, field: 'direction',
                        reason: '方向滑键音符 direction 必须是 Left 或 Right', expected: 'Left / Right',
                    });
                }
                if (typeof note.width !== 'number' || note.width < 1 || note.width > 3) {
                    errors.push({
                        noteIndex: i, field: 'width',
                        reason: '方向滑键音符 width 必须在 1-3 范围内', expected: '1-3',
                    });
                }
                checkNoConnections(note, i, '方向滑键音符', errors);
                break;

            // Slide / Long 同构（Bestdori 一等类型，同一套规则）
            case "Slide":
            case "Long": {
                const label = note.type === "Long" ? '长条音符' : '滑条音符';
                const conns = note.connections;
                if (!Array.isArray(conns)) {
                    errors.push({
                        noteIndex: i, field: 'connections',
                        reason: `${label} connections 必须是数组`, expected: '[{ beat, lane }, …]',
                    });
                    break;
                }
                conns.forEach((conn: RawNote, connIndex: number) => {
                    checkBeat(conn, i, connIndex, `${label}结点`, errors);
                    checkLane(conn, i, connIndex, `${label}结点`, errors);
                });
                // issue 106 定案：**可见结点不足 / 首尾 hidden 不再拒收**——外部数据按实机口径处置：
                // 画布显示投影掐掉首尾 hidden（数据原样保留）、可见 1 个 → 按单键形态显示、
                // 可见 0 个 → 画布上没有任何效果（实机也不会把它从代码里删掉）。
                // 我们自己仍产不出这种数据（删结点转 hidden / 拆条 / 组合 / 烘焙 / 画笔均保可见 ≥2）。
                break;
            }

            default:
                errors.push({
                    noteIndex: i, field: 'type',
                    reason: `未知的 type "${String(note.type)}"`, expected: 'BPM / Single / Directional / Slide / Long',
                });
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * 从文本直接校验（JSON 解析 + 规则校验），**不吞异常**：
 * `parseChartCodeFromJSON` 遇到语法错误会返回 `[]`，空数组天然"零错误"，
 * 会让真正的 JSON 语法错误被后续判定误报成"缺少第 0 拍 BPM"。文本校验必须走这里。
 */
export function validateChartCodeJSON(text: string): ValidationResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        return {
            valid: false,
            errors: [{ noteIndex: -1, reason: 'JSON格式错误: ' + (error as Error).message }],
        };
    }
    return validateChartCode(parsed as ChartCodeNote[]);
}

/**
 * 把一条校验错误渲染成带定位路径的单行文案（供 UI 列表展示，纯函数可单测）。
 * 形如「音符 3 › 结点 0 · lane：滑条结点 lane 必须在 0-6 范围内（期望：0-6）」。
 */
export function formatValidationError(error: ValidationError): string {
    const path = error.noteIndex >= 0 ? `音符 ${error.noteIndex}` : '谱面代码';
    const conn = error.connIndex !== undefined ? ` › 结点 ${error.connIndex}` : '';
    const field = error.field ? ` · ${error.field}` : '';
    const expected = error.expected ? `（期望：${error.expected}）` : '';
    return `${path}${conn}${field}：${error.reason}${expected}`;
}

/**
 * 谱面代码是否包含第 0 拍的 BPM 音符（ADR-0001 谱面必须有初始 BPM）。
 * 保底语义的唯一权威判定：空/未指定初始 BPM 的代码应回到默认 120bpm 状态。
 */
export function hasBeat0Bpm(chartCode: ChartCodeNote[]): boolean {
    return chartCode.some(note => note.type === 'BPM' && note.beat === 0);
}

/**
 * 同一保底语义的另一侧判定：直接看内部音符数组（不经代码序列化）。
 * 单音符 / 结点回写等"局部编辑"路径用它守住"不因局部编辑而失去第 0 拍 BPM"。
 */
export function hasBeat0BpmNote(notes: readonly ChartNote[]): boolean {
    return notes.some(note => note.type === 'BPM' && note.beat === 0);
}
