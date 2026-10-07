// 仿真场几何与接近模型（chart-preview 05 的锁测①）：纯函数那一半。
// 锁的是票面「画面要素」表里的算术：A(t_note) = 1、A(t_note − T) = 0.05（渐近值）、
// lane → x（含 mirror 的符号）、带体四边形顶点顺序、noteSpeed 档位 → T、设计面窄 / 宽下的钳制。
import { describe, expect, it } from 'vitest';
import { SIM_NOTE_SPEED_RANGE } from '@/src/chart/config/AppSettings';
import { NOTE_SKIN_GEOMETRY } from '@/src/rendering/skin/noteSkin';
import {
  APPROACH,
  DESIGN_SURFACE,
  LANE_DESIGN_W,
  SIM_FIELD_LIMITS,
  approachA,
  approachOf,
  approachSeconds,
  bandQuad,
  clampApproach,
  comboAnchor,
  effectAlpha,
  effectProgress,
  fieldImageRect,
  fieldMetrics,
  fieldY,
  fitDesignSurface,
  laneCenterX,
  laneFlashAlpha,
  laneOffsetDesign,
  mirrorLane,
  pingRadius,
  playLineRect,
  simEffectColor,
  simSpriteScale,
  visibleApproach,
} from '@/src/preview/video/sim/simGeometry';

const DESIGN_RATIO = DESIGN_SURFACE.w / DESIGN_SURFACE.h;
/** 设计面原尺寸下的场地几何（1334 × 750 → 判定线 615、lane 宽 154、原点 667） */
const m = fieldMetrics(DESIGN_SURFACE.w, DESIGN_SURFACE.h);

describe('接近模型（CONTEXT「接近模型」）', () => {
  it('A(t_note) = 1：音符正好落在场地判定线上', () => {
    expect(approachA(0, 1.25)).toBe(1);
    expect(approachOf(12, 12, approachSeconds(9.5))).toBe(1);
    expect(APPROACH.floor + APPROACH.range).toBe(1);
  });

  it('A(t_note − T) 落到渐近值 0.05（1 位小数内），且沿时间单调', () => {
    const T = approachSeconds(9.5);
    const far = approachA(-T, T);
    expect(far).toBeGreaterThan(APPROACH.floor);
    expect(far).toBeCloseTo(APPROACH.floor, 1);
    expect(far).toBeLessThan(approachA(-T / 2, T));
    expect(approachA(-T / 2, T)).toBeLessThan(approachA(0, T));
  });

  it('可见窗口 = Δ ∈ [−T, 0]：过线的与还没进场的一律 null', () => {
    const T = approachSeconds(9.5);
    expect(visibleApproach(10, 10, T)).toBe(1);
    expect(visibleApproach(10.001, 10, T)).toBeNull(); // 过线（A > 1 = 落到场地下方）
    expect(visibleApproach(10 - T - 0.001, 10, T)).toBeNull(); // 还没进场
    expect(visibleApproach(10 - T, 10, T)).toBeCloseTo(APPROACH.floor, 1);
  });

  it('noteSpeed 档位 → T = (12 − n)/2：1..11 → 5.5s..0.5s，默认 9.5 → 1.25s', () => {
    expect(approachSeconds(1)).toBe(5.5);
    expect(approachSeconds(11)).toBe(0.5);
    expect(approachSeconds(SIM_NOTE_SPEED_RANGE.fallback)).toBe(1.25);
    // 越界 / 非有限值经白名单归一化（上界 11 是模型的定义域边界：12 会让 T = 0）
    expect(approachSeconds(0)).toBe(5.5);
    expect(approachSeconds(99)).toBe(0.5);
    expect(approachSeconds(Number.NaN)).toBe(1.25);
  });
});

describe('设计面与场地几何', () => {
  it('laneWidth = 154 × W/1334、laneHeight = 0.82 × H、原点 (W/2, 0)', () => {
    expect(m.laneWidth).toBe(LANE_DESIGN_W);
    expect(m.laneHeight).toBeCloseTo(0.82 * DESIGN_SURFACE.h);
    expect(m.centerX).toBe(DESIGN_SURFACE.w / 2);
    const half = fieldMetrics(DESIGN_SURFACE.w / 2, DESIGN_SURFACE.h);
    expect(half.laneWidth).toBe(LANE_DESIGN_W / 2);
  });

  it('lane → x：中央轨居中、每轨一个 laneWidth、随 A 收缩（伪透视）', () => {
    expect(laneOffsetDesign(3)).toBe(0);
    expect(laneCenterX(m, 3, 1)).toBe(667);
    expect(laneCenterX(m, 0, 1)).toBe(667 - 3 * 154);
    expect(laneCenterX(m, 6, 1)).toBe(667 + 3 * 154);
    expect(laneCenterX(m, 0, 0.5)).toBe(667 - 3 * 154 * 0.5); // 越远越靠中
    expect(fieldY(m, 1)).toBe(m.laneHeight);
    expect(fieldY(m, 0.5)).toBe(m.laneHeight * 0.5);
  });

  it('镜向：车道对调（0↔6）、中央轨不动 —— 位置符号随之翻', () => {
    expect(mirrorLane(0, true)).toBe(6);
    expect(mirrorLane(6, true)).toBe(0);
    expect(mirrorLane(3, true)).toBe(3);
    expect(mirrorLane(2, false)).toBe(2);
    expect(laneCenterX(m, mirrorLane(1, true), 1)).toBe(laneCenterX(m, 5, 1));
  });

  it('设计面 contain 进窄 / 宽舞台都保住 1334:750，并按上下界钳制', () => {
    const wide = fitDesignSurface(1390, 603); // 宽舞台：高先到顶
    expect(wide.h).toBe(603);
    expect(wide.w / wide.h).toBeCloseTo(DESIGN_RATIO, 2);

    const narrow = fitDesignSurface(400, 900); // 窄舞台：宽先到顶
    expect(narrow.w).toBe(400);
    expect(narrow.w / narrow.h).toBeCloseTo(DESIGN_RATIO, 2);

    const tiny = fitDesignSurface(100, 80); // 太小：下限兜住（比例仍保住）
    expect(tiny.w).toBe(SIM_FIELD_LIMITS.minW);
    expect(tiny.w / tiny.h).toBeCloseTo(DESIGN_RATIO, 2);

    const huge = fitDesignSurface(4000, 3000); // 太大：上限兜住（位图不撑爆）
    expect(huge.w).toBe(SIM_FIELD_LIMITS.maxW);
    expect(huge.w / huge.h).toBeCloseTo(DESIGN_RATIO, 2);
  });

  it('上界 = 2560（chart-preview 19：大屏不再被 1920 钳住，画面随舞台长到 2560×1440 档）', () => {
    expect(SIM_FIELD_LIMITS.maxW).toBe(2560);
    const xl = fitDesignSurface(2560, 1440); // 2560 宽的舞台：场地能长到上界
    expect(xl.w).toBe(2560);
    expect(xl.h).toBe(Math.round(2560 / DESIGN_RATIO));
    // 仍是 contain：宽高比不变
    expect(xl.w / xl.h).toBeCloseTo(DESIGN_RATIO, 2);
  });
});

describe('场地三图的绘制矩形（chart-preview 18 问题 4）', () => {
  it('场地图：0.875W × 0.82H×0.983，水平居中、底边贴判定线', () => {
    const r = fieldImageRect(m);
    expect(r.w).toBeCloseTo(0.875 * DESIGN_SURFACE.w, 6);
    expect(r.h).toBeCloseTo(0.82 * 0.983 * DESIGN_SURFACE.h, 6);
    expect(r.x + r.w / 2).toBeCloseTo(m.centerX, 6);
    expect(r.y + r.h).toBeCloseTo(m.laneHeight, 6);
  });

  it('判定线：1.35W（素材 1800px = 1334×1.35 的 1:1 标尺）、上下居中于判定线、左右超出画布', () => {
    const r = playLineRect(m);
    expect(r.w).toBeCloseTo(1.35 * DESIGN_SURFACE.w, 6);
    expect(r.h).toBeCloseTo(r.w * (38 / 1800), 6);
    expect(r.x).toBeLessThan(0); // 左侧超出画布（素材自己带渐变收尾，照 Bestdori 的 1.35W）
    expect(r.x + r.w).toBeGreaterThan(m.w);
    expect(r.y + r.h / 2).toBeCloseTo(m.laneHeight, 6);
  });

  it('两张素材的轨道标尺 = laneWidth（修前拉满画布 ⇒ 判定线标记只有 0.74 lane 间距）', () => {
    // 判定线素材的 7 个标记在 1800px 图上间距 154px ⇒ 画到画布上的间距必须（差 < 1%）是 laneWidth
    const lineSpacing = 154 * (playLineRect(m).w / 1800);
    expect(Math.abs(lineSpacing - m.laneWidth) / m.laneWidth).toBeLessThan(0.01);
    // 场地图 1160px 素材的底边车道间距实测 154.3px ⇒ 与 laneWidth 相差 < 1%
    const fieldSpacing = 154.3 * (fieldImageRect(m).w / 1160);
    expect(Math.abs(fieldSpacing - m.laneWidth) / m.laneWidth).toBeLessThan(0.01);
  });
});

describe('带体四边形', () => {
  it('顶点顺序 = a 边左 → a 边右 → b 边右 → b 边左；边宽随各自的 A 收缩', () => {
    const [p0, p1, p2, p3] = bandQuad(m, { lane: 3, a: 1 }, { lane: 5, a: 0.5 });
    expect(p0).toEqual({ x: 667 - 77, y: 615 });
    expect(p1).toEqual({ x: 667 + 77, y: 615 });
    expect(p2).toEqual({ x: 667 + 2 * 154 * 0.5 + (154 * 0.5) / 2, y: 615 * 0.5 });
    expect(p3).toEqual({ x: 667 + 2 * 154 * 0.5 - (154 * 0.5) / 2, y: 615 * 0.5 });
  });

  it('倒流区折返：b 端落在 a 端下方也照样成形（不做任何排序修正）', () => {
    const quad = bandQuad(m, { lane: 0, a: 1 }, { lane: 1, a: 0.5 });
    expect(quad[0]!.y).toBeGreaterThan(quad[3]!.y);
  });

  it('clampApproach：过线的钉在判定线、没进场的钉在渐近位置', () => {
    expect(clampApproach(1.4)).toBe(1);
    expect(clampApproach(0)).toBe(APPROACH.floor);
    expect(clampApproach(0.5)).toBe(0.5);
  });
});

describe('特效参数与 HUD（程序化自绘）', () => {
  it('进度 / 不透明度：命中瞬间最亮、寿命到时归零', () => {
    expect(effectProgress(10, 10)).toBe(0);
    expect(effectProgress(10, 11)).toBeLessThan(0); // 还没命中
    expect(effectAlpha(0)).toBe(1);
    expect(effectAlpha(0.5)).toBeCloseTo(0.25);
    expect(effectAlpha(1)).toBe(0);
  });

  it('轨道闪 = 白 0.5 → 0（线性）', () => {
    expect(laneFlashAlpha(0)).toBe(0.5);
    expect(laneFlashAlpha(0.5)).toBeCloseTo(0.25);
    expect(laneFlashAlpha(1)).toBe(0);
  });

  it('打击环半径随进度涨（lane 单位 × A）', () => {
    expect(pingRadius(m, 1, 0)).toBeLessThan(pingRadius(m, 1, 1));
    expect(pingRadius(m, 1, 1)).toBeCloseTo(0.62 * 154);
  });

  it('特效配色按击打样式：tap / flick / skill / 滑条各一色，方向键分紫橙', () => {
    const all = [simEffectColor('tap'), simEffectColor('flick'), simEffectColor('skill'), simEffectColor('slide')];
    expect(new Set(all).size).toBe(4);
    expect(simEffectColor('directional', 'L')).not.toBe(simEffectColor('directional', 'R'));
  });

  it('combo 锚点照 Bestdori 落 0.85W × 0.4375H', () => {
    const anchor = comboAnchor(fieldMetrics(1000, 500));
    expect(anchor.x).toBe(850);
    expect(anchor.y).toBe(218.75);
  });

  it('精灵缩放：A = 1 时单键绘制宽 = 1.35 × noteSize × laneWidth', () => {
    expect(simSpriteScale(m, 1, 1) * NOTE_SKIN_GEOMETRY.MAIN_W).toBeCloseTo(1.35 * 154);
    expect(simSpriteScale(m, 0.5, 2) * NOTE_SKIN_GEOMETRY.MAIN_W).toBeCloseTo(1.35 * 2 * 154 * 0.5);
  });
});
