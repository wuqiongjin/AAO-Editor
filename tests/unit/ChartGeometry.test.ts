import { describe, it, expect } from 'vitest';
import {
  ChartGeometry,
  LANES,
  LANE_WIDTH,
  TRACK_CHROME_TOTAL,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from '../../src/chart/geometry/ChartGeometry';
import type { ChartNote } from '../../src/chart/types';

const bpm120 = [{ beat: 0, bpm: 120 }];

describe('trackGeometry', () => {
  it('轨道水平居中、左右对称', () => {
    const g = new ChartGeometry(bpm120, 100);
    const { totalTrackWidth, trackStartX, trackBgX, trackBgWidth } = g.trackGeometry(1);
    expect(totalTrackWidth).toBe(LANES * LANE_WIDTH + TRACK_CHROME_TOTAL * 2);
    expect(trackStartX).toBe((CANVAS_WIDTH - totalTrackWidth) / 2);
    expect(trackBgX).toBe(trackStartX + TRACK_CHROME_TOTAL);
    expect(trackBgWidth).toBe(LANES * LANE_WIDTH);
  });
});

describe('坐标换算', () => {
  it('beatToVirtualY 自下而上：beat 0 落在判定线（画布底边）处', () => {
    const g = new ChartGeometry(bpm120, 8);
    // chartEndVirtualY = 8拍 * 220px = 1760；总高 = 1760 + 渲染面高/scale（判定线=渲染面底边，ADR-0006 §2）
    expect(g.chartEndVirtualY).toBe(8 * 220);
    const total = g.totalVirtualHeight(1);
    expect(total).toBe(1760 + CANVAS_HEIGHT);
    // beat0 → 顶部（总高 - 0）= 总高；经翻转后位于判定线
    expect(g.beatToVirtualY(0, 1)).toBe(total);
    expect(g.beatToVirtualY(8, 1)).toBe(CANVAS_HEIGHT);
  });

  it('渲染面尺寸变化时总高随渲染面高自适应（ADR-0006 §1）', () => {
    const g = new ChartGeometry(bpm120, 8, { w: 400, h: 600 });
    expect(g.totalVirtualHeight(1)).toBe(1760 + 600);
    expect(g.beatToVirtualY(8, 1)).toBe(600); // 判定线 = 渲染面底边
  });

  it('virtualYToBeat 与 beatToVirtualY 互逆', () => {
    const g = new ChartGeometry(bpm120, 8);
    for (const beat of [0, 1, 3.5, 8]) {
      expect(g.virtualYToBeat(g.beatToVirtualY(beat, 1), 1)).toBeCloseTo(beat, 6);
    }
  });

  it('virtualToCanvas / canvasToVirtual 互逆', () => {
    const g = new ChartGeometry(bpm120, 8);
    const viewport = { scrollX: 0, scrollY: 100, scale: 1.5 };
    const v = { x: 15, y: 500 };
    const c = g.virtualToCanvas(v.x, v.y, viewport);
    const back = g.canvasToVirtual(c.x, c.y, viewport);
    expect(back.x).toBeCloseTo(v.x, 6);
    expect(back.y).toBeCloseTo(v.y, 6);
  });

  it('noteVirtualY 计入 subBeat 折算', () => {
    const g = new ChartGeometry(bpm120, 8);
    const beatDisplay = 4;
    const y0 = g.noteVirtualY(0, 0, 1, beatDisplay);
    const y1 = g.noteVirtualY(0, 2, 1, beatDisplay); // 0.5 拍
    // 0.5 拍 = 110px，向上（y 更小）
    expect(Math.abs((y0 - y1) - 110)).toBeLessThan(1e-6);
  });
});

describe('laneBeatFromCanvas', () => {
  it('轨道内命中返回 lane 与吸附后的精确拍', () => {
    const g = new ChartGeometry(bpm120, 8);
    // 滚到底（scrollY=chartEndVirtualY）使判定线处为 beat 0
    const viewport = { scrollX: 0, scrollY: g.chartEndVirtualY, scale: 1 };
    const { trackBgX } = g.trackGeometry(1);
    const cx = trackBgX + LANE_WIDTH * 2 + LANE_WIDTH / 2; // lane 2 中心
    const cy = CANVAS_HEIGHT; // 判定线（画布底边）处 = beat 0
    const pos = g.laneBeatFromCanvas(cx, cy, viewport, 4);
    expect(pos).not.toBeNull();
    expect(pos!.lane).toBe(2);
    expect(pos!.preciseBeat).toBeCloseTo(0, 6);
  });

  it('轨道外返回 null', () => {
    const g = new ChartGeometry(bpm120, 8);
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
    const { trackBgX, trackBgWidth, trackStartX, totalTrackWidth } = g.trackGeometry(1);
    // 轨道完全容纳于渲染面宽内
    expect(trackStartX).toBeGreaterThanOrEqual(0);
    expect(trackStartX + totalTrackWidth).toBeLessThanOrEqual(g.surface.w);
    // 等比钳制：effectiveScale = fitWidth = (200-12)/210
    expect(es).toBeCloseTo((200 - TRACK_CHROME_TOTAL * 2) / (LANES * LANE_WIDTH), 6);
    expect(trackBgWidth).toBeCloseTo(LANES * LANE_WIDTH * es, 6);
  });
});

describe('visibleNotes 视口剔除', () => {
  const ch = (beat: number) => ({ type: 'Single' as const, lane: 0, beat, subBeat: 0 });

  const beatOf = (n: { note: ChartNote }) => (n.note as { beat: number }).beat;

    it('只返回视口内的音符', () => {
      const g = new ChartGeometry(bpm120, 100);
      const notes = [ch(0), ch(50), ch(100)];
      // beat0→y=22840(顶)、beat50→y=11840、beat100→y=840(判定线)；scrollY=0 视口 y∈[0,1100]
      const viewport = { scrollX: 0, scrollY: 0, scale: 1 };
      const visible = g.visibleNotes(notes, viewport, 4);
      expect(visible.map(beatOf)).toEqual([100]);
    });

    it('滚动后可见集变化', () => {
      const g = new ChartGeometry(bpm120, 100);
      const notes = [ch(0), ch(50), ch(100)];
      // scrollY=11000 → 视口 y∈[10800,12100]，命中 beat50(y=11840)
      const viewport = { scrollX: 0, scrollY: 11000, scale: 1 };
      const visible = g.visibleNotes(notes, viewport, 4);
      expect(visible.map(beatOf)).toEqual([50]);
    });
});