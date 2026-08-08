import { describe, it, expect } from 'vitest';
import {
  handleNoteReplacement,
  handleSlideToSlideCombination
} from '../../src/utils/NoteReplacementRules';
import type { ChartNote } from '../../src/notes/Charts';

describe('handleNoteReplacement - 单键/方向键', () => {
  it('在空位放置单键音符', () => {
    const r = handleNoteReplacement([], 1, 2, 0, 'single');
    expect(r.shouldReplace).toBe(true);
    expect(r.newNotes).toEqual([{ beat: 1, lane: 2, subBeat: 0, type: 'Single' }]);
  });

  it('同位置放置单键替换既有单键', () => {
    const notes: ChartNote[] = [{ type: 'Single', beat: 1, lane: 2, subBeat: 0 }];
    const r = handleNoteReplacement(notes, 1, 2, 0, 'single');
    expect(r.shouldReplace).toBe(true);
    expect(r.newNotes).toHaveLength(1);
  });

  it('方向键覆盖单键', () => {
    const notes: ChartNote[] = [{ type: 'Single', beat: 1, lane: 2, subBeat: 0 }];
    const r = handleNoteReplacement(notes, 1, 2, 0, 'ldirectional');
    expect(r.newNotes).toEqual([{ beat: 1, lane: 2, subBeat: 0, type: 'LDirectional', length: 1 }]);
  });

  it('同类型方向键叠加 length+1', () => {
    const notes: ChartNote[] = [{ type: 'LDirectional', beat: 1, lane: 2, subBeat: 0, length: 1 }];
    const r = handleNoteReplacement(notes, 1, 2, 0, 'ldirectional');
    expect(r.newNotes).toEqual([{ type: 'LDirectional', beat: 1, lane: 2, subBeat: 0, length: 2 }]);
  });

  it('方向键 length 到 3 后重置为 1', () => {
    const notes: ChartNote[] = [{ type: 'LDirectional', beat: 1, lane: 2, subBeat: 0, length: 3 }];
    const r = handleNoteReplacement(notes, 1, 2, 0, 'ldirectional');
    expect(r.newNotes).toEqual([{ type: 'LDirectional', beat: 1, lane: 2, subBeat: 0, length: 1 }]);
  });
});

describe('handleNoteReplacement - 滑条端点', () => {
  it('滑条终点(flick) + 单键：替换为 endpoint 样式', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 2, lane: 2, flick: true }
      ]
    }];
    const r = handleNoteReplacement(notes, 2, 2, 0, 'single');
    expect(r.shouldReplace).toBe(true);
    const conn = (r.newNotes[0] as any).connections[1];
    expect(conn.flick).toBe(false);
  });

  it('滑条途径结点 + 单键：忽略不处理', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 1, lane: 1 },
        { beat: 2, lane: 2 }
      ]
    }];
    const r = handleNoteReplacement(notes, 1, 1, 0, 'single');
    expect(r.shouldReplace).toBe(false);
    expect(r.newNotes).toHaveLength(1);
  });
});

describe('handleSlideToSlideCombination - 滑条组合', () => {
  it('无既有端点匹配：不组合且不新增滑条', () => {
    const notes: ChartNote[] = [];
    const r = handleSlideToSlideCombination(notes, [
      { beat: 0, lane: 0 },
      { beat: 4, lane: 2 }
    ]);
    expect(r.shouldCombine).toBe(false);
    expect(r.newNotes).toHaveLength(0);
  });

  it('现有滑条终点 + 新滑条起点：合并滑条', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 2, lane: 2 }
      ]
    }];
    // 新滑条 起点=(2,2) 终点=(4,0)，与既有滑条终点(2,2)相接
    const r = handleSlideToSlideCombination(notes, [
      { beat: 2, lane: 2 },
      { beat: 4, lane: 0 }
    ]);
    expect(r.shouldCombine).toBe(true);
    const conns = (r.newNotes[0] as any).connections;
    expect(conns).toHaveLength(3);
    // 原终点转为途径结点，新终点追加
    expect(conns[1]).toEqual({ beat: 2, lane: 2, hidden: false });
    expect(conns[2]).toEqual({ beat: 4, lane: 0 });
  });
});
