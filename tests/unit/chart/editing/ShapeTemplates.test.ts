import { describe, it, expect } from 'vitest';
import {
  SHAPE_TEMPLATES,
  shapeTemplateById,
  bakeTemplatePoints,
  bakeTemplateParam,
  templateMinPoints,
  templateMinSegments,
  adaptiveTemplatePoints,
  halfHeartOffset,
  heartShapeOffset,
} from '@/src/chart/editing/ShapeTemplates';

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

  it('连续模板 (s-curve, wave, arc, heart) 具备 sample 生成器，zigzag 为离散固定点列', () => {
    const sCurve = shapeTemplateById('s-curve')!;
    const wave = shapeTemplateById('wave')!;
    const arc = shapeTemplateById('arc')!;
    const heart = shapeTemplateById('heart')!;
    const zigzag = shapeTemplateById('zigzag')!;

    expect(sCurve.sample).toBeDefined();
    expect(wave.sample).toBeDefined();
    expect(arc.sample).toBeDefined();
    expect(heart.sample).toBeDefined();
    expect(zigzag.sample).toBeUndefined();

    // zigzag 无论 span 与 precision 如何，bakeTemplatePoints 永远是固定的 24 个采样点 (25 份 - 首尾)
    const z1 = bakeTemplatePoints({ lane: 1 }, { lane: 3 }, 0, 1, zigzag, 64);
    const z8 = bakeTemplatePoints({ lane: 1 }, { lane: 3 }, 0, 8, zigzag, 16);
    expect(z1).toHaveLength(zigzag.points.length);
    expect(z8).toHaveLength(zigzag.points.length);
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
});
