// 谱面代码校验规则（issue 59 §1）：结构化错误 + 一次收集全部 + 只接受有意义的谱面代码。
// 只测纯函数层；「导入/应用撞错 = 整份拒」用与调用方同构的闸门函数表达。
import { describe, test, expect } from 'vitest';
import {
    convertNotesToChartCode,
    convertChartCodeToNotes,
    validateChartCode,
    parseCodeText,
    formatValidationError,
    type ChartCodeNote,
    type ValidationError,
} from '@/src/chart/editing/ChartConverter';
import type { ChartNote, SlideNote } from '@/src/chart/types';

/** 应用 / 导入的统一闸门：撞错整份拒，不回写（与 ChartCodeEditor 的应用路径同构） */
function applyChartCode(code: ChartCodeNote[]): { applied: boolean; notes: ChartNote[]; errors: ValidationError[] } {
    const { valid, errors } = validateChartCode(code);
    if (!valid) return { applied: false, notes: [], errors };
    return { applied: true, notes: convertChartCodeToNotes(code), errors };
}

const bpm0: ChartCodeNote = { beat: 0, type: 'BPM', bpm: 120 };

/** 一条合法滑条（3 结点，中间结点 hidden） */
const goodSlide: ChartCodeNote = {
    type: 'Slide',
    connections: [
        { beat: 10, lane: 2 },
        { beat: 10.5, lane: 3, hidden: true },
        { beat: 11, lane: 4 },
    ],
};

describe('谱面代码校验 · 结构化错误', () => {
    test('错误带 noteIndex / field 定位路径，且一次收集全部', () => {
        const result = validateChartCode([
            bpm0,
            { beat: 4, lane: 9, type: 'Single' },
            { beat: 'x', lane: 1, type: 'Single' },
        ] as unknown as ChartCodeNote[]);

        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ noteIndex: 2, field: 'beat' });
        expect(typeof result.errors[0].reason).toBe('string');
        expect(typeof result.errors[0].expected).toBe('string');
    });

    test('formatValidationError 渲染定位路径（音符 › 结点 · 字段）', () => {
        const text = formatValidationError({
            noteIndex: 3, connIndex: 0, field: 'hidden',
            reason: '滑条首结点不得 hidden: true', expected: '省略 hidden 或 false',
        });
        expect(text).toContain('音符 3');
        expect(text).toContain('结点 0');
        expect(text).toContain('hidden');
        expect(text).toContain('滑条首结点不得 hidden: true');
    });
});

describe('谱面代码校验 · 加严规则', () => {
    test('Slide connections 为空数组 → 不再拒（issue 106：可见 0 个 → 画布上没有任何效果，数据原样）', () => {
        const code = [bpm0, { type: 'Slide', connections: [] }] as ChartCodeNote[];
        const result = validateChartCode(code);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);

        const applied = applyChartCode(code);
        expect(applied.applied).toBe(true);
        expect(applied.notes[1]).toEqual({ type: 'Slide', connections: [] });
    });

    test('Slide 只剩 1 个 connection → 不再拒（issue 106：交画布按可见结点处置，不静默改数据）', () => {
        const code = [bpm0, { type: 'Slide', connections: [{ beat: 5, lane: 2 }] }] as ChartCodeNote[];
        const result = validateChartCode(code);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
        // 原样应用：不静默修正（不变单键、也不补结点）
        const applied = applyChartCode(code);
        expect(applied.applied).toBe(true);
        expect(applied.notes[1]).toEqual({ type: 'Slide', connections: [{ beat: 5, lane: 2 }] });
    });

    test('Single 不得残留 connections', () => {
        const code = [
            bpm0,
            { beat: 1, lane: 0, type: 'Single', connections: [{ beat: 1, lane: 0 }, { beat: 2, lane: 1 }] },
        ] as unknown as ChartCodeNote[];
        const result = validateChartCode(code);

        expect(result.valid).toBe(false);
        expect(result.errors).toEqual([
            expect.objectContaining({ noteIndex: 1, field: 'connections' }),
        ]);
        expect(applyChartCode(code).applied).toBe(false);
    });

    test('Single 缺 beat / lane → 逐条报错', () => {
        const result = validateChartCode([{ type: 'Single' }] as unknown as ChartCodeNote[]);
        expect(result.errors.map(e => e.field).sort()).toEqual(['beat', 'lane']);
    });

    test('Directional 另需 direction + width，且不得残留 connections', () => {
        const result = validateChartCode([
            { beat: 2, lane: 2, type: 'Directional', connections: [{ beat: 2, lane: 2 }] },
        ] as unknown as ChartCodeNote[]);

        expect(result.errors.map(e => e.field).sort()).toEqual(['connections', 'direction', 'width']);

        const ok = validateChartCode([
            { beat: 2, lane: 2, type: 'Directional', direction: 'Left', width: 2 },
        ] as ChartCodeNote[]);
        expect(ok.valid).toBe(true);
    });

    test('滑条首尾结点 hidden:true → 不再拒（issue 106：交画布显示投影处置，数据原样）', () => {
        const code = [{
            type: 'Slide',
            connections: [
                { beat: 10, lane: 2, hidden: true },
                { beat: 10.5, lane: 3 },
                { beat: 11, lane: 4, hidden: true },
            ],
        }] as ChartCodeNote[];
        const result = validateChartCode(code);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    test('中间结点 hidden 合法，整份通过', () => {
        expect(validateChartCode([bpm0, goodSlide]).valid).toBe(true);
    });

    test('type:"Long" 是 Slide 的别名：合法，同一套规则（结点数不再设下限）', () => {
        const long: ChartCodeNote = {
            type: 'Long',
            connections: [
                { beat: 20, lane: 3 },
                { beat: 20.5, lane: 4, hidden: true },
                { beat: 21, lane: 5 },
            ],
        };
        expect(validateChartCode([bpm0, long]).valid).toBe(true);

        // issue 106：1 个结点也不拒——实机按可见结点退化，我们画布按单键形态显示（数据原样）
        const oneNode = { type: 'Long', connections: [{ beat: 20, lane: 3 }] } as ChartCodeNote;
        expect(validateChartCode([oneNode]).valid).toBe(true);
    });

    test('Long 首尾结点 hidden:true 同样不再拒（与 Slide 同规则）', () => {
        const result = validateChartCode([{
            type: 'Long',
            connections: [
                { beat: 20, lane: 3, hidden: true },
                { beat: 20.5, lane: 4 },
                { beat: 21, lane: 5, hidden: true },
            ],
        }] as ChartCodeNote[]);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });
});

describe('谱面代码 · Long 身份保留（ADR-0014）', () => {
    test('代码里的 Long 内部仍是 Long，导出仍写 Long', () => {
        const code: ChartCodeNote[] = [
            bpm0,
            {
                type: 'Long',
                connections: [
                    { beat: 20, lane: 3 },
                    { beat: 21, lane: 4, skill: true },
                ],
            },
        ];
        const applied = applyChartCode(code);
        expect(applied.applied).toBe(true);
        expect(applied.notes[1].type).toBe('Long');
        expect((applied.notes[1] as SlideNote).connections).toEqual([
            { beat: 20, lane: 3 },
            { beat: 21, lane: 4, skill: true },
        ]);
        expect(convertNotesToChartCode(applied.notes).some(c => c.type === 'Long')).toBe(true);
        expect(convertNotesToChartCode(applied.notes).some(c => c.type === 'Slide')).toBe(false);
    });

    test('内部 LongNote 导出 type:"Long"', () => {
        const code = convertNotesToChartCode([
            { type: 'Long', connections: [{ beat: 20, lane: 3 }, { beat: 21, lane: 4 }] },
        ]);
        expect(code[0].type).toBe('Long');
    });
});

describe('谱面代码 · 文本校验（JSON 语法错误不得被吞）', () => {
    test('非法 JSON → 整体级错误（noteIndex -1），不是"零错误"', () => {
        const result = parseCodeText('[{ "type": "Single", "beat": 1, }]');
        expect(result.ok).toBe(false);
        expect(result.code).toBeNull();
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].noteIndex).toBe(-1);
        expect(result.errors[0].reason).toContain('JSON');
    });

    test('非数组 JSON → 报错', () => {
        const result = parseCodeText('{ "type": "Single" }');
        expect(result.ok).toBe(false);
        expect(result.code).toBeNull();
        expect(result.errors[0].noteIndex).toBe(-1);
    });

    test('合法文本 → 通过；规则错误照常列出', () => {
        expect(parseCodeText(JSON.stringify([bpm0, goodSlide])).errors).toEqual([]);

        // issue 106 起"空 connections / 可见结点不足"不再算规则错误 → 拿仍然非法的残留 connections 举例
        const bad = parseCodeText(JSON.stringify([bpm0, { beat: 1, lane: 1, type: 'Single', connections: [] }]));
        expect(bad.ok).toBe(false);
        expect(bad.errors[0]).toMatchObject({ noteIndex: 1, field: 'connections' });
    });
});

describe('谱面代码校验 · 整份拒与合法改写', () => {
    test('脏代码（残留 connections）→ errors.length === 2 且整份拒；空 connections 与首尾 hidden 已不拒', () => {
        const dirty = [
            bpm0,
            { type: 'Slide', connections: [] },                                             // 空 connections：合法（画布上无效果）
            { beat: 2, lane: 1, type: 'Single', connections: [{ beat: 2, lane: 1 }] },       // ① Single 残留 connections
            { beat: 3, lane: 2, type: 'Directional', direction: 'Left', width: 2, connections: [] }, // ② Directional 残留 connections
            {
                type: 'Slide',                                                              // 首尾 hidden：issue 106 起不再拒
                connections: [
                    { beat: 10, lane: 2, hidden: true },
                    { beat: 10.5, lane: 3 },
                    { beat: 11, lane: 4, hidden: true },
                ],
            },
        ] as unknown as ChartCodeNote[];

        const result = validateChartCode(dirty);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(2);
        expect(result.errors.map(e => e.noteIndex)).toEqual([2, 3]);

        const applied = applyChartCode(dirty);
        expect(applied.applied).toBe(false);
        expect(applied.notes).toHaveLength(0);
    });

    test('整条 Slide 合法改写成 Single → 通过，回写后为单键', () => {
        const rewritten: ChartCodeNote[] = [bpm0, { beat: 10, lane: 2, type: 'Single' }];

        const result = validateChartCode(rewritten);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);

        const applied = applyChartCode(rewritten);
        expect(applied.applied).toBe(true);
        expect(applied.notes[1]).toEqual({ beat: 10, lane: 2, type: 'Single' });
        // 原滑条已不存在
        expect(applied.notes.some(n => n.type === 'Slide')).toBe(false);
    });
});

describe('谱面代码校验 · 回归', () => {
    const testNotes: ChartNote[] = [
        { beat: 0, type: 'BPM', bpm: 120 },
        { beat: 4, lane: 0, type: 'Single' },
        { beat: 4, lane: 4, type: 'Single', flick: true },
        { beat: 8, lane: 2, type: 'LDirectional', length: 2, skill: true },
        { beat: 8, lane: 5, type: 'RDirectional', length: 1, flick: true },
        {
            type: 'Slide',
            connections: [
                { beat: 10, lane: 2, skill: true },
                { beat: 10.25, lane: 1 },
                { beat: 10.5, lane: 0 },
            ],
        },
        {
            type: 'Long',
            connections: [
                { beat: 20, lane: 3 },
                { beat: 20.5, lane: 4, hidden: true },
                { beat: 21, lane: 5 },
            ],
        },
    ];

    test('长条与滑条同构投影，但 Long 导出仍写 Long', () => {
        const code = convertNotesToChartCode(testNotes);
        const longNote = code.find(c => c.type === 'Long' && (c as { connections: { beat: number }[] }).connections[0].beat === 20);
        expect(longNote).toBeDefined();
        expect(validateChartCode([longNote as ChartCodeNote]).valid).toBe(true);
    });

    test('谱面代码往返产物（含 skill）全部通过校验', () => {
        const code = convertNotesToChartCode(testNotes);
        const result = validateChartCode(code);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    test('未知 type 整份拒（156 grill）', () => {
        const result = validateChartCode([{ beat: 1, lane: 0, type: 'Flick' }] as unknown as ChartCodeNote[]);
        expect(result.valid).toBe(false);
        expect(result.errors[0]?.field).toBe('type');
        const applied = applyChartCode([{ beat: 1, lane: 0, type: 'Flick' }] as unknown as ChartCodeNote[]);
        expect(applied.applied).toBe(false);
    });
});

describe('谱面代码校验 · warnings 通道（issue 49）', () => {
    const width5: ChartCodeNote = { beat: 4, lane: 2, type: 'Directional', direction: 'Left', width: 5 };

    test('width 5 只出警告、不拒收：valid 仍 true，导入/应用闸门放行', () => {
        const result = validateChartCode([bpm0, width5]);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toMatchObject({ noteIndex: 1, field: 'width' });
        // 与调用方同构的闸门：errors 非空即拒——warnings 不参与，应用照常
        expect(applyChartCode([bpm0, width5]).applied).toBe(true);
    });

    test('warnings 与 errors 分道：结构错误照报，width 警告并存', () => {
        const result = validateChartCode([
            bpm0,
            width5,
            { beat: 'x', lane: 1, type: 'Single' },
        ] as unknown as ChartCodeNote[]);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ noteIndex: 2, field: 'beat' });
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toMatchObject({ noteIndex: 1, field: 'width' });
    });

    test('width 非数字已被 errors 点名 → 同处不重复出警告（去重）', () => {
        const result = validateChartCode([
            bpm0,
            { beat: 4, lane: 2, type: 'Directional', direction: 'Left', width: 'abc' },
        ] as unknown as ChartCodeNote[]);
        expect(result.valid).toBe(false);
        expect(result.errors.filter((e) => e.field === 'width')).toHaveLength(1);
        expect(result.warnings).toEqual([]);
    });
});
