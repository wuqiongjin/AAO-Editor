import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PATTERN_SORT,
  sortPatterns,
} from '../../../src/patterns/library';
import type { Pattern } from '../../../src/patterns/types';

function makePattern(partial: {
  id: string;
  name?: string;
  createdAt?: number;
  pinnedAt?: number;
  notes?: Pattern['notes'];
  bpmContext?: Pattern['bpmContext'];
}): Pattern {
  return {
    id: partial.id,
    name: partial.name ?? `Pattern ${partial.id}`,
    createdAt: partial.createdAt ?? 1000,
    pinnedAt: partial.pinnedAt,
    notes: partial.notes ?? [],
    bpmContext: partial.bpmContext ?? { startBpm: 120, events: [] },
  };
}

describe('issue 192 · 片段多维排序（sortPatterns）', () => {
  it('纯函数：不修改输入原数组', () => {
    const p1 = makePattern({ id: 'p1', createdAt: 100 });
    const p2 = makePattern({ id: 'p2', createdAt: 200 });
    const original = [p1, p2];
    const frozen = Object.freeze([...original]);
    const result = sortPatterns(frozen, { key: 'createdAt', direction: 'desc' });
    expect(result.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(original[0]).toBe(p1);
    expect(original[1]).toBe(p2);
  });

  describe('四个键 × 两个方向', () => {
    describe('createdAt', () => {
      it('desc（最新收藏在前，默认）', () => {
        const patterns = [
          makePattern({ id: 'a', createdAt: 100 }),
          makePattern({ id: 'c', createdAt: 300 }),
          makePattern({ id: 'b', createdAt: 200 }),
        ];
        expect(sortPatterns(patterns, { key: 'createdAt', direction: 'desc' }).map((p) => p.id))
          .toEqual(['c', 'b', 'a']);
      });

      it('asc（最早收藏在前）', () => {
        const patterns = [
          makePattern({ id: 'a', createdAt: 100 }),
          makePattern({ id: 'c', createdAt: 300 }),
          makePattern({ id: 'b', createdAt: 200 }),
        ];
        expect(sortPatterns(patterns, { key: 'createdAt', direction: 'asc' }).map((p) => p.id))
          .toEqual(['a', 'b', 'c']);
      });
    });

    describe('name', () => {
      it('asc（自然数字序：片段 2 排在 片段 10 前）', () => {
        const patterns = [
          makePattern({ id: 'p10', name: '片段 10' }),
          makePattern({ id: 'p2', name: '片段 2' }),
          makePattern({ id: 'p1', name: '片段 1' }),
        ];
        const res = sortPatterns(patterns, { key: 'name', direction: 'asc' }, 'zh-CN');
        expect(res.map((p) => p.name)).toEqual(['片段 1', '片段 2', '片段 10']);
      });

      it('asc（大小写不敏感：base sensitivity 下大小写视为相同，由 id 兜底）', () => {
        const patterns = [
          makePattern({ id: 'id-b', name: 'Apple' }),
          makePattern({ id: 'id-a', name: 'apple' }),
        ];
        const res = sortPatterns(patterns, { key: 'name', direction: 'asc' }, 'en');
        // 'Apple' 与 'apple' 在 base sensitivity 下比值 0，按 id 升序排序：id-a ('apple') < id-b ('Apple')
        expect(res.map((p) => p.id)).toEqual(['id-a', 'id-b']);
      });

      it('desc（Z→A，Intl.Collator 降序）', () => {
        const patterns = [
          makePattern({ id: 'p1', name: '片段 1' }),
          makePattern({ id: 'p10', name: '片段 10' }),
          makePattern({ id: 'p2', name: '片段 2' }),
        ];
        const res = sortPatterns(patterns, { key: 'name', direction: 'desc' }, 'zh-CN');
        expect(res.map((p) => p.name)).toEqual(['片段 10', '片段 2', '片段 1']);
      });
    });

    describe('noteCount', () => {
      it('desc（音符数多→少，使用 190 countChartNotes 口径）', () => {
        const pFew = makePattern({
          id: 'few',
          notes: [{ type: 'Single', lane: 1, beat: 0 }],
        });
        const pMany = makePattern({
          id: 'many',
          notes: [
            { type: 'Single', lane: 1, beat: 0 },
            { type: 'Single', lane: 2, beat: 1, flick: true },
            { type: 'Single', lane: 3, beat: 2, skill: true },
          ],
        });
        const pMid = makePattern({
          id: 'mid',
          notes: [
            { type: 'Single', lane: 1, beat: 0 },
            { type: 'Single', lane: 2, beat: 1 },
          ],
        });
        expect(sortPatterns([pFew, pMany, pMid], { key: 'noteCount', direction: 'desc' }).map((p) => p.id))
          .toEqual(['many', 'mid', 'few']);
      });

      it('asc（音符数少→多）', () => {
        const pFew = makePattern({
          id: 'few',
          notes: [{ type: 'Single', lane: 1, beat: 0 }],
        });
        const pMany = makePattern({
          id: 'many',
          notes: [
            { type: 'Single', lane: 1, beat: 0 },
            { type: 'Single', lane: 2, beat: 1 },
          ],
        });
        expect(sortPatterns([pMany, pFew], { key: 'noteCount', direction: 'asc' }).map((p) => p.id))
          .toEqual(['few', 'many']);
      });
    });

    describe('beatSpan', () => {
      it('desc（拍数多→少，使用 190 maxBeat - minBeat 口径）', () => {
        const pShort = makePattern({
          id: 'short',
          notes: [
            { type: 'Single', lane: 1, beat: 0 },
            { type: 'Single', lane: 2, beat: 2 }, // span = 2
          ],
        });
        const pLong = makePattern({
          id: 'long',
          notes: [
            { type: 'Single', lane: 1, beat: 0 },
            { type: 'Single', lane: 2, beat: 8 }, // span = 8
          ],
        });
        const pZero = makePattern({
          id: 'zero',
          notes: [{ type: 'Single', lane: 1, beat: 4 }], // span = 0
        });
        expect(sortPatterns([pShort, pLong, pZero], { key: 'beatSpan', direction: 'desc' }).map((p) => p.id))
          .toEqual(['long', 'short', 'zero']);
      });

      it('asc（拍数少→多）', () => {
        const pShort = makePattern({
          id: 'short',
          notes: [
            { type: 'Single', lane: 1, beat: 0 },
            { type: 'Single', lane: 2, beat: 2 }, // span = 2
          ],
        });
        const pLong = makePattern({
          id: 'long',
          notes: [
            { type: 'Single', lane: 1, beat: 0 },
            { type: 'Single', lane: 2, beat: 8 }, // span = 8
          ],
        });
        expect(sortPatterns([pLong, pShort], { key: 'beatSpan', direction: 'asc' }).map((p) => p.id))
          .toEqual(['short', 'long']);
      });
    });
  });

  describe('全序与同主键 id 兜底', () => {
    it('相同 createdAt 时按 id 升序兜底', () => {
      const patterns = [
        makePattern({ id: 'z', createdAt: 100 }),
        makePattern({ id: 'a', createdAt: 100 }),
        makePattern({ id: 'm', createdAt: 100 }),
      ];
      expect(sortPatterns(patterns, { key: 'createdAt', direction: 'desc' }).map((p) => p.id))
        .toEqual(['a', 'm', 'z']);
      expect(sortPatterns(patterns, { key: 'createdAt', direction: 'asc' }).map((p) => p.id))
        .toEqual(['a', 'm', 'z']);
    });

    it('相同名称时按 id 升序兜底', () => {
      const patterns = [
        makePattern({ id: 'c', name: 'Intro' }),
        makePattern({ id: 'a', name: 'Intro' }),
        makePattern({ id: 'b', name: 'Intro' }),
      ];
      expect(sortPatterns(patterns, { key: 'name', direction: 'asc' }).map((p) => p.id))
        .toEqual(['a', 'b', 'c']);
      expect(sortPatterns(patterns, { key: 'name', direction: 'desc' }).map((p) => p.id))
        .toEqual(['a', 'b', 'c']);
    });

    it('相同音符数与拍数时按 id 升序兜底', () => {
      const patterns = [
        makePattern({ id: 'p2', notes: [{ type: 'Single', lane: 1, beat: 0 }] }),
        makePattern({ id: 'p1', notes: [{ type: 'Single', lane: 2, beat: 0 }] }),
      ];
      expect(sortPatterns(patterns, { key: 'noteCount', direction: 'desc' }).map((p) => p.id))
        .toEqual(['p1', 'p2']);
      expect(sortPatterns(patterns, { key: 'beatSpan', direction: 'desc' }).map((p) => p.id))
        .toEqual(['p1', 'p2']);
    });
  });

  describe('置顶组优先与组内当前键排序', () => {
    it('置顶组永远在最前', () => {
      const patterns = [
        makePattern({ id: 'u1', name: 'Alpha', createdAt: 500 }),
        makePattern({ id: 'p1', name: 'Omega', createdAt: 100, pinnedAt: 50 }),
      ];
      // 哪怕按名称升序，置顶的 Omega 依然排在非置顶的 Alpha 前面
      expect(sortPatterns(patterns, { key: 'name', direction: 'asc' }).map((p) => p.id))
        .toEqual(['p1', 'u1']);
    });

    it('置顶组内按当前排序键 / 方向排（名称升序）', () => {
      const patterns = [
        makePattern({ id: 'pZ', name: 'Zeta', pinnedAt: 100 }),
        makePattern({ id: 'pA', name: 'Alpha', pinnedAt: 200 }),
        makePattern({ id: 'uB', name: 'Beta' }),
      ];
      expect(sortPatterns(patterns, { key: 'name', direction: 'asc' }).map((p) => p.id))
        .toEqual(['pA', 'pZ', 'uB']);
    });

    it('置顶组内按当前排序键 / 方向排（createdAt 升序）', () => {
      const patterns = [
        makePattern({ id: 'pLate', createdAt: 800, pinnedAt: 100 }),
        makePattern({ id: 'pEarly', createdAt: 200, pinnedAt: 200 }),
        makePattern({ id: 'uMid', createdAt: 500 }),
      ];
      expect(sortPatterns(patterns, { key: 'createdAt', direction: 'asc' }).map((p) => p.id))
        .toEqual(['pEarly', 'pLate', 'uMid']);
    });

    it('置顶组内按当前排序键 / 方向排（音符数降序）', () => {
      const pPinnedFew = makePattern({
        id: 'pFew',
        pinnedAt: 200,
        notes: [{ type: 'Single', lane: 1, beat: 0 }],
      });
      const pPinnedMany = makePattern({
        id: 'pMany',
        pinnedAt: 100,
        notes: [
          { type: 'Single', lane: 1, beat: 0 },
          { type: 'Single', lane: 2, beat: 1 },
        ],
      });
      const pUnpinnedMany = makePattern({
        id: 'uMany',
        notes: [
          { type: 'Single', lane: 1, beat: 0 },
          { type: 'Single', lane: 2, beat: 1 },
          { type: 'Single', lane: 3, beat: 2 },
        ],
      });
      expect(sortPatterns([pPinnedFew, pPinnedMany, pUnpinnedMany], { key: 'noteCount', direction: 'desc' }).map((p) => p.id))
        .toEqual(['pMany', 'pFew', 'uMany']);
    });

    it('置顶组内主键相同按 id 全序兜底', () => {
      const patterns = [
        makePattern({ id: 'pb', name: 'Same', pinnedAt: 100 }),
        makePattern({ id: 'pa', name: 'Same', pinnedAt: 200 }),
        makePattern({ id: 'u', name: 'Other' }),
      ];
      expect(sortPatterns(patterns, { key: 'name', direction: 'asc' }).map((p) => p.id))
        .toEqual(['pa', 'pb', 'u']);
    });
  });

  describe('缺省与边界', () => {
    it('缺省 sort 参数使用 DEFAULT_PATTERN_SORT（createdAt desc）', () => {
      const patterns = [
        makePattern({ id: 'a', createdAt: 100 }),
        makePattern({ id: 'b', createdAt: 300 }),
      ];
      expect(sortPatterns(patterns).map((p) => p.id)).toEqual(['b', 'a']);
      expect(DEFAULT_PATTERN_SORT).toEqual({ key: 'createdAt', direction: 'desc' });
    });

    it('空数组与单元素数组安全返回新数组', () => {
      expect(sortPatterns([])).toEqual([]);
      const single = [makePattern({ id: 'one' })];
      const res = sortPatterns(single);
      expect(res).toEqual(single);
      expect(res).not.toBe(single);
    });

    it('先过滤再排序：搜索不改变排序偏好', () => {
      const patterns = [
        makePattern({ id: 'p1', name: 'Verse A', createdAt: 100 }),
        makePattern({ id: 'p2', name: 'Chorus', createdAt: 500 }),
        makePattern({ id: 'p3', name: 'Verse B', createdAt: 300 }),
      ];
      // 模拟先用 query "Verse" 过滤出 p1, p3
      const filtered = patterns.filter((p) => p.name.includes('Verse'));
      const sorted = sortPatterns(filtered, { key: 'createdAt', direction: 'desc' });
      expect(sorted.map((p) => p.id)).toEqual(['p3', 'p1']);
    });
  });
});
