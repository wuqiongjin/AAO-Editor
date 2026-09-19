import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/visual/coords';
import { renderHoverInfo, renderHoverLine } from '@/src/visual/render';
import { formatInMinuteTime } from '@/src/chart/geometry/TimeFormat';
import type { RenderCtx } from '@/src/visual/types';
import type { ChartNote } from '@/src/chart/types';
import { makeRecordingCtx } from '@/tests/support/canvas';

describe('formatInMinuteTime 分内时间（issue 54）', () => {
  it('基本格式：SS.ss 两位小数、分钟位省略', () => {
    expect(formatInMinuteTime(0)).toBe('00.00');
    expect(formatInMinuteTime(5.5)).toBe('05.50');
    expect(formatInMinuteTime(59.99)).toBe('59.99');
    expect(formatInMinuteTime(12.345)).toBe('12.35'); // 四舍五入到厘秒
  });

  it('mod 60 循环：1 分钟后重置为 00.00，59.996+ 回绕', () => {
    expect(formatInMinuteTime(60)).toBe('00.00');
    expect(formatInMinuteTime(119.99)).toBe('59.99');
    expect(formatInMinuteTime(59.996)).toBe('00.00'); // 四舍五入 60.00 → 回绕
    expect(formatInMinuteTime(121.5)).toBe('01.50');
  });

  it('负值与非有限值按 00.00 处理', () => {
    expect(formatInMinuteTime(-0.5)).toBe('00.00');
    expect(formatInMinuteTime(NaN)).toBe('00.00');
    expect(formatInMinuteTime(Infinity)).toBe('00.00');
  });
});

describe('renderHoverLine / renderHoverInfo（issue 54）', () => {
  const bpm120 = [{ beat: 0, bpm: 120 }]; // 120bpm：1 拍 = 0.5s
  const TEST_SURFACE = { w: 750, h: 900 };
  const notes: ChartNote[] = [
    { type: 'Single', lane: 0, beat: 1, subBeat: 0 },
    { type: 'Single', lane: 1, beat: 3, subBeat: 0 },
    { type: 'BPM', beat: 5, bpm: 180 },
  ];

  function makeRc(hover: { cx: number; cy: number } | null) {
    const geometry = new ChartGeometry(bpm120, { endBeat: 8 } , TEST_SURFACE);
    const viewport = { scrollX: 0, scrollY: geometry.chartEndVirtualY, scale: 1 }; // 底部：beat0 在画布底边
    const c = makeCoords(geometry, viewport, 4, notes);
    const rc = { geometry, viewport, surface: TEST_SURFACE, chartEndBeat: 8, notes, hoverPos: hover } as unknown as RenderCtx;
    return { c, rc };
  }

  it('hoverPos 为 null 时完全不绘制', () => {
    const { c, rc } = makeRc(null);
    const { proxy, calls } = makeRecordingCtx();
    renderHoverLine(proxy, c, rc);
    renderHoverInfo(proxy, c, rc);
    expect(calls.length).toBe(0);
  });

  it('线只在轨道宽度内：moveTo(trackBgX) → lineTo(trackBgX+trackBgWidth)，y = 鼠标 cy', () => {
    const { c, rc } = makeRc({ cx: 100, cy: 400 });
    const { trackBgX, trackBgWidth } = c.trackGeometry(1);
    const { proxy, calls } = makeRecordingCtx();
    renderHoverLine(proxy, c, rc);
    const moveTo = calls.filter(([k]) => k === 'moveTo');
    const lineTo = calls.filter(([k]) => k === 'lineTo');
    expect(moveTo[0]?.[1]).toEqual([trackBgX, 400]);
    expect(lineTo[0]?.[1]).toEqual([trackBgX + trackBgWidth, 400]);
  });

  it('左侧分内时间 / 右侧音符数，锚在轨道两侧外缘', () => {
    // 画布底部 scrollY=chartEndVirtualY：cy=900 处为 beat 0，cy=460 处为 beat 2（pos=440px）
    const { c, rc } = makeRc({ cx: 100, cy: 460 });
    const { proxy, calls } = makeRecordingCtx();
    renderHoverInfo(proxy, c, rc);
    const texts = calls.filter(([k]) => k === 'fillText') as [string, [string, number, number]][];
    expect(texts.length).toBe(2);
    const [timeText, countText] = texts.map(t => t[1][0]) as [string, string];
    expect(timeText).toBe('01.00'); // beat 2 @120bpm = 1.0s（分内时间）
    expect(countText).toBe('♪ 1'); // 恰好在线上的音符计入（beat2 无音符，beat1 已过 → 1 条；beat3 未到）
    const aligns = calls.filter(([k]) => k === 'textAlign').map(([, v]) => v[0]);
    expect(aligns).toEqual(['right', 'left']);
  });

  it('连续跟随：非整拍 Y 的读数按连续 beat 计算（不吸附）', () => {
    // cy=40 → pos = 2660 − (1760+40) = 860 → beat ≈ 3.909：时间 1.9545s → "01.95"；beat1、beat3 已过 → ♪ 2
    const { c, rc } = makeRc({ cx: 100, cy: 40 });
    const { proxy, calls } = makeRecordingCtx();
    renderHoverInfo(proxy, c, rc);
    const texts = calls.filter(([k]) => k === 'fillText') as [string, [string, number, number]][];
    const [timeText, countText] = texts.map(t => t[1][0]) as [string, string];
    expect(timeText).toBe('01.95');
    expect(countText).toBe('♪ 2');
    void c;
  });
});
