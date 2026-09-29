import { describe, test, expect } from 'vitest';
import {
    convertNotesToChartCode,
    convertChartCodeToNotes,
    chartCodeToCompactJSON,
    chartCodeExportText,
    normalizeChartCodeText,
    parseCodeText,
    validateChartCode,
    hasBeat0Bpm
} from '@/src/chart/editing/ChartConverter';
import type { ChartCodeNote } from '@/src/chart/editing/ChartConverter';
import type { ChartNote } from '@/src/chart/types';

describe('Chart Converter', () => {
    test('skill 往返映射（单键/方向键/滑条连接点）', () => {
        const notes: ChartNote[] = [
            { beat: 4, lane: 0, type: "Single", skill: true },
            { beat: 8, lane: 2, type: "LDirectional", length: 2, skill: true },
            { beat: 8, lane: 5, type: "RDirectional", length: 3 },
            {
                type: "Slide",
                connections: [
                    { beat: 10, lane: 2, skill: true },
                    { beat: 11, lane: 1, hidden: true, flick: true, skill: true },
                    { beat: 12, lane: 0 }
                ]
            }
        ];
        const code = convertNotesToChartCode(notes);
        const back = convertChartCodeToNotes(code);

        const single = back.find(n => n.type === "Single") as any;
        expect(single.skill).toBe(true);

        const left = back.find(n => n.type === "LDirectional") as any;
        expect(left.skill).toBe(true);

        const right = back.find(n => n.type === "RDirectional") as any;
        expect(right.skill).toBeUndefined();

        const slide = back.find(n => n.type === "Slide") as any;
        expect(slide.connections[0].skill).toBe(true);
        expect(slide.connections[1].skill).toBe(true);
        expect(slide.connections[2].skill).toBeUndefined();
    });

    test('serialize skill 标记（单键/方向键/滑条连接点）', () => {
        const notes: ChartNote[] = [
            { beat: 4, lane: 0, type: "Single", skill: true },
            { beat: 8, lane: 2, type: "LDirectional", length: 2, skill: true },
            {
                type: "Slide",
                connections: [
                    { beat: 10, lane: 2, skill: true },
                    { beat: 11, lane: 1 }
                ]
            }
        ];
        const code = convertNotesToChartCode(notes);
        const single = code.find(c => c.type === "Single") as any;
        expect(single.skill).toBe(true);
        const dir = code.find(c => c.type === "Directional") as any;
        expect(dir.skill).toBe(true);
        const slide = code.find(c => c.type === "Slide") as any;
        expect(slide.connections[0].skill).toBe(true);
    });

    const testNotes: ChartNote[] = [
        { beat: 0, type: "BPM", bpm: 120 },
        { beat: 4, lane: 0, type: "Single" },
        { beat: 4, lane: 4, type: "Single", flick: true },
        { beat: 8, lane: 2, type: "LDirectional", length: 2 },
        { beat: 8, lane: 5, type: "RDirectional", length: 1, flick: true },
        {
            type: "Slide",
            connections: [
                { beat: 10, lane: 2 },
                { beat: 10.25, lane: 1 },
                { beat: 10.5, lane: 0 }
            ]
        },
        {
            type: "Long",
            connections: [
                { beat: 20, lane: 3 },
                { beat: 20.5, lane: 4, hidden: true },
                { beat: 21, lane: 5 }
            ]
        }
    ];

    test('convertNotesToChartCode should convert notes correctly', () => {
        const chartCode = convertNotesToChartCode(testNotes);

        expect(chartCode).toHaveLength(7);

        // Check BPM
        const bpmNote = chartCode.find(n => n.type === "BPM");
        expect(bpmNote).toEqual({
            beat: 0,
            type: "BPM",
            bpm: 120
        });

        // Check Single notes
        const singleNotes = chartCode.filter(n => n.type === "Single");
        expect(singleNotes).toHaveLength(2);
        expect(singleNotes[0]).toEqual({
            beat: 4,
            lane: 0,
            type: "Single"
        });
        expect(singleNotes[1]).toEqual({
            beat: 4,
            lane: 4,
            type: "Single",
            flick: true
        });

        // Check Directional notes
        const directionalNotes = chartCode.filter(n => n.type === "Directional");
        expect(directionalNotes).toHaveLength(2);
        expect(directionalNotes[0]).toEqual({
            beat: 8,
            lane: 2,
            type: "Directional",
            direction: "Left",
            width: 2
        });
        expect(directionalNotes[1]).toEqual({
            beat: 8,
            lane: 5,
            type: "Directional",
            direction: "Right",
            width: 1,
            flick: true
        });

        // Check Slide note
        const slideNote = chartCode.find(n => n.type === "Slide");
        expect(slideNote).toEqual({
            type: "Slide",
            connections: [
                { beat: 10, lane: 2 },
                { beat: 10.25, lane: 1 },
                { beat: 10.5, lane: 0 }
            ]
        });

        // Check Long 身份保留
        const longNote = chartCode.find(n => n.type === "Long");
        expect(longNote).toEqual({
            type: "Long",
            connections: [
                { beat: 20, lane: 3 },
                { beat: 20.5, lane: 4, hidden: true },
                { beat: 21, lane: 5 }
            ]
        });
    });

    test('convertChartCodeToNotes should convert back correctly', () => {
        const chartCode = convertNotesToChartCode(testNotes);
        const convertedNotes = convertChartCodeToNotes(chartCode);

        expect(convertedNotes).toHaveLength(7);

        // Check BPM
        const bpmNote = convertedNotes.find(n => n.type === "BPM");
        expect(bpmNote).toEqual({
            beat: 0,
            type: "BPM",
            bpm: 120
        });

        // Check Single notes
        const singleNotes = convertedNotes.filter(n => n.type === "Single");
        expect(singleNotes).toHaveLength(2);

        // Check Directional notes
        const lDirectionalNotes = convertedNotes.filter(n => n.type === "LDirectional");
        const rDirectionalNotes = convertedNotes.filter(n => n.type === "RDirectional");
        expect(lDirectionalNotes).toHaveLength(1);
        expect(rDirectionalNotes).toHaveLength(1);

        // Check Slide note
        const slideNote = convertedNotes.find(n => n.type === "Slide");
        expect(slideNote).toBeDefined();

        const longNote = convertedNotes.find(n => n.type === "Long");
        expect(longNote).toBeDefined();
    });

    test('chartCodeToCompactJSON and parseCodeText should work correctly', () => {
        const chartCode = convertNotesToChartCode(testNotes);
        const jsonString = chartCodeToCompactJSON(chartCode);
        const parsed = parseCodeText(jsonString);

        expect(parsed.errors).toEqual([]);
        expect(parsed.code).toEqual(chartCode);
    });

    test('validateChartCode should validate correctly', () => {
        const validChartCode = convertNotesToChartCode(testNotes);
        const validation = validateChartCode(validChartCode);

        expect(validation.valid).toBe(true);
        expect(validation.errors).toHaveLength(0);
    });

    test('validateChartCode should catch errors', () => {
        const invalidChartCode = [
            { beat: 4, type: "Single" }, // 缺 lane
            { beat: 8, lane: 2, type: "Directional", width: 1 }, // 缺 direction
            { beat: 0, type: "BPM", bpm: 0 },
        ] as unknown as ChartCodeNote[];

        const validation = validateChartCode(invalidChartCode);

        expect(validation.valid).toBe(false);
        expect(validation.errors.length).toBeGreaterThan(0);
    });

    // issue 103 / ADR-0010 结论 1：负 BPM = 倒流区，是一等语义，不再拒
    test('validateChartCode 放行负 BPM（倒流区：正 → 负 → 正）', () => {
        const code = [
            { beat: 0, type: "BPM", bpm: 120 },
            { beat: 4, type: "BPM", bpm: -120 },
            { beat: 5.5, type: "BPM", bpm: 120 },
        ] as ChartCodeNote[];

        expect(validateChartCode(code)).toEqual({ valid: true, errors: [] });
    });

    // ADR-0010 结论 9：负值原样写出、不取绝对值、不 clamp、不归一化；同拍多条全保留
    test('负 BPM 往返保真：符号原样、同拍多条不合并', () => {
        const notes: ChartNote[] = [
            { beat: 0, type: "BPM", bpm: 225 },
            { beat: 4, type: "BPM", bpm: -225 },
            { beat: 4, type: "BPM", bpm: -0.5 },
            { beat: 6, type: "BPM", bpm: 120 },
            { beat: 6, lane: 2, type: "Single" },
        ];

        const code = convertNotesToChartCode(notes);
        expect(code.filter(n => n.type === "BPM")).toEqual([
            { beat: 0, type: "BPM", bpm: 225 },
            { beat: 4, type: "BPM", bpm: -225 },
            { beat: 4, type: "BPM", bpm: -0.5 },
            { beat: 6, type: "BPM", bpm: 120 },
        ]);
        // 逐元素相等：导出的代码再导入再导出，与第一次导出完全相同
        expect(convertNotesToChartCode(convertChartCodeToNotes(code))).toEqual(code);
    });

    // ADR-0010 结论 9：导出排序为**稳定排序**（同 beat 保持输入顺序，否则导入→导出凭空产生 diff）
    test('导出按 beat 排序且同 beat 保持输入顺序（稳定排序不变序）', () => {
        const notes: ChartNote[] = [
            { beat: 4, type: "BPM", bpm: -60 },
            { beat: 4, type: "BPM", bpm: 60 },
            { beat: 1, type: "BPM", bpm: 120 },
            { beat: 4, lane: 0, type: "Single" },
        ];

        expect(convertNotesToChartCode(notes)).toEqual([
            { beat: 1, type: "BPM", bpm: 120 },
            { beat: 4, type: "BPM", bpm: -60 },
            { beat: 4, type: "BPM", bpm: 60 },
            { beat: 4, lane: 0, type: "Single" },
        ]);
    });

    test('hasBeat0Bpm 判定第 0 拍 BPM 保底', () => {
        expect(hasBeat0Bpm([{ beat: 0, type: 'BPM', bpm: 120 }])).toBe(true);
        expect(hasBeat0Bpm([{ beat: 4, type: 'Single', lane: 0 }] as ChartCodeNote[])).toBe(false);
        expect(hasBeat0Bpm([{ beat: 0, type: 'Single', lane: 0 }] as ChartCodeNote[])).toBe(false);
    });
});

// issue 102 方案 A：弹窗显示文本 = **每条音符一行**（行数才是 textarea 排版成本的主导项，
// 4 空格缩进下 5000 音符 = 49,507 行 vs 每条一行 5,003 行，首次布局 289ms → 30ms）。
// 弹窗显示 / 复制 / 另存为 / 粘贴重排，全部走这一个形态。
describe('issue 102 · 谱面代码文本形态（每条音符一行）', () => {
    const code: ChartCodeNote[] = [
        { beat: 0, type: 'BPM', bpm: 120 },
        { beat: 4, lane: 2, type: 'Single', flick: true },
        { type: 'Slide', connections: [{ beat: 8, lane: 1 }, { beat: 8.5, lane: 2, hidden: true }, { beat: 9, lane: 3 }] },
    ];

    test('每条音符恰好一行（行数 = 音符数 + 2 个括号行）', () => {
        const text = chartCodeToCompactJSON(code);
        const lines = text.split('\n');
        expect(lines.length).toBe(code.length + 2);
        expect(lines[0]).toBe('[');
        expect(lines[1]).toBe('{"beat":0,"type":"BPM","bpm":120},');
        expect(lines[lines.length - 1]).toBe(']');
    });

    test('滑条整条一行（含 hidden 结点），不展开成多行', () => {
        expect(chartCodeToCompactJSON([code[2]!]).split('\n').length).toBe(3);
    });

    test('与缩进形态语义等价：parse 回来完全一样（解析不认空白）', () => {
        expect(parseCodeText(chartCodeToCompactJSON(code)).code).toEqual(code);
        expect(parseCodeText(JSON.stringify(code, null, 4)).code).toEqual(code);
    });

    test('空谱面仍是合法 `[]`（不是 `[\n\n]`）', () => {
        expect(chartCodeToCompactJSON([])).toBe('[]');
        expect(parseCodeText(chartCodeToCompactJSON([])).code).toEqual([]);
    });

    test('不含缩进（另存为与显示同一份文本，issue 102 覆盖 issue 118 的 4 空格口径）', () => {
        expect(chartCodeToCompactJSON(code)).not.toContain('\n    ');
        expect(chartCodeExportText([])).toBe('[]');
    });

    test('粘贴重排：4 空格代码 → 每条一行（行数回到音符数量级）', () => {
        const pretty = JSON.stringify(code, null, 4); // 缩进形态 17 行
        const compact = normalizeChartCodeText(pretty); // 5 行
        expect(compact.split('\n').length).toBe(code.length + 2);
        expect(JSON.parse(compact)).toEqual(code);
    });

    test('粘贴重排只敢动"合法数组"：非法 / 非数组一律原样返回（不改写用户粘的东西）', () => {
        expect(normalizeChartCodeText('[{ "beat": 1,')).toBe('[{ "beat": 1,');          // 语法错误
        expect(normalizeChartCodeText('{ "beat": 1, "lane": 0, "type": "Single" }'))
            .toBe('{ "beat": 1, "lane": 0, "type": "Single" }');                       // 单个对象
        expect(normalizeChartCodeText('[]')).toBe('[]');                               // 空数组
    });
});
