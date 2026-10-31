// issue 185 锁测：片段库的内存视图操作（排序 / 搜索 / 改名 / 删除 / 徽标口径）。
// 存储不在这里测（184 的 PatternStore 已锁），这里只锁"界面看到的库"。
import { describe, expect, it } from 'vitest';
import {
  filterPatternsByName,
  normalizePatternName,
  patternBpmSummary,
  removePatternFromLibrary,
  renamePatternInLibrary,
  sortPatternsNewestFirst,
} from '@/src/chart/patterns/library';
import { makePattern } from '@/tests/support/patterns';

describe('issue 185 · 排序', () => {
  it('收藏时间倒序：最新在最上', () => {
    const patterns = [
      makePattern({ id: 'a', name: '片段 1', createdAt: 100 }),
      makePattern({ id: 'b', name: '片段 2', createdAt: 300 }),
      makePattern({ id: 'c', name: '片段 3', createdAt: 200 }),
    ];
    expect(sortPatternsNewestFirst(patterns).map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('同一毫秒按 id 定序（全序：反复排序结果恒定）', () => {
    const patterns = [
      makePattern({ id: 'z', createdAt: 5 }),
      makePattern({ id: 'a', createdAt: 5 }),
    ];
    expect(sortPatternsNewestFirst(patterns).map((p) => p.id)).toEqual(['a', 'z']);
    expect(sortPatternsNewestFirst(sortPatternsNewestFirst(patterns)).map((p) => p.id))
      .toEqual(['a', 'z']);
  });

  it('不动原数组（排序是纯函数）', () => {
    const patterns = [
      makePattern({ id: 'a', createdAt: 100 }),
      makePattern({ id: 'b', createdAt: 200 }),
    ];
    sortPatternsNewestFirst(patterns);
    expect(patterns.map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('issue 185 · 搜索', () => {
  const patterns = [
    makePattern({ id: 'a', name: '片段 1' }),
    makePattern({ id: 'b', name: 'Backflow Slide' }),
    makePattern({ id: 'c', name: '片段 12' }),
  ];

  it('名字子串过滤，不区分大小写', () => {
    expect(filterPatternsByName(patterns, 'backflow').map((p) => p.id)).toEqual(['b']);
    expect(filterPatternsByName(patterns, 'SLIDE').map((p) => p.id)).toEqual(['b']);
  });

  it('空查询 / 全空白 = 不过滤（顺序原样）', () => {
    expect(filterPatternsByName(patterns, '').map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(filterPatternsByName(patterns, '   ').map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('无匹配 → 空数组（清空查询即复原）', () => {
    expect(filterPatternsByName(patterns, '没有这条')).toEqual([]);
    expect(filterPatternsByName(patterns, '')).toHaveLength(3);
  });

  it('查询首尾空白不影响匹配', () => {
    expect(filterPatternsByName(patterns, '  片段 ').map((p) => p.id)).toEqual(['a', 'c']);
  });
});

describe('issue 185 · 改名', () => {
  const patterns = [makePattern({ id: 'a', name: '片段 1' })];

  it('首尾空白去掉；空名（含纯空白）拒绝', () => {
    expect(normalizePatternName('  滑条花活  ')).toBe('滑条花活');
    expect(normalizePatternName('   ')).toBeNull();
    expect(normalizePatternName('')).toBeNull();
  });

  it('超长名字原样存（显示才截断）', () => {
    const long = '片段' + '很'.repeat(120);
    const next = renamePatternInLibrary(patterns, 'a', long)!;
    expect(next[0]!.name).toBe(long);
  });

  it('空名 → null（不产生新数组、不写盘）', () => {
    expect(renamePatternInLibrary(patterns, 'a', '   ')).toBeNull();
  });

  it('名字没改 / id 不存在 → null', () => {
    expect(renamePatternInLibrary(patterns, 'a', '片段 1')).toBeNull();
    expect(renamePatternInLibrary(patterns, 'nope', '新名')).toBeNull();
  });

  it('成功改名产出新数组，其余条目原样', () => {
    const two = [...patterns, makePattern({ id: 'b', name: '片段 2' })];
    const next = renamePatternInLibrary(two, 'a', ' 折返 ')!;
    expect(next.map((p) => p.name)).toEqual(['折返', '片段 2']);
    expect(two[0]!.name).toBe('片段 1'); // 原地不可变
  });
});

describe('issue 185 · 删除', () => {
  const patterns = [
    makePattern({ id: 'a', name: '片段 1' }),
    makePattern({ id: 'b', name: '片段 2' }),
  ];

  it('删掉目标，其余保序', () => {
    expect(removePatternFromLibrary(patterns, 'a')!.map((p) => p.id)).toEqual(['b']);
  });

  it('id 不存在 → null（不写盘）', () => {
    expect(removePatternFromLibrary(patterns, 'nope')).toBeNull();
  });

  it('不动原数组', () => {
    removePatternFromLibrary(patterns, 'a');
    expect(patterns).toHaveLength(2);
  });
});

describe('issue 185 · 卡片徽标', () => {
  it('含 BPM 变化 · n：n = 跨度内事件条数', () => {
    const pattern = makePattern({
      bpmContext: {
        startBpm: 120,
        events: [{ deltaBeat: 1, bpm: 200 }, { deltaBeat: 2, bpm: -120 }],
      },
    });
    expect(patternBpmSummary(pattern)).toEqual({ changes: 2, backflow: true });
  });

  it('无事件、起点为正 → 无徽标', () => {
    expect(patternBpmSummary(makePattern())).toEqual({ changes: 0, backflow: false });
  });

  it('起点生效 BPM 为负 = 起点就在倒流区 → 含倒流', () => {
    const pattern = makePattern({ bpmContext: { startBpm: -120, events: [] } });
    expect(patternBpmSummary(pattern)).toEqual({ changes: 0, backflow: true });
  });

  it('只有负事件也算含倒流（从那一条起进入倒流区）', () => {
    const pattern = makePattern({
      bpmContext: { startBpm: 120, events: [{ deltaBeat: 4, bpm: -60 }] },
    });
    expect(patternBpmSummary(pattern)).toEqual({ changes: 1, backflow: true });
  });
});
