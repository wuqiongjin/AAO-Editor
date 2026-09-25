import { describe, expect, it } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/visual/coords';
import {
  renderStartMarker,
  START_MARKER_COLOR,
  START_MARKER_HOVER_COLOR,
} from '@/src/visual/render';
import { playbackMarkerLayout } from '@/src/visual/playbackMarker';
import type { RenderCtx } from '@/src/visual/types';
import { makeRecordingCtx, propValues } from '@/tests/support/canvas';

const BPM = [{ beat: 0, bpm: 120 }];
const SURFACE = { w: 750, h: 900 };

function scene(markerBeat: number | null, markerHovered = false) {
  const geometry = new ChartGeometry(BPM, { endBeat: 100 }, SURFACE);
  const viewport = { scrollX: 0, scrollY: 0, scale: 1 };
  const c = makeCoords(geometry, viewport, 4, []);
  const rc = {
    geometry,
    viewport,
    surface: SURFACE,
    markerBeat,
    markerHovered,
  } as unknown as RenderCtx;
  const { proxy, calls } = makeRecordingCtx();
  renderStartMarker(proxy, c, rc);
  return { calls, geometry };
}

describe('renderStartMarker（issue 152）', () => {
  it('未设置播放起点时不绘制', () => {
    expect(scene(null).calls).toEqual([]);
  });

  it('绘制左侧横线且不贯穿轨道（旗帜由共享 SVG 叠加）', () => {
    const { calls, geometry } = scene(100);
    const { trackStartX } = geometry.trackGeometry(1);
    const firstMove = calls.find(([name]) => name === 'moveTo');
    const firstLine = calls.find(([name]) => name === 'lineTo');

    expect(firstMove?.[1]).toEqual([0, expect.any(Number)]);
    expect(firstLine?.[1]).toEqual([trackStartX, expect.any(Number)]);
    expect(trackStartX).toBeLessThan(SURFACE.w);
    expect(calls.some(([name]) => name === 'fillText')).toBe(false);
  });

  it('悬停时使用更亮的旗标颜色', () => {
    expect(propValues(scene(100).calls, 'strokeStyle')).toContain(START_MARKER_COLOR);
    expect(propValues(scene(100, true).calls, 'strokeStyle')).toContain(START_MARKER_HOVER_COLOR);
  });

  it('画布旗帜只比卡片图标大一档，并且旗杆底端落在线上', () => {
    const marker = playbackMarkerLayout();

    expect(marker.width).toBeGreaterThan(28);
    expect(marker.width).toBeLessThan(40);
    expect(marker.height).toBeGreaterThan(30);
    expect(marker.height).toBeLessThan(43);
    expect(marker.poleBottom).toBeLessThanOrEqual(marker.height);
  });
});
