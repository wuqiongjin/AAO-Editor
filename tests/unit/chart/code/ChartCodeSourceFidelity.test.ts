import { describe, expect, test } from 'vitest';
import {
    convertChartCodeToNotes,
    convertNotesToChartCode,
    validateChartCode,
    parseCodeText,
} from '@/src/chart/editing/ChartConverter';
import type { ChartNote, LongNote, SingleNote, SystemNote } from '@/src/chart/types';
import { countChartNotes, countNotesUpToBeat } from '@/src/chart/editing/NoteEditing';
import { buildKeyEvents, getBpmEvents } from '@/src/audio/AudioTiming';
import { chartCodeExportText } from '@/src/project/exportChartCode';
import { directionalLanes } from '@/src/chart/geometry/ChartGeometry';

const bpm0 = { beat: 0, type: 'BPM', bpm: 120 };

describe('issue 153 · Apply 硬拒绝 vs 有限非法', () => {
    test('System + hidden 越界 lane + charge + Long 整份可应用', () => {
        const code = [
            bpm0,
            { beat: 1, type: 'System', data: 'bgm001.wav' },
            { type: 'Long', connections: [
                { beat: 2, lane: 3, charge: true },
                { beat: 4, lane: 3 },
            ] },
            { beat: 5, lane: 1, type: 'Single', charge: true },
            { type: 'Slide', connections: [
                { beat: 6, lane: 2 },
                { beat: 6.5, lane: -0.5, hidden: true },
                { beat: 7, lane: 6.5, hidden: true },
                { beat: 8, lane: 4 },
            ] },
        ];
        expect(validateChartCode(code as never).valid).toBe(true);
        const notes = convertChartCodeToNotes(code as never);
        const back = convertNotesToChartCode(notes);
        expect(back.find(n => n.type === 'System')).toEqual({ beat: 1, type: 'System', data: 'bgm001.wav' });
        expect(back.find(n => n.type === 'Long')).toMatchObject({ type: 'Long' });
        expect((back.find(n => n.type === 'Single') as { charge?: boolean }).charge).toBe(true);
        const slide = back.find(n => n.type === 'Slide') as { connections: { lane: number }[] };
        expect(slide.connections.map(c => c.lane)).toEqual([2, -0.5, 6.5, 4]);
    });

    test('未知 type / 无 type 整份硬拒（156 grill）', () => {
        const mystery = validateChartCode([bpm0, { beat: 3, type: 'Mystery', foo: 1 }] as never);
        expect(mystery.valid).toBe(false);
        expect(mystery.errors.some(e => e.noteIndex === 1 && e.field === 'type')).toBe(true);

        const noType = validateChartCode([bpm0, { beat: 1, lane: 0 }] as never);
        expect(noType.valid).toBe(false);
        expect(noType.errors.some(e => e.noteIndex === 1 && e.field === 'type')).toBe(true);
    });

    test('Single 缺 lane / Slide 缺 connections 仍硬拒绝', () => {
        expect(validateChartCode([bpm0, { beat: 1, type: 'Single' }] as never).valid).toBe(false);
        expect(validateChartCode([bpm0, { type: 'Slide' }] as never).valid).toBe(false);
        expect(validateChartCode([bpm0, { beat: 1, lane: 0, type: 'Single', connections: [] }] as never).valid).toBe(false);
    });

    test('有限越界 width / Other direction 放行；JSON 语法仍拒', () => {
        expect(validateChartCode([
            bpm0,
            { beat: 1, lane: 2, type: 'Directional', direction: 'Other', width: 7 },
        ] as never).valid).toBe(true);
        expect(parseCodeText('not-json').errors.length).toBeGreaterThan(0);
        expect(parseCodeText('[}').errors.length).toBeGreaterThan(0);
    });
});

describe('issue 153 · 往返保真', () => {
    test('未知键 foo 与 charge 经 notes 再导出仍在', () => {
        const code = [
            bpm0,
            { beat: 1, lane: 0, type: 'Single', charge: true, foo: 'bar' },
        ];
        const notes = convertChartCodeToNotes(code as never);
        expect((notes[1] as SingleNote).charge).toBe(true);
        expect(convertNotesToChartCode(notes)[1]).toMatchObject({
            type: 'Single', charge: true, foo: 'bar',
        });
    });

    test('direction Other 导出仍是 Other', () => {
        const code = [
            bpm0,
            { beat: 1, lane: 2, type: 'Directional', direction: 'Other', width: 2 },
        ];
        const notes = convertChartCodeToNotes(code as never);
        expect(notes[1]?.type).toBe('RDirectional');
        expect(convertNotesToChartCode(notes)[1]).toMatchObject({
            type: 'Directional', direction: 'Other', width: 2,
        });
    });

    test('内部 Long 导出仍写 Long，不改成 Slide', () => {
        const notes: ChartNote[] = [
            { beat: 0, type: 'BPM', bpm: 120 },
            { type: 'Long', connections: [{ beat: 1, lane: 2 }, { beat: 3, lane: 2 }] } as LongNote,
        ];
        expect(convertNotesToChartCode(notes).some(n => n.type === 'Long')).toBe(true);
        expect(convertNotesToChartCode(notes).some(n => n.type === 'Slide')).toBe(false);
    });

    test('System 进源数据', () => {
        const notes = convertChartCodeToNotes([
            bpm0,
            { beat: 8, type: 'System', data: 'cmd_fever_start.wav' },
        ] as never);
        expect(notes.some(n => n.type === 'System')).toBe(true);
        expect((notes.find(n => n.type === 'System') as SystemNote).data).toBe('cmd_fever_start.wav');
    });
});

describe('issue 153 · combo / 键音 / 导出原文', () => {
    test('beat<0 计入总数与开播过线，不发键音', () => {
        const notes: ChartNote[] = [
            { type: 'BPM', beat: 0, bpm: 120 },
            { type: 'Single', beat: -1, lane: 2 },
            { type: 'Single', beat: 1, lane: 2 },
        ];
        expect(countChartNotes(notes)).toBe(2);
        expect(countNotesUpToBeat(notes, 0)).toBe(1);
        const ev = buildKeyEvents(notes, 4, getBpmEvents(notes));
        expect(ev.every(e => e.time >= 0)).toBe(true);
        expect(ev).toHaveLength(1);
    });

    test('width>3 键音档为 3', () => {
        const notes: ChartNote[] = [
            { type: 'BPM', beat: 0, bpm: 120 },
            { type: 'RDirectional', beat: 1, lane: 1, length: 7 },
        ];
        const ev = buildKeyEvents(notes, 4, getBpmEvents(notes));
        expect(ev[0]?.tier).toBe(3);
    });

    test('另存为在 pristine 时用已应用原文', () => {
        const notes: ChartNote[] = [{ type: 'BPM', beat: 0, bpm: 120 }];
        const raw = '[\n  {"beat":0,"type":"BPM","bpm":120}\n]';
        expect(chartCodeExportText(notes, raw)).toBe(raw);
        expect(chartCodeExportText(notes)).toBe('[\n{"beat":0,"type":"BPM","bpm":120}\n]');
    });

    test('direction 宽度 4.25 投影 5 个本体轨', () => {
        expect(directionalLanes(1, 'RDirectional', 4.25)).toHaveLength(5);
        expect(directionalLanes(3, 'LDirectional', 0.25)).toEqual([3]);
        expect(directionalLanes(3, 'RDirectional', 0)).toEqual([]);
    });
});
