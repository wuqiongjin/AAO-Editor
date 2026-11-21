import { describe, it, expect } from 'vitest';
import {
  SHAPE_TEMPLATES,
  TEMPLATE_AMPLITUDE,
  TEMPLATE_CATEGORIES,
  TEMPLATE_SEGMENTED_MAX_POINTS,
  shapeTemplateById,
  bakeTemplatePoints,
  bakeTemplateParam,
  templateMappingMode,
  templateMinPoints,
  adaptiveTemplatePoints,
  heartShapeOffset,
  softElasticOffset,
} from '@/src/chart/editing/ShapeTemplates';
import { displayConnections } from '@/src/chart/editing/SlideSegments';
import { reprojectSpanParams } from '@/src/chart/editing/SpanCurve';
import type { SlideNote } from '@/src/chart/types';

describe('issue 223 · 形状模板库与自适应采样（方案 B：响应精度控制）', () => {
  it('templateMinPoints: 各精度档位返回对应合理的保底细分数', () => {
    // 默认 16 档：保底 32 点（波浪 48，大弧 16）
    expect(templateMinPoints('s-curve', 16)).toBe(32);
    expect(templateMinPoints('wave', 16)).toBe(48);
    expect(templateMinPoints('arc', 16)).toBe(16);
    expect(templateMinPoints('heart', 16)).toBe(32);

    // 32 档：保底 48 点（波浪 64，大弧 24）
    expect(templateMinPoints('s-curve', 32)).toBe(48);
    expect(templateMinPoints('wave', 32)).toBe(64);
    expect(templateMinPoints('arc', 32)).toBe(24);
    expect(templateMinPoints('heart', 32)).toBe(48);

    // 64 档：保底 64 点（波浪 96，大弧 32）
    expect(templateMinPoints('s-curve', 64)).toBe(64);
    expect(templateMinPoints('wave', 64)).toBe(96);
    expect(templateMinPoints('arc', 64)).toBe(32);
    expect(templateMinPoints('heart', 64)).toBe(64);
  });

  it('adaptiveTemplatePoints: 1 拍短段在各精度档位下生成对应的保底点数', () => {
    const fn = (t: number) => Math.sin(2 * Math.PI * t);

    // 1 拍在 16 档：N = clamp(16, 32, 128) = 32（31 个 hidden 点）
    const pts16 = adaptiveTemplatePoints(fn, 1.0, templateMinPoints('s-curve', 16), 16);
    expect(pts16).toHaveLength(31);

    // 1 拍在 32 档：N = clamp(32, 48, 128) = 48（47 个 hidden 点）
    const pts32 = adaptiveTemplatePoints(fn, 1.0, templateMinPoints('s-curve', 32), 32);
    expect(pts32).toHaveLength(47);

    // 1 拍在 64 档：N = clamp(64, 64, 128) = 64（63 个 hidden 点，极度丝滑）
    const pts64 = adaptiveTemplatePoints(fn, 1.0, templateMinPoints('s-curve', 64), 64);
    expect(pts64).toHaveLength(63);
  });

  it('adaptiveTemplatePoints: 长段按精度动态增加并截断于 128 上限', () => {
    const fn = (t: number) => Math.sin(2 * Math.PI * t);

    // 2 拍在 32 档：N = 2 * 32 = 64（63 个 hidden 点）
    const pts2x32 = adaptiveTemplatePoints(fn, 2.0, 32, 32);
    expect(pts2x32).toHaveLength(63);

    // 4 拍在 32 档：N = 4 * 32 = 128（127 个 hidden 点）
    const pts4x32 = adaptiveTemplatePoints(fn, 4.0, 32, 32);
    expect(pts4x32).toHaveLength(127);

    // 8 拍在 16 档：N = 8 * 16 = 128（127 个 hidden 点）
    const pts8x16 = adaptiveTemplatePoints(fn, 8.0, 32, 16);
    expect(pts8x16).toHaveLength(127);
  });

  it('平滑连续模板具备 sample 且 precisionSensitive=true；zigzag 改自适应齿数与窄幅并响应段密（忽略精度）', () => {
    const sCurve = shapeTemplateById('s-curve')!;
    const wave = shapeTemplateById('wave')!;
    const arc = shapeTemplateById('arc')!;
    const heart = shapeTemplateById('heart')!;
    const zigzag = shapeTemplateById('zigzag')!;

    expect(sCurve.sample).toBeDefined();
    expect(wave.sample).toBeDefined();
    expect(arc.sample).toBeDefined();
    expect(heart.sample).toBeDefined();
    expect(arc.precisionSensitive).toBe(true);
    expect(zigzag.precisionSensitive).toBe(false);
    expect(zigzag.adjustableDensity).toBe(true);

    // zigzag 不随 precision 变化点数，但随拍长与 densityScale 自适应增加齿数
    const z1p16 = bakeTemplatePoints({ lane: 3 }, { lane: 3 }, 0, 1, zigzag, 16, false, 1, 1);
    const z1p64 = bakeTemplatePoints({ lane: 3 }, { lane: 3 }, 0, 1, zigzag, 64, false, 1, 1);
    const z2Dense = bakeTemplatePoints({ lane: 3 }, { lane: 3 }, 0, 2, zigzag, 16, false, 1, 2);
    expect(z1p16).toHaveLength(z1p64.length);
    expect(z2Dense.length).toBeGreaterThan(z1p16.length);
    // 默认窄幅：off = ±0.45 → ±0.9 轨（center=3 → [2.1, 3.9]）
    expect(Math.max(...z1p16.map((c) => c.lane))).toBeCloseTo(3.9, 6);
    expect(Math.min(...z1p16.map((c) => c.lane))).toBeCloseTo(2.1, 6);
  });

  it('bakeTemplateParam 响应 param.precision', () => {
    // 1 拍 S 弯，传 precision: 64 -> 63 个点
    const baked64 = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 1, {
      kind: 'template', templateId: 's-curve', precision: 64,
    });
    expect(baked64).toHaveLength(63);

    // 1 拍 S 弯，传 precision: 16 -> 31 个点
    const baked16 = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 1, {
      kind: 'template', templateId: 's-curve', precision: 16,
    });
    expect(baked16).toHaveLength(31);

    // 缺省 precision -> 回退 16 档（31 个点）
    const bakedDef = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 1, {
      kind: 'template', templateId: 's-curve',
    });
    expect(bakedDef).toHaveLength(31);
  });

  it('heart 模板（半心弧）：label 为半心弧，单向外凸且峰值偏向上叶', () => {
    const heart = shapeTemplateById('heart')!;
    expect(heart.label).toBe('半心弧');

    // 端点闭合过零：t=0 和 t=1 均为 0
    expect(heartShapeOffset(0)).toBeCloseTo(0, 6);
    expect(heartShapeOffset(1)).toBeCloseTo(0, 6);

    // 半心轮廓：内部点恒正（off > 0），绝不反向穿过弦成为 S 弯
    for (let i = 1; i < 20; i++) {
      expect(heartShapeOffset(i / 20)).toBeGreaterThan(0);
    }

    // 心形肩部饱满特征：峰值位于中上部 t ∈ [0.6, 0.7]，且峰值接近 1.0
    expect(heartShapeOffset(0.65)).toBeGreaterThan(0.95);
    expect(heartShapeOffset(0.65)).toBeGreaterThan(heartShapeOffset(0.35));

    // 烘焙点列 beat 严格单调递增
    const baked = bakeTemplatePoints({ lane: 3 }, { lane: 3 }, 0, 4, heart, 64);
    expect(baked.length).toBeGreaterThan(0);
    for (let i = 1; i < baked.length; i++) {
      expect(baked[i]!.beat).toBeGreaterThan(baked[i - 1]!.beat);
    }
  });

  it('issue 225 · bakeTemplateParam 响应 param.mirrored 进行水平镜像烘焙', () => {
    // 默认（mirrored: false / undefined）：大弧向右凸出（lane > 3）
    const normalBaked = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 2, {
      kind: 'template', templateId: 'arc', precision: 16,
    });
    const normalMaxLane = Math.max(...normalBaked.map((c) => c.lane));
    expect(normalMaxLane).toBeCloseTo(5, 6);

    // mirrored: true：大弧向左凸出（lane < 3，峰值在 lane 1）
    const mirroredBaked = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 2, {
      kind: 'template', templateId: 'arc', precision: 16, mirrored: true,
    });
    const mirroredMinLane = Math.min(...mirroredBaked.map((c) => c.lane));
    expect(mirroredMinLane).toBeCloseTo(1, 6);

    // 对称性：normalBaked 与 mirroredBaked 各点关于 lane 3 严格镜像
    expect(normalBaked).toHaveLength(mirroredBaked.length);
    for (let i = 0; i < normalBaked.length; i++) {
      expect(normalBaked[i]!.beat).toBeCloseTo(mirroredBaked[i]!.beat, 6);
      expect(normalBaked[i]!.lane + mirroredBaked[i]!.lane).toBeCloseTo(6, 6);
    }
  });

  it('issue 235 · 18 款三分组模板目录完整、ID 唯一且全部可合法烘焙', () => {
    expect(SHAPE_TEMPLATES).toHaveLength(18);
    expect(new Set(SHAPE_TEMPLATES.map((t) => t.id)).size).toBe(18);
    expect(TEMPLATE_CATEGORIES).toEqual(['smooth', 'rhythm', 'special']);
    expect(SHAPE_TEMPLATES.filter((t) => t.category === 'smooth')).toHaveLength(8);
    expect(SHAPE_TEMPLATES.filter((t) => t.category === 'rhythm')).toHaveLength(4);
    expect(SHAPE_TEMPLATES.filter((t) => t.category === 'special')).toHaveLength(6);

    for (const tp of SHAPE_TEMPLATES) {
      const isEndpointInterp = templateMappingMode(tp) === 'endpoint-interp';
      const from = { lane: isEndpointInterp ? 1 : 3 };
      const to = { lane: isEndpointInterp ? 5 : 3 };
      const baked = bakeTemplateParam(from, to, 1, 3, {
        kind: 'template', templateId: tp.id, precision: 32, amplitudeScale: 1, densityScale: 1,
      });
      expect(baked.length, tp.id).toBeGreaterThan(0);
      expect(baked.length, `${tp.id} 点数不超上限`).toBeLessThanOrEqual(TEMPLATE_SEGMENTED_MAX_POINTS);
      for (let i = 0; i < baked.length; i++) {
        const pt = baked[i]!;
        expect(Number.isFinite(pt.beat), `${tp.id}[${i}].beat`).toBe(true);
        expect(Number.isFinite(pt.lane), `${tp.id}[${i}].lane`).toBe(true);
        expect(pt.lane).toBeGreaterThanOrEqual(0);
        expect(pt.lane).toBeLessThanOrEqual(6);
        expect(pt.beat).toBeGreaterThan(1);
        expect(pt.beat).toBeLessThan(3);
        if (i > 0) {
          // 同拍跃迁模板满足弱单调 t[i] >= t[i-1]；普通模板严格递增
          if (tp.hasZeroBeatJump) expect(pt.beat).toBeGreaterThanOrEqual(baked[i - 1]!.beat - 1e-12);
          else expect(pt.beat).toBeGreaterThan(baked[i - 1]!.beat);
        }
      }
    }
  });

  it('issue 235 · soft-elastic 延迟主峰在 t≈0.265 且起止平滑归零；gluten-comb 含同拍跃迁对', () => {
    expect(softElasticOffset(0)).toBe(0);
    expect(softElasticOffset(1)).toBe(0);
    expect(softElasticOffset(0.265)).toBeGreaterThan(0.95);
    expect(softElasticOffset(0.6)).toBeLessThan(-0.35);

    const comb = bakeTemplateParam({ lane: 2 }, { lane: 0 }, 5, 15, {
      kind: 'template', templateId: 'gluten-comb', densityScale: 1,
    });
    const zeroJumps = comb.filter((pt, idx) => idx > 0 && Math.abs(pt.beat - comb[idx - 1]!.beat) < 1e-9);
    expect(zeroJumps.length).toBeGreaterThan(0);
  });

  it('issue 235 · amplitudeScale 线性缩放偏移且安全钳制 0..6；densityScale 缩放段落密度', () => {
    const small = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 2, {
      kind: 'template', templateId: 'arc', precision: 16, amplitudeScale: 0.5,
    });
    const large = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 2, {
      kind: 'template', templateId: 'arc', precision: 16, amplitudeScale: 1.5,
    });
    // base arc amp = 2 lanes: 0.5× → 3+1=4; 1.5× → clamp(3+3,0,6)=6
    expect(Math.max(...small.map((c) => c.lane))).toBeCloseTo(4, 6);
    expect(Math.max(...large.map((c) => c.lane))).toBeCloseTo(6, 6);

    const sparse = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 2, {
      kind: 'template', templateId: 'chain-square', densityScale: 0.5,
    });
    const dense = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 2, {
      kind: 'template', templateId: 'chain-square', densityScale: 2,
    });
    expect(dense.length).toBeGreaterThan(sparse.length);

    // 极端长段 + 稠密倍率：所有模板（含 gluten-comb）点列严格不越过 256 上限
    for (const tp of SHAPE_TEMPLATES) {
      const stress = bakeTemplateParam({ lane: 2 }, { lane: 4 }, 0, 16, {
        kind: 'template', templateId: tp.id, precision: 64, amplitudeScale: 1.5, densityScale: 2,
      });
      expect(stress.length, `${tp.id} stress len`).toBeLessThanOrEqual(TEMPLATE_SEGMENTED_MAX_POINTS);
    }
  });

  it('issue 240 · step 阶梯改为端点插值型：单调直达终点无尾端折回，支持 sloped / sharp 切换与同轨退化', () => {
    const step = shapeTemplateById('step')!;
    expect(templateMappingMode(step)).toBe('endpoint-interp');

    // 同轨退化为直线（0 个 hidden 点）
    expect(bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 2, {
      kind: 'template', templateId: 'step', densityScale: 1,
    })).toEqual([]);

    // 1 → 5（2 拍）：6 级台阶，严格竖直踏板，单调递增不折回，不受 mirrored/amplitudeScale 干扰
    const asc = bakeTemplateParam({ lane: 1 }, { lane: 5 }, 0, 2, {
      kind: 'template', templateId: 'step', mirrored: true, amplitudeScale: 1.5, densityScale: 1,
    });
    expect(asc.length).toBe(10); // 6 levels -> 5 transitions * 2 pts
    expect(asc[0]!.lane).toBeCloseTo(1, 6);
    expect(asc.at(-1)!.lane).toBeCloseTo(5, 6);
    for (let i = 1; i < asc.length; i++) {
      expect(asc[i]!.beat).toBeGreaterThan(asc[i - 1]!.beat);
      expect(asc[i]!.lane).toBeGreaterThanOrEqual(asc[i - 1]!.lane - 1e-12);
    }

    // 5 → 1（反向）：单调递减直达 1
    const desc = bakeTemplateParam({ lane: 5 }, { lane: 1 }, 0, 2, {
      kind: 'template', templateId: 'step', densityScale: 1,
    });
    expect(desc[0]!.lane).toBeCloseTo(5, 6);
    expect(desc.at(-1)!.lane).toBeCloseTo(1, 6);
    for (let i = 1; i < desc.length; i++) {
      expect(desc[i]!.lane).toBeLessThanOrEqual(desc[i - 1]!.lane + 1e-12);
    }

    // 直角（sharp）：级间 Δbeat = 0 同拍跃阶，经 displayConnections 保序不丢点
    const sharp = bakeTemplateParam({ lane: 1 }, { lane: 5 }, 0, 2, {
      kind: 'template', templateId: 'step', densityScale: 1, extra: { stepStyle: 'sharp' },
    });
    expect(sharp).toHaveLength(10);
    const jumps = sharp.filter((pt, idx) => idx > 0 && Math.abs(pt.beat - sharp[idx - 1]!.beat) < 1e-9);
    expect(jumps).toHaveLength(5);
    const fullConns = [{ beat: 0, lane: 1 }, ...sharp, { beat: 2, lane: 5 }];
    expect(displayConnections(fullConns).conns).toHaveLength(fullConns.length);
  });

  it('issue 240 · pulse 尖刺位置 pulsePos：50% 向后兼容，0%/100% 走 Δbeat=0 对齐鼓点且显示投影完整保留', () => {
    // 默认 / 50%：1 拍 2 周期（count=2），与旧 [0.3w, 0.5w, 0.7w] 逐点一致
    const defPts = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 1, {
      kind: 'template', templateId: 'pulse', densityScale: 1,
    });
    const p50 = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 1, {
      kind: 'template', templateId: 'pulse', densityScale: 1, extra: { pulsePos: 50 },
    });
    expect(defPts).toEqual(p50);
    expect(defPts.map((p) => p.beat)).toEqual([0.15, 0.25, 0.35, 0.65, 0.75, 0.85]);

    // 0%：首周期在起拍 beat=0 同拍瞬间扎出尖刺（lane 5），次周期在 beat=0.5 Δbeat=0 跃迁
    const p0 = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 1, {
      kind: 'template', templateId: 'pulse', densityScale: 1, extra: { pulsePos: 0 },
    });
    expect(p0[0]).toMatchObject({ beat: 0, lane: 5, hidden: true });
    expect(p0[1]).toMatchObject({ beat: 0.1, lane: 3, hidden: true });
    expect(p0[2]).toMatchObject({ beat: 0.5, lane: 3, hidden: true });
    expect(p0[3]).toMatchObject({ beat: 0.5, lane: 5, hidden: true });
    const p0Conns = [{ beat: 0, lane: 3 }, ...p0, { beat: 1, lane: 3 }];
    expect(displayConnections(p0Conns).conns).toHaveLength(p0Conns.length);
    expect(displayConnections(p0Conns).conns[1]).toMatchObject({ beat: 0, lane: 5, hidden: true });

    // 100%：末周期在终点 beat=1 同拍收口，displayConnections 保留（含非二进制浮点拍不越过 toBeat）
    const p100 = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 1, {
      kind: 'template', templateId: 'pulse', densityScale: 1, extra: { pulsePos: 100 },
    });
    expect(p100.at(-1)).toMatchObject({ beat: 1, lane: 5, hidden: true });
    const p100Conns = [{ beat: 0, lane: 3 }, ...p100, { beat: 1, lane: 3 }];
    expect(displayConnections(p100Conns).conns).toHaveLength(p100Conns.length);

    const floatToBeat = 1.775;
    const p100Float = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0.725, floatToBeat, {
      kind: 'template', templateId: 'pulse', densityScale: 1, extra: { pulsePos: 100 },
    });
    expect(p100Float.at(-1)!.beat).toBe(floatToBeat);
    const floatConns = [{ beat: 0.725, lane: 3 }, ...p100Float, { beat: floatToBeat, lane: 3 }];
    expect(displayConnections(floatConns).conns).toHaveLength(floatConns.length);

    // 5%：贴近起点但保持连续上升斜边（beat 严格递增）
    const p5 = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 1, {
      kind: 'template', templateId: 'pulse', densityScale: 1, extra: { pulsePos: 5 },
    });
    expect(p5[0]!.beat).toBeCloseTo(0.025, 6);
    expect(p5[0]!.lane).toBeCloseTo(5, 6);
    for (let i = 1; i < p5.length; i++) {
      expect(p5[i]!.beat).toBeGreaterThan(p5[i - 1]!.beat);
    }
  });

  it('issue 241 · 自由调节范围（0.1..3.0 幅度 / 0.25..4.0 段密）与上限松绑（≤256 点护栏 + pulsePos 任意整数保真）', () => {
    // 幅度 0.1 / 1.25 / 3.0 线性缩放并安全钳制 0..6
    for (const amp of [0.1, 1.25, 3.0]) {
      const pts = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 2, {
        kind: 'template', templateId: 'arc', precision: 16, amplitudeScale: amp,
      });
      expect(pts.length).toBeGreaterThan(0);
      const peak = Math.max(...pts.map((p) => p.lane));
      expect(peak).toBeCloseTo(Math.min(6, 3 + 2 * amp), 6);
      for (const p of pts) {
        expect(p.lane).toBeGreaterThanOrEqual(0);
        expect(p.lane).toBeLessThanOrEqual(6);
      }
    }

    // 段密 0.25 / 3.5 / 4.0：4 拍 × 4× 段密时不再被旧 24 上限提前截停
    const pulse4x = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 4, {
      kind: 'template', templateId: 'pulse', densityScale: 4, extra: { pulsePos: 25 },
    });
    // 4 beats * 2 * 4 = 32 cycles -> > 24 cycles (32 * 3 = 96 pts > old 24 * 3 = 72 pts)
    expect(pulse4x.length).toBe(96);

    const step4x = bakeTemplateParam({ lane: 1 }, { lane: 5 }, 0, 4, {
      kind: 'template', templateId: 'step', densityScale: 4,
    });
    // 4 beats * 3 * 4 = 48 levels -> (48 - 1) * 2 = 94 pts > old (24 - 1) * 2 = 46 pts
    expect(step4x.length).toBe(94);

    // 超长跨度 × 4× 段密：所有 18 款模板产出均严格 <= 256、beat 弱单调递增且严格落在段内 (fromBeat, toBeat)（无端点溢出）
    const checkLongCap = (templateId: string, expectedPts: number) => {
      const pts = bakeTemplateParam({ lane: 1 }, { lane: 5 }, 0, 32, {
        kind: 'template', templateId, precision: 64, densityScale: 4.0,
      });
      expect(pts.length, `${templateId} 32b × 4×`).toBe(expectedPts);
      expect(pts.length).toBeLessThanOrEqual(TEMPLATE_SEGMENTED_MAX_POINTS);
      expect(pts[0]!.beat).toBeGreaterThan(0);
      expect(pts.at(-1)!.beat).toBeLessThan(32);
    };
    checkLongCap('pulse', 80 * 3);         // 80 周期上限 = 240 点
    checkLongCap('step', (120 - 1) * 2);   // 120 级上限 = 238 点
    checkLongCap('gluten-saw', 128 * 2);   // 128 循环上限 = 256 点（含 t < 1 防溢出校验）
    checkLongCap('chain-square', 128 * 2); // 128 循环上限 = 256 点
    checkLongCap('chain-alt', 128 * 2);    // 128 循环上限 = 256 点

    for (const tp of SHAPE_TEMPLATES) {
      const from = { lane: templateMappingMode(tp) === 'endpoint-interp' ? 1 : 2 };
      const to = { lane: templateMappingMode(tp) === 'endpoint-interp' ? 5 : 4 };
      const pts = bakeTemplateParam(from, to, 0, 32, {
        kind: 'template', templateId: tp.id, precision: 64, amplitudeScale: 3.0, densityScale: 4.0,
      });
      expect(pts.length, `${tp.id} @ 32b × 4×`).toBeGreaterThan(0);
      expect(pts.length, `${tp.id} @ 32b × 4×`).toBeLessThanOrEqual(TEMPLATE_SEGMENTED_MAX_POINTS);
      for (let i = 0; i < pts.length; i++) {
        expect(pts[i]!.beat).toBeGreaterThan(0);
        expect(pts[i]!.beat).toBeLessThan(32);
        expect(pts[i]!.lane).toBeGreaterThanOrEqual(0);
        expect(pts[i]!.lane).toBeLessThanOrEqual(6);
        if (i > 0) {
          expect(pts[i]!.beat).toBeGreaterThanOrEqual(pts[i - 1]!.beat - 1e-12);
        }
      }
    }

    // 稀疏段密 0.25× 对比 3.5× / 4.0×
    const zSparse = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 2, {
      kind: 'template', templateId: 'zigzag', densityScale: 0.25,
    });
    const zDense = bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 2, {
      kind: 'template', templateId: 'zigzag', densityScale: 3.5,
    });
    expect(zDense.length).toBeGreaterThan(zSparse.length);

    // pulsePos 任意中间整数值（15 / 25 / 75）烘焙与重投影完整保真
    for (const pos of [15, 25, 75]) {
      const param = {
        kind: 'template' as const,
        templateId: 'pulse',
        densityScale: 1,
        extra: { pulsePos: pos },
      };
      const slide: SlideNote = {
        type: 'Slide',
        connections: [
          { beat: 0, lane: 3 },
          ...bakeTemplateParam({ lane: 3 }, { lane: 3 }, 0, 1, param),
          { beat: 1, lane: 3 },
        ],
        spanParams: { 0: param },
      };
      const reprojected = reprojectSpanParams(slide, 4);
      expect(reprojected.spanParams?.[0]).toEqual(param);
      // 首周期峰值时间 = (0.5 * pos/100)
      const firstPeak = reprojected.connections.find((c) => c.hidden && Math.abs(c.lane - 5) < 1e-6);
      expect(firstPeak?.beat).toBeCloseTo(0.5 * (pos / 100), 6);
    }
  });
});

const OSCILLATION_IDS = [
  'zigzag', 'damped', 'gluten-spindle', 'gluten-saw', 'chain-square', 'chain-alt',
] as const;
const OSCILLATION_HALVES: Record<(typeof OSCILLATION_IDS)[number], number> = {
  zigzag: 0.45,
  damped: 0.75,
  'gluten-spindle': 0.85,
  'gluten-saw': 0.75,
  'chain-square': 0.55,
  'chain-alt': 0.6,
};

describe('issue 243 · 振荡基线偏移', () => {
  it('六款双侧摆动模板声明 baseline；尖刺/阶梯/大弧/梳齿/竹节没有该键', () => {
    for (const id of OSCILLATION_IDS) {
      const spec = shapeTemplateById(id)!.extraParams?.find((s) => s.key === 'baseline');
      expect(spec, id).toMatchObject({
        kind: 'range',
        defaultValue: 0,
        min: -200,
        max: 200,
        step: 5,
        unit: '%',
      });
    }
    for (const id of ['pulse', 'step', 'arc', 'gluten-comb', 'chain-bead'] as const) {
      expect(shapeTemplateById(id)!.extraParams?.some((s) => s.key === 'baseline')).toBeFalsy();
    }
  });

  it('同轨震动条 baseline=100 一侧贴弦且峰峰值不变；200 整串离弦；无 extra 回落 0', () => {
    const zigzag = shapeTemplateById('zigzag')!;
    const half = OSCILLATION_HALVES.zigzag;
    const amp = TEMPLATE_AMPLITUDE;
    const centered = bakeTemplatePoints({ lane: 3 }, { lane: 3 }, 0, 1, zigzag, 16, false, 1, 1);
    const stick = bakeTemplatePoints(
      { lane: 3 }, { lane: 3 }, 0, 1, zigzag, 16, false, 1, 1, { baseline: 100 },
    );
    const far = bakeTemplatePoints(
      { lane: 3 }, { lane: 3 }, 0, 1, zigzag, 16, false, 1, 1, { baseline: 200 },
    );
    const missing = bakeTemplatePoints({ lane: 3 }, { lane: 3 }, 0, 1, zigzag);

    const p2p = (pts: { lane: number }[]) =>
      Math.max(...pts.map((p) => p.lane)) - Math.min(...pts.map((p) => p.lane));
    expect(p2p(stick)).toBeCloseTo(2 * half * amp, 6);
    expect(p2p(centered)).toBeCloseTo(2 * half * amp, 6);
    expect(Math.min(...stick.map((p) => p.lane))).toBeCloseTo(3, 6);
    expect(Math.max(...stick.map((p) => p.lane))).toBeCloseTo(3 + 2 * half * amp, 6);
    expect(Math.min(...far.map((p) => p.lane))).toBeGreaterThan(3 + 0.5);
    expect(missing.map((p) => p.lane)).toEqual(centered.map((p) => p.lane));
  });

  it('余震尾部 hidden 靠近偏移基线而非弦；偏向只翻齿序不翻贴右方向', () => {
    const damped = shapeTemplateById('damped')!;
    const half = OSCILLATION_HALVES.damped;
    const stick = bakeTemplatePoints(
      { lane: 3 }, { lane: 3 }, 0, 2, damped, 16, false, 1, 1, { baseline: 100 },
    );
    const tail = stick.slice(-4);
    const baselineLane = 3 + TEMPLATE_AMPLITUDE * half;
    for (const p of tail) {
      expect(Math.abs(p.lane - baselineLane)).toBeLessThan(0.35);
      expect(Math.abs(p.lane - 3)).toBeGreaterThan(0.8);
    }

    const zigzag = shapeTemplateById('zigzag')!;
    const right = bakeTemplatePoints(
      { lane: 3 }, { lane: 3 }, 0, 1, zigzag, 16, false, 1, 1, { baseline: 100 },
    );
    const rightMirrored = bakeTemplatePoints(
      { lane: 3 }, { lane: 3 }, 0, 1, zigzag, 16, true, 1, 1, { baseline: 100 },
    );
    expect(Math.min(...right.map((p) => p.lane))).toBeCloseTo(3, 6);
    expect(Math.min(...rightMirrored.map((p) => p.lane))).toBeCloseTo(3, 6);
    expect(Math.max(...rightMirrored.map((p) => p.lane))).toBeCloseTo(3 + 2 * 0.45 * TEMPLATE_AMPLITUDE, 6);
    expect(right.map((p) => p.lane)).not.toEqual(rightMirrored.map((p) => p.lane));
  });
});
