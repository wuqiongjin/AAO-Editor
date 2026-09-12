// issue 09 S2 / ADR-0009 §1-§2：段曲线生成器锁测（烘焙语义 / 护栏 / 重投影 / 导出剥离）。
import { describe, it, expect } from 'vitest';
import type { ConnectionNote, SlideNote } from '../../src/chart/types';
import {
  bakeEasingPoints, buildChainedSlide, buildPenSlide, effectiveSpanParams,
  regenerateSpan, reprojectSpanParams, connTrueBeat,
} from '../../src/chart/editing/SpanCurve';
import { convertNotesToChartCode, convertChartCodeToNotes, validateChartCode } from '../../src/chart/editing/ChartConverter';

const param = (over: Partial<{ family: 'quad'; type: 'in'; precision: 16 }> = {}) => ({
  kind: 'easing' as const,
  family: over.family ?? 'quad',
  type: over.type ?? 'in',
  precision: over.precision ?? 16,
});

describe('issue 09 · bakeEasingPoints（Bestdori 生成语义）', () => {
  it('quad/in 1拍 0→4 lane：f=16，p=1..15，beat=起拍+p/16，lane=4(p/16)²，全 hidden', () => {
    const pts = bakeEasingPoints({ lane: 0 }, { lane: 4 }, 1, 2, param());
    expect(pts).toHaveLength(15);
    expect(pts.every((p) => p.hidden === true)).toBe(true);
    expect(pts[0]!.beat).toBeCloseTo(1 + 1 / 16, 12);
    expect(pts[0]!.lane).toBeCloseTo(4 * Math.pow(1 / 16, 2), 12);
    expect(pts[3]!.beat).toBeCloseTo(1.25, 12);
    expect(pts[3]!.lane).toBeCloseTo(4 * 0.25 * 0.25, 12); // p=4 → (4/16)²=1/16 → 0.25
    expect(pts[7]!.beat).toBeCloseTo(1.5, 12);
    expect(pts[7]!.lane).toBeCloseTo(1.0, 12);
    expect(pts[14]!.beat).toBeCloseTo(1 + 15 / 16, 12);
    // 单调递增（beat 与 lane）
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]!.beat).toBeGreaterThan(pts[i - 1]!.beat);
      expect(pts[i]!.lane).toBeGreaterThanOrEqual(pts[i - 1]!.lane);
    }
  });

  it('lane 钳制 0..6 且允许小数（elastic 过冲被夹在轨道内）', () => {
    const pts = bakeEasingPoints({ lane: 0 }, { lane: 1 }, 0, 4, param({ family: 'elastic', type: 'out', precision: 16 }));
    for (const p of pts) {
      expect(p.lane).toBeGreaterThanOrEqual(0);
      expect(p.lane).toBeLessThanOrEqual(6);
    }
    const pts2 = bakeEasingPoints({ lane: 0 }, { lane: 6.5 }, 0, 2, param({ family: 'back', type: 'out', precision: 16 }));
    expect(Math.max(...pts2.map((p) => p.lane))).toBeLessThanOrEqual(6);
  });

  it('拍差小于一步 → 零采样点（直线段退化）', () => {
    expect(bakeEasingPoints({ lane: 1 }, { lane: 2 }, 1, 1 + 1 / 64, param({ precision: 16 }))).toHaveLength(0);
  });

  it('connTrueBeat：beat 十进制 + subBeat/beatDisplay 细分', () => {
    expect(connTrueBeat({ beat: 1.25 }, 4)).toBe(1.25);
    expect(connTrueBeat({ beat: 1, subBeat: 2 }, 4)).toBe(1.5);
  });
});

describe('issue 09 · buildChainedSlide（链式草稿）', () => {
  it('两段各配参数：连接点 = 端点×3 + 各段烘焙点；spanParams 计数 = 可见结点数', () => {
    const slide = buildChainedSlide(
      [{ beat: 1, lane: 1 }, { beat: 2, lane: 2 }, { beat: 4, lane: 2 }],
      { 0: param(), 1: param({ family: 'cubic', type: 'out' }) },
      4,
    );
    expect(slide.connections[0]).toMatchObject({ beat: 1, lane: 1 });
    expect(slide.connections.filter((c) => !c.hidden).map((c) => c.beat)).toEqual([1, 2, 4]);
    // 第一段 16 点、第二段 48 点（2 拍 × 1/16 → f=32... 修正：diff=2, precision=16 → f=32，31 点）
    const seg1 = slide.connections.filter((c) => c.hidden && c.beat > 1 && c.beat < 2);
    const seg2 = slide.connections.filter((c) => c.hidden && c.beat > 2 && c.beat < 4);
    expect(seg1).toHaveLength(15);
    expect(seg2).toHaveLength(31);
    expect(slide.spanParams).toEqual({ visibleCount: 3, bySpan: { 0: param(), 1: param({ family: 'cubic', type: 'out' }) } });
  });

  it('产物过 validateChartCode（首尾非 hidden、beat/lane 有限且在界内）', () => {
    const slide = buildChainedSlide(
      [{ beat: 1, lane: 0 }, { beat: 3, lane: 6 }],
      { 0: param({ family: 'back', type: 'out' }) },
      4,
    );
    const chart = [{ type: 'BPM' as const, beat: 0, bpm: 120 }, slide];
    expect(validateChartCode(convertNotesToChartCode(chart)).valid).toBe(true);
  });
});

describe('issue 09 · 参数自失效护栏（ADR-0009 §1 一致性规则）', () => {
  it('可见结点数失配 → effectiveSpanParams 返回空（退化普通点集段）', () => {
    const slide = buildChainedSlide([{ beat: 1, lane: 1 }, { beat: 2, lane: 2 }], { 0: param() }, 4);
    expect(Object.keys(effectiveSpanParams(slide))).toEqual(['0']);
    // 模拟手工改动可见序列（删端点/拆条/组合/92 转 hidden……任何让可见计数变化的路径）
    const tampered: SlideNote = { ...slide, connections: slide.connections.slice(0, -1) };
    expect(effectiveSpanParams(tampered)).toEqual({});
    const hiddenized: SlideNote = {
      ...slide,
      connections: [{ ...slide.connections[0]!, hidden: true }, ...slide.connections.slice(1)],
    };
    expect(effectiveSpanParams(hiddenized)).toEqual({});
  });

  it('hidden 点增删不影响护栏（hidden 不是可见序列）', () => {
    const slide = buildChainedSlide([{ beat: 1, lane: 1 }, { beat: 2, lane: 2 }], { 0: param() }, 4);
    const noHidden: SlideNote = { ...slide, connections: slide.connections.filter((c) => !c.hidden) };
    expect(effectiveSpanParams(noHidden)).toEqual({ 0: param() });
  });
});

describe('issue 09 · regenerateSpan（就地重应用/换缓动唯一写路径）', () => {
  it('直线段 [A,B] 重应用 → 烘焙 hidden；再次换缓动 → 替换不叠加', () => {
    const base: SlideNote = { type: 'Slide', connections: [{ beat: 1, lane: 0 }, { beat: 2, lane: 4 }] };
    const once = regenerateSpan(base, 0, param(), 4) as SlideNote;
    expect(once.connections.filter((c) => c.hidden)).toHaveLength(15);
    const twice = regenerateSpan(once, 0, param({ precision: 32 }), 4) as SlideNote;
    expect(twice.connections.filter((c) => c.hidden)).toHaveLength(31);
    expect(twice.spanParams?.bySpan[0]).toEqual(param({ precision: 32 }));
    expect(effectiveSpanParams(twice)[0]).toEqual(param({ precision: 32 }));
  });

  it('三可见结点：只动目标段，邻段 hidden 原样保留', () => {
    const slide = buildChainedSlide(
      [{ beat: 1, lane: 0 }, { beat: 2, lane: 2 }, { beat: 3, lane: 4 }],
      { 0: param(), 1: param({ family: 'sine', type: 'out' }) },
      4,
    );
    const seg1Before = slide.connections.filter((c) => c.hidden && c.beat > 2);
    const edited = regenerateSpan(slide, 0, param({ precision: 32 }), 4) as SlideNote;
    const seg1After = edited.connections.filter((c) => c.hidden && c.beat > 2);
    expect(seg1After).toEqual(seg1Before); // 第二段逐点不动
    expect(edited.connections.filter((c) => c.hidden && c.beat < 2)).toHaveLength(31);
  });

  it('非法段序数 → 原样返回', () => {
    const base: SlideNote = { type: 'Slide', connections: [{ beat: 1, lane: 0 }, { beat: 2, lane: 4 }] };
    expect(regenerateSpan(base, 5, param(), 4)).toBe(base);
  });
});

describe('issue 09 · reprojectSpanParams（端点拖动 = 重投影，参数保留）', () => {
  it('可见端点新位后：段内 hidden 按原参数重烘焙，参数不丢', () => {
    const slide = buildChainedSlide(
      [{ beat: 1, lane: 0 }, { beat: 2, lane: 2 }, { beat: 3, lane: 4 }],
      { 0: param(), 1: param() },
      4,
    );
    // 模拟拖拽已把中间可见结点移位（beat 2→2.5, lane 2→3）
    const moved: SlideNote = {
      ...slide,
      connections: slide.connections.map((c) => (!c.hidden && c.beat === 2 ? { ...c, beat: 2.5, lane: 3 } : c)),
    };
    const out = reprojectSpanParams(moved, 4) as SlideNote;
    expect(effectiveSpanParams(out)).toEqual({ 0: param(), 1: param() });
    // 第一段烘焙点整体落在 [1, 2.5]：quad/in、f=24，p=8 → beat 1.5、lane = 3·(8/24)² = 1/3
    const seg1Mid = out.connections.find((c) => c.hidden && Math.abs(c.beat - 1.5) < 1e-9)!;
    expect(seg1Mid.lane).toBeCloseTo(1 / 3, 6);
  });

  it('无参数的滑条 → 原样返回（自由段不动）', () => {
    const base: SlideNote = {
      type: 'Slide',
      connections: [{ beat: 1, lane: 0 }, { beat: 1.5, lane: 2, hidden: true }, { beat: 2, lane: 4 }],
    };
    expect(reprojectSpanParams(base, 4)).toBe(base);
  });
});

describe('issue 09 · 导出剥离与导入自由段（ADR-0009 §1 与 Bestdori 的边界）', () => {
  it('convertNotesToChartCode 不写 spanParams（谱面代码/Bestdori 导出天然纯净）', () => {
    const slide = buildChainedSlide([{ beat: 1, lane: 1 }, { beat: 2, lane: 2 }], { 0: param() }, 4);
    const code = convertNotesToChartCode([slide]);
    expect(code[0]).not.toHaveProperty('spanParams');
    expect(JSON.stringify(code)).not.toContain('spanParams');
  });

  it('导入（含 hidden 的谱面代码）→ 无参数自由段，点集逐字保留（不做拟合）', () => {
    const code = [{
      type: 'Slide' as const,
      connections: [
        { beat: 8, lane: 0 },
        { beat: 8.0625, lane: 0.63, hidden: true },
        { beat: 8.5, lane: 2 },
      ],
    }];
    const notes = convertChartCodeToNotes(code);
    const slide = notes[0] as SlideNote;
    expect(slide.spanParams).toBeUndefined();
    expect(slide.connections[1]).toEqual({ beat: 8.0625, lane: 0.63, hidden: true, flick: undefined, skill: undefined });
  });

  it('buildPenSlide：起终点可见、途中全 hidden、无参数', () => {
    const pen = buildPenSlide({ beat: 1, lane: 1 }, [{ beat: 1.5, lane: 2.4 }, { beat: 2, lane: 1.2 }], { beat: 3, lane: 0 });
    expect(pen.connections[0]).toEqual({ beat: 1, lane: 1 });
    expect(pen.connections.at(-1)).toEqual({ beat: 3, lane: 0 });
    expect(pen.connections.filter((c) => c.hidden)).toHaveLength(2);
    expect(pen.spanParams).toBeUndefined();
    expect((pen.connections[1] as ConnectionNote).hidden).toBe(true);
  });
});
