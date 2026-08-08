import { describe, it, expect } from 'vitest';
import {
  handleNoteReplacement,
  handleSlideToSlideCombination,
  deleteSlideSegment
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

describe('handleNoteReplacement - 滑条结点（ADR-0001 1.2）', () => {
  it('单键放滑条任意结点：忽略不处理', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 2, lane: 2, flick: true }
      ]
    }];
    const r = handleNoteReplacement(notes, 2, 2, 0, 'single');
    expect(r.shouldReplace).toBe(false);
    expect(r.newNotes).toHaveLength(1);
    expect((r.newNotes[0] as any).connections[1].flick).toBe(true);
  });

  it('滑键放尾部端点：加 flick 标记', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 2, lane: 2 }
      ]
    }];
    const r = handleNoteReplacement(notes, 2, 2, 0, 'flick');
    expect(r.shouldReplace).toBe(true);
    expect((r.newNotes[0] as any).connections[1].flick).toBe(true);
  });

  it('滑键放头部端点：无效果（忽略）', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 2, lane: 2 }
      ]
    }];
    const r = handleNoteReplacement(notes, 0, 0, 0, 'flick');
    expect(r.shouldReplace).toBe(false);
  });

  it('技能键放端点：两端都加 skill', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 2, lane: 2 }
      ]
    }];
    const r = handleNoteReplacement(notes, 0, 0, 0, 'skill');
    expect(r.shouldReplace).toBe(true);
    const conns = (r.newNotes[0] as any).connections;
    expect(conns[0].skill).toBe(true);
    expect(conns[1].skill).toBe(true);
  });

  it('技能键放中间节点：忽略', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 1, lane: 1 },
        { beat: 2, lane: 2 }
      ]
    }];
    const r = handleNoteReplacement(notes, 1, 1, 0, 'skill');
    expect(r.shouldReplace).toBe(false);
    expect(r.newNotes).toHaveLength(1);
  });

  it('方向键放中间节点：拆两侧为两条滑条 + 独立方向键', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 1, lane: 1 },
        { beat: 2, lane: 2 },
        { beat: 3, lane: 3 },
        { beat: 4, lane: 4 }
      ]
    }];
    const r = handleNoteReplacement(notes, 2, 2, 0, 'ldirectional');
    expect(r.shouldReplace).toBe(true);
    expect(r.newNotes).toHaveLength(3);
    // 左段 [0..1]、右段 [3..4]、独立方向键
    const types = r.newNotes.map(n => n.type);
    expect(types).toContain('Slide');
    expect(types).toContain('LDirectional');
    const slideConns = r.newNotes.filter(n => n.type === 'Slide').map(n => (n as any).connections);
    expect(slideConns).toContainEqual([
      { beat: 0, lane: 0 },
      { beat: 1, lane: 1 }
    ]);
    expect(slideConns).toContainEqual([
      { beat: 3, lane: 3 },
      { beat: 4, lane: 4 }
    ]);
  });

  it('方向键放中间节点：单侧仅剩单结点时退化为独立音符（ADR 1.2.1）', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 1, lane: 1, skill: true },
        { beat: 2, lane: 2 }
      ]
    }];
    // 方向键放到中间节点 (1,1)
    const r = handleNoteReplacement(notes, 1, 1, 0, 'ldirectional');
    expect(r.shouldReplace).toBe(true);
    // 两侧各剩 1 结点 → 退化为独立音符；中间节点变为独立方向键
    expect(r.newNotes).toEqual([
      { beat: 0, lane: 0, subBeat: 0, type: 'Single' },
      { beat: 2, lane: 2, subBeat: 0, type: 'Single' },
      { beat: 1, lane: 1, subBeat: 0, type: 'LDirectional', length: 1 }
    ]);
  });

  it('方向键放 2 结点滑条端点：另一端退化为独立音符（ADR 1.2.2）', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 2, lane: 2 }
      ]
    }];
    const r = handleNoteReplacement(notes, 2, 2, 0, 'rdirectional');
    expect(r.shouldReplace).toBe(true);
    expect(r.newNotes).toEqual([
      { beat: 0, lane: 0, subBeat: 0, type: 'Single' },
      { beat: 2, lane: 2, subBeat: 0, type: 'RDirectional', length: 1 }
    ]);
  });

  it('方向键放 2 结点滑条端点：另一端带 skill 标记时退化为技能键', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0, skill: true },
        { beat: 2, lane: 2 }
      ]
    }];
    const r = handleNoteReplacement(notes, 2, 2, 0, 'ldirectional');
    expect(r.shouldReplace).toBe(true);
    expect(r.newNotes).toEqual([
      { beat: 0, lane: 0, subBeat: 0, type: 'Single', skill: true },
      { beat: 2, lane: 2, subBeat: 0, type: 'LDirectional', length: 1 }
    ]);
  });

  it('方向键放多结点滑条端点：去端点，相邻中间节点升新端点', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 1, lane: 1 },
        { beat: 2, lane: 2 }
      ]
    }];
    const r = handleNoteReplacement(notes, 2, 2, 0, 'ldirectional');
    expect(r.shouldReplace).toBe(true);
    expect(r.newNotes).toHaveLength(2);
    const slide = r.newNotes.find(n => n.type === 'Slide') as any;
    expect(slide.connections).toEqual([
      { beat: 0, lane: 0 },
      { beat: 1, lane: 1 }
    ]);
    const dir = r.newNotes.find(n => n.type === 'LDirectional');
    expect(dir).toEqual({ beat: 2, lane: 2, subBeat: 0, type: 'LDirectional', length: 1 });
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

describe('deleteSlideSegment - 删除滑条子段（ADR-0001 §6）', () => {
  it('删除连接带区域（connIndex=null）：删除整条滑条', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 2, lane: 2 }
      ]
    }];
    const result = deleteSlideSegment(notes, 0, null);
    expect(result).toHaveLength(0);
  });

  it('删除中间结点：仅移除该结点，其余保持连接（不拆滑条）', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 1, lane: 1 },
        { beat: 2, lane: 2 }
      ]
    }];
    const result = deleteSlideSegment(notes, 0, 1);
    expect(result).toHaveLength(1);
    expect((result[0] as any).connections).toEqual([
      { beat: 0, lane: 0 },
      { beat: 2, lane: 2 }
    ]);
  });

  it('删除多结点滑条的端点：去端点，相邻中间结点升为新端点', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 1, lane: 1 },
        { beat: 2, lane: 2 }
      ]
    }];
    const result = deleteSlideSegment(notes, 0, 0);
    expect(result).toHaveLength(1);
    expect((result[0] as any).connections).toEqual([
      { beat: 1, lane: 1 },
      { beat: 2, lane: 2 }
    ]);
  });

  it('删除 2 结点滑条的端点：剩余单结点退化为普通单键', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 2, lane: 2 }
      ]
    }];
    const result = deleteSlideSegment(notes, 0, 1);
    expect(result).toEqual([
      { beat: 0, lane: 0, subBeat: 0, type: 'Single' }
    ]);
  });

  it('剩余单结点带 skill 标记时退化为技能键', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0, skill: true },
        { beat: 2, lane: 2 }
      ]
    }];
    const result = deleteSlideSegment(notes, 0, 1);
    expect(result).toEqual([
      { beat: 0, lane: 0, subBeat: 0, type: 'Single', skill: true }
    ]);
  });

  it('剩余单结点带 flick 标记时退化为滑键', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 2, lane: 2, flick: true }
      ]
    }];
    const result = deleteSlideSegment(notes, 0, 0);
    expect(result).toEqual([
      { beat: 2, lane: 2, subBeat: 0, type: 'Single', flick: true }
    ]);
  });
});
