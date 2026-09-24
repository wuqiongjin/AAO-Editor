// 对象视图（单音符 / 滑条结点）的初值投影与回写（issue 59 §4 / §5）逐条锁表。
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildNoteCode, applyNoteCode, noteCodeTargetForHit, noteViewCodeToJSON, coerceNoteViewCode, validateNoteViewCodeText, type NoteCodeTarget } from '@/src/chart/editing/NoteCodeOps';
import type { ChartCodeNote } from '@/src/chart/editing/ChartConverter';
import type { ChartNote, SlideNote } from '@/src/chart/types';
import { repoRoot } from '@/tests/support/source';

// 注：谱面代码格式不携带 subBeat，故样例一律不带 subBeat（带的话往返本就会丢，见专项用例）
const bpm = (beat: number, v: number): ChartNote => ({ type: 'BPM', beat, bpm: v });
const single = (beat: number, lane: number, extra: { flick?: boolean; skill?: boolean } = {}): ChartNote =>
    ({ type: 'Single', beat, lane, ...extra });
const slide = (conns: { beat: number; lane: number; subBeat?: number; hidden?: boolean; flick?: boolean; skill?: boolean }[]): ChartNote =>
    ({ type: 'Slide', connections: conns.map(c => ({ ...c })) });

const notes: ChartNote[] = [bpm(0, 120), single(1, 2), slide([{ beat: 4, lane: 1 }, { beat: 5, lane: 3 }, { beat: 6, lane: 5 }])];
const whole = (noteIndex: number): NoteCodeTarget => ({ noteIndex });
const node = (noteIndex: number, connIndex: number): NoteCodeTarget => ({ noteIndex, connIndex });

// ══════════════════ §4 初值 ══════════════════
describe('§4 buildNoteCode 初值', () => {
    test('整条单键 = 权威格式（含 flick/skill）', () => {
        const ns: ChartNote[] = [single(2, 3, { flick: true, skill: true })];
        expect(buildNoteCode(ns, whole(0))).toEqual([{ beat: 2, lane: 3, type: 'Single', flick: true, skill: true }]);
    });

    test('整条 Slide/Long = 权威格式，不展开', () => {
        expect(buildNoteCode(notes, whole(2))).toEqual([{
            type: 'Slide',
            connections: [{ beat: 4, lane: 1 }, { beat: 5, lane: 3 }, { beat: 6, lane: 5 }],
        }]);
    });

    test('BPM 音符 = 其自身代码（BPM 也是谱面代码里的一条音符）', () => {
        expect(buildNoteCode(notes, whole(0))).toEqual([{ beat: 0, type: 'BPM', bpm: 120 }]);
    });

    test('滑条结点 = 独立形态投影，type 恒 Single，flick/skill/hidden 如实映射', () => {
        const ns: ChartNote[] = [slide([
            { beat: 1, lane: 0 },
            { beat: 2, lane: 3, hidden: true, skill: true },
            { beat: 3, lane: 6, flick: true },
        ])];
        expect(buildNoteCode(ns, node(0, 1))).toEqual([{ beat: 2, lane: 3, type: 'Single', hidden: true, skill: true }]);
        expect(buildNoteCode(ns, node(0, 2))).toEqual([{ beat: 3, lane: 6, type: 'Single', flick: true }]);
    });

    test('目标不存在 / 非滑条给结点下标 → null；System 整条可投影', () => {
        expect(buildNoteCode(notes, whole(99))).toBeNull();
        expect(buildNoteCode(notes, node(99, 0))).toBeNull();
        expect(buildNoteCode(notes, node(1, 0))).toBeNull(); // 单键不是滑条
        expect(buildNoteCode(notes, node(2, 9))).toBeNull(); // 结点越界
        expect(buildNoteCode([{ type: 'System', beat: 0, data: 'x' }], whole(0)))
            .toEqual([{ beat: 0, type: 'System', data: 'x' }]);
    });
});

// ══════════════════ §5 回写·整条 ══════════════════
describe('§5 applyNoteCode 整条音符', () => {
    test('合法单键改动 → 只替换该 noteIndex，其余不动', () => {
        const r = applyNoteCode(notes, whole(1), [{ beat: 9, lane: 4, type: 'Single', flick: true }]);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.notes).toHaveLength(3);
        expect(r.notes[0]).toBe(notes[0]);
        expect(r.notes[1]).toMatchObject({ type: 'Single', beat: 9, lane: 4, flick: true });
        expect(r.notes[2]).toBe(notes[2]);
    });

    test('整条 Slide 合法改写成 Single → 回写后为单键（§1.2 允许的合法编辑）', () => {
        const r = applyNoteCode(notes, whole(2), [{ beat: 4, lane: 1, type: 'Single' }]);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.notes[2]).toMatchObject({ type: 'Single', beat: 4, lane: 1 });
    });

    test('0 条 / 多条 → 报错不回写', () => {
        expect(applyNoteCode(notes, whole(1), []).ok).toBe(false);
        const two = applyNoteCode(notes, whole(1), [{ beat: 1, lane: 1, type: 'Single' }, { beat: 2, lane: 2, type: 'Single' }]);
        expect(two.ok).toBe(false);
        if (!two.ok) expect(two.errors[0].noteIndex).toBe(-1);
    });

    test('Slide 只有 1 个结点 → 允许回写（issue 106：不拒、也不静默退化，画布按单键形态显示）', () => {
        const r = applyNoteCode(notes, whole(1), [{ type: 'Slide', connections: [{ beat: 1, lane: 1 }] }]);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect((r.notes[1] as SlideNote).connections).toHaveLength(1);
    });

    test('改动会丢掉第 0 拍 BPM → 报错不回写（ADR-0001 保底）', () => {
        const r = applyNoteCode(notes, whole(0), [{ beat: 4, type: 'BPM', bpm: 150 }]);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.errors[0].reason).toContain('第 0 拍');
    });

    test('原本就没有第 0 拍 BPM 时，不做追究（不把既有脏数据当成新错误）', () => {
        const ns: ChartNote[] = [single(1, 1)];
        const r = applyNoteCode(ns, whole(0), [{ beat: 1, lane: 5, type: 'Single' }]);
        expect(r.ok).toBe(true);
    });

    // issue 103 / ADR-0010 结论 8：对象视图按**片段**校验（跳过"末条 BPM 必须为正"），
    // 否则"把中途某条 BPM 改成负值"会被误判成末条负值，堵死"用代码创建倒流区"的路。
    test('把中途 BPM 改成负值 → 允许回写（片段口径）；beat 0 的 BPM 改成负值 → 拒', () => {
        const ns: ChartNote[] = [bpm(0, 120), bpm(4, 120), bpm(8, 120)];
        const mid = applyNoteCode(ns, whole(1), [{ beat: 4, type: 'BPM', bpm: -225 }]);
        expect(mid.ok).toBe(true);
        if (mid.ok) expect(mid.notes[1]).toEqual({ type: 'BPM', beat: 4, bpm: -225 });

        const head = applyNoteCode(ns, whole(0), [{ beat: 0, type: 'BPM', bpm: -120 }]);
        expect(head.ok).toBe(false);
        if (!head.ok) expect(head.errors[0].reason).toContain('第 0 拍');
    });
});

// ══════════════════ §5 回写·结点 ══════════════════
describe('§5 applyNoteCode 滑条结点', () => {
    test('只接受 type:"Single"（Directional / Slide 一律报错不回写）', () => {
        const directional: ChartCodeNote = { beat: 5, lane: 3, type: 'Directional', direction: 'Left', width: 2 };
        const r = applyNoteCode(notes, node(2, 1), [directional]);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.errors[0]).toMatchObject({ noteIndex: 2, connIndex: 1, field: 'type' });

        const asSlide = applyNoteCode(notes, node(2, 1), [{ type: 'Slide', connections: [{ beat: 1, lane: 1 }, { beat: 2, lane: 2 }] }]);
        expect(asSlide.ok).toBe(false);
    });

    test('写回 beat/lane/flick/skill/hidden；subBeat 代码侧无从表达 → 保留原值', () => {
        const ns: ChartNote[] = [slide([{ beat: 1, lane: 0 }, { beat: 2, lane: 3, subBeat: 0.5 }, { beat: 3, lane: 6 }])];
        const r = applyNoteCode(ns, node(0, 1), [{ beat: 7, lane: 2, type: 'Single', flick: true }]);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const conns = (r.notes[0] as SlideNote).connections;
        expect(conns[1]).toMatchObject({ beat: 7, lane: 2, flick: true, subBeat: 0.5 });
        expect(conns[0]).toEqual(ns[0] && (ns[0] as SlideNote).connections[0]);
        expect(conns[2]).toEqual((ns[0] as SlideNote).connections[2]);
    });

    test('省略 flick/skill/hidden = 清除（不静默忽略）', () => {
        const ns: ChartNote[] = [slide([{ beat: 1, lane: 0 }, { beat: 2, lane: 3, hidden: true, skill: true }, { beat: 3, lane: 6 }])];
        const r = applyNoteCode(ns, node(0, 1), [{ beat: 2, lane: 3, type: 'Single' }]);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const conn = (r.notes[0] as SlideNote).connections[1];
        expect(conn.hidden).toBeUndefined();
        expect(conn.skill).toBeUndefined();
    });

    test('有限越界 lane 可回写（ADR-0014）', () => {
        const r = applyNoteCode(notes, node(2, 1), [{ beat: 5, lane: 9, type: 'Single' }]);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect((r.notes[2] as SlideNote).connections[1].lane).toBe(9);
    });

    test('首/尾结点写 hidden:true → 允许回写（issue 106：不再由代码视图拦，画布投影掐首尾 hidden）', () => {
        for (const ci of [0, 2]) {
            const r = applyNoteCode(notes, node(2, ci), [{ beat: 5, lane: 3, type: 'Single', hidden: true }]);
            expect(r.ok).toBe(true);
            if (!r.ok) continue;
            expect((r.notes[2] as SlideNote).connections[ci].hidden).toBe(true);
        }
    });

    test('中间结点写 hidden:true → 合法（hidden 正是中间结点的语义）', () => {
        const r = applyNoteCode(notes, node(2, 1), [{ beat: 5, lane: 3, type: 'Single', hidden: true }]);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect((r.notes[2] as SlideNote).connections[1].hidden).toBe(true);
    });

    test('目标音符/结点不存在 → 报错不回写', () => {
        expect(applyNoteCode(notes, node(99, 0), [{ beat: 1, lane: 1, type: 'Single' }]).ok).toBe(false);
        expect(applyNoteCode(notes, node(2, 9), [{ beat: 1, lane: 1, type: 'Single' }]).ok).toBe(false);
        expect(applyNoteCode(notes, node(1, 0), [{ beat: 1, lane: 1, type: 'Single' }]).ok).toBe(false);
    });
});

// ══════════════════ 往返不变 ══════════════════
describe('对象视图往返', () => {
    test('初值原样回写 → 谱面不变（整条与结点两路）', () => {
        for (const target of [whole(1), whole(2), node(2, 0), node(2, 1)] as NoteCodeTarget[]) {
            const code = buildNoteCode(notes, target);
            expect(code).not.toBeNull();
            const r = applyNoteCode(notes, target, code as ChartCodeNote[]);
            expect(r.ok).toBe(true);
            if (!r.ok) continue;
            expect(r.notes).toEqual(notes);
        }
    });
});

// ══════════════════ issue 93 · 子段代码层 ══════════════════
// 段 = SlideSegments 逻辑段口径（跨 hidden）；段代码 = 该段材质化为**独立 Slide**（含段内 hidden，
// 与复制/剪贴板同口径）、绝对 beat；回写 = 段 connections 整体替换回宿主（用户 2026-09-12 拍板可编辑）。

const segTarget = (noteIndex: number, start: number, end: number): NoteCodeTarget =>
    ({ noteIndex, span: { start, end } });

describe('issue 93 · buildSegmentCode 子段初值', () => {
    // [A, H, B, C]：两段 = A→H→B（实下标 0..2）、B→C（2..3）
    const segNotes: ChartNote[] = [bpm(0, 120), slide([
        { beat: 4, lane: 1 },
        { beat: 5, lane: 3, hidden: true },
        { beat: 6, lane: 4 },
        { beat: 8, lane: 6, flick: true },
    ])];

    test('段1（A→B，跨 hidden）= 独立 Slide 代码：绝对 beat、hidden 如实保留', () => {
        expect(buildNoteCode(segNotes, segTarget(1, 0, 2))).toEqual([{
            type: 'Slide',
            connections: [
                { beat: 4, lane: 1 },
                { beat: 5, lane: 3, hidden: true },
                { beat: 6, lane: 4 },
            ],
        }]);
    });

    test('段2（B→C）= 两结点独立 Slide，flick 保留', () => {
        expect(buildNoteCode(segNotes, segTarget(1, 2, 3))).toEqual([{
            type: 'Slide',
            connections: [{ beat: 6, lane: 4 }, { beat: 8, lane: 6, flick: true }],
        }]);
    });

    test('span + connIndex 并存 = 结点入口的 trail 形态 → 仍走结点投影（默认结点视图）', () => {
        expect(buildNoteCode(segNotes, { noteIndex: 1, connIndex: 2, span: { start: 0, end: 2 } }))
            .toEqual([{ beat: 6, lane: 4, type: 'Single' }]);
    });

    test('段区间失效 / 不足 2 结点 / 非滑条 → null（弹窗据此自动关闭）', () => {
        expect(buildNoteCode(segNotes, segTarget(1, 2, 9))).toBeNull();
        expect(buildNoteCode(segNotes, segTarget(1, 0, 0))).toBeNull();
        expect(buildNoteCode(segNotes, segTarget(0, 0, 1))).toBeNull(); // BPM
    });
});

describe('issue 93 · applySegmentCode 子段回写（可编辑回写）', () => {
    const segNotes: ChartNote[] = [bpm(0, 120), slide([
        { beat: 4, lane: 1, subBeat: 1 },
        { beat: 5, lane: 3, subBeat: 0, hidden: true },
        { beat: 6, lane: 4, subBeat: 2 },
        { beat: 8, lane: 6, subBeat: 2 },
    ])];

    test('应用 = 段整体替换：段内结点改写、段外结点不动、subBeat 结点数一致时逐结点保留', () => {
        const code: ChartCodeNote[] = [{
            type: 'Slide',
            connections: [{ beat: 4, lane: 2 }, { beat: 5, lane: 5, hidden: true }, { beat: 7, lane: 4, flick: true }],
        }];
        const r = applyNoteCode(segNotes, segTarget(1, 0, 2), code);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const s = r.notes[1] as SlideNote;
        expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[4, 2], [5, 5], [7, 4], [8, 6]]);
        expect(s.connections.map(c => c.hidden === true)).toEqual([false, true, false, false]);
        expect(s.connections.map(c => c.subBeat)).toEqual([1, 0, 2, 2]); // 段内逐结点保留，段外原样
    });

    test('段内加结点：替换后宿主滑条结点数增加，新增结点 subBeat 取缺省（按位置保留仅对齐原段）', () => {
        const code: ChartCodeNote[] = [{
            type: 'Slide',
            connections: [
                { beat: 4, lane: 1 }, { beat: 5, lane: 2 }, { beat: 6, lane: 4 }, { beat: 7, lane: 5 },
            ],
        }];
        const r = applyNoteCode(segNotes, segTarget(1, 0, 2), code);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const s = r.notes[1] as SlideNote;
        expect(s.connections.map(c => c.beat)).toEqual([4, 5, 6, 7, 8]);
        expect(s.connections.map(c => c.subBeat)).toEqual([1, 0, 2, undefined, 2]); // 前 3 位对齐原段，第 4 位新增
    });

    test('非法拒绝：条数不为 1 / 非滑条 / 目标段失效 → 整单拒绝不回写（隐藏端点与 1 结点不再拒）', () => {
        const seg = segTarget(1, 0, 2);
        expect(applyNoteCode(segNotes, seg, []).ok).toBe(false);
        expect(applyNoteCode(segNotes, seg, [{ beat: 1, lane: 1, type: 'Single' }]).ok).toBe(false);
        // issue 106：段首 / 尾 hidden 与"缩成 1 结点"都不再拒（可见结点不足交画布投影处置，数据原样）
        const badSeg: ChartCodeNote[] = [{
            type: 'Slide',
            connections: [{ beat: 4, lane: 1, hidden: true }, { beat: 6, lane: 4 }],
        }];
        expect(applyNoteCode(segNotes, seg, badSeg).ok).toBe(true);
        const shrink: ChartCodeNote[] = [{ type: 'Slide', connections: [{ beat: 4, lane: 1 }] }];
        expect(applyNoteCode(segNotes, seg, shrink).ok).toBe(true);
        // 目标段失效（越界）
        expect(applyNoteCode(segNotes, segTarget(1, 3, 9), segTargetCode()).ok).toBe(false);
        function segTargetCode(): ChartCodeNote[] {
            return [{ type: 'Slide', connections: [{ beat: 1, lane: 1 }, { beat: 2, lane: 2 }] }];
        }
    });
});

describe('issue 93 · noteCodeTargetForHit 命中 → target 口径', () => {
    // [A, H, B, C] 多段 + [A, B] 单段 + [A, H, B] 单段
    const ns: ChartNote[] = [
        bpm(0, 120),
        slide([{ beat: 4, lane: 1 }, { beat: 5, lane: 3, hidden: true }, { beat: 6, lane: 4 }, { beat: 8, lane: 6 }]),
        slide([{ beat: 1, lane: 1 }, { beat: 2, lane: 2 }]),
        slide([{ beat: 1, lane: 1 }, { beat: 2, lane: 2, hidden: true }, { beat: 3, lane: 3 }]),
    ];

    test('多段滑条：region → 默认子段视图（span，无 connIndex）', () => {
        expect(noteCodeTargetForHit(ns, { kind: 'slideRegion', noteIndex: 1, connIndex: 0 }))
            .toEqual({ noteIndex: 1, span: { start: 0, end: 2 } });
        expect(noteCodeTargetForHit(ns, { kind: 'slideRegion', noteIndex: 1, connIndex: 2 }))
            .toEqual({ noteIndex: 1, span: { start: 2, end: 3 } });
    });

    test('多段滑条：可见中间结点 = 段边界 → 取**入段**（前一可见结点 → 该结点）', () => {
        expect(noteCodeTargetForHit(ns, { kind: 'slideNode', noteIndex: 1, connIndex: 2 }))
            .toEqual({ noteIndex: 1, connIndex: 2, span: { start: 0, end: 2 } });
    });

    test('单段滑条（A—B / A—H—B）：region 回退整条、结点走结点视图（无 span，隐藏子段层）', () => {
        expect(noteCodeTargetForHit(ns, { kind: 'slideRegion', noteIndex: 2, connIndex: 0 }))
            .toEqual({ noteIndex: 2 });
        expect(noteCodeTargetForHit(ns, { kind: 'slideRegion', noteIndex: 3, connIndex: 0 }))
            .toEqual({ noteIndex: 3 });
        expect(noteCodeTargetForHit(ns, { kind: 'slideNode', noteIndex: 2, connIndex: 0 }))
            .toEqual({ noteIndex: 2, connIndex: 0 });
    });

    test('端点结点（多段滑条，issue 93 二轮）= 结点视图 + 所属段 span：首端点挂第一段、末端点挂最后一段', () => {
        expect(noteCodeTargetForHit(ns, { kind: 'slideNode', noteIndex: 1, connIndex: 0 }))
            .toEqual({ noteIndex: 1, connIndex: 0, span: { start: 0, end: 2 } }); // 首端点 → 第一段 A→H→B
        expect(noteCodeTargetForHit(ns, { kind: 'slideNode', noteIndex: 1, connIndex: 3 }))
            .toEqual({ noteIndex: 1, connIndex: 3, span: { start: 2, end: 3 } }); // 末端点 → 最后一段 B→C
    });
});

describe('issue 93 · 弹窗结构断言（四档面包屑，防把子段层拆掉）', () => {
    const root = repoRoot;
    const modalSrc = readFileSync(join(root, 'src/chart/components/code-editor/ChartCodeEditorModal.tsx'), 'utf-8');

    test('面包屑含「子段代码」档，由 trail.span 决定显示；单段滑条不产生 span → 自然不出现', () => {
        expect(modalSrc).toContain('子段代码');
        expect(modalSrc).toContain('trail?.span !== undefined');
        expect(modalSrc).toContain('isSegmentView');
    });
});

describe('issue 95 · 面包屑结点档改名「音符代码」（方案甲按视图定名）', () => {
    const root = repoRoot;
    const modalSrc = readFileSync(join(root, 'src/chart/components/code-editor/ChartCodeEditorModal.tsx'), 'utf-8');

    test('「滑条结点代码」全面退场；四档口径 = 完整谱面代码 › 所属滑条 › 子段代码 › 音符代码', () => {
        expect(modalSrc).not.toContain('滑条结点代码');
        expect(modalSrc).toContain('完整谱面代码 › 所属滑条 › 子段代码 › 音符代码');
    });
});

// ══════════════════ issue 94 · 对象视图去除外层 [] ══════════════════
describe('issue 94 · noteViewCodeToJSON 展示序列化', () => {
    test('单条音符 = 裸对象 JSON（无外层 []，4 空格缩进）', () => {
        const text = noteViewCodeToJSON([{ beat: 8, lane: 1, type: 'Single' }]);
        expect(text.startsWith('{')).toBe(true);
        expect(text.endsWith('}')).toBe(true);
        expect(JSON.parse(text)).toEqual({ beat: 8, lane: 1, type: 'Single' });
    });

    test('Slide 段代码同样裸对象（段内 connections 数组保留，顶层不是数组）', () => {
        const seg: ChartCodeNote[] = [{ type: 'Slide', connections: [{ beat: 8, lane: 1 }, { beat: 12, lane: 3 }] }];
        const text = noteViewCodeToJSON(seg);
        expect(JSON.parse(text)).toEqual(seg[0]);
        expect(Array.isArray(JSON.parse(text))).toBe(false);
    });

    test('空数组兜底 → "null" 字符串（string 契约不破，下游 coerce 干净报错）', () => {
        const text = noteViewCodeToJSON([]);
        expect(typeof text).toBe('string');
        const r = coerceNoteViewCode(text);
        expect(r.ok).toBe(false);
    });
});

describe('issue 94 · coerceNoteViewCode 输入容错（裸对象 / 数组都收）', () => {
    test('裸对象 → 包成恰好 1 条', () => {
        const r = coerceNoteViewCode('{ "beat": 8, "lane": 1, "type": "Single" }');
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.code).toEqual([{ beat: 8, lane: 1, type: 'Single' }]);
    });

    test('单元素数组 → 原样通过（旧习惯不破）', () => {
        const r = coerceNoteViewCode('[{ "beat": 8, "lane": 1, "type": "Single" }]');
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.code).toEqual([{ beat: 8, lane: 1, type: 'Single' }]);
    });

    test('多元素数组 → 放行给校验/回写（条数不符由 applyNoteCode 报"恰好 1 条"）', () => {
        const r = coerceNoteViewCode('[{ "beat": 0, "type": "BPM", "bpm": 120 }, { "beat": 1, "lane": 1, "type": "Single" }]');
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.code).toHaveLength(2);
    });

    test('JSON 语法错误 → 不抛出，定位 noteIndex -1（弹窗当普通校验错误展示）', () => {
        const r = coerceNoteViewCode('{ "beat": 8, ');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.errors[0]).toMatchObject({ noteIndex: -1 });
    });

    test('数字等既非数组也非对象的输入 → 干净报错不抛异常', () => {
        for (const text of ['42', 'null', '"x"']) {
            const r = coerceNoteViewCode(text);
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.errors[0].noteIndex).toBe(-1);
        }
    });
});

describe('issue 94 · validateNoteViewCodeText（容错后与完整视图同一套规则）', () => {
    test('合法裸对象 → 零错误', () => {
        expect(validateNoteViewCodeText('{ "beat": 8, "lane": 1, "type": "Single" }')).toEqual([]);
    });

    test('裸对象：有限越界 lane 放行；hidden 端点不拦', () => {
        expect(validateNoteViewCodeText('{ "beat": 8, "lane": 9, "type": "Single" }')).toEqual([]);
        expect(validateNoteViewCodeText('{ "beat": 8, "lane": 1, "type": "Slide", "connections": [{ "beat": 8, "lane": 1 }, { "beat": 9, "lane": 2, "hidden": true }] }'))
            .toEqual([]);
    });

    test('语法错误 → 1 条定位错误（不会"零错误"放行）', () => {
        const errors = validateNoteViewCodeText('{ "beat": 8, ');
        expect(errors).toHaveLength(1);
        expect(errors[0].noteIndex).toBe(-1);
    });
});

describe('issue 94 · 弹窗接线断言（初值/校验/应用三处都走裸对象口径）', () => {
    const root = repoRoot;
    const modalSrc = readFileSync(join(root, 'src/chart/components/code-editor/ChartCodeEditorModal.tsx'), 'utf-8');

    test('对象视图初值与刷新走 noteViewCodeToJSON（完整视图仍 chartCodeToJSON）', () => {
        expect(modalSrc).toContain('noteViewCodeToJSON');
        expect(modalSrc).not.toContain('chartCodeToJSON(currentViewCode())');
    });

    test('校验与应用走 coerceNoteViewCode（裸对象可应用，不再经 parseChartCodeFromJSON）', () => {
        expect(modalSrc).toContain('coerceNoteViewCode');
        expect(modalSrc).toContain('validateNoteViewCodeText');
        // 数组口径解析器只允许出现在完整视图分支（对象视图分支用 coerce 后的代码回写）
        expect(modalSrc.split('parseChartCodeFromJSON(chartCode)')).toHaveLength(2);
        expect(modalSrc).toContain('applyNoteCode(notes, target, coerced.code)');
        expect(modalSrc).not.toContain('applyNoteCode(notes, target, parsedCode)');
    });
});
