// issue 187 · 片段分享文件名（ADR-0023 §3「分享」）：
// 整库 `aao-patterns-YYYYMMDD-HHmmss.json`；单条 `<片段名>.aao-pattern.json`。
// 名字里的非法文件名字符替换为 `_`，**不改库里存的名字**。
import { describe, expect, it } from 'vitest';
import { parsePatternsFile, serializePatterns } from '@/src/chart/patterns/share';
import {
  patternExportFilename,
  patternLibraryExportFilename,
} from '@/src/chart/patterns/shareFile';
import { makePattern } from '@/tests/support/patterns';

describe('整库导出文件名 · aao-patterns-YYYYMMDD-HHmmss.json', () => {
  it('按本地日期 + 时间（各段补零）', () => {
    expect(patternLibraryExportFilename(new Date(2026, 9, 31, 21, 5, 6))).toBe('aao-patterns-20261031-210506.json');
    expect(patternLibraryExportFilename(new Date(2026, 0, 5, 0, 0, 0))).toBe('aao-patterns-20260105-000000.json');
  });

  it('同一天不同时刻导出 → 文件名不同（不靠浏览器加 (1) 区分快照）', () => {
    expect(patternLibraryExportFilename(new Date(2026, 9, 31, 10, 0, 0)))
      .not.toBe(patternLibraryExportFilename(new Date(2026, 9, 31, 11, 30, 0)));
  });
});

describe('单条导出文件名 · <片段名>.aao-pattern.json', () => {
  it('普通名字原样保留（含中文与空格）', () => {
    expect(patternExportFilename('折返花活')).toBe('折返花活.aao-pattern.json');
    expect(patternExportFilename('My Pattern')).toBe('My Pattern.aao-pattern.json');
  });

  it('非法文件名字符逐个替换为下划线', () => {
    expect(patternExportFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j.aao-pattern.json');
    expect(patternExportFilename('坏\n名字\t')).toBe('坏_名字.aao-pattern.json');
  });

  it('空名 / 只有空白 → 回落 pattern；末尾的点被去掉（Windows 不接受）', () => {
    expect(patternExportFilename('   ')).toBe('pattern.aao-pattern.json');
    expect(patternExportFilename('末尾点.')).toBe('末尾点.aao-pattern.json');
  });

  it('只清洗文件名，信封里的片段名保持原样', () => {
    const source = makePattern({ name: 'a/b' });
    const doc = parsePatternsFile(serializePatterns([source]));
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;

    expect(doc.patterns[0]!.name).toBe('a/b');
    expect(patternExportFilename(doc.patterns[0]!.name)).toBe('a_b.aao-pattern.json');
  });
});
