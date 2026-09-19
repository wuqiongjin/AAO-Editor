// issue 09 S2 / ADR-0009 §1-§2：段曲线生成器锁测（烘焙语义 / 护栏 / 重投影 / 导出剥离）。
import { describe, it, expect } from 'vitest';
import type { ConnectionNote, SlideNote } from '@/src/chart/types';
import {
  bakeEasingPoints, bakeSpanPoints, bendSpan, buildChainedSlide, buildPenSlide, effectiveSpanParams,
  regenerateSpan, remapFreeSpanHidden, reprojectSpanParams, connTrueBeat, pinchWeight,
} from '@/src/chart/editing/SpanCurve';
import { convertNotesToChartCode, convertChartCodeToNotes, validateChartCode } from '@/src/chart/editing/ChartConverter';
import { shapeTemplateById } from '@/src/chart/editing/ShapeTemplates';

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

describe('issue 09 S3 · bendSpan（拉弓变形 / ADR-0009 §4）', () => {
  const slide = buildChainedSlide([{ beat: 1, lane: 2 }, { beat: 3, lane: 2 }], { 0: param({ family: 'sine', type: 'inOut' }) }, 4);

  it('两端锚定：端点 lane 不动；中点权重 1（全跟）、靠近端点少跟；beat 不动', () => {
    const bent = bendSpan(slide, 0, 2, 4) as SlideNote;
    expect(bent.connections[0]).toMatchObject({ lane: 2 });
    expect(bent.connections.at(-1)).toMatchObject({ lane: 2 });
    const mid = bent.connections.find((c) => c.hidden && Math.abs(c.beat - 2) < 1e-9)!;
    expect(mid.lane).toBeCloseTo(4, 9); // t=0.5 → w=1 → 2+2
    const near = bent.connections.find((c) => c.hidden && Math.abs(c.beat - 1.25) < 1e-9)!;
    // t=0.125 → 三角权重 w=0.25 → 2+0.5=2.5
    expect(near.lane).toBeCloseTo(2.5, 9);
    // beat 恒不变（拉弓只动 lane）
    expect(bent.connections.map((c) => c.beat)).toEqual(slide.connections.map((c) => c.beat));
  });

  it('一动就自由化：被拨段参数清除；其余段参数保留', () => {
    const two = buildChainedSlide(
      [{ beat: 1, lane: 0 }, { beat: 2, lane: 2 }, { beat: 3, lane: 4 }],
      { 0: param(), 1: param({ family: 'sine', type: 'out' }) },
      4,
    );
    // edge 16 = 第二段的第一条边（第一段 15 hidden → 段 0 覆盖 edge 0..15）
    const bent = bendSpan(two, 16, 1, 4) as SlideNote;
    expect(effectiveSpanParams(bent)[1]).toBeUndefined();
    expect(effectiveSpanParams(bent)[0]).toEqual(param());
    expect(bent.spanParams?.visibleCount).toBe(3);
  });

  it('拨普通段（无 hidden）= 自动补采样点转化（Q10=B），出生即 SP 段', () => {
    const plain: SlideNote = { type: 'Slide', connections: [{ beat: 1, lane: 0 }, { beat: 2, lane: 0 }] };
    const bent = bendSpan(plain, 0, 3, 4) as SlideNote;
    expect(bent.connections.filter((c) => c.hidden).length).toBeGreaterThanOrEqual(8);
    expect(bent.connections[0]).toMatchObject({ lane: 0 });
    expect(bent.connections.at(-1)).toMatchObject({ lane: 0 });
    const mid = bent.connections.find((c) => c.hidden && Math.abs(c.beat - 1.5) < 1e-9)!;
    expect(mid.lane).toBeCloseTo(3, 9);
    expect(bent.spanParams).toBeUndefined(); // 自由段
  });

  it('dLane=0 / 越界 edge → 原引用（无变化）', () => {
    expect(bendSpan(slide, 0, 0, 4)).toBe(slide);
    expect(bendSpan(slide, 32, 2, 4)).toBe(slide); // 2 拍 1/16 → 32 条 edge，32 越界
  });
});

describe('issue 108 · 捏形（位移场峰值 = 抓取点 / ADR-0009 §4）', () => {
  /** 段 1→2，15 个 hidden（1/16 栅格），全程 lane 2 */
  const span = (): SlideNote => {
    const conns: ConnectionNote[] = [{ beat: 1, lane: 2, subBeat: 0 }];
    for (let p = 1; p < 16; p++) conns.push({ beat: 1 + p / 16, lane: 2, subBeat: 0, hidden: true });
    conns.push({ beat: 2, lane: 2, subBeat: 0 });
    return { type: 'Slide', connections: conns } as SlideNote;
  };
  const laneAt = (s: SlideNote, beat: number) =>
    s.connections.find((c) => Math.abs(c.beat - beat) < 1e-9)!.lane;

  it('pinchWeight：grabT=0.5 与旧三角权重逐点相同（拉弓 = 抓中点的特例）', () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(pinchWeight(t, 0.5)).toBeCloseTo(1 - Math.abs(2 * t - 1), 12);
    }
  });

  it('pinchWeight：grabT=0.25 → 两端 0、峰值 1、左陡右缓', () => {
    expect(pinchWeight(0, 0.25)).toBeCloseTo(0, 12);
    expect(pinchWeight(1, 0.25)).toBeCloseTo(0, 12);
    expect(pinchWeight(0.25, 0.25)).toBeCloseTo(1, 12);
    expect(pinchWeight(0.125, 0.25)).toBeCloseTo(0.5, 12);        // 左：t/g
    expect(pinchWeight(0.625, 0.25)).toBeCloseTo(0.5, 12);        // 右：(1-t)/(1-g)
    // 左陡右缓：距抓取点同为 0.125 的两侧不对称（左 0.5 < 右 0.8333）
    expect(pinchWeight(0.375, 0.25)).toBeCloseTo(0.625 / 0.75, 12);
  });

  it('pinchWeight：grabT 落在 0/1 边界不产生 NaN / Infinity', () => {
    for (const g of [0, 1]) {
      for (const t of [0, 0.5, 1]) {
        expect(Number.isFinite(pinchWeight(t, g))).toBe(true);
      }
    }
  });

  it('抓中点 = 旧行为（不传 grabBeat 与传中点拍位结果一致）', () => {
    const a = bendSpan(span(), 0, 2, 4) as SlideNote;
    const b = bendSpan(span(), 0, 2, 4, 16, 1.5) as SlideNote;
    expect(b.connections.map((c) => c.lane)).toEqual(a.connections.map((c) => c.lane));
  });

  it('抓非中点：峰值落在抓取点（lane 增量 = dLane）、两端锚定、beat 不动', () => {
    const s = bendSpan(span(), 0, 2, 4, 16, 1.25) as SlideNote; // 最近采样点 beat 1.25 → t=0.25
    expect(laneAt(s, 1.25)).toBeCloseTo(4, 9);                  // w=1 → 2+2
    expect(laneAt(s, 1.5)).toBeCloseTo(2 + 2 * (0.5 / 0.75), 9);
    expect(s.connections[0]!.lane).toBe(2);                     // 端点锚定
    expect(s.connections.at(-1)!.lane).toBe(2);
    expect(s.connections.map((c) => c.beat)).toEqual(span().connections.map((c) => c.beat));
  });

  it('抓取点吸附到最近采样点（拍位距离，1/16 栅格内）', () => {
    const s = bendSpan(span(), 0, 2, 4, 16, 1.26) as SlideNote; // 最近 = 1.25
    expect(laneAt(s, 1.25)).toBeCloseTo(4, 9);
  });

  it('grabBeat 落在段外 → 钳到最近端点侧采样点，无 NaN', () => {
    const s = bendSpan(span(), 0, 2, 4, 16, 0.2) as SlideNote;
    expect(s.connections.every((c) => Number.isFinite(c.lane))).toBe(true);
    expect(s.connections[0]!.lane).toBe(2);
    expect(s.connections.at(-1)!.lane).toBe(2);
  });

  it('普通段（无 hidden）抓非中点：补 1/16 点后峰值仍在抓取点', () => {
    const plain = { type: 'Slide', connections: [{ beat: 1, lane: 0 }, { beat: 2, lane: 0 }] } as SlideNote;
    const s = bendSpan(plain, 0, 3, 4, 16, 1.25) as SlideNote;
    expect(laneAt(s, 1.25)).toBeCloseTo(3, 9);
    expect(laneAt(s, 1.5)).toBeCloseTo(3 * (0.5 / 0.75), 9);
    expect(s.connections[0]!.lane).toBe(0);
    expect(s.connections.at(-1)!.lane).toBe(0);
  });

  it('段极短（补不出采样点）→ 原引用：不制造"无变化的 undo 步"', () => {
    // 跨度 1/32 拍 × precision 16 → f = 1 → 补 0 个点
    const tiny = { type: 'Slide', connections: [{ beat: 1, lane: 0 }, { beat: 1 + 1 / 32, lane: 0 }] } as SlideNote;
    expect(bendSpan(tiny, 0, 2, 4)).toBe(tiny);
  });
});

describe('issue 09 S3 · remapFreeSpanHidden（自由段端点跟随重映射）', () => {
  it('hidden 点按旧端点投影 t 拉伸到新端点：弦上分量跟随 + 相对偏移保留', () => {
    // 旧段 [A(1,0) … B(2,4)]，中点 hidden 在 beat 1.5 / lane 3（弦上 2 + 偏移 1）
    const prev: ConnectionNote[] = [
      { beat: 1, lane: 0 }, { beat: 1.5, lane: 3, hidden: true }, { beat: 2, lane: 4 },
    ];
    // 新端点 [A(1,0) … B(3,0)]：t=0.5 → beat=2；新弦中点 lane 0 + 旧偏移 1 → lane 1
    const cur: ConnectionNote[] = [
      { beat: 1, lane: 0 }, { beat: 1.5, lane: 3, hidden: true }, { beat: 3, lane: 0 },
    ];
    const out = remapFreeSpanHidden(cur, prev, { start: 0, end: 2 }, 4);
    expect(out[1]).toMatchObject({ beat: 2, lane: 1 });
    // 可见端点不动
    expect(out[0]).toBe(cur[0]);
    expect(out[2]).toBe(cur[2]);
  });

  it('无 hidden 的段 → 原数组返回', () => {
    const cur: ConnectionNote[] = [{ beat: 1, lane: 0 }, { beat: 2, lane: 4 }];
    expect(remapFreeSpanHidden(cur, cur, { start: 0, end: 1 }, 4)).toBe(cur);
  });
});

describe('issue 09 S4 · 形状模板（ADR-0009 §2 三来源之三）', () => {
  it('bakeSpanPoints 派发：template 参数按库内点列生成 hidden 采样（beat 单调、lane = 弦 + off×2 轨）', () => {
    const tp = shapeTemplateById('arc')!;
    const pts = bakeSpanPoints({ lane: 0 }, { lane: 0 }, 1, 3, { kind: 'template', templateId: 'arc' });
    expect(pts.length).toBe(tp.points.length);
    expect(pts.every((p) => p.hidden === true)).toBe(true);
    // 弧顶：t=0.5 → off=1 → lane = 0 + 0×0.5 + 1×2 = 2
    const mid = pts.find((p) => Math.abs(p.beat - 2) < 1e-9)!;
    expect(mid.lane).toBeCloseTo(2, 9);
    // beat 单调
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.beat).toBeGreaterThan(pts[i - 1]!.beat);
    void tp;
  });

  it('模板段 regenerateSpan：换模板 = 替换采样点并记录新 id；未知模板 id 退化为直线（不抛错）', () => {
    const base: SlideNote = { type: 'Slide', connections: [{ beat: 1, lane: 0 }, { beat: 2, lane: 0 }] };
    const once = regenerateSpan(base, 0, { kind: 'template', templateId: 'wave' }, 4) as SlideNote;
    expect(once.connections.filter((c) => c.hidden).length).toBe(shapeTemplateById('wave')!.points.length);
    expect(effectiveSpanParams(once)[0]).toEqual({ kind: 'template', templateId: 'wave' });
    const twice = regenerateSpan(once, 0, { kind: 'easing', family: 'quad', type: 'in', precision: 16 }, 4) as SlideNote;
    expect(twice.spanParams?.bySpan[0]).toEqual({ kind: 'easing', family: 'quad', type: 'in', precision: 16 });
    const bad = regenerateSpan(base, 0, { kind: 'template', templateId: 'ghost-template' }, 4) as SlideNote;
    expect(bad.connections.filter((c) => c.hidden)).toHaveLength(0);
  });

  it('模板参数同走 visibleCount 护栏（可见序列改动 → 参数消失、点集保留）', () => {
    const once = regenerateSpan(
      { type: 'Slide', connections: [{ beat: 1, lane: 0 }, { beat: 2, lane: 0 }] },
      0, { kind: 'template', templateId: 's-curve' }, 4,
    ) as SlideNote;
    expect(Object.keys(effectiveSpanParams(once))).toEqual(['0']);
    const tampered: SlideNote = { ...once, connections: once.connections.slice(0, -1) };
    expect(effectiveSpanParams(tampered)).toEqual({});
    expect(once.connections.filter((c) => c.hidden).length).toBeGreaterThan(0); // 点集是唯一真相
  });
});
