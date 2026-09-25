// issue 152：播放起点（ADR-0004 §4）—— Canvas 只画定位横线，旗帜由共享 SVG 叠加。
// 锁：① 横线止于轨道外沿、不贯穿轨道；② 起点**存秒**（时间轴锚定，不跟拍）；
//     ③ 悬停反馈足够明显（色 + 线宽）；④ 旗帜尺寸恒定屏幕像素。
import { describe, expect, it } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/visual/coords';
import {
  renderPlaybackMarker,
  PLAYBACK_MARKER_COLOR,
  PLAYBACK_MARKER_HOVER_COLOR,
} from '@/src/visual/render';
import { PLAYBACK_MARKER_LAYOUT } from '@/src/visual/playbackMarker';
import type { RenderCtx } from '@/src/visual/types';
import { makeRecordingCtx, propValues } from '@/tests/support/canvas';

const SURFACE = { w: 750, h: 900 };
/** BPM 120：10 秒 == beat 20（用来校验"存秒"与"存拍"在常速谱下等价）。 */
const MARKER_SECONDS = 10;

function scene(
  markerSeconds: number | null,
  opts: { markerHovered?: boolean; scale?: number; bpm?: { beat: number; bpm: number }[] } = {},
) {
  const bpm = opts.bpm ?? [{ beat: 0, bpm: 120 }];
  const geometry = new ChartGeometry(bpm, { endBeat: 100 }, SURFACE);
  const scale = opts.scale ?? 1;
  // 把起点滚到画布内（y≈300px），否则会被渲染器的离屏剔除吃掉，断言空跑
  const markerVirtualY = markerSeconds === null ? 0 : geometry.secondsToVirtualY(markerSeconds, scale);
  const viewport = { scrollX: 0, scrollY: markerVirtualY - 300 / geometry.effectiveScale(scale), scale };
  const c = makeCoords(geometry, viewport, 4, []);
  const rc = {
    geometry,
    viewport,
    surface: SURFACE,
    markerSeconds,
    markerHovered: opts.markerHovered ?? false,
  } as unknown as RenderCtx;
  const { proxy, calls } = makeRecordingCtx();
  renderPlaybackMarker(proxy, c, rc);
  return { calls, geometry, c, viewport };
}

describe('renderPlaybackMarker（issue 152）', () => {
  it('未设置播放起点时不绘制', () => {
    expect(scene(null).calls).toEqual([]);
  });

  it('绘制左侧横线且不贯穿轨道（旗帜由共享 SVG 叠加）', () => {
    const { calls, geometry, viewport } = scene(MARKER_SECONDS);
    const { trackStartX } = geometry.trackGeometry(viewport.scale);
    const firstMove = calls.find(([name]) => name === 'moveTo');
    const firstLine = calls.find(([name]) => name === 'lineTo');

    expect(firstMove?.[1]).toEqual([0, expect.any(Number)]);
    expect(firstLine?.[1]).toEqual([trackStartX, expect.any(Number)]);
    expect(trackStartX).toBeLessThan(SURFACE.w);
    expect(calls.some(([name]) => name === 'fillText')).toBe(false);
  });

  it('起点存**秒**：常速谱下与 beat 20 同点（布局轴就是秒）', () => {
    const { calls, geometry, viewport } = scene(MARKER_SECONDS);
    const drawnY = (calls.find(([name]) => name === 'moveTo')?.[1] as number[])[1];
    const expected = geometry.virtualToCanvas(
      0,
      geometry.beatToVirtualY(20, viewport.scale),
      viewport,
    ).y;
    expect(drawnY).toBeCloseTo(expected, 6);
  });

  it('起点不跟拍：BPM 改动后横钉在同一秒（时间锚定）', () => {
    // beat 10 起 BPM 翻倍 → 原 beat 20 的秒从 10 变成 7.5，而标记仍钉在 10 秒
    const { calls, geometry, viewport } = scene(MARKER_SECONDS, {
      bpm: [{ beat: 0, bpm: 120 }, { beat: 10, bpm: 240 }],
    });
    const drawnY = (calls.find(([name]) => name === 'moveTo')?.[1] as number[])[1];
    const secondsY = geometry.virtualToCanvas(
      0,
      geometry.secondsToVirtualY(MARKER_SECONDS, viewport.scale),
      viewport,
    ).y;
    const beat20Y = geometry.virtualToCanvas(0, geometry.beatToVirtualY(20, viewport.scale), viewport).y;
    expect(drawnY).toBeCloseTo(secondsY, 6);
    expect(drawnY).not.toBeCloseTo(beat20Y, 3);
  });

  it('悬停同时改色与加粗（原来只换一个几乎同亮度的浅色，发现不了）', () => {
    expect(propValues(scene(MARKER_SECONDS).calls, 'strokeStyle')).toContain(PLAYBACK_MARKER_COLOR);
    expect(propValues(scene(MARKER_SECONDS).calls, 'lineWidth')).toContain(2);
    expect(propValues(scene(MARKER_SECONDS, { markerHovered: true }).calls, 'strokeStyle'))
      .toContain(PLAYBACK_MARKER_HOVER_COLOR);
    expect(propValues(scene(MARKER_SECONDS, { markerHovered: true }).calls, 'lineWidth'))
      .toContain(3);
  });

  it('旗帜尺寸恒定屏幕像素（不随画布缩放，三轮定案 ~40×43）', () => {
    // 尺寸是模块级常量：任一缩放档位下取到的是同一个对象，且值不变
    expect(Object.isFrozen(PLAYBACK_MARKER_LAYOUT)).toBe(true);
    expect(PLAYBACK_MARKER_LAYOUT.width).toBeGreaterThanOrEqual(38);
    expect(PLAYBACK_MARKER_LAYOUT.width).toBeLessThanOrEqual(42);
    expect(PLAYBACK_MARKER_LAYOUT.height).toBeGreaterThanOrEqual(41);
    expect(PLAYBACK_MARKER_LAYOUT.height).toBeLessThanOrEqual(45);
    expect(PLAYBACK_MARKER_LAYOUT.poleBottom).toBeLessThanOrEqual(PLAYBACK_MARKER_LAYOUT.height);

    // 线宽同样是固定像素：换缩放档位不变
    expect(propValues(scene(MARKER_SECONDS, { scale: 2 }).calls, 'lineWidth')).toContain(2);
  });
});
