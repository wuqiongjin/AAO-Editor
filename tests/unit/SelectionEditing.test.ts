import { describe, it, expect } from 'vitest';
import type { ChartNote, SelectionItem } from '../../src/notes/Charts';
import { deleteSelection, copySelection, cutSelection, mirrorSelection, selectionNoteIndices } from '../../src/utils/SelectionEditing';

// 构造一条 4 结点滑条：E(端点,skill) — A — B — F(端点,flick)
const slide = (): ChartNote => ({
  type: 'Slide',
  connections: [
    { beat: 0, lane: 0, skill: true },
    { beat: 1, lane: 1 },
    { beat: 2, lane: 2 },
    { beat: 3, lane: 3, flick: true }
  ]
});

describe('selectionNoteIndices', () => {
  it('提取去重后的音符下标', () => {
    const items: SelectionItem[] = [
      { kind: 'note', noteIndex: 0 },
      { kind: 'slideNode', noteIndex: 2, connIndex: 1 },
      { kind: 'slideRegion', noteIndex: 2, connIndex: 0 }
    ];
    expect(selectionNoteIndices(items)).toEqual([0, 2]);
  });
});

describe('deleteSelection', () => {
  it('删区域 = 删除整条滑条', () => {
    const notes = [slide(), { type: 'Single', beat: 5, lane: 0 } as ChartNote];
    const out = deleteSelection(notes, [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('Single');
  });

  it('删中间结点：仅移除该结点，其余保持连接', () => {
    const out = deleteSelection([slide()], [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }]);
    expect(out).toHaveLength(1);
    const s = out[0] as any;
    expect(s.connections).toHaveLength(3);
    expect(s.connections.map((c: { beat: number }) => c.beat)).toEqual([0, 2, 3]);
  });

  it('删端点（剩 2 结点）：另一端退化为独立音符', () => {
    const two = (): ChartNote => ({
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0, skill: true },
        { beat: 3, lane: 3 }
      ]
    });
    const out = deleteSelection([two()], [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('Single');
    expect((out[0] as any).skill).toBe(true);
    expect((out[0] as any).beat).toBe(0);
  });

  it('整条音符删除', () => {
    const notes = [slide(), { type: 'Single', beat: 5, lane: 0 } as ChartNote];
    const out = deleteSelection(notes, [{ kind: 'note', noteIndex: 0 }]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('Single');
  });
});

describe('copySelection', () => {
  const beats = (n: ChartNote) => (n as any).connections.map((c: { beat: number }) => c.beat);
  it('复制单个结点 → 独立音符（按标记退化）', () => {
    const out = copySelection([slide()], [{ kind: 'slideNode', noteIndex: 0, connIndex: 3 }]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('Single');
    expect((out[0] as any).flick).toBe(true);
    expect((out[0] as any).beat).toBe(3);
  });

  it('复制区域（2 结点）→ 2 结点滑条', () => {
    const out = copySelection([slide()], [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }]);
    expect(out).toHaveLength(1);
    const s = out[0] as any;
    expect(s.type).toBe('Slide');
    expect(s.connections).toHaveLength(2);
    expect(beats(out[0])).toEqual([0, 1]);
  });

  it('复制 >1 个结点 → 连续连接段（跳过中间结点也取连续段）', () => {
    const out = copySelection(
      [slide()],
      [
        { kind: 'slideNode', noteIndex: 0, connIndex: 0 },
        { kind: 'slideNode', noteIndex: 0, connIndex: 2 }
      ]
    );
    expect(out).toHaveLength(1);
    const s = out[0] as any;
    expect(s.type).toBe('Slide');
    // Q15=A：取 min..max 连续段，含中间的 1
    expect(beats(out[0])).toEqual([0, 1, 2]);
  });

  it('复制整条音符 → 音符本身', () => {
    const out = copySelection([slide()], [{ kind: 'note', noteIndex: 0 }]);
    expect(out).toHaveLength(1);
    expect((out[0] as any).connections).toHaveLength(4);
  });
});

describe('cutSelection', () => {
  it('剪切区域：只移除该段两端点，其余保持连接（与删除不同）', () => {
    const out = cutSelection([slide()], [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }]);
    expect(out.clipboard).toHaveLength(1); // 该段（2 结点滑条）
    expect(out.newNotes).toHaveLength(1);
    const s = out.newNotes[0] as any;
    expect(s.connections.map((c: { beat: number }) => c.beat)).toEqual([2, 3]);
  });

  it('剪切单个结点：移除该结点', () => {
    const out = cutSelection([slide()], [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }]);
    expect(out.newNotes[0] as any).toBeDefined();
    expect((out.newNotes[0] as any).connections.map((c: any) => c.beat)).toEqual([0, 2, 3]);
  });
});

describe('mirrorSelection', () => {
  it('镜像结点：仅翻转该结点 lane，不联动其它结点', () => {
    const out = mirrorSelection([slide()], [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }]);
    const s = out[0] as any;
    // connIndex=1 的 lane 1 → 5；其它结点不变
    expect(s.connections[0].lane).toBe(0);
    expect(s.connections[1].lane).toBe(5);
    expect(s.connections[2].lane).toBe(2);
    expect(s.connections[3].lane).toBe(3);
  });

  it('镜像整条滑条：全部结点 lane 翻转', () => {
    const out = mirrorSelection([slide()], [{ kind: 'note', noteIndex: 0 }]);
    const s = out[0] as any;
    expect(s.connections.map((c: any) => c.lane)).toEqual([6, 5, 4, 3]);
  });
});
