// ADR-0008 §4 框选组合：排序规则 + 形态归一表 + 接合——逐行锁表（用户明确要求：
// 规则表"明确地"落到文档和代码，未来变动先改 ADR-0008 再改本表断言）。
import { describe, it, expect } from 'vitest';
import type { ChartNote, SelectionItem, SlideNote } from '../../src/chart/types';
import {
  combineSelectionIntoSlide,
  connectionFromAbsorbedNote,
  sortAbsorbable,
} from '../../src/chart/editing/SlideCombination';

const single = (beat: number, lane: number, extra: Partial<ChartNote> = {}): ChartNote =>
  ({ type: 'Single', beat, lane, subBeat: 0, ...extra });
const dirL = (beat: number, lane: number, length = 1): ChartNote =>
  ({ type: 'LDirectional', beat, lane, subBeat: 0, length });
const dirR = (beat: number, lane: number, length = 1): ChartNote =>
  ({ type: 'RDirectional', beat, lane, subBeat: 0, length });
const slide = (...flat: number[]): ChartNote => {
  const connections = [];
  for (let i = 0; i < flat.length; i += 2) connections.push({ beat: flat[i], lane: flat[i + 1], subBeat: 0 });
  return { type: 'Slide', connections };
};
const noteSel = (...idxs: number[]): SelectionItem[] => idxs.map(i => ({ kind: 'note' as const, noteIndex: i }));

describe('归一表（ADR-0008 §4）——逐行锁定', () => {
  it('行1 单键：三个位置都是普通端点/中间结点', () => {
    const n = single(2, 3) as any;
    expect(connectionFromAbsorbedNote(n, 'start')).toEqual({ beat: 2, lane: 3, subBeat: 0 });
    expect(connectionFromAbsorbedNote(n, 'middle')).toEqual({ beat: 2, lane: 3, subBeat: 0 });
    expect(connectionFromAbsorbedNote(n, 'end')).toEqual({ beat: 2, lane: 3, subBeat: 0 });
  });

  it('行2 滑键 flick：起始降为普通端点(剥标)，中间统一化(剥标)，末尾保留 flick', () => {
    const n = single(2, 3, { flick: true }) as any;
    expect(connectionFromAbsorbedNote(n, 'start').flick).toBeFalsy();
    expect(connectionFromAbsorbedNote(n, 'middle').flick).toBeFalsy();
    expect(connectionFromAbsorbedNote(n, 'end').flick).toBe(true);
    // 起点/中间剥标后不残留任何标记字段
    expect(connectionFromAbsorbedNote(n, 'start')).toEqual({ beat: 2, lane: 3, subBeat: 0 });
    expect(connectionFromAbsorbedNote(n, 'middle')).toEqual({ beat: 2, lane: 3, subBeat: 0 });
  });

  it('行3 技能键 skill：起始保留，中间统一化(剥标)，末尾保留', () => {
    const n = single(2, 3, { skill: true }) as any;
    expect(connectionFromAbsorbedNote(n, 'start').skill).toBe(true);
    expect(connectionFromAbsorbedNote(n, 'middle').skill).toBeFalsy();
    expect(connectionFromAbsorbedNote(n, 'end').skill).toBe(true);
  });

  it('行2+行3 叠加：flick+skill 并存 → 起点留 skill 剥 flick，中间全剥，末尾双保留', () => {
    const n = single(2, 3, { flick: true, skill: true }) as any;
    expect(connectionFromAbsorbedNote(n, 'start')).toEqual({ beat: 2, lane: 3, subBeat: 0, skill: true });
    expect(connectionFromAbsorbedNote(n, 'middle')).toEqual({ beat: 2, lane: 3, subBeat: 0 });
    expect(connectionFromAbsorbedNote(n, 'end')).toEqual({ beat: 2, lane: 3, subBeat: 0, flick: true, skill: true });
  });

  it('行4 方向键：三个位置都是普通端点/统一化中间结点，length 不保留', () => {
    for (const n of [dirL(2, 3, 2), dirR(2, 3, 3)] as any[]) {
      expect(connectionFromAbsorbedNote(n, 'start')).toEqual({ beat: 2, lane: 3, subBeat: 0 });
      expect(connectionFromAbsorbedNote(n, 'middle')).toEqual({ beat: 2, lane: 3, subBeat: 0 });
      expect(connectionFromAbsorbedNote(n, 'end')).toEqual({ beat: 2, lane: 3, subBeat: 0 });
    }
  });

  it('subBeat 原样保留在结点上', () => {
    const n = single(1.25, 2, { subBeat: undefined }) as any;
    n.subBeat = 0.25;
    expect(connectionFromAbsorbedNote(n, 'start').subBeat).toBe(0.25);
  });
});

describe('排序规则（ADR-0008 §4）', () => {
  it('beat+subBeat 升序，同拍按 lane 升序', () => {
    const arr = [
      { beat: 2, subBeat: 0, lane: 5 },
      { beat: 1.5, subBeat: 0, lane: 5 },
      { beat: 2, subBeat: 0, lane: 1 },
      { beat: 1.5, subBeat: 0, lane: 1 },
      { beat: 2, subBeat: 0.5, lane: 0 },
      { beat: 1, subBeat: 0, lane: 6 },
    ];
    expect(sortAbsorbable(arr).map(p => [p.beat, p.subBeat, p.lane])).toEqual([
      [1, 0, 6],
      [1.5, 0, 1],
      [1.5, 0, 5],
      [2, 0, 1],
      [2, 0, 5],
      [2, 0.5, 0],
    ]);
  });

  it('不改动入参（纯函数）', () => {
    const arr = [{ beat: 2, lane: 1 }, { beat: 1, lane: 1 }];
    sortAbsorbable(arr);
    expect(arr[0].beat).toBe(2);
  });
});

describe('combineSelectionIntoSlide：框选组合', () => {
  it('zigzag 样例：乱序框选 4 键 → 排序重现特殊滑条样例 1.5l1→1.5l5→2l1→2l5（同拍横向段合法）', () => {
    const notes: ChartNote[] = [
      single(2, 5),   // 0
      single(1.5, 1), // 1
      single(2, 1),   // 2
      single(1.5, 5), // 3
    ];
    const r = combineSelectionIntoSlide(notes, noteSel(0, 1, 2, 3));
    expect(r.shouldCombine).toBe(true);
    const s = r.newNotes[r.slideIndex!] as SlideNote;
    expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[1.5, 1], [1.5, 5], [2, 1], [2, 5]]);
    // 被吸音符全部消耗
    expect(r.newNotes.length).toBe(1);
  });

  it('N=2 成条：首=start 尾=end 各按归一表处置', () => {
    const notes: ChartNote[] = [
      single(1, 1, { flick: true }), // flick 在起始位 → 剥标
      single(2, 3, { skill: true }), // skill 在末尾位 → 保留
    ];
    const r = combineSelectionIntoSlide(notes, noteSel(0, 1));
    const s = r.newNotes[r.slideIndex!] as SlideNote;
    expect(s.connections[0]).toEqual({ beat: 1, lane: 1, subBeat: 0 });
    expect(s.connections[1]).toEqual({ beat: 2, lane: 3, subBeat: 0, skill: true });
  });

  it('中间结点统一化：flick/skill 在中间位一律剥标', () => {
    const notes: ChartNote[] = [
      single(1, 1),
      single(2, 2, { flick: true }),
      single(3, 3, { skill: true }),
      single(4, 4),
    ];
    const r = combineSelectionIntoSlide(notes, noteSel(0, 1, 2, 3));
    const s = r.newNotes[r.slideIndex!] as SlideNote;
    expect(s.connections[1]).toEqual({ beat: 2, lane: 2, subBeat: 0 });
    expect(s.connections[2]).toEqual({ beat: 3, lane: 3, subBeat: 0 });
  });

  it('可组合音符 <2 → 无事发生（返回原数组引用）', () => {
    const notes: ChartNote[] = [single(1, 1)];
    const r = combineSelectionIntoSlide(notes, noteSel(0));
    expect(r.shouldCombine).toBe(false);
    expect(r.newNotes).toBe(notes);
    expect(combineSelectionIntoSlide(notes, []).shouldCombine).toBe(false);
  });

  it('忽略不可吸对象：滑条子部分/整条滑条/BPM 不参与也不消耗', () => {
    const notes: ChartNote[] = [
      single(1, 1),
      slide(2, 2, 3, 3),               // 整条滑条 kind:'note' → 忽略
      { type: 'BPM', beat: 4, bpm: 120 },
    ];
    const items: SelectionItem[] = [
      ...noteSel(0, 1, 2),
      { kind: 'slideNode', noteIndex: 1, connIndex: 0 },
      { kind: 'slideRegion', noteIndex: 1, connIndex: 0 },
    ];
    const r = combineSelectionIntoSlide(notes, items);
    expect(r.shouldCombine).toBe(false); // 只有 1 个键型音符可吸入
  });

  it('无就地变异：未受影响音符复用原引用，入参数组不被改动', () => {
    const keep = { type: 'System', beat: 5, data: 'x' } as ChartNote;
    const notes: ChartNote[] = [single(1, 1), single(2, 2), keep];
    const snapshot = notes.map(n => ({ ...n }));
    const r = combineSelectionIntoSlide(notes, noteSel(0, 1));
    expect(notes[2]).toBe(keep); // 原数组对象未被改动
    expect(r.newNotes[0]).toBe(keep); // 结构共享
    expect(r.newNotes).not.toBe(notes);
    expect(notes.length).toBe(3);
    void snapshot;
  });
});

describe('接合（ADR-0001 §3）：组合链端点与既有滑条端点重合', () => {
  it('既有滑条末尾端点 == 链起始 → 向前接长，共享点降为中间结点(hidden:false)', () => {
    const notes: ChartNote[] = [
      slide(1, 1, 2, 2), // 既有滑条 0→2拍
      single(2, 2),      // 吸入起点与既有末尾重合
      single(3, 3),
    ];
    const r = combineSelectionIntoSlide(notes, noteSel(1, 2));
    expect(r.newNotes.length).toBe(1); // 既有滑条被合并消耗
    const s = r.newNotes[0] as SlideNote;
    expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[1, 1], [2, 2], [3, 3]]);
    expect(s.connections[1]).toEqual({ beat: 2, lane: 2, subBeat: 0, hidden: false });
  });

  it('既有滑条起始端点 == 链末尾 → 向后接长', () => {
    const notes: ChartNote[] = [
      single(1, 1),
      single(2, 2), // 吸入终点与既有起点重合
      slide(2, 2, 3, 4),
    ];
    const r = combineSelectionIntoSlide(notes, noteSel(0, 1));
    expect(r.newNotes.length).toBe(1);
    const s = r.newNotes[0] as SlideNote;
    expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[1, 1], [2, 2], [3, 4]]);
  });

  it('同向端点重合（起点+起点、终点+终点）→ 不合并，两条独立滑条', () => {
    const notes: ChartNote[] = [
      slide(2, 2, 4, 4),
      single(2, 2),
      single(3, 3),
    ];
    const r = combineSelectionIntoSlide(notes, noteSel(1, 2));
    expect(r.newNotes.length).toBe(2); // 既有滑条 + 新滑条
    const s = r.newNotes[r.slideIndex!] as SlideNote;
    expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[2, 2], [3, 3]]);
  });

  it('两端各接一条既有滑条 → 三段串成一条', () => {
    const notes: ChartNote[] = [
      slide(1, 1, 2, 2),
      slide(3, 3, 4, 4),
      single(2, 2),
      single(3, 3),
    ];
    const r = combineSelectionIntoSlide(notes, noteSel(2, 3));
    expect(r.newNotes.length).toBe(1);
    const s = r.newNotes[0] as SlideNote;
    expect(s.connections.map(c => [c.beat, c.lane])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4]]);
  });

  it('flick 末尾端点接入既有滑条（共享点降中间结点时剥标）', () => {
    const notes: ChartNote[] = [
      slide(1, 1, 2, 2),
      single(2, 2, { flick: true }),
      single(3, 3),
    ];
    const r = combineSelectionIntoSlide(notes, noteSel(1, 2));
    const s = r.newNotes[0] as SlideNote;
    expect(s.connections[1]).toEqual({ beat: 2, lane: 2, subBeat: 0, hidden: false }); // flick 被降为普通中间结点
  });
});
