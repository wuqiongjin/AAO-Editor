// ADR-0008 §2 统一交互语义矩阵 + §3 执行键语义 的逐行锁表（矩阵唯一事实源 = ToolActionMatrix.ts）。
// ⚠ 任何一行改动必须先修订 docs/adr/0008-工具交互机制.md，再同步本表（ADR-0008 §8 收口约定）。
import { describe, it, expect } from 'vitest';
import type { ChartNote, SelectionItem, SlideNote } from '../../src/chart/types';
import {
  pointerClickSelection, clickOps, boxSelectOps, execSlideOps, execBpmOps,
  type ClickInput, type SnapPos, type SlidePoint,
} from '../../src/chart/editing/ToolActionMatrix';

const single = (beat: number, lane: number): ChartNote =>
  ({ type: 'Single', beat, lane, subBeat: 0 } as ChartNote);
const bpm = (beat: number, v: number): ChartNote => ({ type: 'BPM', beat, bpm: v } as ChartNote);
const slide = (...flat: number[]): ChartNote => {
  const connections = [];
  for (let i = 0; i < flat.length; i += 2) connections.push({ beat: flat[i], lane: flat[i + 1], subBeat: 0 });
  return { type: 'Slide', connections } as ChartNote;
};
const noteSel = (...idxs: number[]): SelectionItem[] => idxs.map(i => ({ kind: 'note' as const, noteIndex: i }));
const sp = (beat: number, lane: number): SnapPos => ({ beat, lane });
const pt = (beat: number, lane: number): SlidePoint => ({ beat, lane, subBeat: 0 });

/** §2 单击矩阵输入基底（各行只覆盖需要的字段） */
const input = (patch: Partial<ClickInput>): ClickInput => ({
  tool: 'single', notes: [], hit: null, pos: null,
  slideBuffer: null, lastBpm: 120, clipboard: [], ...patch,
});

// ══════════════════ §2 指针行·单击（pointerClickSelection）══════════════════
describe('§2 指针行·单击', () => {
  it('音符 = 替换选区；空白 = 清空选区', () => {
    const cur = noteSel(0);
    expect(pointerClickSelection(cur, noteSel(1)[0], false, false)).toEqual(noteSel(1));
    expect(pointerClickSelection(cur, null, false, false)).toEqual([]);
  });
  it('Shift+音符 = 未选则加选、已选则去选', () => {
    expect(pointerClickSelection(noteSel(0), noteSel(1)[0], true, false)).toEqual(noteSel(0, 1));
    expect(pointerClickSelection(noteSel(0, 1), noteSel(1)[0], true, false)).toEqual(noteSel(0));
  });
  it('Shift+空白 = 不动选区（返回原数组）', () => {
    const cur = noteSel(0);
    expect(pointerClickSelection(cur, null, true, false)).toBe(cur);
  });
  it('Ctrl+音符 = 选中整条（目标升格为 {kind:\'note\'}）', () => {
    const node: SelectionItem = { kind: 'slideNode', noteIndex: 2, connIndex: 1 };
    expect(pointerClickSelection([], node, false, true)).toEqual(noteSel(2));
  });
  it('Ctrl+Shift 加选整条：清同条子部分后加入（ADR-0001 §6.1 互斥）', () => {
    const cur: SelectionItem[] = [{ kind: 'slideNode', noteIndex: 2, connIndex: 0 }, noteSel(0)[0]];
    const node: SelectionItem = { kind: 'slideNode', noteIndex: 2, connIndex: 1 };
    expect(pointerClickSelection(cur, node, true, true)).toEqual([noteSel(0)[0], noteSel(2)[0]]);
  });
  it('Ctrl+Shift 已选整条 → 去选', () => {
    const cur = noteSel(2);
    expect(pointerClickSelection(cur, cur[0], true, true)).toEqual([]);
  });
});

// ══════════════════ §2 单击矩阵·键型工具行 ══════════════════
describe('§2 键型工具单击（single/flick/skill/l/r）', () => {
  const notes: ChartNote[] = [single(1, 1), bpm(2, 120)];
  it('空白放置 = 追加（pos 合法即放置，不看 hit）+ 清选区（§2 原则 6）', () => {
    const ops = clickOps(input({ tool: 'single', notes, pos: sp(4, 3) }));
    expect(ops).toHaveLength(2);
    expect(ops[0].t).toBe('setNotes');
    expect((ops[0] as any).notes.length).toBe(3);
    expect(ops[1]).toEqual({ t: 'setSelection', items: [] });
  });
  it('音符上点击与空白点击同格（hit 列不参与键型行）', () => {
    const a = clickOps(input({ tool: 'flick', notes, pos: sp(4, 3), hit: noteSel(0)[0] }));
    const b = clickOps(input({ tool: 'flick', notes, pos: sp(4, 3), hit: null }));
    expect(a).toEqual(b);
  });
  it('非法位置（pos=null：轨道外/谱面末端外）→ 动作无事发生，但取消选中（§2 原则 6）', () => {
    expect(clickOps(input({ tool: 'single', notes, pos: null, hit: noteSel(0)[0] })))
      .toEqual([{ t: 'setSelection', items: [] }]);
  });
  it('替换规则内部处置（ADR-0001 表在 NoteReplacementRules 锁）：同位单键再放单键 → setNotes', () => {
    const ops = clickOps(input({ tool: 'single', notes, pos: sp(1, 1) }));
    expect(ops[0]?.t).toBe('setNotes');
  });
});

// ══════════════════ §2 单击矩阵·BPM 行（含 §5 放置语义）══════════════════
describe('§2 BPM 工具单击', () => {
  it('空白新放置 = 追加 lastBpm + 打开就地编辑（默认值沿用上次所设值）+ 清选区', () => {
    const ops = clickOps(input({ tool: 'bpm', pos: sp(4, 0), lastBpm: 150 }));
    expect(ops).toEqual([
      { t: 'setNotes', notes: [bpm(4, 150)] },
      { t: 'openBpmEditor', beat: 4, value: '150' },
      { t: 'setSelection', items: [] },
    ]);
  });
  it('同拍已有 BPM 且值不同 → 字面覆盖为 lastBpm 再开编辑（ADR-0008 §5 定案）', () => {
    const ops = clickOps(input({ tool: 'bpm', notes: [bpm(4, 120)], pos: sp(4, 0), lastBpm: 150 }));
    expect(ops).toEqual([
      { t: 'setNotes', notes: [bpm(4, 150)] },
      { t: 'openBpmEditor', beat: 4, value: '150' },
      { t: 'setSelection', items: [] },
    ]);
  });
  it('同拍值相同 → 不写 notes（免空快照），只开编辑（仍清选区）', () => {
    const ops = clickOps(input({ tool: 'bpm', notes: [bpm(4, 150)], pos: sp(4, 0), lastBpm: 150 }));
    expect(ops).toEqual([
      { t: 'openBpmEditor', beat: 4, value: '150' },
      { t: 'setSelection', items: [] },
    ]);
  });
  it('非法位置 → 动作无事发生，但取消选中（§2 原则 6）', () => {
    expect(clickOps(input({ tool: 'bpm', pos: null }))).toEqual([{ t: 'setSelection', items: [] }]);
  });
});

// ══════════════════ §2 单击矩阵·Slide 行（§4 两击直放）══════════════════
describe('§2 Slide 工具单击（两击直放）', () => {
  it('第一次合法点击 = 挂临时端点（subBeat 归 0）+ 清选区（原则 6 扩订）', () => {
    expect(clickOps(input({ tool: 'slide', pos: sp(2, 1) })))
      .toEqual([{ t: 'setSlideBuffer', point: pt(2, 1) }, { t: 'setSelection', items: [] }]);
  });
  it('第二次合法点击 = 成条（按拍排序）+ 清锚点 + 清选区（§2 原则 6）', () => {
    const ops = clickOps(input({ tool: 'slide', pos: sp(1, 1), slideBuffer: pt(3, 2) }));
    expect(ops).toEqual([
      { t: 'setNotes', notes: [slide(1, 1, 3, 2)] },
      { t: 'setSlideBuffer', point: null },
      { t: 'setSelection', items: [] },
    ]);
  });
  it('挂锚点 / 取消锚点（都不改谱面）→ 同样清选区（原则 6 扩订：不按"是否改谱面"做双轨判定）', () => {
    expect(clickOps(input({ tool: 'slide', pos: sp(2, 1) })))
      .toEqual([{ t: 'setSlideBuffer', point: pt(2, 1) }, { t: 'setSelection', items: [] }]);
    expect(clickOps(input({ tool: 'slide', pos: sp(3, 5), slideBuffer: pt(3, 2) })))
      .toEqual([{ t: 'setSlideBuffer', point: null }, { t: 'setSelection', items: [] }]);
  });
  it('第二次点击与锚点同拍同半拍 = 取消（bug 32 语义；只看拍位不看轨道）+ 清选区', () => {
    expect(clickOps(input({ tool: 'slide', pos: sp(3, 5), slideBuffer: pt(3, 2) })))
      .toEqual([{ t: 'setSlideBuffer', point: null }, { t: 'setSelection', items: [] }]);
  });
  it('端点与既有滑条端点重合 → 走 ADR-0001 §3 合并', () => {
    const ops = clickOps(input({
      tool: 'slide', notes: [slide(1, 1, 2, 2)], pos: sp(3, 3), slideBuffer: pt(2, 2),
    }));
    expect(ops).toHaveLength(3);
    const merged = (ops[0] as any).notes.find(n => n.type === 'Slide') as SlideNote;
    expect(merged.connections.length).toBe(3);
    expect(ops[1]).toEqual({ t: 'setSlideBuffer', point: null });
    expect(ops[2]).toEqual({ t: 'setSelection', items: [] });
  });
  it('轨道外点击 = 取消锚点 + 清选区；无锚点时只清选区', () => {
    expect(clickOps(input({ tool: 'slide', pos: null, slideBuffer: pt(2, 1) })))
      .toEqual([{ t: 'setSlideBuffer', point: null }, { t: 'setSelection', items: [] }]);
    expect(clickOps(input({ tool: 'slide', pos: null, slideBuffer: null })))
      .toEqual([{ t: 'setSelection', items: [] }]);
  });
});

// ══════════════════ §2 单击矩阵·粘贴行（Ctrl+V 同语义）══════════════════
describe('§2 paste 工具单击', () => {
  const clipboard = [single(0, 0), single(0.5, 1)];
  it('位置化放置：setNotes + 选区 = 粘贴产物（音符/空白两列同格）', () => {
    const ops = clickOps(input({ tool: 'paste', notes: [bpm(0, 120)], pos: sp(4, 3), clipboard }));
    expect(ops).toHaveLength(2);
    const setN = ops.find(o => o.t === 'setNotes') as any;
    expect(setN.notes.length).toBe(3);
    expect(ops[1]).toEqual({
      t: 'setSelection',
      items: [{ kind: 'note', noteIndex: 1 }, { kind: 'note', noteIndex: 2 }],
    });
  });
  it('剪贴板空 / 轨道外 → 不粘贴，但取消选中（§2 原则 6）', () => {
    expect(clickOps(input({ tool: 'paste', pos: sp(4, 3), clipboard: [] })))
      .toEqual([{ t: 'setSelection', items: [] }]);
    expect(clickOps(input({ tool: 'paste', pos: null, clipboard })))
      .toEqual([{ t: 'setSelection', items: [] }]);
  });
});

// ══════════════════ §2 单击矩阵·动作工具行（T/Q，Model A）══════════════════
// §2.1（六轮）：copy / cut 已退出工具轴（不 arm），矩阵不再有这两行
describe('§2 delete/mirror 单击', () => {
  const notes: ChartNote[] = [single(1, 1), single(2, 2)];
  const hit = noteSel(0)[0];
  it('delete：删除 + 清选区', () => {
    const ops = clickOps(input({ tool: 'delete', notes, hit }));
    expect(ops).toEqual([
      { t: 'setNotes', notes: [single(2, 2)] },
      { t: 'setSelection', items: [] },
    ]);
  });
  it('mirror：选中 + 立即执行（lane 镜像 6−lane）', () => {
    const ops = clickOps(input({ tool: 'mirror', notes, hit }));
    expect(ops[0]).toEqual({ t: 'setSelection', items: [hit] });
    expect((ops[1] as any).notes[0].lane).toBe(5);
  });
  it('轨道内空白 = 无效果、不清选区（§2 定案）；轨道外 = 清选区（原则 6）', () => {
    for (const tool of ['delete', 'mirror'] as const) {
      expect(clickOps(input({ tool, notes, hit: null, pos: sp(4, 3) }))).toEqual([]);
      expect(clickOps(input({ tool, notes, hit: null, pos: null })))
        .toEqual([{ t: 'setSelection', items: [] }]);
    }
  });
  it('执行只看命中不看位置（pos=null 也照常执行）', () => {
    expect(clickOps(input({ tool: 'delete', notes, hit, pos: null }))).not.toEqual([]);
  });
});

// ══════════════════ §2 框选矩阵（boxSelectOps）══════════════════
describe('§2 框选矩阵', () => {
  it('键型行：框内逐个应用替换 + 原则4 选区保留（BPM 不参与不丢弃）', () => {
    const notes: ChartNote[] = [single(1, 1), single(2, 2), bpm(3, 120)];
    const ops = boxSelectOps('flick', notes, noteSel(0, 1, 2));
    expect(ops).toHaveLength(2);
    expect((ops[0] as any).notes.every((n: ChartNote, i: number) =>
      i === 2 ? n.type === 'BPM' : !!(n as any).flick)).toBe(true);
    expect(ops[1]).toEqual({ t: 'setSelection', items: noteSel(0, 1, 2) });
  });
  it('键型行：无可应用落点（框内全是 BPM）→ 无事发生', () => {
    expect(boxSelectOps('single', [bpm(1, 120)], noteSel(0))).toEqual([]);
  });
  it('bpm / paste 行 = 无效果', () => {
    expect(boxSelectOps('bpm', [single(1, 1)], noteSel(0))).toEqual([]);
    expect(boxSelectOps('paste', [single(1, 1)], noteSel(0))).toEqual([]);
  });
  it('slide 行：框选组合成滑条（§4）+ 完成后清选区（一次性动作，§2 原则 4 例外）+ 清两击锚点', () => {
    const notes: ChartNote[] = [single(1, 1), single(2, 2), bpm(9, 120)];
    const ops = boxSelectOps('slide', notes, noteSel(0, 1));
    expect(ops).toHaveLength(3);
    const setN = ops[0] as any;
    expect(setN.notes[setN.notes.length - 1].type).toBe('Slide'); // 组合滑条在数组末尾
    expect(ops[1]).toEqual({ t: 'setSelection', items: [] });
    expect(ops[2]).toEqual({ t: 'setSlideBuffer', point: null });
  });
  it('slide 行：可吸入 <2 → 无事发生', () => {
    expect(boxSelectOps('slide', [single(1, 1), bpm(2, 120)], noteSel(0, 1))).toEqual([]);
  });
  it('slide 行（§4 修订·滑条吸入）：框选两个独立滑条（slideNode 条目）→ 串链 + 完成后清选区', () => {
    const notes: ChartNote[] = [slide(1, 1, 2, 2), slide(3, 3, 4, 4)];
    const items: SelectionItem[] = [0, 1, 2, 3].map(ci =>
      ({ kind: 'slideNode' as const, noteIndex: ci < 2 ? 0 : 1, connIndex: ci % 2 }));
    const ops = boxSelectOps('slide', notes, items);
    expect(ops).toHaveLength(3);
    const setN = ops[0] as any;
    const s = setN.notes[setN.notes.length - 1];
    expect(s.type).toBe('Slide');
    expect(s.connections.map((c: any) => [c.beat, c.lane])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4]]);
    expect(ops[1]).toEqual({ t: 'setSelection', items: [] });
  });
  it('slide 行（§4 四轮修订·先接合后拆条）：两条滑条只框相邻端点 → 两条整链串成一条', () => {
    const notes: ChartNote[] = [slide(1, 1, 2, 2), slide(3, 3, 4, 4)];
    const items: SelectionItem[] = [
      { kind: 'slideNode', noteIndex: 0, connIndex: 1 },
      { kind: 'slideNode', noteIndex: 1, connIndex: 0 },
    ];
    const ops = boxSelectOps('slide', notes, items);
    expect(ops).toHaveLength(3);
    const chain = ((ops[0] as any).notes.at(-1)) as any;
    expect(chain.connections.map((c: any) => [c.beat, c.lane])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4]]);
    expect((ops[0] as any).notes).toHaveLength(1); // 两条宿主都被接合消耗，无拆条残留
    expect(ops[1]).toEqual({ t: 'setSelection', items: [] });
  });
  it('slide 行（§4 修订）：单条滑条整框选中（来源=1）→ 无事发生', () => {
    const items: SelectionItem[] = [0, 1, 2].map(ci => ({ kind: 'slideNode' as const, noteIndex: 0, connIndex: ci }));
    expect(boxSelectOps('slide', [slide(1, 1, 2, 2, 3, 3)], items)).toEqual([]);
  });
  it('动作行空框 = 无效果不清选区（T/Q 两行）', () => {
    for (const tool of ['delete', 'mirror'] as const) {
      expect(boxSelectOps(tool, [single(1, 1)], [])).toEqual([]);
    }
  });
  it('§2.1（六轮）：copy / cut 不占工具轴 → 框选无效果（只走 Ctrl+C / Ctrl+X 执行键）', () => {
    const notes: ChartNote[] = [single(1, 1), single(2, 2)];
    // 矩阵类型层面已移除；运行时兜底（旧配置残留）同样无效果
    expect(boxSelectOps('copy' as never, notes, noteSel(0, 1))).toEqual([]);
    expect(boxSelectOps('cut' as never, notes, noteSel(0, 1))).toEqual([]);
  });
  it('delete 行：删框内 + 清选区', () => {
    const notes: ChartNote[] = [single(1, 1), single(2, 2)];
    const ops = boxSelectOps('delete', notes, noteSel(0));
    expect(ops).toEqual([
      { t: 'setNotes', notes: [single(2, 2)] },
      { t: 'setSelection', items: [] },
    ]);
  });
  it('mirror 行：松手立即执行（预览在渲染器，无需二次确认）', () => {
    const notes: ChartNote[] = [single(1, 1), single(2, 2)];
    const ops = boxSelectOps('mirror', notes, noteSel(0, 1));
    expect(ops[0]).toEqual({ t: 'setSelection', items: noteSel(0, 1) });
    expect((ops[1] as any).notes.map((n: any) => n.lane)).toEqual([5, 4]);
  });
});

// ══════════════════ §3 执行键（Ctrl+E / Ctrl+`）══════════════════
describe('§3 execSlideOps（Ctrl+E）', () => {
  const twoKeys: ChartNote[] = [single(1, 1), single(2, 2)];
  it('有选区 → 组合档：≥2 可吸入即组合，光标/锚点一概不看', () => {
    const ops = execSlideOps({
      notes: twoKeys, selectedItems: noteSel(0, 1),
      cursor: null, slideBuffer: null, lastBpm: 120, chartEndBeat: 16,
    });
    expect(ops).toHaveLength(3);
    expect(ops[0].t).toBe('setNotes');
    expect((ops[0] as any).notes).toEqual([slide(1, 1, 2, 2)]); // 两键被吸入，谱面只剩结果滑条
    expect(ops[1]).toEqual({ t: 'setSelection', items: [] });    // 组合一次性 → 清选区
    expect(ops[2]).toEqual({ t: 'setSlideBuffer', point: null });
  });
  it('有选区但可吸入 <2 → 无事发生，且不落两击档（定案：无 fall-through）', () => {
    const ops = execSlideOps({
      notes: [bpm(1, 120)], selectedItems: noteSel(0),
      cursor: sp(2, 2), slideBuffer: null, lastBpm: 120, chartEndBeat: 16,
    });
    expect(ops).toEqual([]);
  });
  it('无选区 → 两击档：与 Slide 工具共用同一 slideBuffer（首次挂点/二次成条/同位取消）', () => {
    const base = { notes: [] as ChartNote[], selectedItems: [], lastBpm: 120, chartEndBeat: 16 };
    expect(execSlideOps({ ...base, cursor: sp(2, 1), slideBuffer: null }))
      .toEqual([{ t: 'setSlideBuffer', point: pt(2, 1) }, { t: 'setSelection', items: [] }]);
    expect(execSlideOps({ ...base, cursor: sp(1, 1), slideBuffer: pt(3, 2) }))
      .toEqual([
        { t: 'setNotes', notes: [slide(1, 1, 3, 2)] },
        { t: 'setSlideBuffer', point: null },
        { t: 'setSelection', items: [] }, // 成条 → 清选区（原则 6）
      ]);
    expect(execSlideOps({ ...base, cursor: sp(3, 2), slideBuffer: pt(3, 2) }))
      .toEqual([{ t: 'setSlideBuffer', point: null }, { t: 'setSelection', items: [] }]);
  });
  it('光标不在画布 / 越过谱面末端 → 无事发生', () => {
    const base = { notes: [] as ChartNote[], selectedItems: [], slideBuffer: null, lastBpm: 120, chartEndBeat: 16 };
    expect(execSlideOps({ ...base, cursor: null })).toEqual([]);
    expect(execSlideOps({ ...base, cursor: sp(20, 1) })).toEqual([]);
  });
});

describe('§3 execBpmOps（Ctrl+`）', () => {
  it('光标处放置（同拍覆盖）→ 就地编辑，与 BPM 工具单击同函数', () => {
    const ops = execBpmOps({
      notes: [bpm(2, 100)], selectedItems: [], cursor: sp(2, 1),
      slideBuffer: null, lastBpm: 150, chartEndBeat: 16,
    });
    expect(ops).toEqual([
      { t: 'setNotes', notes: [bpm(2, 150)] },
      { t: 'openBpmEditor', beat: 2, value: '150' },
    ]);
  });
  it('光标不在画布 / 越过末端 → 无事发生', () => {
    const base = { notes: [], selectedItems: [], slideBuffer: null, lastBpm: 120, chartEndBeat: 16 } as const;
    expect(execBpmOps({ ...base, cursor: null })).toEqual([]);
    expect(execBpmOps({ ...base, cursor: sp(17, 0) })).toEqual([]);
  });
});
