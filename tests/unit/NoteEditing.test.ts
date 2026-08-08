import { describe, it, expect } from 'vitest';
import { mirrorNotes, mirrorNote, shiftGroupToAnchor } from '../../src/utils/NoteEditing';
import type { ChartNote } from '../../src/notes/Charts';

describe('noteEditing - mirror', () => {
  it('mirrors a Single note lane', () => {
    const n: ChartNote = { type: 'Single', beat: 1, lane: 0 };
    const m = mirrorNote(n);
    expect(m).toEqual({ type: 'Single', beat: 1, lane: 6 });
  });

  it('flips LDirectional to RDirectional and mirrors lane', () => {
    const n: ChartNote = { type: 'LDirectional', beat: 2, lane: 3, length: 2 };
    const m = mirrorNote(n) as any;
    expect(m.type).toBe('RDirectional');
    expect(m.lane).toBe(3);
    expect(m.length).toBe(2);
  });

  it('mirrors all slide connection lanes', () => {
    const n: ChartNote = {
      type: 'Slide',
      connections: [
        { beat: 1, lane: 0 },
        { beat: 2, lane: 6 }
      ]
    };
    const m = mirrorNote(n) as any;
    expect(m.connections.map((c: any) => c.lane)).toEqual([6, 0]);
  });

  it('leaves BPM notes untouched', () => {
    const n: ChartNote = { type: 'BPM', beat: 0, bpm: 120 };
    expect(mirrorNote(n)).toBe(n);
  });

  it('only mirrors selected indices', () => {
    const notes: ChartNote[] = [
      { type: 'Single', beat: 0, lane: 0 },
      { type: 'Single', beat: 1, lane: 1 }
    ];
    const out = mirrorNotes(notes, [0]) as any;
    expect(out[0].lane).toBe(6);
    expect(out[1].lane).toBe(1);
  });
});

describe('noteEditing - paste to anchor', () => {
  it('keeps relative layout and anchors group top-left to target', () => {
    const clip: ChartNote[] = [
      { type: 'Single', beat: 2, lane: 1 },
      { type: 'Single', beat: 3, lane: 2 }
    ];
    // 组左上角 = (beat 2, lane 1)，粘贴锚点到 (10, 4)
    const out = shiftGroupToAnchor(clip, 10, 4);
    expect(out[0]).toEqual({ type: 'Single', beat: 10, lane: 4 });
    expect(out[1]).toEqual({ type: 'Single', beat: 11, lane: 5 });
  });

  it('shifts slide connections and clamps lanes into range', () => {
    const clip: ChartNote[] = [
      { type: 'Slide', connections: [{ beat: 1, lane: 6 }] }
    ];
    // 锚点 lane 0，deltaLane = 0 - 6 = -6，clamp 到 0
    const out = shiftGroupToAnchor(clip, 10, 0) as any;
    expect(out[0].connections[0]).toMatchObject({ beat: 10, lane: 0 });
  });

  it('returns empty for empty clipboard', () => {
    expect(shiftGroupToAnchor([], 0, 0)).toEqual([]);
  });
});
