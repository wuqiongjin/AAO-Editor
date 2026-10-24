// 谱面域规则清单（issue 49）：平台「收什么、不收什么」的纯函数锁测。
//
// 清单判据写死在机制里：进一条规则要么有实测（真发帖撞到）、要么有在野证据
// （已发布社区谱里出现过该值）。本文件同时锁两件事：
//   ① width 规则本身——1/2/3 放行，域外点名（noteIndex + field + expected）；
//   ② **不误伤**——lane 越界（在野反例：已发布社区谱 143 张带 8791 个越界 lane）
//      与其余无证据候选（direction 变体、单结点 Slide）一律零警告。
import { describe, expect, test } from 'vitest';
import { checkChartDomainRules } from '@/src/chart/editing/ChartDomainRules';
import type { ChartCodeNote } from '@/src/chart/editing/ChartConverter';

const bpm0: ChartCodeNote = { beat: 0, type: 'BPM', bpm: 120 };

const directional = (width: unknown, overrides: Record<string, unknown> = {}): ChartCodeNote =>
    ({ beat: 4, lane: 2, type: 'Directional', direction: 'Left', width, ...overrides }) as ChartCodeNote;

describe('issue 49 · Directional width 规则', () => {
    test('width 1 / 2 / 3 放行（平台实测值域）', () => {
        for (const width of [1, 2, 3]) {
            expect(checkChartDomainRules([bpm0, directional(width)]), String(width)).toEqual([]);
        }
    });

    test('域外值逐条点名：noteIndex / field / expected 都在', () => {
        const issues = checkChartDomainRules([
            bpm0,
            directional(5),   // 用户实测被平台 POST_INVALID 的那个值
            directional(0),
            directional(4),   // 用户定案：4 也不行，不为 4 留口子
        ]);
        expect(issues.map((i) => i.noteIndex)).toEqual([1, 2, 3]);
        expect(issues.every((i) => i.field === 'width')).toBe(true);
        expect(typeof issues[0]!.reason).toBe('string');
    });

    test('谱面域文案不掺发布渠道的概念（验收定案 2026-10-24：编辑器不关心「平台」）', () => {
        const issues = checkChartDomainRules([directional(5)]);
        for (const issue of issues) {
            expect(issue.reason).not.toMatch(/平台|社区|发布/);
            // reason 已写明范围，不再挂「期望」段（重复）
            expect(issue.expected).toBeUndefined();
        }
    });

    test.each([-1, 2.5, '3', null, undefined])('width = %p 也算域外（值域是整数 1..3）', (width) => {
        const issues = checkChartDomainRules([directional(width)]);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ noteIndex: 0, field: 'width' });
    });

    test('只看顶层 Directional：Slide 结点没有 width 字段，不误报', () => {
        const slide: ChartCodeNote = {
            type: 'Slide',
            connections: [{ beat: 10, lane: 2, width: 9 }, { beat: 11, lane: 3 }],
        };
        expect(checkChartDomainRules([slide])).toEqual([]);
    });

    test('脏输入（null 项 / 非对象）不归这里管：零警告不抛异常', () => {
        const dirty = [null, 42, directional(5)] as unknown as ChartCodeNote[];
        expect(checkChartDomainRules(dirty).map((i) => i.noteIndex)).toEqual([2]);
        expect(checkChartDomainRules([])).toEqual([]);
    });
});

describe('issue 49 · 不误伤（没证据的不拦）', () => {
    test('lane 越界不进规则集（在野反例：已发布社区谱带越界 lane，平台是收的）', () => {
        const issues = checkChartDomainRules([
            bpm0,
            directional(2, { lane: -0.5 }),
            directional(3, { lane: 6.5 }),
            { beat: 5, lane: 8, type: 'Single' },
        ]);
        expect(issues).toEqual([]);
    });

    test('其余候选零证据零警告：direction 变体、单结点 Slide、大 BPM', () => {
        const issues = checkChartDomainRules([
            bpm0,
            directional(2, { direction: 'Other' }),
            { type: 'Slide', connections: [{ beat: 10, lane: 2 }] },
            { beat: 1, type: 'BPM', bpm: 9999 },
        ]);
        expect(issues).toEqual([]);
    });
});
