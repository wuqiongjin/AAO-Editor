// 单音符 / 滑条结点 / 滑条子段的「对象视图」纯函数层（issue 59 §4 初值 + §5 回写；issue 93 增子段）。
// 完整谱面代码与对象视图共用同一套校验规则（§1.2），故规则本身不在此重造，只做「初值投影 / 回写落点」。
//
// §4 初值（按 target 字段分档）：
//   - 整条音符（note）            → 权威格式（滑条/长条 = {"type":"Slide","connections":[…]}，不展开）
//   - 滑条结点（slideNode）       → 独立形态投影 {"beat","lane","type":"Single", hidden?, flick?, skill?}
//   - 滑条子段（span，无 connIndex）→ 该逻辑段材质化为独立 Slide（含段内 hidden，issue 93）
//   - slideRegion 命中 → 由 noteCodeTargetForHit 在入口处换算成 span（多段滑条）或回退整条（单段）
// 展示（issue 94）：对象视图初值 = **裸 JSON 对象**（noteViewCodeToJSON，无外层 `[]`）；
//   输入容错 coerceNoteViewCode：裸对象 / 数组都收，统一成数组后走既有校验与回写。
// §5 回写：
//   - 整条：恰好 1 条 + 合法 + 字段集与 type 匹配 → 替换原 noteIndex（整条 Slide 改写成合法 Single 亦属合法编辑）
//   - 结点：只接受 type:"Single" → 写回该 connection 的 beat/lane/flick/skill/hidden
//   - 子段（issue 93）：恰好 1 条合法 Slide → 段 connections 整体替换回宿主滑条（段代码/整条双重校验）
//   - 非法一律报错 + 不回写，不静默修正、不静默忽略
import type { ChartNote, ConnectionNote, SelectionItem } from '../types';
import { t } from '../../i18n';
import { isSlide } from './SelectionEditing';
import { slideSpans, regionIdentity } from './SlideSegments';
import {
    convertNotesToChartCode, convertChartCodeToNotes, validateChartCode, hasBeat0BpmNote, parseCodeRaw,
    type ChartCodeNote, type ChartCodeSingle, type ValidationError,
} from './ChartConverter';

/** 对象视图的目标：整条音符（connIndex 缺省）/ 滑条结点（connIndex）/ 滑条子段（span，issue 93） */
export interface NoteCodeTarget {
    noteIndex: number;
    /** 滑条结点下标；undefined = 整条音符 */
    connIndex?: number;
    /**
     * 滑条**逻辑段**区间（两端可见结点的实下标闭区间，含段内 hidden；`SlideSegments` 口径）。
     * 仅多段滑条（slideSpans ≥2）才附带 —— 单段的段视图与整条层内容相同（冗余），issue 93 定案隐藏。
     * connIndex 与 span 并存 = 结点入口的 trail 形态（默认仍显示结点视图，面包屑多一档"子段代码"可点）。
     */
    span?: { start: number; end: number };
}

/**
 * 结点投影形态：type 恒 "Single" —— connection 上没有 direction / width，
 * 端点不可能被投影成 Directional（§4 投影规则：如实映射，不按位置臆断）。
 * hidden 可出现在任意结点（issue 106 起首尾 hidden 不再被校验拦；画布显示投影会掐掉首尾 hidden）。
 */
export type ChartCodeNodeProjection = ChartCodeSingle & { hidden?: boolean };

export type NoteCodeApplyResult =
    | { ok: true; notes: ChartNote[] }
    | { ok: false; errors: ValidationError[] };

const fail = (error: ValidationError): NoteCodeApplyResult => ({ ok: false, errors: [error] });

/** 错误定位抬升：校验按"对象视图里的局部代码"定位（noteIndex 0），统一抬升为谱面内真实下标（§1.1） */
const liftErrors = (errors: ValidationError[], noteIndex: number, connIndex?: number): ValidationError[] =>
    errors.map(e => ({
        ...e,
        noteIndex: e.noteIndex >= 0 ? noteIndex : e.noteIndex,
        ...(connIndex !== undefined ? { connIndex } : {}),
    }));

/**
 * 初值构造（§4）。目标不存在 / 不可投影（System、结点下标越界、非滑条却给了结点下标）→ null。
 * issue 93：span 且无 connIndex = **子段视图** —— 该逻辑段序列化为独立 Slide（含段内 hidden，
 * 与复制/剪贴板同口径，`SelectionEditing.copySelection`）。
 */
export function buildNoteCode(notes: readonly ChartNote[], target: NoteCodeTarget): ChartCodeNote[] | null {
    const note = notes[target.noteIndex];
    if (!note) return null;

    if (target.span !== undefined && target.connIndex === undefined) {
        return buildSegmentCode(notes, target);
    }

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

    // 整条：走权威序列化（System / Opaque 各一条）
    const code = convertNotesToChartCode([note]);
    return code.length === 1 ? code : null;
}

/**
 * 子段初值（issue 93）：该逻辑段（span 闭区间，含段内 hidden）材质化为**独立 Slide** 的权威代码。
 * 段两端是可见结点（`SlideSegments` 口径），单看也合法；beat 为谱面**绝对值**（不相对段首）。
 * 段区间失效 / 不足 2 结点 / 宿主不是滑条 → null。
 */
function buildSegmentCode(notes: readonly ChartNote[], target: NoteCodeTarget): ChartCodeNote[] | null {
    const note = notes[target.noteIndex];
    if (!note || !isSlide(note) || !target.span) return null;
    const { start, end } = target.span;
    if (start < 0 || end < start || end >= note.connections.length) return null; // 段区间失效
    const seg = note.connections.slice(start, end + 1);
    if (seg.length < 2) return null;
    return convertNotesToChartCode([{ ...note, connections: seg }]);
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
        return fail({ noteIndex: target.noteIndex, reason: t('noteCode.targetGone') });
    }

    // 子段视图回写（issue 93，用户拍板"可编辑回写"）：把编辑后的段整体替换回宿主滑条
    if (target.connIndex === undefined && target.span !== undefined) {
        return applySegmentCode(notes, target, code);
    }

    if (target.connIndex !== undefined) {
        if (!isSlide(note)) {
            return fail({ noteIndex: target.noteIndex, reason: t('noteCode.notSlide') });
        }
        const conn = note.connections[target.connIndex];
        if (!conn) {
            return fail({ noteIndex: target.noteIndex, connIndex: target.connIndex, reason: t('noteCode.nodeGone') });
        }
        if (code.length !== 1) {
            return fail({
                noteIndex: -1,
                reason: t('noteCode.nodeCount', { count: code.length }),
                expected: t('noteCode.nodeCountExpected'),
            });
        }
        // 规则与完整代码视图同源（§1.2）：脏代码同样被拒。
        // 校验按"对象视图里的 1 条代码"定位（noteIndex 0），此处抬升为谱面内的真实下标，避免 UI 报"音符 0"。
        // issue 103：对象视图 = **片段**（只看得到这 1 条），跳过依赖整份谱面上下文的边界规则。
        const { errors } = validateChartCode(code, { fragment: true });
        if (errors.length > 0) {
            return { ok: false, errors: liftErrors(errors, target.noteIndex, target.connIndex) };
        }
        // 按投影形态读（校验只保证它是 Single，hidden 是投影形态的扩展字段）
        const c = code[0] as ChartCodeNodeProjection;
        if (c.type !== 'Single') {
            return fail({
                noteIndex: target.noteIndex, connIndex: target.connIndex, field: 'type',
                reason: t('noteCode.nodeType', { type: c.type }),
                expected: 'Single',
            });
        }
        // issue 106：首/尾结点写 hidden 不再拒（外部数据按实机口径处置——画布投影掐首尾 hidden、
        // 可见 1 → 按单键显示、可见 0 → 画布无效果）。数据照原样回写，不做静默修正。
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
            reason: t('noteCode.noteCount', { count: code.length }),
            expected: t('noteCode.noteCountExpected'),
        });
    }
    // 同上：校验定位从"对象视图的 1 条代码"抬升为谱面内真实下标；片段口径见上方
    const { errors } = validateChartCode(code, { fragment: true });
    if (errors.length > 0) {
        return {
            ok: false,
            errors: errors.map(e => ({ ...e, noteIndex: e.noteIndex >= 0 ? target.noteIndex : e.noteIndex })),
        };
    }
    const [converted] = convertChartCodeToNotes(code);
    if (!converted) {
        return fail({ noteIndex: target.noteIndex, reason: t('noteCode.convertFail') });
    }
    const newNotes = notes.map((n, i) => (i === target.noteIndex ? converted : n));
    // ADR-0001 保底：单音符编辑也不得把谱面拖进"无初始 BPM"的非法态（原本就没有则不追究）
    if (hasBeat0BpmNote(notes) && !hasBeat0BpmNote(newNotes)) {
        return fail({
            noteIndex: target.noteIndex, field: 'beat',
            reason: t('noteCode.lostBpm0'),
            expected: t('noteCode.lostBpm0Expected'),
        });
    }
    return { ok: true, notes: newNotes };
}

/**
 * 子段回写（issue 93 §5）：解析后的段 connections **整体替换**回宿主滑条对应区间（splice），
 * 段外结点不动；段两端是与相邻段的衔接点，被改 beat/lane 时相邻段自然跟随（同一条滑条）。
 * 校验同完整代码视图口径（issue 106 起：段代码本身合法 + 替换后的**整条滑条**仍合法；
 * 可见结点不足与首尾 hidden 不再拦，见 `displaySlide`）。
 * subBeat 代码侧无从表达：新段结点数与原段一致时逐结点保留原值，新增结点取缺省（同结点视图口径）。
 */
function applySegmentCode(
    notes: readonly ChartNote[],
    target: NoteCodeTarget,
    code: ChartCodeNote[],
): NoteCodeApplyResult {
    const note = notes[target.noteIndex];
    if (!note || !isSlide(note)) {
        return fail({ noteIndex: target.noteIndex, reason: t('noteCode.targetNotSlide') });
    }
    const span = target.span;
    if (!span) return fail({ noteIndex: target.noteIndex, reason: t('noteCode.missingSpan') });
    const { start, end } = span;
    if (start < 0 || end < start || end >= note.connections.length) {
        return fail({ noteIndex: target.noteIndex, reason: t('noteCode.spanGone') });
    }
    if (code.length !== 1 || !('connections' in code[0])) {
        return fail({
            noteIndex: -1,
            reason: t('noteCode.segmentCount', { count: code.length }),
            expected: t('noteCode.segmentCountExpected'),
        });
    }
    // 段代码合法性（与完整代码视图同源）：脏代码同样被拒；错误定位抬升为谱面内真实下标。
    // issue 103：片段口径（只看到这一条滑条）。
    const segCheck = validateChartCode(code, { fragment: true });
    if (segCheck.errors.length > 0) return { ok: false, errors: liftErrors(segCheck.errors, target.noteIndex) };
    const [segCode] = convertChartCodeToNotes(code);
    if (!segCode || !isSlide(segCode)) {
        return fail({ noteIndex: target.noteIndex, reason: t('noteCode.segmentConvertFail') });
    }
    const origSeg = note.connections.slice(start, end + 1);
    const merged: ConnectionNote[] = segCode.connections.map((c, i) => ({ ...c, subBeat: origSeg[i]?.subBeat }));
    const newNote: ChartNote = {
        ...note,
        connections: [...note.connections.slice(0, start), ...merged, ...note.connections.slice(end + 1)],
    };
    // 替换后的整条滑条仍须通过校验（issue 106 起可见结点不足 / 首尾 hidden 不再拦；issue 103：片段口径）
    const wholeCheck = validateChartCode(convertNotesToChartCode([newNote]), { fragment: true });
    if (wholeCheck.errors.length > 0) return { ok: false, errors: liftErrors(wholeCheck.errors, target.noteIndex) };
    return { ok: true, notes: notes.map((n, i) => (i === target.noteIndex ? newNote : n)) };
}

/**
 * 对象视图展示形态（issue 94）：单条音符序列化为**裸 JSON 对象**（无外层 `[]`，4 空格缩进与完整视图一致）。
 * 调用方保证 code 恰好 1 条（`buildNoteCode` 口径：非 1 条返回 null、弹窗已关闭）；
 * 空数组兜底序列化为 "null"（下游 coerce 会干净报错），绝不让 stringify 返回 undefined 破坏 string 契约。
 */
export function noteViewCodeToJSON(code: ChartCodeNote[]): string {
    return JSON.stringify(code[0] ?? null, null, 4);
}

/**
 * 对象视图输入容错（issue 94）：**裸对象 / 数组都接受**（旧习惯不破），统一成数组形态交给既有校验与回写；
 * 多元素数组原样放行（条数不符由 `applyNoteCode` 的"恰好 1 条"报错）。
 * 语法错误 / 既非数组也非对象（数字、字符串等）→ { ok:false, errors }，定位 noteIndex -1（代码级，不指向音符）。
 */
export function coerceNoteViewCode(
    text: string,
): { ok: true; code: ChartCodeNote[] } | { ok: false; errors: ValidationError[] } {
    // 解析走 ChartConverter 的原语（全仓唯一一处谱面代码文本的 parse）；
    // 容错（裸对象 → 包成单元素数组）**留在这里**——裸对象不该悄悄成为整份谱面入口也接受的形态。
    const { value, errors } = parseCodeRaw(text);
    if (errors.length > 0) return { ok: false, errors };
    if (Array.isArray(value)) return { ok: true, code: value as ChartCodeNote[] };
    if (value !== null && typeof value === 'object') return { ok: true, code: [value as ChartCodeNote] };
    return {
        ok: false,
        errors: [{ noteIndex: -1, reason: t('noteCode.objectViewNeedOne'), expected: t('noteCode.objectViewExpected') }],
    };
}

/**
 * 对象视图文本校验（issue 94）：容错后走与完整代码视图同一套规则（§1.2），错误为视图内局部定位。
 * 完整视图走 `parseCodeText`（按数组口径）——两口径在此分叉，弹窗按视图择一。
 * issue 103：对象视图按**片段**校验（`fragment`）——「末条 BPM 必须为正」是整份谱面级规则，
 * 在这里会把"把中途某条 BPM 改成负值"误判成末条（ADR-0010 结论 8 要求编辑器内能创建负值）。
 * warnings（issue 49）：谱面域警告随片段口径一并带出（width 域外值在整条音符视图里同样点名）。
 */
export function validateNoteViewCodeText(text: string): { errors: ValidationError[]; warnings: ValidationError[] } {
    const coerced = coerceNoteViewCode(text);
    if (!coerced.ok) return { errors: coerced.errors, warnings: [] };
    const result = validateChartCode(coerced.code, { fragment: true });
    return { errors: result.errors, warnings: result.warnings };
}

/**
 * noteCode 工具命中 → 弹窗 target（issue 93；工具单击与 Ctrl+B 共用本口径）：
 * - 段（slideRegion）或**中间可见结点**（slideNode 非端点）且宿主为**多段滑条**（slideSpans ≥2）
 *   → target 带该逻辑段的 span。region 进入 = 默认子段视图（span，无 connIndex）；
 *     结点进入 = 结点视图（span + connIndex 并存，面包屑多一档"子段代码"可点）。
 * - **单段滑条**（`A—B` / `A—H—B`）维持旧口径：region 回退整条、结点走结点视图
 *   （issue 93 定案：单段的段视图与整条层内容相同，隐藏子段层）。
 * - 端点结点（issue 93 二轮，用户复报 2026-09-12）：端点也是所属段的边界 → 首端点挂**第一段**、
 *   末端点挂**最后一段**（target = span + connIndex，默认结点视图、面包屑多一档"子段代码"）。
 * - 整条命中 → 整条视图。
 */
export function noteCodeTargetForHit(notes: readonly ChartNote[], hit: SelectionItem): NoteCodeTarget {
    const asNode = (): NoteCodeTarget => ({ noteIndex: hit.noteIndex, connIndex: (hit as { connIndex: number }).connIndex });
    const asWhole = (): NoteCodeTarget => ({ noteIndex: hit.noteIndex });
    if (hit.kind !== 'slideNode' && hit.kind !== 'slideRegion') return asWhole();
    const note = notes[hit.noteIndex];
    if (!note || !isSlide(note)) return hit.kind === 'slideNode' ? asNode() : asWhole();
    const spans = slideSpans(note.connections);
    if (spans.length < 2) return hit.kind === 'slideNode' ? asNode() : asWhole();
    if (hit.kind === 'slideRegion') {
        const sp = regionIdentity(note.connections, hit.connIndex)?.span;
        return sp ? { noteIndex: hit.noteIndex, span: { start: sp.start, end: sp.end } } : asWhole();
    }
    // 结点的"所属段"口径（issue 93）：
    // - 端点结点（二轮复报）：首端点 = 第一段、末端点 = 最后一段；
    // - 可见中间结点恒为段边界（不属于任何段的内部）→ 按从左到右的阅读顺序取**入段**
    //   （前一可见结点 → 该结点）；
    // - hidden 过渡点（UI 不可达，纯函数兜底）取跨过它的段。
    const ci = hit.connIndex;
    if (ci <= 0) {
        const first = spans[0];
        return { noteIndex: hit.noteIndex, connIndex: hit.connIndex, span: { start: first.start, end: first.end } };
    }
    if (ci >= note.connections.length - 1) {
        const last = spans[spans.length - 1];
        return { noteIndex: hit.noteIndex, connIndex: hit.connIndex, span: { start: last.start, end: last.end } };
    }
    const sp = spans.find(s => ci > s.start && ci < s.end)
        ?? spans.find(s => s.end === ci)
        ?? spans.find(s => s.start === ci);
    if (!sp) return asNode();
    return { noteIndex: hit.noteIndex, connIndex: hit.connIndex, span: { start: sp.start, end: sp.end } };
}
