// issue 186 锁测：片段粘贴与剪贴板的**隔离**（ADR-0023 §4）。
// 三条不变量：
// 1. 点卡片不改写剪贴板（粘贴产物里没有 setClipboard，剪贴板数组原封不动）；
// 2. 退出片段态后，工具轨「粘贴」照旧贴剪贴板；
// 3. 片段粘贴可连续两次（持工具态驻留，来源不因一次粘贴被清掉）。
import { describe, expect, it } from 'vitest';
import { clickOps, type MatrixOp } from '@/src/chart/editing/ToolActionMatrix';
import {
  POINTER_TOOL_STATE, withArmedTool, withPatternPaste, withPatternPasteToggled, type ArmedToolState,
} from '@/src/app/armedToolState';
import type { Pattern } from '@/src/chart/patterns/types';
import type { ChartNote } from '@/src/chart/types';

const single = (beat: number, lane: number): ChartNote => ({ type: 'Single', beat, lane });
const bpm = (beat: number, value: number): ChartNote => ({ type: 'BPM', beat, bpm: value });

const pat = (notes: ChartNote[]): Pattern => ({
  id: 'p1', name: '片段 1', createdAt: 1,
  notes,
  bpmContext: { startBpm: 120, events: [] },
});

/**
 * 画布的一次粘贴（与 `FinalVirtualCanvas` / `GestureSession` 同源）：
 * 片段来源由工具态带出，剪贴板永远照传 —— 这正是"两个来源并存"的形状。
 * 落点固定 beat/lane；单个音符的组会被锚到光标上（ADR-0008 §2.1 左上角对齐）。
 */
function pasteOnce(state: ArmedToolState, notes: ChartNote[], clipboard: ChartNote[], beat: number) {
  return clickOps({
    tool: 'paste',
    notes,
    hit: null,
    pos: { beat, lane: 2 },
    slideBuffer: null,
    lastBpm: 120,
    clipboard,
    pastePattern: state.pattern ? { pattern: state.pattern, withBpm: true } : null,
    chartEndBeat: 1e9,
    beatDisplay: 4,
    selectedItems: [],
  });
}
const writtenNotes = (ops: MatrixOp[]): ChartNote[] =>
  (ops.find(o => o.t === 'setNotes') as { notes: ChartNote[] } | undefined)?.notes ?? [];
/** 只看单键的落点（断言"贴出来的是哪一组"用；lane 会被锚点夹取，故都按落点算） */
const singles = (notes: ChartNote[]): { beat: number; lane: number }[] =>
  notes
    .filter(n => n.type === 'Single')
    .map(n => ({ beat: (n as { beat: number }).beat, lane: (n as { lane: number }).lane }));

describe('issue 186 · 片段粘贴不改写剪贴板', () => {
  it('点卡片进态：来源是该片段，剪贴板内容与引用都不动', () => {
    const clipboard = [single(0, 1)];
    const before = [...clipboard];
    const state = withPatternPaste(pat([single(6, 3)]));

    const ops = pasteOnce(state, [bpm(0, 120)], clipboard, 8);

    expect(ops.some(o => o.t === 'setClipboard')).toBe(false);
    expect(clipboard).toEqual(before);
    expect(clipboard[0]).toBe(before[0]); // 没有就地替换/覆盖
    expect(singles(writtenNotes(ops))).toEqual([{ beat: 8, lane: 2 }]);
  });

  it('粘贴产物来自片段而不是剪贴板（个数与形状都不同）', () => {
    // 剪贴板只有 1 个音符；片段 2 个 —— 贴出来的是 2 个就说明来源是片段
    const clipboard = [single(0, 1)];
    const state = withPatternPaste(pat([single(6, 3), single(7, 4)]));
    const written = singles(writtenNotes(pasteOnce(state, [bpm(0, 120)], clipboard, 8)));
    expect(written.map(n => ({ beat: n.beat, lane: n.lane }))).toEqual([
      { beat: 8, lane: 2 },
      { beat: 9, lane: 3 },
    ]);
  });
});

describe('issue 186 · 退出片段态后贴的仍是剪贴板', () => {
  it('再点工具轨「粘贴」= 回剪贴板来源', () => {
    const state = withArmedTool('paste');
    expect(state.pattern).toBeNull();
    const written = singles(writtenNotes(pasteOnce(state, [bpm(0, 120)], [single(0, 1)], 8)));
    expect(written.map(n => ({ beat: n.beat, lane: n.lane }))).toEqual([{ beat: 8, lane: 2 }]);
  });

  it('切走工具（含 Esc 落回指针）= 回剪贴板来源', () => {
    expect(withArmedTool(null)).toEqual(POINTER_TOOL_STATE);
    expect(withArmedTool('single').pattern).toBeNull();
  });

  it('切走工具后再进粘贴态不会残留上一个片段', () => {
    const withPattern = withPatternPaste(pat([single(6, 3)]));
    expect(withArmedTool(null).pattern).toBeNull();
    expect(withArmedTool('paste').pattern).toBeNull();
    expect(withPattern.pattern).not.toBeNull();
  });
});

describe('issue 186 · 点同一张卡片 = 退出', () => {
  const p1 = pat([single(0, 3)]);
  const p2: Pattern = { ...pat([single(0, 4)]), id: 'p2', name: '片段 2' };

  it('同一片段再点一次回指针（不是回剪贴板粘贴态）', () => {
    const state = withPatternPaste(p1);
    expect(withPatternPasteToggled(state, p1)).toEqual(POINTER_TOOL_STATE);
  });

  it('换一张 = 换来源，仍持粘贴工具', () => {
    const state = withPatternPasteToggled(withPatternPaste(p1), p2);
    expect(state.armedTool).toBe('paste');
    expect(state.pattern?.id).toBe('p2');
  });

  it('不在片段态时点卡片 = 进态', () => {
    const state = withPatternPasteToggled(withArmedTool('single'), p1);
    expect(state.armedTool).toBe('paste');
    expect(state.pattern?.id).toBe(p1.id);
  });
});

describe('issue 186 · 片段粘贴可连续两次', () => {
  it('持工具态驻留：同一来源能连贴两处', () => {
    const state = withPatternPaste(pat([single(6, 3)]));
    const clipboard: ChartNote[] = [];

    const afterFirst = writtenNotes(pasteOnce(state, [bpm(0, 120)], clipboard, 8));
    const afterSecond = writtenNotes(pasteOnce(state, afterFirst, clipboard, 12));

    expect(singles(afterSecond).map(n => ({ beat: n.beat, lane: n.lane }))).toEqual([
      { beat: 8, lane: 2 },
      { beat: 12, lane: 2 },
    ]);
    // 两次之后来源仍在（状态没被粘贴动作吃掉）
    expect(state.pattern).not.toBeNull();
  });
});
