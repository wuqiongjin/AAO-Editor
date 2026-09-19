import { describe, it, expect } from 'vitest';
import type { ChartNote, SelectionItem } from '@/src/chart/types';
import { deleteSelection, copySelection, cutSelection, mirrorSelection, remapSelection, selectionNoteIndices } from '@/src/chart/editing/SelectionEditing';

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

// issue 59：beat 0 的 BPM 线不可删除 —— 删除退化为「重置为初始状态（120）」
describe('deleteSelection · 初始 BPM 线保底', () => {
  const bpm = (beat: number, v: number): ChartNote => ({ type: 'BPM', beat, bpm: v });

  it('删除 beat0 BPM（值为 180）→ 不消失，数值重置为 120', () => {
    const notes = [bpm(0, 180), { type: 'Single', beat: 4, lane: 0 } as ChartNote];
    const out = deleteSelection(notes, [{ kind: 'note', noteIndex: 0 }]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(bpm(0, 120));
    expect(out[1]).toBe(notes[1]);
  });

  it('非 beat0 的 BPM 线照常删除', () => {
    const notes = [bpm(0, 120), bpm(8, 150)];
    const out = deleteSelection(notes, [{ kind: 'note', noteIndex: 1 }]);
    expect(out).toEqual([bpm(0, 120)]);
  });

  it('框选含 beat0 BPM 的一组 → BPM 重置、其余照删', () => {
    const notes = [bpm(0, 180), { type: 'Single', beat: 4, lane: 0 } as ChartNote, bpm(8, 150)];
    const out = deleteSelection(notes, [
      { kind: 'note', noteIndex: 0 },
      { kind: 'note', noteIndex: 1 },
      { kind: 'note', noteIndex: 2 },
    ]);
    expect(out).toEqual([bpm(0, 120)]);
  });

  it('已经是 120 时删除 → 内容不变（仍重置一次，快照去重由 pushHistoryIfChanged 负责）', () => {
    const notes = [bpm(0, 120)];
    expect(deleteSelection(notes, [{ kind: 'note', noteIndex: 0 }])).toEqual(notes);
  });
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
  it('删区域 = 拆滑条：两端结点保留为新端点，单侧单结点退化', () => {
    // 滑条 E(0)—A(1)—B(2)—F(3)，删除区域 R0（E–A 连接带）
    const notes = [slide(), { type: 'Single', beat: 5, lane: 0 } as ChartNote];
    const out = deleteSelection(notes, [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }]);
    // E 侧仅剩单结点 → 退化为独立音符（skill）；A—B—F 保留为滑条；另一首普通音符不受影响
    expect(out).toHaveLength(3);
    expect(out[0].type).toBe('Single');
    expect((out[0] as any).skill).toBe(true);
    expect((out[0] as any).beat).toBe(0);
    expect((out[1] as any).connections.map((c: { beat: number }) => c.beat)).toEqual([1, 2, 3]);
    expect(out[2].type).toBe('Single');
  });

  it('删中间结点 → 原位转 hidden（issue 92 定案，bestdori 口径；位置与标记保留）', () => {
    const out = deleteSelection([slide()], [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }]);
    expect(out).toHaveLength(1);
    const s = out[0] as any;
    expect(s.connections).toHaveLength(4); // 结点一个不少
    expect(s.connections.map((c: { beat: number }) => c.beat)).toEqual([0, 1, 2, 3]);
    expect(s.connections[1].hidden).toBe(true); // 原位转 hidden
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
  it('剪切区域：= 复制该区域 + 删除该区域（拆滑条）', () => {
    // 滑条 E(0)—A(1)—B(2)—F(3)，剪切区域 R0（E–A 连接带）
    const out = cutSelection([slide()], [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }]);
    // 剪贴板：该区域物质化为 2 结点滑条 [E, A]
    expect(out.clipboard).toHaveLength(1);
    expect((out.clipboard[0] as any).type).toBe('Slide');
    expect((out.clipboard[0] as any).connections.map((c: { beat: number }) => c.beat)).toEqual([0, 1]);
    // 删除区域：E 退化为独立音符（skill），A—B—F 保留为滑条
    expect(out.newNotes).toHaveLength(2);
    expect(out.newNotes[0].type).toBe('Single');
    expect((out.newNotes[0] as any).skill).toBe(true);
    expect((out.newNotes[0] as any).beat).toBe(0);
    expect((out.newNotes[1] as any).connections.map((c: { beat: number }) => c.beat)).toEqual([1, 2, 3]);
  });

  it('剪切单个中间结点 = 复制该结点 + 原位转 hidden（剪切 = 复制 + §6.2 删除，issue 92 定案）', () => {
    const out = cutSelection([slide()], [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }]);
    expect(out.newNotes[0] as any).toBeDefined();
    expect((out.newNotes[0] as any).connections.map((c: any) => c.beat)).toEqual([0, 1, 2, 3]);
    expect((out.newNotes[0] as any).connections[1].hidden).toBe(true);
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

// ---- remapSelection（ADR-0008 §2.4 批量后选区保留；Issue 55）----
describe('remapSelection（批量后选区按位置迁移）', () => {
  const singleN = (beat: number, lane: number): ChartNote =>
    ({ type: 'Single', beat, lane, subBeat: 0 } as ChartNote);
  const flickN = (beat: number, lane: number): ChartNote =>
    ({ ...singleN(beat, lane), flick: true } as ChartNote);
  const dirLN = (beat: number, lane: number, length = 1): ChartNote =>
    ({ type: 'LDirectional', beat, lane, subBeat: 0, length });
  const slideN = (...flat: number[]): ChartNote => {
    const connections = [];
    for (let i = 0; i < flat.length; i += 2) connections.push({ beat: flat[i], lane: flat[i + 1], subBeat: 0 });
    return { type: 'Slide', connections } as ChartNote;
  };
  const noteSel = (...idxs: number[]): SelectionItem[] => idxs.map(i => ({ kind: 'note' as const, noteIndex: i }));

  it('键型音符批量替换后下标不变 → 选择保留', () => {
    const old = [singleN(1, 1), singleN(2, 2)];
    const next = [flickN(1, 1), flickN(2, 2)];
    expect(remapSelection(old, noteSel(0, 1), next)).toEqual(noteSel(0, 1));
  });

  it('被消耗的音符（组合/删除）从选区丢弃', () => {
    const old = [singleN(1, 1), singleN(2, 2), singleN(3, 3)];
    const next = [slideN(1, 1, 2, 2, 3, 3)]; // 三个键被组合消耗
    expect(remapSelection(old, noteSel(0, 1, 2), next)).toEqual([]);
  });

  it('整条滑条选择 → 起始结点仍在同一条滑条起点则保留', () => {
    const old: ChartNote[] = [singleN(0, 0), slideN(1, 1, 2, 2)];
    const next: ChartNote[] = [flickN(0, 0), slideN(1, 1, 2, 2)];
    expect(remapSelection(old, noteSel(1), next)).toEqual(noteSel(1));
  });

  it('slideNode → 滑条拆条后迁移到新宿主滑条下标', () => {
    const old: ChartNote[] = [slideN(1, 1, 2, 2, 3, 3)];
    const next: ChartNote[] = [slideN(1, 1, 2, 2), dirLN(2, 2), slideN(3, 3, 4, 3)]; // 示意：中间结点独立化
    const items: SelectionItem[] = [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }];
    const remapped = remapSelection(old, items, next);
    expect(remapped).toEqual([{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }]);
  });

  it('slideRegion：两段结点仍同条相邻才保留', () => {
    const old: ChartNote[] = [slideN(1, 1, 2, 2, 3, 3)];
    const items: SelectionItem[] = [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }];
    const kept = remapSelection(old, items, [slideN(1, 1, 2, 2, 3, 3)]);
    expect(kept).toEqual(items);
    const dropped = remapSelection(old, items, [slideN(1, 1), singleN(2, 2)]); // 拆散
    expect(dropped).toEqual([]);
  });

  it('BPM 选择按 type+beat 迁移（前面插入音符导致下标移动）', () => {
    const old: ChartNote[] = [{ type: 'BPM', beat: 0, bpm: 120 }, singleN(1, 1)];
    const next: ChartNote[] = [singleN(0, 5), { type: 'BPM', beat: 0, bpm: 120 }, singleN(1, 1)];
    expect(remapSelection(old, noteSel(0), next)).toEqual(noteSel(1));
  });
});
