import type { ChartNote, ConnectionNote, SelectionItem, SlideNote, LDirectionalNote, RDirectionalNote } from '../types';
import { connectionToNote, mergeChainWithSlides, compareAbsorbable } from './SlideCombination';
import { shiftGroupToAnchor } from './NoteEditing';
import { isPastChartEnd, groupMaxBeat } from './ChartEndBounds';

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
 * 查找该位置（beat/lane/subBeat）上是否已有音符 —— **「这个位置上有什么」的唯一口径**。
 * 含滑条/长条的**连接结点**（ADR-0001：结点与键型音符同位即重合）。
 * BPM / System 不参与（覆盖规则不适用于它们，见 `pasteChartNotes` 的独立分支）。
 *
 * 候选 4 归一：此前 `handleNoteReplacement` 与 `pasteChartNotes` 各写了一份**逐字相同**的判定，
 * 改一处忘另一处即口径漂移。两处共用本函数；**只抽查询，不动各自分支** ——
 * paste 的空位要「原样保留 flick/skill/length 标记」，与 `handleNoteReplacement` 的
 * `addNewNote` 语义不同，合并分支会改行为（handoff §5 教训 1：决策是否被复制才是判据）。
 *
 * @returns 命中下标；-1 = 空位
 */
export function findNoteIndexAt(
    notes: readonly ChartNote[],
    beat: number,
    lane: number,
    subBeat: number,
): number {
    const sb = subBeat || 0;
    return notes.findIndex(n => {
        if (n.type === "Single" || n.type === "LDirectional" || n.type === "RDirectional") {
            return n.beat === beat && n.lane === lane && (n.subBeat || 0) === sb;
        }
        if (n.type === "Slide" || n.type === "Long") {
            // issue 77：hidden 结点**不占位**（与 hitTest / computeItemsInBox / 渲染 / 拖拽占位表同口径）
            // —— 它不可见、不可选中、不可 hover，放置/覆盖在它所在位置 = 空位，
            // 也不会以它为支点拆条（否则一条 [A,hidden,B] 会被切成两截）。
            return (n as SlideNote).connections.some((c: ConnectionNote) =>
                !c.hidden && c.beat === beat && c.lane === lane && (c.subBeat || 0) === sb
            );
        }
        return false;
    });
}

/**
 * 键音符 → 放置工具的 id（issue 76）：落点撞滑条结点时，用它把"移动 / 粘贴"改判为"放置"。
 * 口径：flick 标记 → 滑键、skill 标记 → 技能键，否则单键；方向键 → "ldirectional" / "rdirectional"。
 *
 * issue 130：**拖拽与粘贴两条路径共用这一份** —— 此前 `NoteDragging` 与 `pasteChartNotes` 各写一份
 * 逐字相同的映射，而两份现在都喂同一个 `source` 入参，漂移一次就分裂一次。
 */
export function keyToolIdOf(n: ChartNote): string {
    return n.type === 'Single'
        ? (n.flick ? 'flick' : (n.skill ? 'skill' : 'single'))
        : n.type.toLowerCase();
}

/**
 * 单落点覆盖意图（issue 133）：点击 / 拖动键→滑条结点 / 粘贴重叠 丢同一份。
 * `source` 仅拆条分支使用（issue 130）；不传 = 工具点击，产物恒 `length=1`、无标记。
 */
export interface PlacementIntent {
    beat: number;
    lane: number;
    subBeat: number;
    tool: string;
    source?: ChartNote;
}

/**
 * ADR-0001 覆盖的公开入口。调用方只报意图，本模块答 notes。
 */
export function applyPlacement(notes: ChartNote[], intent: PlacementIntent): NoteReplacementResult {
    const newNotes = [...notes];
    let newNoteType = intent.tool;
    const { beat, lane, subBeat, source } = intent;

    // 统一 tool：单键工具 id 为小写 "single"，模块内部与音符类型一致用 "Single"
    if (newNoteType === "single") {
        newNoteType = "Single";
    }

    const existingNoteIndex = findNoteIndexAt(newNotes, beat, lane, subBeat);

    if (existingNoteIndex !== -1) {
        const existingNote = newNotes[existingNoteIndex];
        if (existingNote.type === "Slide" || existingNote.type === "Long") {
            return handleSlideNoteReplacement(newNotes, existingNoteIndex, beat, lane, subBeat, newNoteType, source);
        }
        return handleSingleAndDirectionalReplacement(newNotes, existingNoteIndex, beat, lane, subBeat, newNoteType);
    }
    return addNewNote(newNotes, beat, lane, subBeat, newNoteType);
}

/** @deprecated 行为测薄包装；生产调用点走 `applyPlacement`（issue 133） */
export function handleNoteReplacement(
    notes: ChartNote[],
    beat: number,
    lane: number,
    subBeat: number,
    newNoteType: string,
    source?: ChartNote,
): NoteReplacementResult {
    return applyPlacement(notes, { beat, lane, subBeat, tool: newNoteType, source });
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
 * 对每个落点顺序应用 applyPlacement（后一个基于前一个结果，位置互异故次序无关）。
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
        const r = applyPlacement(cur, { beat: t.beat, lane: t.lane, subBeat: t.subBeat, tool });
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
 * 滑条**端点**被键型音符覆盖 = **替换该端点的 flick/skill 标记**（issue 81 定案，
 * 取代原「只加不清、flick 与 skill 可并存」）。与「非 Slide 音符互相覆盖」（ADR-0001 §1.1）
 * 同口径 —— 后放的键型胜出、清掉另一个标记，故不会再出现「技能键底图 + 滑键箭头」的叠加样式：
 * - 单键 → 清空该端点的 flick / skill（退化为普通端点）
 * - 滑键 → 改 flick（清 skill）；**仅尾端点**（ADR-0001 §5：滑键不可作滑条起点）
 * - 技能键 → 改 skill（清 flick）；头尾端点皆可
 *
 * 中间结点不参与（保持 §1.2 的「忽略」）。
 * @returns 替换后的连接点；**null = 不合法或标记无变化** —— 调用方按"忽略"处理，
 *          不写历史快照（否则每次空点都会产生一个无变化的可撤销步）。
 */
function overrideEndpointMark(
    conn: ConnectionNote,
    newNoteType: string,
    isStartPoint: boolean,
    isEndPoint: boolean,
): ConnectionNote | null {
    if (!isStartPoint && !isEndPoint) return null;                 // 中间结点：不参与
    if (newNoteType === "flick" && !isEndPoint) return null;       // ADR §5：头部端点不携带 flick

    const next: ConnectionNote = { ...conn };
    delete next.flick;
    delete next.skill;
    if (newNoteType === "flick") next.flick = true;
    if (newNoteType === "skill") next.skill = true;

    // 标记无变化 → 视为忽略（避免无意义的历史快照）
    if (!!next.flick === !!conn.flick && !!next.skill === !!conn.skill) return null;
    return next;
}

/**
 * 处理滑条音符的覆盖替换规则（规则见 ADR-0001 第 1.2 节 + issue 81 端点修订）
 * - 单键：中间结点忽略；**端点清空 flick/skill（覆盖）**
 * - 滑键：中间/头部忽略；**尾端点改 flick（清 skill）**
 * - 技能键：中间忽略；**两端点改 skill（清 flick）**
 * - 方向键：中间节点拆两侧 / 端点拆端（2 结点滑条整条删除）
 */
function handleSlideNoteReplacement(
    newNotes: ChartNote[],
    existingNoteIndex: number,
    beat: number,
    lane: number,
    subBeat: number,
    newNoteType: string,
    source?: ChartNote,
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

    // 单键 / 滑键 / 技能键：**端点**按覆盖语义替换标记（issue 81 定案），中间结点一律忽略
    if (newNoteType === "Single" || newNoteType === "flick" || newNoteType === "skill") {
        const replaced = overrideEndpointMark(conns[connectionIndex], newNoteType, isStartPoint, isEndPoint);
        if (!replaced) {
            return { shouldReplace: false, newNotes, message: "忽略不处理" };
        }
        const updated = conns.map((c, i) => (i === connectionIndex ? replaced : c));
        newNotes[existingNoteIndex] = { ...existingNote, connections: updated };
        return { shouldReplace: true, newNotes, message: "端点标记覆盖替换" };
    }

    // 方向键：中间节点拆两侧 / 端点拆端
    if (newNoteType === "ldirectional" || newNoteType === "rdirectional") {
        return splitSlideAtNode(newNotes, existingNoteIndex, beat, lane, subBeat, newNoteType, connectionIndex, source);
    }

    return { shouldReplace: false, newNotes, message: "未知的音符类型组合" };
}


/**
 * 方向键放置到滑条结点上的拆条逻辑（ADR-0001 1.2.1 中间拆两侧 / 1.2.2 端点拆端）
 * @param connectionIndex 被放置方向键的结点下标
 * @param source 来源方向键（拖动 = 被拖件 / 粘贴 = 剪贴板件）。issue 130：拆出的独立方向键
 *               **继承它的 length / flick / skill**（移动口径：拖过去的东西原样落地）；
 *               不传（工具点击）→ 恒 length=1、无标记（放置口径，ADR §1.1 一致）。
 */
function splitSlideAtNode(
    newNotes: ChartNote[],
    existingNoteIndex: number,
    beat: number,
    lane: number,
    subBeat: number,
    newNoteType: string,
    connectionIndex: number,
    source?: ChartNote,
): NoteReplacementResult {
    const existingNote = newNotes[existingNoteIndex] as SlideNote;
    const conns = existingNote.connections;
    const slideType = (existingNote.type as string) === "Long" ? "Long" : "Slide";
    const directionalType = (newNoteType === "ldirectional" ? "LDirectional" : "RDirectional") as "LDirectional" | "RDirectional";
    const srcDir = source && (source.type === "LDirectional" || source.type === "RDirectional") ? source : null;
    const independentNote = {
        beat,
        lane,
        subBeat,
        type: directionalType,
        // `?? 1`：来源件缺 length（畸形数据）时兜底，不产出 length=undefined 的方向键
        length: srcDir?.length ?? 1,
        ...(srcDir?.flick ? { flick: true } : {}),
        ...(srcDir?.skill ? { skill: true } : {}),
    };

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
    // 候选 4 归一：改用权威 `compareAbsorbable`（与旧表达式逐字相同 → 等价）。
    const [start, end] = compareAbsorbable(a, b) <= 0 ? [a, b] : [b, a];

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
    anchorLane: number,
    /** 谱面末端边界（issue 73）；不传 = 不校验（仅供纯逻辑单测） */
    bounds?: { chartEndBeat: number; beatDisplay?: number }
): { newNotes: ChartNote[]; newStartIndex: number; written: number[]; rejected?: 'past-end' } {
    const pasted = shiftGroupToAnchor(clipboard, anchorBeat, anchorLane);
    // issue 73：**整组**越界即拒绝（此前只校验锚点，组尾可以越出 END）。
    // 想放下请先延长谱面长度（调音频时长）—— 用户 2026-09-10 拍板。
    if (bounds && pasted.length > 0
        && isPastChartEnd(groupMaxBeat(pasted, bounds.beatDisplay ?? 1), bounds.chartEndBeat)) {
        return { newNotes: notes, newStartIndex: notes.length, written: [], rejected: 'past-end' };
    }
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

        // 查找同位置既有音符（含滑条结点）（候选 4 归一：与 handleNoteReplacement 共用 findNoteIndexAt）
        const existingIndex = findNoteIndexAt(newNotes, beat, lane, subBeat);

        if (existingIndex === -1) {
            // 空位：原样粘贴（保留 flick/skill/length 标记）
            newNotes.push(structuredClone(note));
            continue;
        }

        // 有既有音符：应用覆盖替换规则（ADR §1）
        const tool = keyToolIdOf(note); // 与拖拽路径同一份映射（issue 130）
        // issue 130：来源件 = 剪贴板音符本身 —— 拆条产物继承它的 length / flick / skill，
        // 与拖拽路径同一份实现（此前粘贴侧有一段事后 findIndex 回填，拖拽侧没有，故两口径分裂）
        const result = applyPlacement(newNotes, { beat, lane, subBeat, tool, source: note });
        if (result.shouldReplace) newNotes = result.newNotes;
    }

    // 实际写入/改动的下标：新数组里引用不在原数组中的那些（新增或替换产生的新对象，含拆条产物）
    const original = new Set(notes);
    const written: number[] = [];
    newNotes.forEach((n, i) => { if (!original.has(n)) written.push(i); });
    return { newNotes, newStartIndex, written };
}

