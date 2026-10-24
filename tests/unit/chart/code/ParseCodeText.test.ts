// 04 票 · 谱面代码**解析侧唯一入口**：文本 → 已校验 code，一次 parse 同时给出 code 与全部错误。
//
// 这里锁的是三件事：
//   ① 「同一份文本只 parse 一次」—— 历史上有调用点「先 parse 校验、再 parse 取数组」，
//      根因是校验把解析出的数组丢了；
//   ② JSON 语法错误不得降级成"零错误"（旧 `parseChartCodeFromJSON` 返回 `[]` 的锅，
//      会让 Apply 把它误报成"缺少第 0 拍 BPM"）；
//   ③ 「校验与转换分离」—— 入口本身不产 notes，要画布音符的调用方自己调
//      `convertChartCodeToNotes`（保持纯函数、可单测；只要错误列表的路径也不付这份成本）。
import { describe, test, expect, vi } from 'vitest';
import {
    convertChartCodeToNotes,
    convertNotesToChartCode,
    hasBeat0Bpm,
    parseCodeRaw,
    parseCodeText,
    type ChartCodeNote,
} from '@/src/chart/editing/ChartConverter';
import type { ChartNote } from '@/src/chart/types';

const code: ChartCodeNote[] = [
    { beat: 0, type: 'BPM', bpm: 120 },
    { beat: 4, lane: 2, type: 'Single', flick: true },
    { type: 'Slide', connections: [{ beat: 8, lane: 1 }, { beat: 8.5, lane: 2, hidden: true }, { beat: 9, lane: 3 }] },
];

describe('04 票 · parseCodeText（唯一入口：一次 parse 给 code + 全部错误）', () => {
    test('合法数组 → code 与空 errors 一次给出', () => {
        const result = parseCodeText(JSON.stringify(code));

        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
        expect(result.code).toEqual(code);
    });

    test('issue 49：warnings 随解析结果带出（width 域外 → ok 仍 true）', () => {
        const withWidth5: ChartCodeNote[] = [
            { beat: 0, type: 'BPM', bpm: 120 },
            { beat: 4, lane: 2, type: 'Directional', direction: 'Left', width: 5 },
        ];
        const result = parseCodeText(JSON.stringify(withWidth5));
        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toMatchObject({ noteIndex: 1, field: 'width' });
    });

    test('同一份文本只 parse 一次（解析出的 code 不再被丢）', () => {
        const text = JSON.stringify(code);
        const spy = vi.spyOn(JSON, 'parse');
        let calls = 0;
        let result: ReturnType<typeof parseCodeText> | null = null;
        try {
            result = parseCodeText(text);
            calls = spy.mock.calls.length;
        } finally {
            spy.mockRestore();
        }

        expect(calls).toBe(1);
        expect(result!.ok).toBe(true);
        expect(result!.code).toEqual(code);
        // 要画布音符的路径复用这一次的结果，不必自己再 parse 一遍
        expect(convertChartCodeToNotes(result!.code as ChartCodeNote[])).toHaveLength(3);
    });

    test('JSON 语法错 → errors 非空且 code === null（不得降级成"零错误"）', () => {
        for (const text of ['[{ "beat": 0, "type": "BPM", "bpm": 120, }]', '[}', 'not-json', '']) {
            const result = parseCodeText(text);

            expect(result.ok).toBe(false);
            expect(result.code).toBeNull();
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]!.noteIndex).toBe(-1);
            expect(result.errors[0]!.reason).toContain('JSON');
        }
    });

    test('根不是数组（对象 / 字符串 / null / 数字）→ 拒', () => {
        for (const text of ['{ "beat": 0, "type": "BPM", "bpm": 120 }', '"Single"', 'null', '42']) {
            const result = parseCodeText(text);

            expect(result.ok).toBe(false);
            expect(result.code).toBeNull();
            expect(result.errors).toMatchObject([{ noteIndex: -1 }]);
        }
    });

    test('顶层无 type → 拒，报错明示下标', () => {
        const result = parseCodeText(JSON.stringify([
            { beat: 0, type: 'BPM', bpm: 120 },
            { beat: 1, lane: 1 },
        ]));

        expect(result.ok).toBe(false);
        expect(result.code).toBeNull();
        expect(result.errors).toMatchObject([{ noteIndex: 1, field: 'type' }]);
    });

    test('type 不在 ADR-0014 白名单 → 拒，报错明示下标', () => {
        const result = parseCodeText(JSON.stringify([
            { beat: 0, type: 'BPM', bpm: 120 },
            { beat: 1, lane: 1, type: 'Star' },
        ]));

        expect(result.ok).toBe(false);
        expect(result.code).toBeNull();
        expect(result.errors).toMatchObject([{ noteIndex: 1, field: 'type' }]);
    });

    test('一次收全部错误（不是首条即停）', () => {
        const result = parseCodeText(JSON.stringify([
            { beat: 0, type: 'BPM', bpm: 0 },
            { beat: 1, type: 'Single' },
            { beat: 2, type: 'Single' },
        ]));

        expect(result.ok).toBe(false);
        expect(result.errors.map(e => e.noteIndex)).toEqual([0, 1, 2]);
    });

    test('校验与转换分离：入口不产 notes（转换由调用方显式发起）', () => {
        const notes: ChartNote[] = [{ beat: 0, type: 'BPM', bpm: 120 }];
        const result = parseCodeText(JSON.stringify(convertNotesToChartCode(notes)));

        expect(result.ok).toBe(true);
        // code 是**谱面代码形态**，不是画布音符
        expect(result.code![0]).toMatchObject({ type: 'BPM', bpm: 120 });
        expect(convertChartCodeToNotes(result.code as ChartCodeNote[])).toEqual(notes);
    });

    test('空文本 / hasBeat0Bpm 策略仍在调用方（入口不替保底表态）', () => {
        const noBpm0 = parseCodeText(JSON.stringify([{ beat: 4, lane: 1, type: 'Single' }]));

        expect(noBpm0.ok).toBe(true);
        expect(hasBeat0Bpm(noBpm0.code as ChartCodeNote[])).toBe(false);
    });
});

describe('04 票 · parseCodeRaw（解析原语：只管 JSON 层）', () => {
    test('语法错误 → errors（noteIndex -1）；成功 → 原样吐值', () => {
        expect(parseCodeRaw('[}').errors).toMatchObject([{ noteIndex: -1 }]);
        expect(parseCodeRaw('{ "a": 1 }').value).toEqual({ a: 1 });
        expect(parseCodeRaw('3').value).toBe(3);
    });

    test('不做结构校验：脏数组原样给出（校验按调用方各自的口径）', () => {
        const raw = parseCodeRaw('[{ "beat": 1 }]');

        expect(raw.errors).toEqual([]);
        expect(raw.value).toEqual([{ beat: 1 }]);
        // 同一份文本过完整入口会被拒 —— 这正是"原语 ≠ 入口"的分工
        expect(parseCodeText('[{ "beat": 1 }]').ok).toBe(false);
    });
});
