// issue 132：连打 / 连续编辑后栈长度有上限（测长度，不测真实 MB）。
import { describe, it, expect } from 'vitest';
import {
  createHistory, pushHistoryIfChanged,
  TEXT_HISTORY_CAP, NOTES_HISTORY_CAP,
} from '@/src/chart/editing/History';
import { notesEqual } from '@/src/chart/editing/NotesEqual';
import type { ChartNote } from '@/src/chart/types';

describe('History 容量上限（issue 132）', () => {
  it('连打 K 次后文本栈长度 ≤ TEXT_HISTORY_CAP', () => {
    const K = TEXT_HISTORY_CAP + 20;
    let h = createHistory('');
    for (let i = 1; i <= K; i++) {
      h = pushHistoryIfChanged(h, 'x'.repeat(i), Object.is, TEXT_HISTORY_CAP);
    }
    expect(h.stack.length).toBe(TEXT_HISTORY_CAP);
  });

  it('连续编辑 K 次后 notes 栈长度 ≤ NOTES_HISTORY_CAP', () => {
    const K = NOTES_HISTORY_CAP + 20;
    const bpm = { beat: 0, type: 'BPM', bpm: 120 } as ChartNote;
    let h = createHistory<ChartNote[]>([bpm]);
    for (let i = 1; i <= K; i++) {
      h = pushHistoryIfChanged(
        h,
        [bpm, { type: 'Single', lane: 0, beat: i, subBeat: 0 } as ChartNote],
        notesEqual,
        NOTES_HISTORY_CAP,
      );
    }
    expect(h.stack.length).toBe(NOTES_HISTORY_CAP);
  });
});
