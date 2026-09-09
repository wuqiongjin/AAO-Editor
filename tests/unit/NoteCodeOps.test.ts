// 对象视图（单音符 / 滑条结点）的初值投影与回写（issue 59 §4 / §5）逐条锁表。
import { describe, test, expect } from 'vitest';
import { buildNoteCode, applyNoteCode, type NoteCodeTarget } from '../../src/chart/editing/NoteCodeOps';
import type { ChartCodeNote } from '../../src/chart/editing/ChartConverter';
import type { ChartNote, SlideNote } from '../../src/chart/types';

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

    test('目标不存在 / System / 非滑条给结点下标 → null', () => {
        expect(buildNoteCode(notes, whole(99))).toBeNull();
        expect(buildNoteCode(notes, node(99, 0))).toBeNull();
        expect(buildNoteCode(notes, node(1, 0))).toBeNull(); // 单键不是滑条
        expect(buildNoteCode(notes, node(2, 9))).toBeNull(); // 结点越界
        expect(buildNoteCode([{ type: 'System', beat: 0, data: 'x' }], whole(0))).toBeNull();
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

    test('非法代码（Slide 只有 1 个结点）→ 报错不回写，不静默退化', () => {
        const r = applyNoteCode(notes, whole(1), [{ type: 'Slide', connections: [{ beat: 1, lane: 1 }] }]);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.errors[0]).toMatchObject({ noteIndex: 1, field: 'connections' });
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

    test('非法 lane → 报错不回写（错误定位抬升为谱面内真实下标 + 结点下标）', () => {
        const r = applyNoteCode(notes, node(2, 1), [{ beat: 5, lane: 9, type: 'Single' }]);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.errors[0]).toMatchObject({ noteIndex: 2, connIndex: 1, field: 'lane' });
    });

    test('§1.2 首/尾结点写 hidden:true → 报错不回写（否则整份谱面此后被完整视图判非法）', () => {
        for (const ci of [0, 2]) {
            const r = applyNoteCode(notes, node(2, ci), [{ beat: 5, lane: 3, type: 'Single', hidden: true }]);
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.errors[0]).toMatchObject({ noteIndex: 2, connIndex: ci, field: 'hidden' });
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
