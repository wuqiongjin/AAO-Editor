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

// issue 62（2026-11-27 修正）：beat 0 不再特殊，BPM 线照常删除；
// 只有删掉最后一条 BPM 时退化为「重置出默认 BPM（120@0）」。
describe('deleteSelection · BPM 线删除与保底', () => {
  const bpm = (beat: number, v: number): ChartNote => ({ type: 'BPM', beat, bpm: v });

  it('删除 beat0 BPM（还有其它 BPM）→ 只删该线，不重置', () => {
    const notes = [bpm(0, 180), bpm(8, 150)];
    const out = deleteSelection(notes, [{ kind: 'note', noteIndex: 0 }]);
    expect(out).toEqual([bpm(8, 150)]);
  });

  it('删除 beat0 BPM（它是最后一条）→ 重置为默认 BPM（120@0）', () => {
    const notes = [bpm(0, 180), { type: 'Single', beat: 4, lane: 0 } as ChartNote];
    const out = deleteSelection(notes, [{ kind: 'note', noteIndex: 0 }]);
    expect(out).toEqual([bpm(0, 120), { type: 'Single', beat: 4, lane: 0 }]);
  });

  it('非 beat0 的 BPM 线照常删除', () => {
    const notes = [bpm(0, 120), bpm(8, 150)];
    const out = deleteSelection(notes, [{ kind: 'note', noteIndex: 1 }]);
    expect(out).toEqual([bpm(0, 120)]);
  });

  it('框选含 beat0 BPM 的一组 → 全部照删；删光所有 BPM 才重置出默认', () => {
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

  // issue 62 Q2b：谱面至少要有一条 BPM —— 删掉最后一条（且无 beat 0）同样退化为重置
  it('删除最后一条 BPM（非 beat0）→ 重置为默认 BPM（120@0）', () => {
    const notes = [bpm(8, 150), { type: 'Single', beat: 4, lane: 0 } as ChartNote];
    const out = deleteSelection(notes, [{ kind: 'note', noteIndex: 0 }]);
    expect(out).toEqual([bpm(0, 120), { type: 'Single', beat: 4, lane: 0 }]);
  });

  it('删掉唯一一条 BPM 与其它音符一起 → 仍重置出默认 BPM', () => {
    const notes = [bpm(8, 150), { type: 'Single', beat: 4, lane: 0 } as ChartNote];
    const out = deleteSelection(notes, [
      { kind: 'note', noteIndex: 0 },
      { kind: 'note', noteIndex: 1 },
    ]);
    expect(out).toEqual([bpm(0, 120)]);
  });
});

describe('issue 63 · 负拍结点可正常参与选区（时间 ≥ 0 的可见结点）', () => {
  const negativeSlide = (): ChartNote => ({
    type: 'Slide',
    connections: [
      { beat: -2, lane: 0 },
      { beat: 1, lane: 2 },
      { beat: 3, lane: 4 },
    ],
  });

  it('删除负拍端点 → 该结点被移除（不再被当成 hidden 跳过）', () => {
    const out = deleteSelection([negativeSlide()], [{ kind: 'slideNode', noteIndex: 0, connIndex: 0 }]);
    const conns = (out[0] as Extract<ChartNote, { type: 'Slide' }>).connections;
    expect(conns.map((p) => p.beat)).toEqual([1, 3]);
  });

  it('删除中段可见结点 → 原位转 hidden（issue 92 口径不受 beat 影响）', () => {
    const out = deleteSelection([negativeSlide()], [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }]);
    const conns = (out[0] as Extract<ChartNote, { type: 'Slide' }>).connections;
    expect(conns.map((p) => [p.beat, p.hidden ?? false])).toEqual([[-2, false], [1, true], [3, false]]);
  });

  it('复制整条含负拍结点的滑条不丢点', () => {
    const copied = copySelection([negativeSlide()], [{ kind: 'note', noteIndex: 0 }]);
    expect(copied).toHaveLength(1);
    expect((copied[0] as Extract<ChartNote, { type: 'Slide' }>).connections.map((p) => p.beat)).toEqual([-2, 1, 3]);
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

  it('框选覆盖全部可见结点时保留 spanParams（issue 225 / Q3=A）', () => {
    const s: ChartNote = {
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 1, lane: 1, hidden: true },
        { beat: 2, lane: 2 },
      ],
      spanParams: {
        visibleCount: 2,
        bySpan: { 0: { kind: 'template', templateId: 'arc', precision: 16 } },
      },
    };
    const out = copySelection([s], [
      { kind: 'slideNode', noteIndex: 0, connIndex: 0 },
      { kind: 'slideNode', noteIndex: 0, connIndex: 2 },
    ]);
    expect(out).toHaveLength(1);
    const copied = out[0] as any;
    expect(copied.spanParams).toBeDefined();
    expect(copied.spanParams.bySpan[0].templateId).toBe('arc');
  });

  it('框选仅覆盖部分可见结点时不保留 spanParams（转为自由段）', () => {
    const s: ChartNote = {
      type: 'Slide',
      connections: [
        { beat: 0, lane: 0 },
        { beat: 1, lane: 1 },
        { beat: 2, lane: 2 },
      ],
      spanParams: {
        visibleCount: 3,
        bySpan: { 0: { kind: 'template', templateId: 'arc', precision: 16 } },
      },
    };
    const out = copySelection([s], [
      { kind: 'slideNode', noteIndex: 0, connIndex: 0 },
      { kind: 'slideNode', noteIndex: 0, connIndex: 1 },
    ]);
    expect(out).toHaveLength(1);
    const copied = out[0] as any;
    expect(copied.spanParams).toBeUndefined();
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

  it('框选整条滑条（包含结点或区域）镜像时翻转 template 的 mirrored 状态（issue 225）', () => {
    const s: ChartNote = {
      type: 'Slide',
      connections: [
        { beat: 0, lane: 1 },
        { beat: 1, lane: 2, hidden: true },
        { beat: 2, lane: 1 },
      ],
      spanParams: {
        visibleCount: 2,
        bySpan: { 0: { kind: 'template', templateId: 'arc', precision: 16 } },
      },
    };
    const out = mirrorSelection([s], [
      { kind: 'slideRegion', noteIndex: 0, connIndex: 0 },
    ]);
    const res = out[0] as any;
    expect(res.connections[0].lane).toBe(5);
    expect(res.connections[1].lane).toBe(4);
    expect(res.connections[2].lane).toBe(5);
    expect(res.spanParams.bySpan[0].mirrored).toBe(true);
  });

  it('部分结点镜像（结构被破坏）时清除受损段的 spanParams（issue 225）', () => {
    const s: ChartNote = {
      type: 'Slide',
      connections: [
        { beat: 0, lane: 1 },
        { beat: 1, lane: 2, hidden: true },
        { beat: 2, lane: 1 },
      ],
      spanParams: {
        visibleCount: 2,
        bySpan: { 0: { kind: 'template', templateId: 'arc', precision: 16 } },
      },
    };
    // 仅镜像起点
    const out = mirrorSelection([s], [
      { kind: 'slideNode', noteIndex: 0, connIndex: 0 },
    ]);
    const res = out[0] as any;
    expect(res.connections[0].lane).toBe(5);
    expect(res.connections[1].lane).toBe(2);
    expect(res.spanParams).toBeUndefined();
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
