import { describe, expect, it } from 'vitest';
import { ChartGeometry, LANE_WIDTH } from '@/src/chart/geometry/ChartGeometry';
import { findItemAt } from '@/src/visual/hitTest';
import type { ChartNote } from '@/src/chart/types';

const bpm120 = [{ beat: 0, bpm: 120 }];
const TEST_SURFACE = { w: 750, h: 900 };

describe('issue 153 · 画布投影', () => {
  it('beat<0 单键不进 visibleNotes、点不到', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 16 }, TEST_SURFACE);
    const notes: ChartNote[] = [
      { type: 'BPM', beat: 0, bpm: 120 },
      { type: 'Single', beat: -1, lane: 2, subBeat: 0 },
      { type: 'Single', beat: 4, lane: 2, subBeat: 0 },
    ];
    const viewport = { scrollX: 0, scrollY: 0, scale: 1 };
    const vis = g.visibleNotes(notes, viewport, 4);
    expect(vis.some(v => v.note.type === 'Single' && (v.note as { beat: number }).beat < 0)).toBe(false);
    const canvas = g.virtualToCanvas(
      g.noteVirtualX(2),
      g.noteVirtualY(-1, 0, 1, 4),
      viewport,
    );
    expect(findItemAt(canvas.x, canvas.y, { geometry: g, viewport, beatDisplay: 4, notes })).toBeNull();
  });

  it('END 之后的音符仍可进入可见集', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 4 }, TEST_SURFACE);
    const notes: ChartNote[] = [
      { type: 'BPM', beat: 0, bpm: 120 },
      { type: 'Single', beat: 8, lane: 1, subBeat: 0 },
    ];
    const y = g.noteVirtualY(8, 0, 1, 4);
    const vis = g.visibleNotes(notes, { scrollX: 0, scrollY: y - 80, scale: 1 }, 4);
    expect(vis.some(v => v.note.type === 'Single' && (v.note as { beat: number }).beat === 8)).toBe(true);
  });

  it('越界 lane 的 X = lane × 轨宽 + 半轨', () => {
    const g = new ChartGeometry(bpm120, { endBeat: 8 }, TEST_SURFACE);
    expect(g.noteVirtualX(-1)).toBeCloseTo(-LANE_WIDTH + LANE_WIDTH / 2, 8);
    expect(g.noteVirtualX(7)).toBeCloseTo(7 * LANE_WIDTH + LANE_WIDTH / 2, 8);
    expect(g.noteVirtualX(7) - g.noteVirtualX(6)).toBeCloseTo(LANE_WIDTH, 8);
  });
});
