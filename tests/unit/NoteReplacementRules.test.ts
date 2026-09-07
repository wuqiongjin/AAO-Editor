import { describe, it, expect } from 'vitest';
import {
  handleNoteReplacement,
  handleSlideToSlideCombination,
  deleteSlideSegment,
  keyTargetsFromItems,
  batchApplyKeyType,
} from '../../src/chart/editing/NoteReplacementRules';
import type { ChartNote, SlideNote } from '../../src/chart/types';

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

  it('技能键放端点：仅在点击的端点加 skill', () => {
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
    expect(conns[1].skill).toBeUndefined();
  });

  it('技能键放终点：仅在点击的终点加 skill，起点不受影响', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 2, lane: 2 }
      ]
    }];
    const r = handleNoteReplacement(notes, 2, 2, 0, 'skill');
    expect(r.shouldReplace).toBe(true);
    const conns = (r.newNotes[0] as any).connections;
    expect(conns[0].skill).toBeUndefined();
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
    expect(conns[1]).toEqual({ beat: 2, lane: 2, subBeat: 0, hidden: false });
    expect(conns[2]).toEqual({ beat: 4, lane: 0 });
  });

  it('两击接合级联（§4 三轮修复）：A→B + 两击 B→C + C→D → 一步成 A→B→C→D', () => {
    const notes: ChartNote[] = [
      { type: 'Slide', connections: [{ beat: 1, lane: 1 }, { beat: 2, lane: 2 }] },
      { type: 'Slide', connections: [{ beat: 3, lane: 3 }, { beat: 4, lane: 4 }] },
    ] as ChartNote[];
    const r = handleSlideToSlideCombination(notes, [
      { beat: 2, lane: 2 }, // buffer：既有滑条1的尾
      { beat: 3, lane: 3 }, // 点击：既有滑条2的头
    ]);
    expect(r.shouldCombine).toBe(true);
    expect(r.newNotes).toHaveLength(1); // 两条都被消耗，结果写回原下标 0
    const conns = (r.newNotes[0] as any).connections;
    expect(conns.map((c: any) => [c.beat, c.lane])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4]]);
    expect(conns[1]).toEqual({ beat: 2, lane: 2, subBeat: 0, hidden: false }); // 两接合点均为可见途径结点
    expect(conns[2]).toEqual({ beat: 3, lane: 3, subBeat: 0, hidden: false });
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

// ---- 键型批量框选（ADR-0008 §2 框选矩阵；Issue 55）----
describe('keyTargetsFromItems（键型框选落点提取）', () => {
  const singleN = (beat: number, lane: number): ChartNote =>
    ({ type: 'Single', beat, lane, subBeat: 0 } as ChartNote);
  const dirLN = (beat: number, lane: number, length = 1): ChartNote =>
    ({ type: 'LDirectional', beat, lane, subBeat: 0, length });
  const slideN = (...flat: number[]): ChartNote => {
    const connections = [];
    for (let i = 0; i < flat.length; i += 2) connections.push({ beat: flat[i], lane: flat[i + 1], subBeat: 0 });
    return { type: 'Slide', connections } as ChartNote;
  };
  const noteSel = (...idxs: number[]) => idxs.map(i => ({ kind: 'note' as const, noteIndex: i }));

  it('键型音符取自身位置；BPM/System/整条滑条/slideRegion 跳过；slideNode 取结点位置', () => {
    const notes: ChartNote[] = [
      singleN(1, 2),            // 0 键型 ✓
      { type: 'BPM', beat: 2, bpm: 120 },        // 1 跳过
      slideN(3, 1, 4, 2),       // 2 整条滑条 kind:'note' 跳过
      dirLN(5, 0),              // 3 键型 ✓
      { type: 'System', beat: 6, data: 'x' },    // 4 跳过
    ];
    const items = [
      ...noteSel(0, 1, 2, 3, 4),
      { kind: 'slideNode', noteIndex: 2, connIndex: 1 } as const,  // 滑条第2结点 ✓
      { kind: 'slideRegion', noteIndex: 2, connIndex: 0 } as const,// 跳过
    ];
    expect(keyTargetsFromItems(notes, items)).toEqual([
      { beat: 1, lane: 2, subBeat: 0 },
      { beat: 5, lane: 0, subBeat: 0 },
      { beat: 4, lane: 2, subBeat: 0 },
    ]);
  });
});

describe('batchApplyKeyType（框内逐个应用 ADR-0001 替换规则）', () => {
  const singleN = (beat: number, lane: number): ChartNote =>
    ({ type: 'Single', beat, lane, subBeat: 0 } as ChartNote);
  const dirLN = (beat: number, lane: number, length = 1): ChartNote =>
    ({ type: 'LDirectional', beat, lane, subBeat: 0, length });
  const slideN = (...flat: number[]): ChartNote => {
    const connections = [];
    for (let i = 0; i < flat.length; i += 2) connections.push({ beat: flat[i], lane: flat[i + 1], subBeat: 0 });
    return { type: 'Slide', connections } as ChartNote;
  };

  it('单键工具框选含空位+单键+方向键：空位新增、单键替换、方向键覆盖', () => {
    const notes: ChartNote[] = [singleN(1, 1), dirLN(2, 2, 2)];
    const r = batchApplyKeyType(notes, [
      { beat: 0, lane: 0, subBeat: 0 },  // 空位 → 新增
      { beat: 1, lane: 1, subBeat: 0 },  // 单键 → 替换（同型仍替换）
      { beat: 2, lane: 2, subBeat: 0 },  // 方向键 → 替换为单键
    ], 'single');
    expect(r.shouldReplace).toBe(true);
    expect(r.newNotes.filter(n => n.type === 'Single').length).toBe(3);
    expect(r.newNotes.find(n => n.type === 'LDirectional')).toBeUndefined();
  });

  it('滑键框选滑条结点：尾部端点加 flick、中间/头部忽略（ADR-0001 §1.2 表）', () => {
    const notes: ChartNote[] = [singleN(0, 3), slideN(1, 1, 2, 2, 3, 3)]; // 结点 1,1 / 2,2(中) / 3,3(尾)
    const r = batchApplyKeyType(notes, [
      { beat: 1, lane: 1, subBeat: 0 },
      { beat: 2, lane: 2, subBeat: 0 },
      { beat: 3, lane: 3, subBeat: 0 },
    ], 'flick');
    const s = r.newNotes.find(n => n.type === 'Slide') as SlideNote;
    expect(s.connections.map(c => !!c.flick)).toEqual([false, false, true]);
  });

  it('技能键框选：两端加 skill、中间忽略', () => {
    const notes: ChartNote[] = [slideN(1, 1, 2, 2, 3, 3)];
    const r = batchApplyKeyType(notes, [
      { beat: 1, lane: 1, subBeat: 0 },
      { beat: 2, lane: 2, subBeat: 0 },
      { beat: 3, lane: 3, subBeat: 0 },
    ], 'skill');
    const s = r.newNotes.find(n => n.type === 'Slide') as SlideNote;
    expect(s.connections.map(c => !!c.skill)).toEqual([true, false, true]);
  });

  it('无可应用落点（如单键框选全是滑条结点）→ shouldReplace=false 且返回原数组引用', () => {
    const notes: ChartNote[] = [slideN(1, 1, 2, 2)];
    const targets = [{ beat: 1, lane: 1, subBeat: 0 }, { beat: 2, lane: 2, subBeat: 0 }];
    const r = batchApplyKeyType(notes, targets, 'single');
    expect(r.shouldReplace).toBe(false);
    expect(r.newNotes).toBe(notes);
  });

  it('方向键框选中间结点 → 拆条生效：左右各 1 结点退化为独立音符 + 方向键本体', () => {
    const notes: ChartNote[] = [slideN(1, 1, 2, 2, 3, 3)];
    const r = batchApplyKeyType(notes, [{ beat: 2, lane: 2, subBeat: 0 }], 'ldirectional');
    expect(r.shouldReplace).toBe(true);
    expect(r.newNotes.some(n => n.type === 'LDirectional')).toBe(true);
    expect(r.newNotes.filter(n => n.type === 'Slide').length).toBe(0);
    expect(r.newNotes.filter(n => n.type === 'Single').length).toBe(2); // 两侧退化
  });

  it('无就地变异：入参数组不被改动', () => {
    const notes: ChartNote[] = [singleN(1, 1)];
    const snap = [...notes];
    batchApplyKeyType(notes, [{ beat: 2, lane: 2, subBeat: 0 }], 'flick');
    expect(notes).toEqual(snap);
  });
});
