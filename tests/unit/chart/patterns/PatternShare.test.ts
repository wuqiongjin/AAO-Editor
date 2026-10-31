// issue 184 · 片段分享信封（ADR-0023 §3「分享」）：
// 信封 round-trip、版本不认识整包拒绝、坏条目跳过并报数、导入生成新 id、重名不报错。
import { describe, expect, it } from 'vitest';
import type { ChartNote } from '@/src/chart/types';
import {
  PATTERN_EXPORT_SCHEMA_VERSION,
  parsePatternsFile,
  serializePatterns,
  type PatternExportFile,
} from '@/src/chart/patterns/share';
import type { Pattern } from '@/src/chart/patterns/types';

function pattern(overrides: Partial<Pattern> = {}): Pattern {
  return {
    id: 'p1',
    name: '片段 1',
    createdAt: 1,
    notes: [{ type: 'Single', beat: 1, lane: 2 } as ChartNote],
    bpmContext: { startBpm: 120, events: [] },
    ...overrides,
  };
}

describe('serializePatterns · 统一信封', () => {
  it('单条也套信封：schemaVersion / exportedAt / patterns', () => {
    const doc = JSON.parse(
      serializePatterns([pattern()], new Date('2026-10-31T00:00:00.000Z')),
    ) as PatternExportFile;

    expect(doc.schemaVersion).toBe(PATTERN_EXPORT_SCHEMA_VERSION);
    expect(doc.exportedAt).toBe('2026-10-31T00:00:00.000Z');
    expect(doc.patterns).toHaveLength(1);
    expect(doc.patterns[0]!.notes).toEqual([{ type: 'Single', beat: 1, lane: 2 }]);
  });

  it('round-trip：名字 / 音符 / 速度语境 / spanParams 原样回来', () => {
    const source = pattern({
      notes: [{
        type: 'Slide',
        connections: [{ beat: 2, lane: 1 }, { beat: 4, lane: 3, hidden: true }],
        spanParams: { visibleCount: 2, bySpan: { 0: { kind: 'easing', family: 'sine', type: 'in', precision: 64 } } },
      } as ChartNote],
      bpmContext: { startBpm: 200, events: [{ deltaBeat: 2, bpm: -120 }] },
    });

    const parsed = parsePatternsFile(serializePatterns([source]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.skipped).toEqual([]);
    expect(parsed.patterns[0]).toMatchObject({
      name: source.name,
      createdAt: source.createdAt,
      notes: source.notes,
      bpmContext: source.bpmContext,
    });
  });
});

describe('parsePatternsFile · 整包拒绝', () => {
  it('JSON 坏 → invalid-json，带可展示说明', () => {
    const result = parsePatternsFile('{ not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-json');
    expect(result.message).not.toBe('');
  });

  it('版本不认识 → 整包拒绝并说明（不尝试逐条解析）', () => {
    const text = JSON.stringify({ schemaVersion: 99, exportedAt: 'x', patterns: [pattern()] });
    const result = parsePatternsFile(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-version');
    expect(result.version).toBe(99);
    expect(result.message).toContain('99');
  });

  it('信封里没有 patterns 数组 → invalid-envelope', () => {
    const result = parsePatternsFile(JSON.stringify({ schemaVersion: 1, exportedAt: 'x' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-envelope');
  });

  it('缺少 / 非数字 schemaVersion → invalid-envelope，不把 undefined 当版本号', () => {
    for (const doc of [
      { exportedAt: 'x', patterns: [pattern()] },
      { schemaVersion: null, exportedAt: 'x', patterns: [pattern()] },
      { schemaVersion: '1', exportedAt: 'x', patterns: [pattern()] },
      { schemaVersion: {}, exportedAt: 'x', patterns: [pattern()] },
    ]) {
      const result = parsePatternsFile(JSON.stringify(doc));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe('invalid-envelope');
      expect(result.message).toBe('片段文件无法解析');
      expect(result.message).not.toContain('undefined');
    }
  });
});

describe('parsePatternsFile · 逐条校验与导入语义', () => {
  it('坏条目跳过并报数（不整包失败），好条目照常导入', () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      exportedAt: 'x',
      patterns: [
        pattern({ name: '好 1' }),
        { ...pattern({ name: '没有音符' }), notes: [] },
        pattern({ name: '好 2' }),
        'nope',
      ],
    });

    const result = parsePatternsFile(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patterns.map((p) => p.name)).toEqual(['好 1', '好 2']);
    expect(result.skipped).toEqual([
      { index: 1, name: '没有音符', reason: 'invalid-notes' },
      { index: 3, name: null, reason: 'not-an-object' },
    ]);
  });

  it('缺 lane 的键型音符按坏条目拒收（不把脏数据带进渲染层）', () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      exportedAt: 'x',
      patterns: [{ ...pattern(), notes: [{ type: 'Single', beat: 1 }] }],
    });

    const result = parsePatternsFile(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patterns).toEqual([]);
    expect(result.skipped).toEqual([{ index: 0, name: '片段 1', reason: 'invalid-notes' }]);
  });

  it('导入生成新 id（不与源库撞车）', () => {
    const sources = [pattern({ id: 'same' }), pattern({ id: 'same', name: '片段 2' })];
    const result = parsePatternsFile(serializePatterns(sources));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ids = result.patterns.map((p) => p.id);
    expect(ids).not.toContain('same');
    expect(new Set(ids).size).toBe(2);
  });

  it('允许重名：两条同名片段都导入，不报错、不改写名字', () => {
    const result = parsePatternsFile(
      serializePatterns([pattern({ name: '我的花活' }), pattern({ name: '我的花活' })]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toEqual([]);
    expect(result.patterns.map((p) => p.name)).toEqual(['我的花活', '我的花活']);
  });
});
