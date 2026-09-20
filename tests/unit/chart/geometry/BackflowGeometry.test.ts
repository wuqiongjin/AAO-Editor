// issue 104 · 倒流区时间轴与几何（ADR-0010 结论 3/4/5/9 的落地锁）。
//
// 测试谱 = ADR-0010 附录 B 的变体（把中段改成 -240，让三层斜率互不相同）：
//   `[{beat:0,bpm:120}, {beat:5,bpm:-240}, {beat:6.5,bpm:120}]`
//   秒：t(0)=0 → t(5)=2.5 → t(6.5)=2.125 → t(7)=2.375 → t(7.25)=2.5
//   像素（verticalRatio=1，密度 440 px/s = 2·BEAT_HEIGHT）：1100 / 935 / 1045 / 1100
//   折返带 t ∈ [2.125, 2.5]（pos ∈ [935, 1100]）内同一 y 有三层：
//     L1（段 0，0.5 s/拍上坡）beat 4.25–5 ／ L2（段 1，-0.25 s/拍回程）beat 6.5–5 ／ L3 beat 6.5–7.25
import { describe, it, expect } from 'vitest';
import { ChartGeometry, BEAT_HEIGHT } from '@/src/chart/geometry/ChartGeometry';
import { buildChainedSlide, previewSpanConnections } from '@/src/chart/editing/SpanCurve';
import type { BpmEvent } from '@/src/audio/AudioTiming';
import type { ChartNote } from '@/src/chart/types';
import { readSource } from '@/tests/support/source';

const FOLD: BpmEvent[] = [{ beat: 0, bpm: 120 }, { beat: 5, bpm: -240 }, { beat: 6.5, bpm: 120 }];
const SURFACE = { w: 750, h: 900 };
const DURATION = 2.5; // = t(5) = t(7.25)：谱面长度就取折返带的顶
const BEAT_DISPLAY = 4;
/** 视口：scrollY=0 → 基线 C = chartEndVirtualY + surface.h = 2000 */
const VIEWPORT = { scrollX: 0, scrollY: 0, scale: 1 };
/** 只覆盖折返带的虚拟 Y 窗口（pos 935–1100 → virtualY 900–1065） */
const BAND_BOUNDS = { minX: 0, maxX: 1000, minY: 900, maxY: 1065 };

const geo = (duration = DURATION) => new ChartGeometry(FOLD, { seconds: duration }, SURFACE);

describe('issue 104 · 画布高度由秒直出（修法 1）', () => {
  it('chartEndVirtualY = 谱面长度(秒) × 像素密度，与 bpm / 倒流区无关', () => {
    const g = geo();
    expect(g.virtualPxPerSecond).toBeCloseTo(2 * BEAT_HEIGHT, 6);
    expect(g.chartEndVirtualY).toBeCloseTo(DURATION * 2 * BEAT_HEIGHT, 6);
    expect(geo(10).chartEndVirtualY).toBeCloseTo(10 * 2 * BEAT_HEIGHT, 6);
    // 纵向比例参与密度（issue 39 #5）
    const g2 = new ChartGeometry(FOLD, { seconds: DURATION }, SURFACE, 1.5);
    expect(g2.chartEndVirtualY).toBeCloseTo(DURATION * 2 * BEAT_HEIGHT * 1.5, 6);
  });

  it('chartEndBeat 由**最大 beat 解**派生（不是反查出来的唯一值）', () => {
    // pos=1100 的解是 {beat 5, 段 1} 与 {beat 7.25, 段 2} → 末端拍 = 7.25
    expect(geo().chartEndBeat).toBeCloseTo(7.25, 6);
  });

  it('拍域声明口径（{ endBeat }）保持原语义：高度 = positionOfBeat(该拍)（测试/工具用）', () => {
    const g = new ChartGeometry(FOLD, { endBeat: 5 }, SURFACE);
    expect(g.chartEndBeat).toBe(5);
    expect(g.chartEndVirtualY).toBeCloseTo(1100, 6);
  });
});

describe('issue 104 · 秒读数走布局轴直读（修法 3）', () => {
  it('virtualYToSeconds 线性直读，折返带内连续且与层无关', () => {
    const g = geo();
    // virtualY 1065 → pos 935 → 2.125s（折返带底）
    expect(g.virtualYToSeconds(1065, 1)).toBeCloseTo(2.125, 6);
    // 同一 y 的三层共享同一个秒（beat 不同、秒相同）——这正是"秒单值、拍多值"
    for (const beat of [4.25, 6.5, 6.5]) {
      const y = g.beatToVirtualY(beat, 1);
      expect(g.virtualYToSeconds(y, 1)).toBeCloseTo(g.timeline.positionOfBeat(beat) / g.virtualPxPerSecond, 6);
    }
    // 判定线（画布底边）= 当前滚动位置对应的秒
    expect(g.virtualYToSeconds(VIEWPORT.scrollY + SURFACE.h, 1)).toBeCloseTo(2.5 - 0, 6);
  });

  it('virtualYSolutions 列出各层；virtualYToBeat 取最大解（空白新增口径）', () => {
    const g = geo();
    const y = g.virtualYOfPos(2.3 * g.virtualPxPerSecond, 1); // pos 1012 → t=2.3s
    const sols = g.virtualYSolutions(y, 1);
    expect(sols.map(s => s.segmentIndex)).toEqual([0, 1, 2]);
    expect(sols.map(s => s.beat)).toEqual([
      expect.closeTo(4.6, 6), expect.closeTo(5.8, 6), expect.closeTo(6.85, 6),
    ]);
    expect(g.virtualYToBeat(y, 1)).toBeCloseTo(6.85, 6); // 最大 beat 解（= 与制谱器逐操作等价的那个）
  });

  it('layerBeatFromCanvas：拖拽锚定被拖元素所在层（段外按该层斜率外推）', () => {
    const g = geo();
    const y = g.virtualYOfPos(2.3 * g.virtualPxPerSecond, 1);
    // 同一个画布点，按不同层换算得到不同的拍——拖拽必须用**被拖元素那一层**
    expect(g.layerBeatFromCanvas(y, VIEWPORT, 0)).toBeCloseTo(4.6, 6);
    expect(g.layerBeatFromCanvas(y, VIEWPORT, 1)).toBeCloseTo(5.8, 6);
    expect(g.layerBeatFromCanvas(y, VIEWPORT, 2)).toBeCloseTo(6.85, 6);
  });
});

describe('issue 104 · 剔除按布局坐标（修法 4）', () => {
  const notes: ChartNote[] = [
    { type: 'Single', lane: 0, beat: 4.5 },  // L1，pos 990
    { type: 'Single', lane: 1, beat: 5.75 }, // L2，pos 1017.5
    { type: 'Single', lane: 2, beat: 7 },    // L3，pos 1045
    { type: 'Single', lane: 3, beat: 1 },    // 带外（pos 440）
  ];

  it('折返带内的**各层**音符都在可见集里（旧实现按 beat 窗口反推只留最后一层）', () => {
    const g = geo();
    const visible = g.visibleNotes(notes, VIEWPORT, BEAT_DISPLAY, BAND_BOUNDS).map(v => v.index).sort();
    expect(visible).toEqual([0, 1, 2]); // beat 1 那件在带外，不入选
  });

  it('visibleBeatRanges 折返带 → 多段区间，并集覆盖三层', () => {
    const g = geo();
    const ranges = g.visibleBeatRanges({ ...VIEWPORT, scale: 1 });
    // 折返区下同一视口覆盖多个拍区间（单调谱面恒为单区间）
    expect(ranges.length).toBe(3);
    const covers = (b: number) => ranges.some(r => b >= r.start && b <= r.end);
    expect(covers(4.5)).toBe(true);  // L1
    expect(covers(5.75)).toBe(true); // L2
    expect(covers(7)).toBe(true);    // L3
    // 对照：同一视口在单调谱面下只有一个区间
    const mono = new ChartGeometry([{ beat: 0, bpm: 120 }], { seconds: DURATION }, SURFACE);
    expect(mono.visibleBeatRanges(VIEWPORT).length).toBe(1);
  });

  it('瓦片失效的布局坐标区间 = 时间轴正向极值（折返的回落点也在内）', () => {
    const g = geo();
    // beat [5,7]：两端 1100 / 1045，但区间内 beat 6.5 回落到 935 → 真区间 [935, 1100]
    const r = g.timeline.positionRangeOfBeats(5, 7);
    expect(r.min).toBeCloseTo(935, 6);
    expect(r.max).toBeCloseTo(1100, 6);
  });
});

describe('issue 104 · 曲线工具两击直放预览按折返几何显示（修法 9）', () => {
  const param = { kind: 'easing' as const, family: 'sine' as const, type: 'in' as const, precision: 16 as const };

  it('跨倒流区的预览：拍单调递增，但映射到画布 Y 非单调（折返真的画出来）', () => {
    const g = geo();
    const conns = previewSpanConnections({ beat: 4.5, lane: 0 }, { beat: 7, lane: 6 }, param, BEAT_DISPLAY);
    const beats = conns.map(c => c.beat + (c.subBeat || 0) / BEAT_DISPLAY);
    expect(beats.length).toBeGreaterThan(10);
    expect(beats.every((b, i) => i === 0 || b > beats[i - 1])).toBe(true); // 点序严格单调
    const ys = conns.map(c => g.beatToVirtualY(c.beat, 1));
    // 折返：Y 先升后降再升（存在局部极大）——单调布局预览在这里会画成一条直线上坡
    const hasFold = ys.some((y, i) => i > 0 && i < ys.length - 1 && y > ys[i - 1] && y > ys[i + 1]);
    expect(hasFold).toBe(true);
  });

  it('预览 = 落子：与链式草稿重建（buildChainedSlide）逐顶点一致', () => {
    const from = { beat: 4.5, lane: 0 };
    const to = { beat: 7, lane: 6 };
    const preview = previewSpanConnections(from, to, param, BEAT_DISPLAY);
    const committed = buildChainedSlide([from, to], { 0: param }, BEAT_DISPLAY).connections;
    expect(committed.map(c => c.beat)).toEqual(preview.map(c => c.beat));
    expect(committed.map(c => c.lane)).toEqual(preview.map(c => c.lane));
  });
});

describe('issue 104 · 反查单一所有者（静态源码断言）', () => {

  it('应用侧几何一律按**秒**构造（不得再有拍域末端声明混进 src/）', () => {
    const canvas = readSource('src/chart/components/canvas/FinalVirtualCanvas.tsx');
    expect(canvas).toContain('new ChartGeometry(bpmEvents, { seconds: chartEndSeconds }, surf, verticalRatio)');
    const scroll = readSource('src/playback/useScrollModel.ts');
    expect(scroll).toContain('{ seconds: ctxDuration }');
    expect(scroll).toContain('new ChartGeometry([], { seconds: 0 }, { w: 200, h: 240 })');
    // 两处（画布 / 滚动模型）不再各自反查端点拍——endBeat 声明只留给测试与工具
    expect(canvas).not.toContain('chartLengthToEndBeat');
    expect(scroll).not.toContain('chartLengthToEndBeat');
  });

  it('拖拽的 Δy→Δ拍 走 layerBeatFromCanvas(…, drag.layerSegment)（不是最大解那一层）', () => {
    const session = readSource('src/chart/editing/GestureSession.ts');
    expect(session).toContain('layerBeatFromCanvas(my, w.viewport, drag.layerSegment)');
    const gesture = readSource('src/chart/editing/CanvasGesture.ts');
    expect(gesture).toContain('segmentIndexAtBeat(anchorBeat)');
    expect(gesture).toContain('layerBeatFromCanvas(input.cy, input.deps.viewport, layerSegment)');
  });

  it('瓦片失效与网格枚举都走时间轴的布局坐标提供者，不再自行内联端点换算', () => {
    const cache = readSource('src/visual/noteLayerCache.ts');
    expect(cache).toContain('positionRangeOfBeats');
    expect(cache).not.toContain('cEs - rc.geometry.beatToVirtualY');
    const render = readSource('src/visual/render.ts');
    expect(render).toContain('geometry.visibleBeatRanges(viewport)');
    expect(render).not.toContain('virtualYToBeat(b.maxY');
  });

  it('层接口是取「所在段每拍值」的唯一入口（调用点不再翻 timeline.segments）', () => {
    const gesture = readSource('src/chart/editing/CanvasGesture.ts');
    expect(gesture).not.toContain('timeline.segments');
    expect(gesture).toContain('perBeatOfSegment(timeline.segmentIndexAtBeat(beat))');
  });

  it('网格末端判据共用 ChartEndBounds 的 epsilon（不另写一份）', () => {
    const render = readSource('src/visual/render.ts');
    expect(render).toContain('isPastChartEnd(beat, rc.chartEndBeat)');
    expect(render).toContain('isPastChartEnd(preciseBeat, rc.chartEndBeat)');
    expect(render).not.toContain('rc.chartEndBeat + 1e-6');
  });
});
