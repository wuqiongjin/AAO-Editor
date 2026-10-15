#!/usr/bin/env node
/**
 * Replay Bestdori community chart editor I/O (Apply / Copy / persist / canvas)
 * against logic extracted from CommunityChartsNew.b534f9a9.js (2026-09-24).
 *
 * Usage: node scripts/replay-bestdori-chart-editor-io.mjs [--local-413]
 *
 * 全量 413_SP 在 docs/resource/StressTestChart/（issue 154，不进库）；仅 --local-413 且文件存在时读取。
 * 产品上传清洗见 src/community/bestdori/sanitizeChart.ts（单测内联切片）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Mirrors `sanitize` / `sanitizeAll` on my-song-chart-editor (onConfirmEditCode). */
export function sanitize(obj) {
    if (obj && typeof obj === 'object') {
        delete obj.charge;
        if (Array.isArray(obj.connections)) {
            obj.connections = obj.connections.map((c) => sanitize(c));
        }
    }
    return obj;
}

const KNOWN_TYPES = new Set(['Single', 'Directional', 'Slide', 'Long', 'BPM']);

export function sanitizeAll(chart) {
    if (!Array.isArray(chart)) return chart;
    return chart
        .filter((o) => KNOWN_TYPES.has(o?.type))
        .map((o) => sanitize(structuredClone(o)));
}

/** Full-chart Apply (codeHitbox === null). */
export function applyFullChartCode(parsed) {
    return sanitizeAll(parsed);
}

/** Copy modal initial text (onOpenEditCodeChart): JSON.stringify(value). */
export function copyChartCode(memory) {
    return JSON.stringify(memory);
}

/** localStorage round-trip via settings store (actions.set → JSON.stringify). */
export function persistRoundTrip(memory) {
    return JSON.parse(JSON.stringify(memory));
}

/** Mirrors `function W` hitbox branch: only known types get hitboxes. */
export function hasCanvasHitbox(obj) {
    if (!obj || typeof obj !== 'object') return false;
    switch (obj.type) {
        case 'Single':
        case 'Directional':
        case 'BPM':
            return true;
        case 'Slide':
        case 'Long':
            return Array.isArray(obj.connections) && obj.connections.some((c) => !c.hidden);
        default:
            return false;
    }
}

function row(fixture, memoryAfterApply) {
    const afterCopy = JSON.parse(copyChartCode(memoryAfterApply));
    const afterPersist = persistRoundTrip(memoryAfterApply);
    return {
        id: fixture.id,
        applyCount: memoryAfterApply.length,
        copyMatchesApply: JSON.stringify(afterCopy) === JSON.stringify(memoryAfterApply),
        persistMatchesApply: JSON.stringify(afterPersist) === JSON.stringify(memoryAfterApply),
        canvasAnyHitbox: memoryAfterApply.some(hasCanvasHitbox),
        notes: fixture.notes ?? '',
    };
}

const FIXTURES = [
    {
        id: 'known-extra-top',
        notes: 'Single + 顶层多余键',
        input: [
            { type: 'BPM', bpm: 120, beat: 0 },
            { type: 'Single', lane: 3, beat: 4, __extra: 'keep-me' },
        ],
    },
    {
        id: 'connection-extra',
        notes: 'Slide connection 多余键（非 charge）',
        input: [
            { type: 'BPM', bpm: 120, beat: 0 },
            {
                type: 'Slide',
                connections: [
                    { lane: 2, beat: 8, tailTag: 'x' },
                    { lane: 2, beat: 12, flick: true },
                ],
            },
        ],
    },
    {
        id: 'unknown-type-mystery',
        notes: '{ type: "Mystery" }',
        input: [
            { type: 'BPM', bpm: 120, beat: 0 },
            { type: 'Mystery', lane: 3, beat: 4 },
            { type: 'Single', lane: 3, beat: 8 },
        ],
    },
    {
        id: 'no-type-object',
        notes: '无 type 对象',
        input: [
            { type: 'BPM', bpm: 120, beat: 0 },
            { lane: 3, beat: 4 },
            { type: 'Single', lane: 3, beat: 8 },
        ],
    },
    {
        id: 'sandwich-unknown',
        notes: '数组中夹未知对象',
        input: [
            { type: 'BPM', bpm: 120, beat: 0 },
            { type: 'Single', lane: 1, beat: 2 },
            { type: 'Weird', beat: 3 },
            { type: 'Single', lane: 2, beat: 4 },
        ],
    },
    {
        id: 'charge-stripped',
        notes: 'charge 在 Apply 剥除',
        input: [
            { type: 'BPM', bpm: 120, beat: 0 },
            { type: 'Single', lane: 3, beat: 4, charge: true },
            {
                type: 'Slide',
                connections: [
                    { lane: 2, beat: 8, charge: true },
                    { lane: 2, beat: 12 },
                ],
            },
        ],
    },
];

function summarizeOfficial413() {
    const path = resolve(
        __dirname,
        '../docs/resource/StressTestChart/Official/413_SP.json',
    );
    if (!existsSync(path)) {
        console.error(
            'skip: 413_SP not found (fetch-stress-test-charts.mjs); CI uses tests/unit/community/bestdori/sanitizeChart.test.ts',
        );
        return null;
    }
    const api = JSON.parse(readFileSync(path, 'utf8'));
    const applied = applyFullChartCode(structuredClone(api));
    const systemsApi = api.filter((o) => o.type === 'System').length;
    const systemsOut = applied.filter((o) => o.type === 'System').length;
    let chargeApi = 0;
    let chargeOut = 0;
    const countCharge = (o) => {
        if (o && typeof o === 'object') {
            if ('charge' in o) chargeApi++;
            if (Array.isArray(o.connections)) o.connections.forEach(countCharge);
        }
    };
    api.forEach(countCharge);
    const countChargeOut = (o) => {
        if (o && typeof o === 'object') {
            if ('charge' in o) chargeOut++;
            if (Array.isArray(o.connections)) o.connections.forEach(countChargeOut);
        }
    };
    applied.forEach(countChargeOut);

    const extraKeysLost = [];
    for (const o of api) {
        if (!KNOWN_TYPES.has(o.type)) continue;
        const match = applied.find(
            (x) => x.type === o.type && x.beat === o.beat && x.lane === o.lane,
        );
        if (!match) continue;
        for (const k of Object.keys(o)) {
            if (k === 'charge') continue;
            if (!(k in match)) extraKeysLost.push({ type: o.type, beat: o.beat, key: k });
        }
    }

    return {
        apiObjects: api.length,
        afterApplyObjects: applied.length,
        droppedSystems: systemsApi - systemsOut,
        chargeKeysRemoved: chargeApi - chargeOut,
        longCount: applied.filter((o) => o.type === 'Long').length,
        extraKeysLostSample: extraKeysLost.slice(0, 5),
        extraKeysLostCount: extraKeysLost.length,
    };
}

function main() {
    const withOfficial = process.argv.includes('--local-413');
    const results = FIXTURES.map((f) => {
        const memory = applyFullChartCode(structuredClone(f.input));
        return row(f, memory);
    });

    console.log(JSON.stringify({ fixtures: results }, null, 2));
    if (withOfficial) {
        const official413 = summarizeOfficial413();
        if (official413) console.log(JSON.stringify({ official413 }, null, 2));
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    main();
}
