import { describe, expect, test } from 'vitest';
import { sanitizeChartForBestdoriUpload } from '@/src/upload/bestdori/sanitizeChart';

/** 上传清洗主责：丢 System、剥 charge；合法五种 type 与多余键保留（Apply 已放行部分）。 */
const chartWithSystemAndCharge = [
    { type: 'BPM', bpm: 210, beat: 0 },
    { type: 'System', data: 'bgm1020.wav', beat: 0 },
    { type: 'System', data: 'cmd_fever_ready.wav', beat: 220 },
    { type: 'Single', lane: 1, beat: 220, charge: true, noteTag: 'keep-me' },
    {
        type: 'Directional',
        beat: 221,
        lane: 2,
        direction: 'Right',
        width: 2,
        charge: true,
        widthHint: 2,
    },
    {
        type: 'Long',
        connections: [
            { lane: 0, beat: 239.5, charge: true },
            { lane: 0, beat: 240.5 },
        ],
    },
    {
        type: 'Slide',
        connections: [
            { lane: 0, beat: 223, charge: true },
            { lane: 2, beat: 223.5, charge: true },
            { lane: 0, beat: 224 },
        ],
    },
] as const;

describe('sanitizeChartForBestdoriUpload', () => {
    test('丢 System，剥 charge（含 connections），五种击打类型与多余键保留', () => {
        const out = sanitizeChartForBestdoriUpload(chartWithSystemAndCharge as never);
        expect(out).toHaveLength(5);
        expect(out.map(o => o.type)).toEqual(['BPM', 'Single', 'Directional', 'Long', 'Slide']);
        expect(out.some(o => o.type === 'System')).toBe(false);

        const single = out[1] as { charge?: boolean; noteTag?: string };
        expect(single.charge).toBeUndefined();
        expect(single.noteTag).toBe('keep-me');

        const dir = out[2] as { charge?: boolean; widthHint?: number };
        expect(dir.charge).toBeUndefined();
        expect(dir.widthHint).toBe(2);

        const long = out[3] as { connections: { charge?: boolean }[] };
        expect(long.connections.every(c => c.charge === undefined)).toBe(true);

        const slide = out[4] as { connections: { charge?: boolean }[] };
        expect(slide.connections).toHaveLength(3);
        expect(slide.connections.every(c => c.charge === undefined)).toBe(true);
    });

    test('不修改入参数组', () => {
        const input = structuredClone(chartWithSystemAndCharge) as unknown[];
        const before = JSON.stringify(input);
        sanitizeChartForBestdoriUpload(input as never);
        expect(JSON.stringify(input)).toBe(before);
        expect((input[3] as { charge?: boolean }).charge).toBe(true);
    });

    test('非数组入参返回空数组', () => {
        expect(sanitizeChartForBestdoriUpload(null as never)).toEqual([]);
        expect(sanitizeChartForBestdoriUpload(undefined as never)).toEqual([]);
    });
});
