import type { ChartNote, SingleNote, LDirectionalNote, RDirectionalNote, SlideNote, LongNote, SystemNote, OpaqueNote, ConnectionNote, ChartSourceObject } from '../types';
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
    charge?: boolean;
    [key: string]: unknown;
}

export interface ChartCodeDirectional {
    beat: number;
    lane: number;
    type: "Directional";
    direction: string;
    width: number;
    flick?: boolean;
    skill?: boolean;
    charge?: boolean;
    [key: string]: unknown;
}

export interface ChartCodeSlideConnection {
    beat: number;
    lane: number;
    hidden?: boolean;
    flick?: boolean;
    skill?: boolean;
    charge?: boolean;
    [key: string]: unknown;
}

/**
 * 滑条 / 长条：源 `type` 保持 `"Long"` 或 `"Slide"`（ADR-0014）；画布同构。
 */
export interface ChartCodeSlide {
    type: "Slide" | "Long";
    connections: ChartCodeSlideConnection[];
    [key: string]: unknown;
}

export interface ChartCodeSystem {
    beat: number;
    type: "System";
    data?: string;
    [key: string]: unknown;
}

export type ChartCodeNote = ChartCodeBPM | ChartCodeSingle | ChartCodeDirectional | ChartCodeSlide | ChartCodeSystem | Record<string, unknown>;

type RawNote = Record<string, unknown>;

function sourceIfExtra(raw: object, known: readonly string[]): ChartSourceObject | undefined {
    const keys = Object.keys(raw);
    return keys.some(k => !known.includes(k)) ? asSource(raw) : undefined;
}

const KNOWN_BPM = ['beat', 'type', 'bpm'] as const;
const KNOWN_SINGLE = ['beat', 'lane', 'type', 'flick', 'skill', 'charge'] as const;
const KNOWN_DIR = ['beat', 'lane', 'type', 'direction', 'width', 'flick', 'skill', 'charge'] as const;
const KNOWN_SLIDE = ['type', 'connections'] as const;
const KNOWN_SYS = ['beat', 'type', 'data'] as const;
const KNOWN_CONN = ['beat', 'lane', 'hidden', 'flick', 'skill', 'charge'] as const;

function asSource(obj: object): ChartSourceObject {
    return obj as ChartSourceObject;
}

function overlaySource(source: ChartSourceObject | undefined, mapped: Record<string, unknown>): Record<string, unknown> {
    return source ? { ...source, ...mapped } : mapped;
}

function connToCode(conn: ConnectionNote): ChartCodeSlideConnection {
    const mapped: ChartCodeSlideConnection = { beat: conn.beat, lane: conn.lane };
    if (conn.hidden) mapped.hidden = true;
    if (conn.flick) mapped.flick = true;
    if (conn.skill) mapped.skill = true;
    if (conn.charge) mapped.charge = true;
    return overlaySource(conn.source, mapped) as ChartCodeSlideConnection;
}

function connFromCode(conn: ChartCodeSlideConnection): ConnectionNote {
    const n: ConnectionNote = { beat: conn.beat, lane: conn.lane };
    const src = sourceIfExtra(conn, KNOWN_CONN);
    if (src) n.source = src;
    if (conn.hidden) n.hidden = true;
    if (conn.flick) n.flick = true;
    if (conn.skill) n.skill = true;
    if (conn.charge) n.charge = true;
    return n;
}

/**
 * 将谱面音符的编辑操作转换为谱面代码
 */
export function convertNotesToChartCode(notes: ChartNote[]): ChartCodeNote[] {
    const chartCode: ChartCodeNote[] = [];

    for (const note of notes) {
        switch (note.type) {
            case "BPM":
                chartCode.push(overlaySource(note.source, {
                    beat: note.beat, type: "BPM", bpm: note.bpm,
                }) as unknown as ChartCodeBPM);
                break;
            case "Single": {
                const mapped: Record<string, unknown> = {
                    beat: note.beat, lane: note.lane, type: "Single",
                };
                if (note.flick) mapped.flick = true;
                if (note.skill) mapped.skill = true;
                if (note.charge) mapped.charge = true;
                chartCode.push(overlaySource(note.source, mapped));
                break;
            }
            case "LDirectional":
            case "RDirectional": {
                const mapped: Record<string, unknown> = {
                    beat: note.beat,
                    lane: note.lane,
                    type: "Directional",
                    direction: note.type === "LDirectional" ? "Left" : "Right",
                    width: note.length,
                };
                if (note.source && typeof note.source.direction === 'string' && note.source.direction !== 'Left') {
                    mapped.direction = note.source.direction;
                }
                if (note.flick) mapped.flick = true;
                if (note.skill) mapped.skill = true;
                if (note.charge) mapped.charge = true;
                chartCode.push(overlaySource(note.source, mapped));
                break;
            }
            case "Slide":
            case "Long": {
                const mapped: Record<string, unknown> = {
                    type: note.type,
                    connections: note.connections.map(connToCode),
                };
                chartCode.push(overlaySource(note.source, mapped));
                break;
            }
            case "System":
                chartCode.push(overlaySource(note.source, {
                    beat: note.beat, type: "System", data: note.data,
                }));
                break;
            case "Opaque":
                chartCode.push({ ...note.source });
                break;
        }
    }

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
    if (note && typeof note === 'object' && 'connections' in note) {
        const conns = (note as ChartCodeSlide).connections;
        if (Array.isArray(conns) && typeof conns[0]?.beat === 'number') return conns[0].beat;
        return 0;
    }
    const b = (note as { beat?: unknown }).beat;
    return typeof b === 'number' && Number.isFinite(b) ? b : 0;
}


/**
 * 谱面代码 → JSON 文本（**唯一的**序列化形态，issue 102 方案 A）：**每条音符一行**。
 * 弹窗显示、复制、另存为、粘贴重排都走它。
 *
 * 为什么不是缩进排版：大文本框的排版成本由**行数**主导，不是字节数（把缩进从 4 降到 2、
 * 体积小了但行数不变 —— 几乎没收益，这就是行数说了算的证据）。每条一行让行数回到音符数量级。
 *
 * 解析侧完全不受影响（JSON 不认空白），也接近 Bestdori 自己的谱面代码风格。
 * 行数预算由 `tests/perf/ChartCodeScale.test.ts` 看守（改回缩进形态会红）。
 */
export function chartCodeToCompactJSON(chartCode: ChartCodeNote[]): string {
    if (chartCode.length === 0) return '[]';
    return `[\n${chartCode.map(note => JSON.stringify(note)).join(',\n')}\n]`;
}

/**
 * 谱面代码保真（CONTEXT「谱面代码源数据」）：Apply 成功留下的**源文本** + 一个 pristine 标志。
 * 两者是一个整体 —— 只有 pristine（且仍留着源文本）时，导出才发原文，见 `chartCodeExportText`。
 *
 * 类型放 chart 域（与序列化同一 module）：工程记录继续用 `appliedChartCodeText` / `chartCodePristine`
 * 两个扁平字段，映射在编辑态边界做，不引入 `chart → project` 反向依赖。
 */
export interface ChartCodeFidelity {
    /** Apply 留下的源文本（未经画布往返的原文）；从未 Apply 过为 null */
    text: string | null;
    /** 源文本是否仍是画布的来源：任何改动画布音符的操作（含撤销 / 重做）作废它，且不还原 */
    pristine: boolean;
}

/** 未保真（新谱面 / 从未 Apply）：保真的初始值（冻结，防止被就地改写） */
export const EMPTY_CHART_CODE_FIDELITY: Readonly<ChartCodeFidelity> = Object.freeze({
    text: null,
    pristine: false,
});

/**
 * **投影文本**（画布 → 文本）：画布音符序列化成紧凑 JSON。弹窗显示、以及未保真时的导出回退都走它。
 * 仓库里 `convertNotesToChartCode` + `chartCodeToCompactJSON` 的组合只允许出现在这里（05 收口）。
 */
export function chartCodeProjectionText(notes: ChartNote[]): string {
    return chartCodeToCompactJSON(convertNotesToChartCode(notes));
}

/**
 * **导出文本**（文本 → 文件/上传）：保真 pristine 且有源文本时**原文返回**（未知字段与原始排版一并保留），
 * 否则回退画布投影。
 *
 * 口径只活在**这里**：弹窗显示的是投影，另存为（以及将来 Bestdori 上传）走本入口，
 * 未 Apply 的草稿自然发不出去（`fidelity` 缺省 = 未保真 = 投影）。
 */
export function chartCodeExportText(
    notes: ChartNote[],
    fidelity: ChartCodeFidelity | null = EMPTY_CHART_CODE_FIDELITY,
): string {
    if (fidelity?.pristine && fidelity.text != null && fidelity.text !== '') return fidelity.text;
    return chartCodeProjectionText(notes);
}

/**
 * 把一段文本重排成显示形态（每条一行）—— **只敢在"它本来就是合法谱面代码数组"时动手**。
 *
 * 用途：粘贴。外部代码多半是 4 空格缩进（5000 音符 = 30,007 行），原样落进 textarea 会让
 * 这次粘贴卡 ~200ms、并且之后每输入一个字都按那个行数付费；重排后 5,003 行 ≈ 53ms。
 * 解析失败 / 不是数组（半成品、非法代码、粘的是单个对象）→ **原样返回**，绝不擅自改写用户粘进来的东西。
 */
export function normalizeChartCodeText(text: string): string {
    const { value, errors } = parseCodeRaw(text);
    if (errors.length > 0 || !Array.isArray(value)) return text;
    return chartCodeToCompactJSON(value as ChartCodeNote[]);
}

/**
 * 将谱面代码转换回编辑器音符
 */
export function convertChartCodeToNotes(chartCode: ChartCodeNote[]): ChartNote[] {
    const notes: ChartNote[] = [];

    for (const codeNote of chartCode) {
        const raw = codeNote as RawNote;
        switch (raw.type) {
            case "BPM":
                const src = sourceIfExtra(raw, KNOWN_BPM);
                notes.push({
                    beat: (codeNote as ChartCodeBPM).beat,
                    type: "BPM",
                    bpm: (codeNote as ChartCodeBPM).bpm,
                    ...(src ? { source: src } : {}),
                });
                break;

            case "Single": {
                const c = codeNote as ChartCodeSingle;
                const singleNote: SingleNote = {
                    beat: c.beat,
                    lane: c.lane,
                    type: "Single",
                };
                const extra = sourceIfExtra(raw, KNOWN_SINGLE);
                if (extra) singleNote.source = extra;
                if (c.flick) singleNote.flick = true;
                if (c.skill) singleNote.skill = true;
                if (c.charge) singleNote.charge = true;
                notes.push(singleNote);
                break;
            }

            case "Directional": {
                const c = codeNote as ChartCodeDirectional;
                const isLeft = c.direction === "Left";
                const directionalNote: LDirectionalNote | RDirectionalNote = isLeft
                    ? { beat: c.beat, lane: c.lane, type: "LDirectional", length: c.width }
                    : { beat: c.beat, lane: c.lane, type: "RDirectional", length: c.width };
                const extra = sourceIfExtra(raw, KNOWN_DIR);
                if (extra) directionalNote.source = extra;
                else if (!isLeft) directionalNote.source = asSource(raw);
                if (c.flick) directionalNote.flick = true;
                if (c.skill) directionalNote.skill = true;
                if (c.charge) directionalNote.charge = true;
                notes.push(directionalNote);
                break;
            }

            case "Slide":
            case "Long": {
                const c = codeNote as ChartCodeSlide;
                const slide: SlideNote | LongNote = {
                    type: raw.type === "Long" ? "Long" : "Slide",
                    connections: (c.connections ?? []).map(connFromCode),
                };
                const extra = sourceIfExtra(raw, KNOWN_SLIDE);
                if (extra) slide.source = extra;
                notes.push(slide);
                break;
            }

            case "System": {
                const c = codeNote as ChartCodeSystem;
                const sys: SystemNote = {
                    type: "System",
                    beat: typeof c.beat === 'number' ? c.beat : 0,
                    data: typeof c.data === 'string' ? c.data : '',
                };
                const extra = sourceIfExtra(raw, KNOWN_SYS);
                if (extra) sys.source = extra;
                notes.push(sys);
                break;
            }

            default: {
                const beat = typeof raw.beat === 'number' && Number.isFinite(raw.beat) ? raw.beat : 0;
                const opaque: OpaqueNote = {
                    type: "Opaque",
                    sourceType: String(raw.type ?? ''),
                    beat,
                    source: asSource(raw),
                };
                notes.push(opaque);
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

/** lane 必须是有限数字（可越界，ADR-0014） */
function checkLane(
    note: RawNote, noteIndex: number, connIndex: number | undefined, label: string, errors: ValidationError[]
): void {
    if (typeof note.lane !== 'number' || !Number.isFinite(note.lane)) {
        errors.push({
            noteIndex, connIndex, field: 'lane',
            reason: t('validate.laneRange', { label, min: LANE_MIN, max: LANE_MAX }), expected: t('validate.expectedFiniteBeat'),
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
                if (typeof note.direction !== 'string') {
                    errors.push({
                        noteIndex: i, field: 'direction',
                        reason: t('validate.dirInvalid'), expected: t('validate.dirExpected'),
                    });
                }
                if (typeof note.width !== 'number' || !Number.isFinite(note.width)) {
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

            case "System":
                if (note.beat !== undefined && (typeof note.beat !== 'number' || !Number.isFinite(note.beat))) {
                    errors.push({
                        noteIndex: i, field: 'beat',
                        reason: t('validate.beatMustBeNumber', { label: 'System' }), expected: t('validate.expectedFiniteBeat'),
                    });
                }
                break;

            default:
                errors.push({
                    noteIndex: i,
                    field: 'type',
                    reason: t('validate.unknownType', { type: String(note.type) }),
                    expected: t('validate.typeExpected'),
                });
                break;
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
 * **解析原语**：文本 → 尚未定型的 JSON 值。本文件（也就全仓）**唯一一处**对谱面代码文本的 `JSON.parse`
 * —— `parseCodeText` / `normalizeChartCodeText` / 对象视图的 `coerceNoteViewCode` 都基于它。
 * 只负责 JSON 层（语法错误 → `errors`，noteIndex -1）；**结构校验不在这里**：各调用方按自己的口径做
 * （整份谱面 `validateChartCode`、对象视图片段口径 + 裸对象容错）。
 */
export interface ParseCodeRawResult {
    /** JSON.parse 的结果；语法错误时为 null。可能是数组 / 对象 / 标量，调用方自行判定 */
    value: unknown;
    /** 语法错误（文案 `validate.jsonError`）；成功时为空数组 */
    errors: ValidationError[];
}

export function parseCodeRaw(text: string): ParseCodeRawResult {
    try {
        return { value: JSON.parse(text), errors: [] };
    } catch (error) {
        return {
            value: null,
            errors: [{ noteIndex: -1, reason: t('validate.jsonError', { message: (error as Error).message }) }],
        };
    }
}

/**
 * **文本 → 已校验 code 的唯一入口**（04 票）：内部 `JSON.parse` **一次**，解析出的数组**不再丢**
 * —— 要画布音符的调用方直接把 `code` 交给 `convertChartCodeToNotes`，不必自己再 parse 一遍
 * （二次 parse 正是历史上「JSON 语法错误被误报成缺第 0 拍 BPM」的来源）。
 *
 * 结构校验照旧走 `validateChartCode`（**一次收全部错误**），由调用方决定「errors 非空即拒」。
 * 返回值是判别联合：`ok === false` 时 `code` 恒为 null，成功的 code 一定是数组，不必再校验一次。
 * **校验与转换分离**：只要错误列表的路径（弹窗 250ms 防抖）不付 `convertChartCodeToNotes` 的成本。
 */
export type ParseCodeTextResult =
    | { ok: true; code: ChartCodeNote[]; errors: ValidationError[] }
    | { ok: false; code: null; errors: ValidationError[] };

export function parseCodeText(text: string): ParseCodeTextResult {
    const raw = parseCodeRaw(text);
    if (raw.errors.length > 0) return { ok: false, code: null, errors: raw.errors };
    // 根不是数组 → validateChartCode 自己报整体级错误（`validate.mustBeArray`）
    const { errors } = validateChartCode(raw.value as ChartCodeNote[]);
    if (errors.length > 0) return { ok: false, code: null, errors };
    return { ok: true, code: raw.value as ChartCodeNote[], errors };
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
