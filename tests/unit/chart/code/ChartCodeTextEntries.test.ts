// 05 票 · 谱面代码文本的**两个具名入口**（一份序列化器，两个出口）：
//   · 投影文本（画布 → 文本）：弹窗显示、未保真时的导出回退；
//   · 导出文本（文本 → 文件/上传）：保真 pristine 且有源文本 → 原文返回，否则回退投影。
// 「发哪份文本」这条口径只活在 ChartConverter 这一处（另存为与将来 Bestdori 上传共用一个口）。
import { describe, it, expect } from 'vitest';
import {
  chartCodeProjectionText, chartCodeExportText,
  parseCodeText, convertChartCodeToNotes,
} from '@/src/chart/editing/ChartConverter';
import type { ChartNote } from '@/src/chart/types';

const NOTES: ChartNote[] = [
  { beat: 0, type: 'BPM', bpm: 120 },
  { beat: 4, lane: 2, type: 'Single', flick: true },
];
/** Apply 留下的源文本：原样排版 + 未知字段（保真就是为这两样存在的） */
const SOURCE = '[\n    {\n        "beat": 0,\n        "type": "BPM",\n        "bpm": 120,\n        "unknown": "留着我"\n    }\n]';

describe('05 · 投影文本（画布 → 文本）', () => {
  it('就是既有的紧凑序列化：每条音符一行（行数 = 音符数 + 两个括号行）', () => {
    expect(chartCodeProjectionText(NOTES)).toBe(
      '[\n{"beat":0,"type":"BPM","bpm":120},\n{"beat":4,"lane":2,"type":"Single","flick":true}\n]',
    );
    expect(chartCodeProjectionText(NOTES).split('\n')).toHaveLength(NOTES.length + 2);
  });

  it('空谱面 → `[]`', () => {
    expect(chartCodeProjectionText([])).toBe('[]');
  });

  it('未知字段（源数据 source）在投影里保留 —— 回退到投影不等于丢保真', () => {
    const parsed = parseCodeText(SOURCE);
    expect(parsed.ok).toBe(true);
    const notes = convertChartCodeToNotes(parsed.ok ? parsed.code : []);
    expect(chartCodeProjectionText(notes)).toContain('"unknown":"留着我"');
  });
});

describe('05 · 导出文本（保真优先，否则投影）', () => {
  it('pristine 且有源文本 → **原文**：未知字段与原始排版一个字都不动', () => {
    expect(chartCodeExportText(NOTES, { text: SOURCE, pristine: true })).toBe(SOURCE);
  });

  it('非 pristine → 投影（源文本还留着也不发）', () => {
    expect(chartCodeExportText(NOTES, { text: SOURCE, pristine: false }))
      .toBe(chartCodeProjectionText(NOTES));
  });

  it('pristine 但没有源文本（旧记录 / 空文本）→ 投影，不发空串', () => {
    expect(chartCodeExportText(NOTES, { text: null, pristine: true })).toBe(chartCodeProjectionText(NOTES));
    expect(chartCodeExportText(NOTES, { text: '', pristine: true })).toBe(chartCodeProjectionText(NOTES));
  });

  it('缺省保真（未 Apply 过）→ 投影：未应用的草稿发不出去（issue 118 口径）', () => {
    expect(chartCodeExportText(NOTES)).toBe(chartCodeProjectionText(NOTES));
    expect(chartCodeExportText(NOTES, null)).toBe(chartCodeProjectionText(NOTES));
  });
});
