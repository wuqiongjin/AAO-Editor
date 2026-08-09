import { describe, it, expect } from 'vitest';
import { pasteChartNotes } from '../../src/utils/NoteReplacementRules';
import type { ChartNote } from '../../src/notes/Charts';

// 粘贴 = 应用 ADR-0001 覆盖规则（修复直接 concat 导致同坐标重叠音符）
describe('pasteChartNotes - 空位粘贴', () => {
  it('空位粘贴单键：新增且无重叠', () => {
    const clipboard: ChartNote[] = [{ type: 'Single', beat: 5, lane: 1, subBeat: 0 }];
    const r = pasteChartNotes([], clipboard, 5, 1);
    expect(r.newNotes).toEqual([{ type: 'Single', beat: 5, lane: 1, subBeat: 0 }]);
  });

  it('空位粘贴方向键：保留 length（>1）', () => {
    const clipboard: ChartNote[] = [{ type: 'LDirectional', beat: 5, lane: 1, subBeat: 0, length: 2 }];
    const r = pasteChartNotes([], clipboard, 5, 1);
    expect(r.newNotes).toEqual([{ type: 'LDirectional', beat: 5, lane: 1, subBeat: 0, length: 2 }]);
  });

  it('空位粘贴滑键/技能键：保留标记', () => {
    const clipboard: ChartNote[] = [
      { type: 'Single', beat: 5, lane: 1, subBeat: 0, flick: true },
      { type: 'Single', beat: 6, lane: 1, subBeat: 0, skill: true }
    ];
    const r = pasteChartNotes([], clipboard, 5, 1);
    expect(r.newNotes).toHaveLength(2);
    expect(r.newNotes[0]).toMatchObject({ beat: 5, flick: true });
    expect(r.newNotes[1]).toMatchObject({ beat: 6, skill: true });
  });
});

describe('pasteChartNotes - 普通音符覆盖', () => {
  it('粘贴到既有单键：替换而非重叠', () => {
    const notes: ChartNote[] = [{ type: 'Single', beat: 5, lane: 1, subBeat: 0 }];
    const clipboard: ChartNote[] = [{ type: 'Single', beat: 5, lane: 1, subBeat: 0, flick: true }];
    const r = pasteChartNotes(notes, clipboard, 5, 1);
    expect(r.newNotes).toHaveLength(1);
    expect(r.newNotes[0]).toMatchObject({ type: 'Single', flick: true });
  });

  it('粘贴方向键到既有方向键：同类型 length+1', () => {
    const notes: ChartNote[] = [{ type: 'LDirectional', beat: 5, lane: 1, subBeat: 0, length: 1 }];
    const clipboard: ChartNote[] = [{ type: 'LDirectional', beat: 5, lane: 1, subBeat: 0, length: 1 }];
    const r = pasteChartNotes(notes, clipboard, 5, 1);
    expect(r.newNotes).toHaveLength(1);
    expect(r.newNotes[0]).toMatchObject({ type: 'LDirectional', length: 2 });
  });
});

describe('pasteChartNotes - 滑条结点覆盖（ADR §1.2）', () => {
  const slide: ChartNote = {
    type: 'Slide',
    connections: [
      { beat: 1, lane: 0, subBeat: 0 },
      { beat: 2, lane: 0, subBeat: 0 },
      { beat: 3, lane: 0, subBeat: 0 }
    ]
  };

  it('粘贴单键到滑条中间结点：忽略，不产生重叠', () => {
    const clipboard: ChartNote[] = [{ type: 'Single', beat: 2, lane: 0, subBeat: 0 }];
    const r = pasteChartNotes([slide], clipboard, 2, 0);
    expect(r.newNotes).toHaveLength(1); // 滑条保持原样
  });

  it('粘贴滑键到滑条尾端：仅尾部结点加 flick', () => {
    const clipboard: ChartNote[] = [{ type: 'Single', beat: 3, lane: 0, subBeat: 0, flick: true }];
    const r = pasteChartNotes([slide], clipboard, 3, 0);
    const conns = (r.newNotes[0] as { type: 'Slide'; connections: Array<{ flick?: boolean }> }).connections;
    expect(conns[2].flick).toBe(true);
    expect(conns[0].flick).toBeUndefined();
  });

  it('粘贴方向键到滑条中间结点：拆条 + 独立方向键', () => {
    const clipboard: ChartNote[] = [{ type: 'LDirectional', beat: 2, lane: 0, subBeat: 0, length: 1 }];
    const r = pasteChartNotes([slide], clipboard, 2, 0);
    // 3 结点连接点：中间结点两侧各仅剩 1 结点 → 两侧结点退化为独立音符（ADR §1.2.1），无滑条剩余
    expect(r.newNotes.filter(n => n.type === 'LDirectional')).toHaveLength(1);
    expect(r.newNotes.filter(n => n.type === 'Single')).toHaveLength(2);
    expect(r.newNotes.filter(n => n.type === 'Slide')).toHaveLength(0);
  });

  it('粘贴方向键到 5 结点滑条中间：拆成两条滑条 + 独立方向键', () => {
    const longSlide: ChartNote = {
      type: 'Slide',
      connections: [
        { beat: 1, lane: 0, subBeat: 0 },
        { beat: 2, lane: 0, subBeat: 0 },
        { beat: 3, lane: 0, subBeat: 0 },
        { beat: 4, lane: 0, subBeat: 0 },
        { beat: 5, lane: 0, subBeat: 0 }
      ]
    };
    const clipboard: ChartNote[] = [{ type: 'LDirectional', beat: 3, lane: 0, subBeat: 0, length: 1 }];
    const r = pasteChartNotes([longSlide], clipboard, 3, 0);
    // 中间结点两侧各剩 2 结点 → 左右各成一条滑条（ADR §1.2.1），加上独立方向键
    expect(r.newNotes.filter(n => n.type === 'Slide')).toHaveLength(2);
    expect(r.newNotes.filter(n => n.type === 'LDirectional')).toHaveLength(1);
    expect(r.newNotes.filter(n => n.type === 'Single')).toHaveLength(0);
  });
});

describe('pasteChartNotes - 粘贴滑条本身', () => {
  it('滑条连接点覆盖普通音符：清理重叠后独立加入（不组合）', () => {
    const notes: ChartNote[] = [
      { type: 'Single', beat: 2, lane: 0, subBeat: 0 },
      { type: 'Slide', connections: [{ beat: 10, lane: 3, subBeat: 0 }, { beat: 11, lane: 3, subBeat: 0 }] }
    ];
    const clipboard: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 2, lane: 0, subBeat: 0 },
        { beat: 3, lane: 0, subBeat: 0 }
      ]
    }];
    const r = pasteChartNotes(notes, clipboard, 2, 0);
    // 原重叠单键被清理，粘贴滑条独立加入，不与既有滑条组合
    expect(r.newNotes.filter(n => n.type === 'Single')).toHaveLength(0);
    expect(r.newNotes.filter(n => n.type === 'Slide')).toHaveLength(2);
  });
});
