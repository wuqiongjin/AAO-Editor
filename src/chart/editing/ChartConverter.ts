import type { ChartNote, SingleNote, LDirectionalNote, RDirectionalNote, SlideNote, BpmNote } from '../types';
import { t } from '../../i18n';

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

    // 按节拍时间排序。**稳定排序**（ADR-0010 结论 9）：同 beat 保持输入顺序，
    // 否则「导入 → 导出」会凭空产生 diff（同拍多条 BPM 换位）。
    // 显式带下标兜底，不依赖引擎 Array#sort 的稳定性实现。
    return chartCode
        .map((note, index) => ({ note, index }))
        .sort((a, b) => {
            const diff = getBeatFromNote(a.note) - getBeatFromNote(b.note);
            return diff !== 0 ? diff : a.index - b.index;
        })
        .map(entry => entry.note);
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
 * 校验作用域（issue 103）。默认 = **整份谱面**（导入 / 应用 / 完整代码视图）。
 * `fragment` = 单音符 / 滑条结点 / 子段三类**对象视图**：弹窗里只看得到这一小段代码，
 * 依赖整份谱面上下文的规则会误判（详见 `checkBackflowBoundaries`）。
 */
export interface ValidateChartCodeOptions {
    fragment?: boolean;
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
            reason: t('validate.beatMustBeNumber', { label }), expected: t('validate.expectedFiniteBeat'),
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
            reason: t('validate.laneRange', { label, min: LANE_MIN, max: LANE_MAX }), expected: `${LANE_MIN}-${LANE_MAX}`,
        });
    }
}

/** 非滑条类型不得残留 connections（字段集必须与 type 匹配，issue 59 §1.2） */
function checkNoConnections(note: RawNote, noteIndex: number, label: string, errors: ValidationError[]): void {
    if (note.connections !== undefined) {
        errors.push({
            noteIndex, field: 'connections',
            reason: t('validate.noConnections', { label }),
            expected: t('validate.noConnectionsExpected'),
        });
    }
}

/**
 * 倒流区边界（ADR-0010 结论 7，比 Bestdori 严的两条）——这两条都依赖**整份谱面**上下文：
 * ① `beat 0` 处的 BPM 不得为负（会让全谱秒坐标 ≤ 0，无意义输入）；
 * ② 最后一条 BPM 事件必须为正（谱面以负 BPM 收尾会让制谱器内存溢出崩溃）。
 * 「最后一条」= 按 beat 稳定排序后的最后一条（同 beat 取数组序最后一条），与导出排序同口径。
 * `fragment`（对象视图）跳过②：视图里任何一条 BPM 都"看起来是末条"，
 * 会把「把中途某条 BPM 改成负值」误判成末条负值（ADR-0010 结论 8 要求编辑器内能创建负值）。
 * ①在片段里照样成立——beat 0 就是 beat 0。
 */
function checkBackflowBoundaries(
    chartCode: ChartCodeNote[], errors: ValidationError[], fragment: boolean,
): void {
    // 与逐条检查同口径：这里看到的也可能是脏对象（JSON.parse 来的），一律按 RawNote 读
    const at = (i: number): RawNote => chartCode[i] as unknown as RawNote;
    const bpmIndices: number[] = [];
    for (let i = 0; i < chartCode.length; i++) {
        const raw: unknown = chartCode[i];
        if (raw !== null && typeof raw === 'object' && (raw as RawNote).type === 'BPM') bpmIndices.push(i);
    }
    if (bpmIndices.length === 0) return;

    // 只对"本身合法的数值"判边界：0 / 非有限数 / 非数字已由逐条检查报过，不重复报
    const isNegNumber = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v < 0;

    // ②不再报①已报过的同一条：全谱只有一条 BPM 且它在 beat 0 为负时，"beat 0 负值"已经
    // 说清了毛病（同一条音符列两条同源错误＝噪音），此时跳过②。
    const beatZeroFlagged = new Set<number>();
    for (const i of bpmIndices) {
        const note = at(i);
        if (note.beat === 0 && isNegNumber(note.bpm)) {
            beatZeroFlagged.add(i);
            errors.push({
                noteIndex: i, field: 'bpm',
                reason: t('validate.bpm0Negative'),
                expected: '> 0',
            });
        }
    }
    if (fragment) return;

    // beat 非法的条目已在逐条检查里报过，这里不再追加边界错误
    const beatOf = (i: number): unknown => at(i).beat;
    const usable = bpmIndices.filter(i => typeof beatOf(i) === 'number' && Number.isFinite(beatOf(i)));
    if (usable.length === 0) return;
    let last = usable[0]!;
    for (const i of usable) {
        if ((beatOf(i) as number) >= (beatOf(last) as number)) last = i;
    }
    const lastBpm = at(last).bpm;
    if (isNegNumber(lastBpm) && !beatZeroFlagged.has(last)) {
        errors.push({
            noteIndex: last, field: 'bpm',
            reason: t('validate.lastBpmNegative'),
            expected: t('validate.lastBpmExpected'),
        });
    }
}

/**
 * 验证谱面代码格式（issue 59 §1）：**一次收集全部错误**，不首条即停。
 * 口径：只拦"无意义 / 无法解释"的输入（类型缺字段、beat / lane 非法、BPM 非法等），
 * 由调用方决定"整份拒"（导入 / 应用）。**滑条可见结点不足（< 2）与首尾 hidden 不在此拦**——
 * issue 106 定案：这类外部数据按实机口径处置（画布 `displaySlide` 投影掐首尾 hidden；
 * 可见 1 个 → 按单键形态显示；可见 0 个 → 画布上没有任何效果），数据原样保留。
 *
 * BPM 边界（ADR-0010 结论 7，issue 103）：`bpm < 0` **放行**（倒流区是一等语义）；
 * 仍拒 `0`（含 `-0`）与非有限数；另加两条整份谱面级规则，见 `checkBackflowBoundaries`。
 */
export function validateChartCode(
    chartCode: ChartCodeNote[],
    options: ValidateChartCodeOptions = {},
): ValidationResult {
    const errors: ValidationError[] = [];

    // 整体级：连数组都不是（外部粘来的脏代码）
    if (!Array.isArray(chartCode)) {
        return {
            valid: false,
            errors: [{ noteIndex: -1, reason: t('validate.mustBeArray'), expected: t('validate.mustBeArrayExpected') }],
        };
    }

    for (let i = 0; i < chartCode.length; i++) {
        const raw: unknown = chartCode[i];

        // 检查必需字段
        if (raw === null || typeof raw !== 'object') {
            errors.push({ noteIndex: i, reason: t('validate.noteMustBeObject'), expected: t('validate.noteMustBeObjectExpected') });
            continue;
        }
        const note = raw as RawNote;
        if (!note.type) {
            errors.push({ noteIndex: i, field: 'type', reason: t('validate.missingType'), expected: t('validate.typeExpected') });
            continue;
        }

        switch (note.type) {
            case "BPM":
                checkBeat(note, i, undefined, t('validate.label.bpm'), errors);
                if (typeof note.bpm !== 'number' || !Number.isFinite(note.bpm)) {
                    errors.push({
                        noteIndex: i, field: 'bpm',
                        reason: t('validate.bpmNotFinite'),
                        expected: t('validate.bpmExpected'),
                    });
                } else if (note.bpm === 0) {
                    errors.push({
                        noteIndex: i, field: 'bpm',
                        reason: t('validate.bpmNotZero'),
                        expected: t('validate.bpmExpected'),
                    });
                }
                break;

            case "Single":
                checkBeat(note, i, undefined, t('validate.label.single'), errors);
                checkLane(note, i, undefined, t('validate.label.single'), errors);
                checkNoConnections(note, i, t('validate.label.single'), errors);
                break;

            case "Directional":
                checkBeat(note, i, undefined, t('validate.label.directional'), errors);
                checkLane(note, i, undefined, t('validate.label.directional'), errors);
                if (typeof note.direction !== 'string' || !['Left', 'Right'].includes(note.direction)) {
                    errors.push({
                        noteIndex: i, field: 'direction',
                        reason: t('validate.dirInvalid'), expected: t('validate.dirExpected'),
                    });
                }
                if (typeof note.width !== 'number' || note.width < 1 || note.width > 3) {
                    errors.push({
                        noteIndex: i, field: 'width',
                        reason: t('validate.widthRange'), expected: t('validate.widthExpected'),
                    });
                }
                checkNoConnections(note, i, t('validate.label.directional'), errors);
                break;

            // Slide / Long 同构（Bestdori 一等类型，同一套规则）
            case "Slide":
            case "Long": {
                const label = note.type === "Long" ? t('validate.label.long') : t('validate.label.slide');
                const conns = note.connections;
                if (!Array.isArray(conns)) {
                    errors.push({
                        noteIndex: i, field: 'connections',
                        reason: t('validate.connectionsArray', { label }), expected: t('validate.connectionsExpected'),
                    });
                    break;
                }
                conns.forEach((conn: RawNote, connIndex: number) => {
                    checkBeat(conn, i, connIndex, t('validate.label.node', { label }), errors);
                    checkLane(conn, i, connIndex, t('validate.label.node', { label }), errors);
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
                    reason: t('validate.unknownType', { type: String(note.type) }), expected: t('validate.typeExpected'),
                });
        }
    }

    // 整份谱面级的倒流区边界（放行负 BPM 之后才可能触发；见 checkBackflowBoundaries）
    checkBackflowBoundaries(chartCode, errors, options.fragment === true);

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
            errors: [{ noteIndex: -1, reason: t('validate.jsonError', { message: (error as Error).message }) }],
        };
    }
    return validateChartCode(parsed as ChartCodeNote[]);
}

/**
 * 把一条校验错误渲染成带定位路径的单行文案（供 UI 列表展示，纯函数可单测）。
 * 形如「音符 3 › 结点 0 · lane：滑条结点 lane 必须在 0-6 范围内（期望：0-6）」。
 */
export function formatValidationError(error: ValidationError): string {
    const path = error.noteIndex >= 0 ? t('validate.formatNote', { index: error.noteIndex }) : t('validate.formatChart');
    const conn = error.connIndex !== undefined ? t('validate.formatConn', { index: error.connIndex }) : '';
    const field = error.field ? t('validate.formatField', { field: error.field }) : '';
    const expected = error.expected ? t('validate.formatExpected', { expected: error.expected }) : '';
    return t('validate.formatLine', { path, conn, field, reason: error.reason, expected });
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
