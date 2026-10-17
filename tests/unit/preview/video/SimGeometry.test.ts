// 仿真场几何与接近模型（chart-preview 05 的锁测①）：纯函数那一半。
// 锁的是票面「画面要素」表里的算术：A(t_note) = 1、A(t_note − T) = 0.05（渐近值）、
// lane → x（含 mirror 的符号）、带体四边形顶点顺序、noteSpeed 档位 → T、设计面窄 / 宽下的钳制。
import { describe, expect, it } from 'vitest';
import { SIM_NOTE_SPEED_RANGE } from '@/src/chart/config/AppSettings';
import { NOTE_SKIN_GEOMETRY } from '@/src/rendering/skin/noteSkin';
import {
  APPROACH,
  APPROACH_MIN_SECONDS,
  DESIGN_SURFACE,
  LANE_DESIGN_W,
  SIM_FIELD_LIMITS,
  approachA,
  approachOf,
  approachSeconds,
  backgroundRect,
  bandLaneAt,
  bandQuad,
  clampApproach,
  comboAnchor,
  comboMetrics,
  comboPopScale,
  easeInCubic,
  easeOutCubic,
  effectAlpha,
  effectProgress,
  fieldImageRect,
  fieldMetrics,
  fieldY,
  fitDesignSurface,
  laneCenterX,
  laneFlashAlpha,
  laneFlashShear,
  laneOffsetDesign,
  mirrorLane,
  pingRadius,
  playLineRect,
  simDualLineThickness,
  simEffectColor,
  simNoteRect,
  simSpriteAspect,
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

  it('noteSpeed 档位 → T = max(0.1, (12 − n)/2)：1..12 → 5.5s..0.1s，默认 9.5 → 1.25s', () => {
    expect(approachSeconds(1)).toBe(5.5);
    expect(approachSeconds(11)).toBe(0.5);
    expect(approachSeconds(SIM_NOTE_SPEED_RANGE.fallback)).toBe(1.25);
    // 越界 / 非有限值经白名单归一化（上界 12 = 现代游戏的档位上限）
    expect(approachSeconds(0)).toBe(5.5);
    expect(approachSeconds(99)).toBe(APPROACH_MIN_SECONDS);
    expect(approachSeconds(Number.NaN)).toBe(1.25);
  });

  it('票 24：12 档不再退化成 T = 0 —— 落到下限、仍是正数，且与 n ≥ 11.8 连续', () => {
    expect(approachSeconds(12)).toBe(APPROACH_MIN_SECONDS);
    expect(approachSeconds(12)).toBeGreaterThan(0); // 今天差的 0 那条要能红
    expect(approachSeconds(11.8)).toBe(APPROACH_MIN_SECONDS); // 11.8 起就贴着下限 ⇒ 无跳变
    expect(approachSeconds(11.9)).toBe(APPROACH_MIN_SECONDS);
    expect(approachSeconds(11.7)).toBeCloseTo(0.15, 6); // 下限之上仍是原公式
  });

  it('票 24：T = 下限那一档的 A 仍成立（Δ = −T ⇒ ≈ 0.058）', () => {
    const t = approachSeconds(12);
    expect(t).toBe(APPROACH_MIN_SECONDS);
    expect(approachA(-t, t)).toBeCloseTo(0.058, 2);
    expect(approachA(-t, t)).toBeGreaterThan(APPROACH.floor);
    expect(approachOf(10 - t, 10, t)).toBeCloseTo(approachA(-t, t), 12);
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

  // 票 27：黑边 = 播放条占的那一行（`play-bar--preview` 的 32 + 舞台 gap 8 = 40，票 19 / 26 收过一档后的值）
  const PLAY_ROW_PX = 32 + 8;
  const barsFor = (screenW: number, metrics: { w: number }) => (screenW - metrics.w) / 2;

  it('票 27 · 全屏黑边 = 播放条那一行的算术（去掉它 ⇒ 16:9 屏左右黑边归零）', () => {
    // 现状：舞台里那一行占掉 40px ⇒ 画面只吃到 `屏高 − 40`、宽按设计面比例缩到 1850
    // ⇒ 每侧黑边 (1920 − 1850) / 2 ≈ 35px，与票 27 的真机实测（各 35px）逐位吻合
    const before = fitDesignSurface(1920, 1080 - PLAY_ROW_PX);
    expect(before).toMatchObject({ w: 1850, h: 1080 - PLAY_ROW_PX });
    expect(barsFor(1920, before)).toBeCloseTo(35, 0);

    // 播放条浮在画面上（脱离文档流）⇒ 画面吃到整个舞台高度 ⇒ 黑边 0，面积 +7.7%（票面实测）
    const after = fitDesignSurface(1920, 1080);
    expect(after.w).toBe(1920);
    expect((after.w * after.h) / (before.w * before.h) - 1).toBeGreaterThan(0.07);
  });

  it('票 27 · 21:9 屏上那一行更贵：画面被高钳住后仍差 475px（另有 maxW 成因）', () => {
    // 3440×1440 下 `fitDesignSurface(3440, 1400)` 出来 2490×1400（h 先被 1400 钳住）
    const before = fitDesignSurface(3440, 1440 - PLAY_ROW_PX);
    expect(before.w).toBe(2490);
    expect(barsFor(3440, before)).toBeCloseTo(475, 0);
    // 去掉那一行后也只到 2560×1439 —— 真正卡住它的是 maxW（本票的 F，登记观察项不管）
    const after = fitDesignSurface(3440, 1440);
    expect(after.w).toBe(SIM_FIELD_LIMITS.maxW);
    expect(barsFor(3440, after)).toBeCloseTo(440, 0);
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
    const [p0, p1, p2, p3] = bandQuad(m, { lane: 3, a: 1 }, { lane: 5, a: 0.5 }, 1);
    expect(p0).toEqual({ x: 667 - 77, y: 615 });
    expect(p1).toEqual({ x: 667 + 77, y: 615 });
    expect(p2).toEqual({ x: 667 + 2 * 154 * 0.5 + (154 * 0.5) / 2, y: 615 * 0.5 });
    expect(p3).toEqual({ x: 667 + 2 * 154 * 0.5 - (154 * 0.5) / 2, y: 615 * 0.5 });
  });

  it('倒流区折返：b 端落在 a 端下方也照样成形（不做任何排序修正）', () => {
    const quad = bandQuad(m, { lane: 0, a: 1 }, { lane: 1, a: 0.5 }, 1);
    expect(quad[0]!.y).toBeGreaterThan(quad[3]!.y);
  });

  it('issue 47：边宽 × noteSize（与音符盒子 / 双押线同一口径；修前恒 1 lane）', () => {
    const [p0, p1] = bandQuad(m, { lane: 3, a: 1 }, { lane: 3, a: 1 }, 2);
    expect(p1.x - p0.x).toBeCloseTo(m.laneWidth * 2, 6);
    // A 的收缩与 noteSize 正交：半宽 = laneWidth × noteSize × A / 2
    const [q0, q1] = bandQuad(m, { lane: 3, a: 0.5 }, { lane: 3, a: 0.5 }, 2);
    expect(q1.x - q0.x).toBeCloseTo(m.laneWidth * 2 * 0.5, 6);
  });

  it('clampApproach：过线的钉在判定线、没进场的钉在渐近位置', () => {
    expect(clampApproach(1.4)).toBe(1);
    expect(clampApproach(0)).toBe(APPROACH.floor);
    expect(clampApproach(0.5)).toBe(0.5);
  });
});

describe('票 23 #1 · 带体过线端沿带子行进（bandLaneAt）', () => {
  it('按时间插值：起点在 lane0、终点在 lane1、中间线性', () => {
    const band = { t0: 1, lane0: 3, t1: 2, lane1: 5 };
    expect(bandLaneAt(band, 1)).toBe(3);
    expect(bandLaneAt(band, 1.5)).toBe(4);
    expect(bandLaneAt(band, 2)).toBe(5);
  });

  it('倒流 / 折返段（t1 < t0）：同一条线、同一个点 —— 结果与两端顺序无关', () => {
    expect(bandLaneAt({ t0: 2, lane0: 5, t1: 1, lane1: 3 }, 1.5)).toBe(4);
  });

  it('t1 === t0：按同轨处理，不除零、不出 NaN', () => {
    const same = { t0: 1, lane0: 3, t1: 1, lane1: 5 };
    expect(bandLaneAt(same, 1.5)).toBe(3);
    expect(Number.isFinite(bandLaneAt(same, 1.5))).toBe(true);
  });
});

describe('票 23 #2 · 音符盒子 / 同时点击线 / 背景取景', () => {
  it('simNoteRect：宽 = 1.35 × noteSize × laneWidth × A，高 = 宽 × 精灵源格比', () => {
    const r = simNoteRect(m, 1, 1, 120 / 308);
    expect(r.w).toBeCloseTo(1.35 * 154, 6);
    expect(r.h).toBeCloseTo(1.35 * 154 * (120 / 308), 6);
    // 屏上纵横比 = 精灵自然比 308:120（修前吃设计盒的 36:21.6 = 1.667 ⇒ 纵向拉高 1.54 倍）
    expect(r.w / r.h).toBeCloseTo(308 / 120, 6);
    // A 与 noteSize 都线性（0.5 × 2 = 1）
    expect(simNoteRect(m, 0.5, 2, 120 / 308)).toEqual(r);
    // 方向键本体：同一套盒子、只差设计宽（45 设计 px = 1.25 × 单键），比仍由源格定
    const dir = simNoteRect(m, 1, 1, 120 / 308, 45);
    expect(dir.w).toBeCloseTo(r.w * (45 / 36), 6);
    expect(dir.w / dir.h).toBeCloseTo(308 / 120, 6);
  });

  it('simSpriteAspect：取源矩形的高/宽；尺寸缺失 / 退化 → 回落 120/308', () => {
    expect(simSpriteAspect({ w: 308, h: 120 })).toBeCloseTo(120 / 308, 12);
    expect(simSpriteAspect({ w: 0, h: 120 })).toBeCloseTo(120 / 308, 12);
    expect(simSpriteAspect({ w: 308, h: 0 })).toBeCloseTo(120 / 308, 12);
    const fallback = simNoteRect(m, 1, 1, 0);
    expect(fallback.h / fallback.w).toBeCloseTo(120 / 308, 12);
  });

  it('同时点击线：粗细 = 1.35 × 27/308 × noteSize × laneWidth × A（修前 0.3 ≈ 2.5 倍粗）', () => {
    const thickness = simDualLineThickness(m, 1, 1);
    expect(thickness).toBeCloseTo(1.35 * (27 / 308) * 154, 6);
    expect((0.3 * 154) / thickness).toBeCloseTo(2.53, 2);
    expect(simDualLineThickness(m, 0.5, 2)).toBeCloseTo(thickness, 6);
  });

  it('背景取景 = 1.32W × 1.0065W、水平居中、上缘 H/2 − 0.3775·图高（设计面上 ≈ −0.176H）', () => {
    const r = backgroundRect(m);
    expect(r.w).toBeCloseTo(1.32 * DESIGN_SURFACE.w, 6);
    expect(r.h).toBeCloseTo(1.0065 * DESIGN_SURFACE.w, 6);
    expect(r.x + r.w / 2).toBeCloseTo(m.centerX, 6);
    expect(r.y).toBeCloseTo(m.h / 2 - 0.3775 * r.h, 6);
    expect(r.y / m.h).toBeCloseTo(-0.176, 2); // 与票面记的 −0.176H 对上
    expect(r.y + r.h).toBeGreaterThan(m.h); // 下缘沉到画布之下（幕布铺满）
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

  it('Bestdori 口径（chart-preview 21）：缓动 / combo 尺寸与弹跳 / 轨道闪剪切', () => {
    expect(easeInCubic(0.5)).toBeCloseTo(0.125, 6);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 6);

    const combo = comboMetrics(m);
    expect(combo.digitH).toBeCloseTo(0.125 * DESIGN_SURFACE.h, 6); // 数字高 = 0.125H
    expect(combo.digitW).toBeCloseTo(0.09375 * DESIGN_SURFACE.h, 6);
    expect(combo.labelW / combo.labelH).toBeCloseTo(150 / 41, 6); // combo.png 的比例
    expect(combo.labelGap).toBeCloseTo(combo.digitH / 2, 6); // 标签从数字下缘起

    // 弹跳：命中瞬间 0.8 → 0.1s 时 1.1 → 0.2s 落回 1（之后一直是 1）
    expect(comboPopScale(0)).toBeCloseTo(0.8, 6);
    expect(comboPopScale(0.1)).toBeCloseTo(1.1, 6);
    expect(comboPopScale(0.2)).toBeCloseTo(1, 6);
    expect(comboPopScale(5)).toBe(1);

    // 轨道闪剪切：最外轨的上下缘错开 3.5 / 2.5 个 lane（照 Bestdori 的 (lane−0.5)）
    expect(laneFlashShear(m, 0)).toBeCloseTo(-3.5 * (m.laneWidth / m.laneHeight), 6);
    expect(laneFlashShear(m, 6)).toBeCloseTo(2.5 * (m.laneWidth / m.laneHeight), 6);
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
