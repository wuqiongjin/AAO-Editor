import { describe, test, expect } from 'vitest';
import {
    convertNotesToChartCode,
    convertChartCodeToNotes,
    chartCodeToJSON,
    parseChartCodeFromJSON,
    validateChartCode
} from '../../src/utils/ChartConverter';
import type { ChartCodeNote } from '../../src/utils/ChartConverter';
import type { ChartNote } from '../../src/notes/Charts';

describe('Chart Converter', () => {
    test('序列化 skill 标记（单键/方向键/滑条连接点）', () => {
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

        // Check Long note (converted to Slide)
        const longNote = chartCode.find(n => n.type === "Slide" && n.connections[0].beat === 20);
        expect(longNote).toEqual({
            type: "Slide",
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

        // Check Long note (converted to Slide)
        const longNote = convertedNotes.find(n => n.type === "Slide" && n.connections[0].beat === 20);
        expect(longNote).toBeDefined();
    });

    test('chartCodeToJSON and parseChartCodeFromJSON should work correctly', () => {
        const chartCode = convertNotesToChartCode(testNotes);
        const jsonString = chartCodeToJSON(chartCode);
        const parsedCode = parseChartCodeFromJSON(jsonString);

        expect(parsedCode).toEqual(chartCode);
    });

    test('validateChartCode should validate correctly', () => {
        const validChartCode = convertNotesToChartCode(testNotes);
        const validation = validateChartCode(validChartCode);

        expect(validation.valid).toBe(true);
        expect(validation.errors).toHaveLength(0);
    });

    test('validateChartCode should catch errors', () => {
        const invalidChartCode = [
            { beat: 0, type: "BPM", bpm: -1 }, // Invalid BPM
            { beat: 4, lane: 10, type: "Single" }, // Invalid lane
            { beat: 8, lane: 2, type: "Directional", direction: "Up", width: 1 }, // Invalid direction
            { beat: 12, lane: 3, type: "Directional", direction: "Left", width: 5 }, // Invalid width
        ] as unknown as ChartCodeNote[];

        const validation = validateChartCode(invalidChartCode);

        expect(validation.valid).toBe(false);
        expect(validation.errors.length).toBeGreaterThan(0);
    });
});
