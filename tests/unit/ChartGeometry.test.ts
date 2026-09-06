import { describe, it, expect } from 'vitest';
import {
  ChartGeometry,
  LANES,
  LANE_WIDTH,
  TRACK_CHROME_TOTAL,
} from '../../src/chart/geometry/ChartGeometry';
import type { ChartNote } from '../../src/chart/types';

const bpm120 = [{ beat: 0, bpm: 120 }];
// issue 50：测试用默认 surface（旧 DEFAULT_SURFACE 值）；新构造函数 surface 必传
const TEST_SURFACE = { w: 750, h: 900 };
const TEST_SURFACE_W_NARROW = 200;
const surface = (over: Partial<{ w: number; h: number }> = {}) => ({ w: over.w ?? TEST_SURFACE.w, h: over.h ?? TEST_SURFACE.h });

describe('trackGeometry', () => {
  it('轨道水平居中、左右对称', () => {
    const g = new ChartGeometry(bpm120, 100, surface());
    const { totalTrackWidth, trackStartX, trackBgX, trackBgWidth } = g.trackGeometry(1);
    expect(totalTrackWidth).toBe(LANES * LANE_WIDTH + TRACK_CHROME_TOTAL * 2);
    expect(trackStartX).toBe((TEST_SURFACE.w - totalTrackWidth) / 2);
    expect(trackBgX).toBe(trackStartX + TRACK_CHROME_TOTAL);
    expect(trackBgWidth).toBe(LANES * LANE_WIDTH);
  });
});

describe('坐标换算', () => {
  it('beatToVirtualY 自下而上：beat 0 落在判定线（画布底边）处', () => {
    const g = new ChartGeometry(bpm120, 8, surface());
    // chartEndVirtualY = 8拍 * 220px = 1760；总高 = 1760 + 渲染面高/scale（判定线=渲染面底边，ADR-0006 §2）
    expect(g.chartEndVirtualY).toBe(8 * 220);
    const total = g.totalVirtualHeight(1);
    expect(total).toBe(1760 + TEST_SURFACE.h);
    // beat0 → 顶部（总高 - 0）= 总高；经翻转后位于判定线
    expect(g.beatToVirtualY(0, 1)).toBe(total);
    expect(g.beatToVirtualY(8, 1)).toBe(TEST_SURFACE.h);
  });

  it('渲染面尺寸变化时总高随渲染面高自适应（ADR-0006 §1）', () => {
    const g = new ChartGeometry(bpm120, 8, { w: 400, h: 600 });
    expect(g.totalVirtualHeight(1)).toBe(1760 + 600);
    expect(g.beatToVirtualY(8, 1)).toBe(600); // 判定线 = 渲染面底边
  });

  it('virtualYToBeat 与 beatToVirtualY 互逆', () => {
    const g = new ChartGeometry(bpm120, 8, surface());
    for (const beat of [0, 1, 3.5, 8]) {
      expect(g.virtualYToBeat(g.beatToVirtualY(beat, 1), 1)).toBeCloseTo(beat, 6);
    }
  });

  it('virtualToCanvas / canvasToVirtual 互逆', () => {
    const g = new ChartGeometry(bpm120, 8, surface());
    const viewport = { scrollX: 0, scrollY: 100, scale: 1.5 };
    const v = { x: 15, y: 500 };
    const c = g.virtualToCanvas(v.x, v.y, viewport);
    const back = g.canvasToVirtual(c.x, c.y, viewport);
    expect(back.x).toBeCloseTo(v.x, 6);
    expect(back.y).toBeCloseTo(v.y, 6);
  });

  it('noteVirtualY 计入 subBeat 折算', () => {
    const g = new ChartGeometry(bpm120, 8, surface());
    const beatDisplay = 4;
    const y0 = g.noteVirtualY(0, 0, 1, beatDisplay);
    const y1 = g.noteVirtualY(0, 2, 1, beatDisplay); // 0.5 拍
    // 0.5 拍 = 110px，向上（y 更小）
    expect(Math.abs((y0 - y1) - 110)).toBeLessThan(1e-6);
  });
});

describe('laneBeatFromCanvas', () => {
  it('轨道内命中返回 lane 与吸附后的精确拍', () => {
    const g = new ChartGeometry(bpm120, 8, surface());
    // 滚到底（scrollY=chartEndVirtualY）使判定线处为 beat 0
    const viewport = { scrollX: 0, scrollY: g.chartEndVirtualY, scale: 1 };
    const { trackBgX } = g.trackGeometry(1);
    const cx = trackBgX + LANE_WIDTH * 2 + LANE_WIDTH / 2; // lane 2 中心
    const cy = TEST_SURFACE.h; // 判定线（画布底边）处 = beat 0
    const pos = g.laneBeatFromCanvas(cx, cy, viewport, 4);
    expect(pos).not.toBeNull();
    expect(pos!.lane).toBe(2);
    expect(pos!.preciseBeat).toBeCloseTo(0, 6);
  });

  it('轨道外返回 null', () => {
    const g = new ChartGeometry(bpm120, 8, surface());
    const viewport = { scrollX: 0, scrollY: 0, scale: 1 };
    expect(g.laneBeatFromCanvas(-5, 10, viewport, 4)).toBeNull();
  });
});

describe('effectiveScale 缩放钳制（ADR-0006 Q4=A）', () => {
  it('宽渲染面下不钳制：effectiveScale = 用户 scale', () => {
    const g = new ChartGeometry(bpm120, 8, { w: 750, h: 900 });
    expect(g.effectiveScale(1)).toBe(1);
  });

  it('窄渲染面下钳制到恰好容纳 7 轨（不变形、不裁剪）', () => {
    const g = new ChartGeometry(bpm120, 8, { w: 200, h: 500 });
    const es = g.effectiveScale(1);
    const { trackBgWidth, trackStartX, totalTrackWidth } = g.trackGeometry(1);
    // 轨道完全容纳于渲染面宽内
    expect(trackStartX).toBeGreaterThanOrEqual(0);
    expect(trackStartX + totalTrackWidth).toBeLessThanOrEqual(g.surface.w);
    // 等比钳制：effectiveScale = fitWidth = 200 / (210 + 18)（外框 chrome 随缩放，分母含 chrome）
    expect(es).toBeCloseTo(TEST_SURFACE_W_NARROW / (LANES * LANE_WIDTH + 2 * TRACK_CHROME_TOTAL), 6);
    expect(trackBgWidth).toBeCloseTo(LANES * LANE_WIDTH * es, 6);
  });

  it('外框 chrome 随缩放缩放：预留与边条绘制一致（issue 51 修订，沟槽文字距离恒定的前提）', () => {
    const g = new ChartGeometry(bpm120, 8, surface());
    for (const es of [0.5, 1, 2.5]) {
      const { trackStartX, trackBgX, totalTrackWidth } = g.trackGeometry(es);
      expect(trackBgX - trackStartX).toBeCloseTo(TRACK_CHROME_TOTAL * es, 6);
      expect(totalTrackWidth).toBeCloseTo((LANES * LANE_WIDTH + 2 * TRACK_CHROME_TOTAL) * es, 6);
      // 居中对称：左右沟槽等宽
      expect(trackStartX).toBeCloseTo((TEST_SURFACE.w - totalTrackWidth) / 2, 6);
    }
  });
});

describe('visibleNotes 视口剔除', () => {
  const ch = (beat: number) => ({ type: 'Single' as const, lane: 0, beat, subBeat: 0 });

  const beatOf = (n: { note: ChartNote }) => (n.note as { beat: number }).beat;

    it('只返回视口内的音符', () => {
      const g = new ChartGeometry(bpm120, 100, surface());
      const notes = [ch(0), ch(50), ch(100)];
      // beat0→y=22840(顶)、beat50→y=11840、beat100→y=840(判定线)；scrollY=0 视口 y∈[0,1100]
      const viewport = { scrollX: 0, scrollY: 0, scale: 1 };
      const visible = g.visibleNotes(notes, viewport, 4);
      expect(visible.map(beatOf)).toEqual([100]);
    });

    it('滚动后可见集变化', () => {
      const g = new ChartGeometry(bpm120, 100, surface());
      const notes = [ch(0), ch(50), ch(100)];
      // scrollY=11000 → 视口 y∈[10800,12100]，命中 beat50(y=11840)
      const viewport = { scrollX: 0, scrollY: 11000, scale: 1 };
      const visible = g.visibleNotes(notes, viewport, 4);
      expect(visible.map(beatOf)).toEqual([50]);
    });
});

describe('zoomAnchorScrollY 缩放锚定（起始线/首拍 BPM 线漂移修复）', () => {
  const g = new ChartGeometry(bpm120, 40, surface());
  const chartEndY = g.chartEndVirtualY;

  // 与渲染同一套画布 Y 公式：canvasY(beat) = (beatToVirtualY(beat, es) − scrollY) · es
  const canvasYOfBeat = (beat: number, scrollY: number, es: number) =>
    (g.beatToVirtualY(beat, es) - scrollY) * es;

  it('放大/缩小后鼠标下的拍点画布位置不变（锚定不变量，pos 空间）', () => {
    const mouseCanvasY = TEST_SURFACE.h / 2;
    for (const es1 of [0.5, 1, 1.5]) {
      // 取滚动范围中段，避免端点钳制介入
      const scrollY = chartEndY / 2;
      const beatUnderMouse = g.virtualYToBeat(scrollY + mouseCanvasY / es1, es1);
      for (const k of [1.1, 0.9, 1.5, 1 / 1.5]) {
        const newScrollY = g.zoomAnchorScrollY(mouseCanvasY, es1, scrollY, es1 * k);
        expect(canvasYOfBeat(beatUnderMouse, newScrollY, es1 * k)).toBeCloseTo(mouseCanvasY, 6);
      }
    }
  });

  it('scale 不变的缩放请求返回原 scrollY', () => {
    const scrollY = chartEndY / 2;
    expect(g.zoomAnchorScrollY(400, 1, scrollY, 1)).toBeCloseTo(scrollY, 6);
  });

  it('谱面起点放大不越界（回归：旧数学 scrollY 超过 chartEndVirtualY 后被钳制拉回）', () => {
    // 滚到谱面最底端（判定线处 beat 0，起始线/首拍 BPM 线所在），鼠标在画布中部放大
    const mouseCanvasY = TEST_SURFACE.h / 2;
    const newScrollY = g.zoomAnchorScrollY(mouseCanvasY, 1, chartEndY, 1.1);
    expect(newScrollY).toBeLessThanOrEqual(chartEndY);
    expect(newScrollY).toBeGreaterThanOrEqual(0);
    // 锚定未被钳制破坏：鼠标下的拍点仍留在原画布位置
    const beatUnderMouse = g.virtualYToBeat(chartEndY + mouseCanvasY, 1);
    expect(canvasYOfBeat(beatUnderMouse, newScrollY, 1.1)).toBeCloseTo(mouseCanvasY, 6);
  });

  it('端点钳制：谱面起点缩小钉在起点（起始线不越出判定线），谱面末端放大钉在末端', () => {
    const mouseCanvasY = TEST_SURFACE.h / 2;
    // 起点缩小：raw scrollY > chartEndVirtualY → 钳回，起始线保持贴判定线
    expect(g.zoomAnchorScrollY(mouseCanvasY, 1, chartEndY, 0.9)).toBe(chartEndY);
    // 末端放大：raw scrollY < 0 → 钳回 0，结束线保持可见
    expect(g.zoomAnchorScrollY(mouseCanvasY, 1, 0, 1.1)).toBe(0);
  });

  it('鼠标正压在起始线上放大：起始线原地不动（m=h 时锚点退化为端点钉住）', () => {
    const newScrollY = g.zoomAnchorScrollY(TEST_SURFACE.h, 1, chartEndY, 1.1);
    expect(canvasYOfBeat(0, newScrollY, 1.1)).toBeCloseTo(TEST_SURFACE.h, 6);
  });
});
