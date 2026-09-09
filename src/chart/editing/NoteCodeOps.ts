// 单音符 / 滑条结点的「对象视图」纯函数层（issue 59 §4 初值 + §5 回写）。
// 完整谱面代码与对象视图共用同一套校验规则（§1.2），故规则本身不在此重造，只做「初值投影 / 回写落点」。
//
// §4 三种初值：
//   - 整条音符（note）      → 权威格式（滑条/长条 = {"type":"Slide","connections":[…]}，不展开）
//   - 滑条结点（slideNode） → 独立形态投影 {"beat","lane","type":"Single", hidden?, flick?, skill?}
//   - 滑条区域（slideRegion）→ 不支持，调用方在入口处回退成整条
// §5 回写：
//   - 整条：恰好 1 条 + 合法 + 字段集与 type 匹配 → 替换原 noteIndex（整条 Slide 改写成合法 Single 亦属合法编辑）
//   - 结点：只接受 type:"Single" → 写回该 connection 的 beat/lane/flick/skill/hidden
//   - 非法一律报错 + 不回写，不静默修正、不静默忽略
import type { ChartNote, ConnectionNote } from '../types';
import { isSlide } from './SelectionEditing';
import {
    convertNotesToChartCode, convertChartCodeToNotes, validateChartCode, hasBeat0BpmNote,
    type ChartCodeNote, type ChartCodeSingle, type ValidationError,
} from './ChartConverter';

/** 对象视图的目标：整条音符（connIndex 缺省）或滑条结点 */
export interface NoteCodeTarget {
    noteIndex: number;
    /** 滑条结点下标；undefined = 整条音符 */
    connIndex?: number;
}

/**
 * 结点投影形态：type 恒 "Single" —— connection 上没有 direction / width，
 * 端点不可能被投影成 Directional（§4 投影规则：如实映射，不按位置臆断）。
 * hidden 只在中间结点出现（首尾结点按 §1.2 本就不得 hidden）。
 */
export type ChartCodeNodeProjection = ChartCodeSingle & { hidden?: boolean };

export type NoteCodeApplyResult =
    | { ok: true; notes: ChartNote[] }
    | { ok: false; errors: ValidationError[] };

const fail = (error: ValidationError): NoteCodeApplyResult => ({ ok: false, errors: [error] });

/**
 * 初值构造（§4）。目标不存在 / 不可投影（System、结点下标越界、非滑条却给了结点下标）→ null。
 */
export function buildNoteCode(notes: readonly ChartNote[], target: NoteCodeTarget): ChartCodeNote[] | null {
    const note = notes[target.noteIndex];
    if (!note) return null;

    if (target.connIndex !== undefined) {
        if (!isSlide(note)) return null;
        const conn = note.connections[target.connIndex];
        if (!conn) return null;
        const projection: ChartCodeNodeProjection = { beat: conn.beat, lane: conn.lane, type: 'Single' };
        if (conn.hidden) projection.hidden = true;
        if (conn.flick) projection.flick = true;
        if (conn.skill) projection.skill = true;
        return [projection];
    }

    // 整条：走权威序列化（System 不产生代码 → 空数组 = 无对象视图）
    const code = convertNotesToChartCode([note]);
    return code.length === 1 ? code : null;
}

/**
 * 回写（§5）。非法 → { ok:false, errors }，调用方据此「报错 + 不回写」。
 * 错误的 `noteIndex` 一律用**谱面内**的真实下标（§1.1 的定位语义），不是对象视图里的局部下标 0。
 * @param code 用户在对象视图里编辑后的代码（应恰好 1 条；条数不对也按错误返回）
 */
export function applyNoteCode(
    notes: readonly ChartNote[],
    target: NoteCodeTarget,
    code: ChartCodeNote[],
): NoteCodeApplyResult {
    const note = notes[target.noteIndex];
    if (!note) {
        return fail({ noteIndex: target.noteIndex, reason: '目标音符已不存在（谱面可能已被改动）' });
    }

    if (target.connIndex !== undefined) {
        if (!isSlide(note)) {
            return fail({ noteIndex: target.noteIndex, reason: '该音符不是滑条/长条，没有结点可回写' });
        }
        const conn = note.connections[target.connIndex];
        if (!conn) {
            return fail({ noteIndex: target.noteIndex, connIndex: target.connIndex, reason: '目标结点已不存在' });
        }
        if (code.length !== 1) {
            return fail({
                noteIndex: -1,
                reason: `结点视图只接受恰好 1 条音符（当前 ${code.length} 条）`,
                expected: '1 条 {"type":"Single", …}',
            });
        }
        // 规则与完整代码视图同源（§1.2）：脏代码同样被拒。
        // 校验按"对象视图里的 1 条代码"定位（noteIndex 0），此处抬升为谱面内的真实下标，避免 UI 报"音符 0"。
        const { errors } = validateChartCode(code);
        if (errors.length > 0) {
            return {
                ok: false,
                errors: errors.map(e => ({
                    ...e,
                    noteIndex: e.noteIndex >= 0 ? target.noteIndex : e.noteIndex,
                    connIndex: target.connIndex,
                })),
            };
        }
        // 按投影形态读（校验只保证它是 Single，hidden 是投影形态的扩展字段）
        const c = code[0] as ChartCodeNodeProjection;
        if (c.type !== 'Single') {
            return fail({
                noteIndex: target.noteIndex, connIndex: target.connIndex, field: 'type',
                reason: `结点视图只接受 type:"Single"（当前 "${c.type}"）`,
                expected: 'Single',
            });
        }
        // §1.2「首尾 connection 不得 hidden」在**单条投影**上无从判定（独立的 Single 看不出自己是端点），
        // 必须在此显式补判——否则用户可在首/尾结点写上 hidden:true，回写后整份谱面被完整视图判非法。
        const isEnd = target.connIndex === 0 || target.connIndex === note.connections.length - 1;
        if (isEnd && c.hidden === true) {
            return fail({
                noteIndex: target.noteIndex, connIndex: target.connIndex, field: 'hidden',
                reason: '滑条首/尾结点不得 hidden: true',
                expected: '省略 hidden 或 false',
            });
        }
        // 只写 beat/lane/flick/skill/hidden；subBeat 代码侧无从表达，保留原值（不静默改位置）
        const next: ConnectionNote = {
            ...conn,
            beat: c.beat,
            lane: c.lane,
            hidden: c.hidden,
            flick: c.flick,
            skill: c.skill,
        };
        const connections = note.connections.map((x, i) => (i === target.connIndex ? next : x));
        return { ok: true, notes: notes.map((n, i) => (i === target.noteIndex ? { ...note, connections } : n)) };
    }

    // 整条音符：恰好 1 条 + 合法 + 字段集与 type 匹配（校验已覆盖）
    if (code.length !== 1) {
        return fail({
            noteIndex: -1,
            reason: `音符视图只接受恰好 1 条音符（当前 ${code.length} 条）`,
            expected: '1 条音符对象',
        });
    }
    // 同上：校验定位从"对象视图的 1 条代码"抬升为谱面内真实下标
    const { errors } = validateChartCode(code);
    if (errors.length > 0) {
        return {
            ok: false,
            errors: errors.map(e => ({ ...e, noteIndex: e.noteIndex >= 0 ? target.noteIndex : e.noteIndex })),
        };
    }
    const [converted] = convertChartCodeToNotes(code);
    if (!converted) {
        return fail({ noteIndex: target.noteIndex, reason: '该代码无法转换为音符' });
    }
    const newNotes = notes.map((n, i) => (i === target.noteIndex ? converted : n));
    // ADR-0001 保底：单音符编辑也不得把谱面拖进"无初始 BPM"的非法态（原本就没有则不追究）
    if (hasBeat0BpmNote(notes) && !hasBeat0BpmNote(newNotes)) {
        return fail({
            noteIndex: target.noteIndex, field: 'beat',
            reason: '改动会让谱面失去第 0 拍的 BPM 音符',
            expected: '保留一条第 0 拍的 BPM 音符（ADR-0001 保底语义）',
        });
    }
    return { ok: true, notes: newNotes };
}
