import { describe, it, expect } from 'vitest';
import { pasteChartNotes } from '@/src/chart/editing/NoteReplacementRules';
import type { ChartNote } from '@/src/chart/types';

// 粘贴 = 应用 ADR-0001 覆盖规则（修复直接 concat 导致同坐标重叠音符）
// issue 73：粘贴**整组**校验谱面末端 —— 越界即拒绝整组（想放下请先延长谱面长度）。
// 判据与放置/执行键同源（ChartEndBounds.isPastChartEnd / groupMaxBeat）。
describe('pasteChartNotes - 整组越出谱面末端应拒绝（issue 73）', () => {
  const bounds = { chartEndBeat: 10, beatDisplay: 4 };
  const twoKeys: ChartNote[] = [
    { type: 'Single', beat: 9, lane: 1, subBeat: 0 },
    { type: 'Single', beat: 10, lane: 1, subBeat: 0 }, // 组高 1 拍
  ];

  it('组尾恰好落在末端 → 正常粘贴', () => {
    const r = pasteChartNotes([], twoKeys, 9, 1, bounds);
    expect(r.rejected).toBeUndefined();
    expect(r.newNotes).toHaveLength(2);
  });

  it('锚点在界内但**组尾**越界 → rejected，且 newNotes 与原数组同引用（不写谱）', () => {
    const notes: ChartNote[] = [{ type: 'BPM', beat: 0, bpm: 120 }];
    const r = pasteChartNotes(notes, twoKeys, 9.5, 1, bounds); // 组尾 10.5 > 10
    expect(r.rejected).toBe('past-end');
    expect(r.newNotes).toBe(notes);
    expect(r.written).toEqual([]);
  });

  it('滑条组：任一结点越界即整组拒绝', () => {
    const slide: ChartNote[] = [{
      type: 'Slide',
      connections: [{ beat: 9, lane: 1, subBeat: 0 }, { beat: 11, lane: 1, subBeat: 0 }],
    } as ChartNote];
    expect(pasteChartNotes([], slide, 9, 1, bounds).rejected).toBe('past-end');
    expect(pasteChartNotes([], slide, 7, 1, bounds).rejected).toBeUndefined(); // 组尾 9 ≤ 10
  });

  it('不传 bounds = 不校验（纯逻辑单测兼容）', () => {
    expect(pasteChartNotes([], twoKeys, 100, 1).rejected).toBeUndefined();
  });
});

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

  // issue 130：删掉「方向键 length>1 事后回填」那段后，粘贴到单键按 ADR §1.1 = 替换为 length=1
  // （此前那段回填顺带把这个落点也保成了 2，与 §1.1 不符，且无测试看守）
  it('粘贴 length=2 方向键到既有单键：按 ADR §1.1 替换为 length=1', () => {
    const notes: ChartNote[] = [{ type: 'Single', beat: 5, lane: 1, subBeat: 0 }];
    const clipboard: ChartNote[] = [{ type: 'LDirectional', beat: 5, lane: 1, subBeat: 0, length: 2 }];
    const r = pasteChartNotes(notes, clipboard, 5, 1);
    expect(r.newNotes).toHaveLength(1);
    expect(r.newNotes[0]).toMatchObject({ type: 'LDirectional', length: 1 });
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

  // issue 130：拖 / 粘贴两条路径合成一份 —— 拆条产物继承来源方向键的 length / flick / skill
  it('粘贴 length=3 方向键到滑条中间结点：拆条产物保留 length=3', () => {
    const longSlide: ChartNote = {
      type: 'Slide',
      connections: [
        { beat: 1, lane: 0, subBeat: 0 },
        { beat: 2, lane: 0, subBeat: 0 },
        { beat: 3, lane: 0, subBeat: 0 }
      ]
    };
    const clipboard: ChartNote[] = [{ type: 'LDirectional', beat: 2, lane: 0, subBeat: 0, length: 3 }];
    const r = pasteChartNotes([longSlide], clipboard, 2, 0);
    expect(r.newNotes.find(n => n.type === 'LDirectional')).toMatchObject({ beat: 2, lane: 0, length: 3 });
  });

  it('粘贴带 skill 的方向键到滑条中间结点：拆条产物保留 skill', () => {
    const clipboard: ChartNote[] = [
      { type: 'LDirectional', beat: 2, lane: 0, subBeat: 0, length: 2, skill: true }
    ];
    const r = pasteChartNotes([slide], clipboard, 2, 0);
    expect(r.newNotes.find(n => n.type === 'LDirectional')).toMatchObject({ length: 2, skill: true });
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

describe('pasteChartNotes - written（本次实际写入下标，2026-09-08 评审修复）', () => {
  it('有重叠时下标不连续 → written 为实际写入项（不能假设 newStartIndex+i）', () => {
    const notes: ChartNote[] = [{ type: 'Single', beat: 5, lane: 1, subBeat: 0 }];
    const clipboard: ChartNote[] = [
      { type: 'Single', beat: 5, lane: 1, subBeat: 0, flick: true }, // 与既有同位 → 就地替换，不 push
      { type: 'Single', beat: 6, lane: 1, subBeat: 0 },               // 空位 → push
    ];
    const r = pasteChartNotes(notes, clipboard, 5, 1);
    expect(r.newNotes).toHaveLength(2);
    // 旧实现：newStartIndex=1 → 只选中下标 1，漏掉被替换的下标 0
    expect(r.written).toEqual([0, 1]);
    expect((r.newNotes[0] as any).flick).toBe(true);
  });

  it('拆条产物也算写入（可能比剪贴板更多）', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [{ beat: 1, lane: 0, subBeat: 0 }, { beat: 2, lane: 0, subBeat: 0 }, { beat: 3, lane: 0, subBeat: 0 }],
    }];
    const clipboard: ChartNote[] = [{ type: 'LDirectional', beat: 2, lane: 0, subBeat: 0, length: 1 }];
    const r = pasteChartNotes(notes, clipboard, 2, 0);
    // 中间结点被拆：两侧退化单键 + 独立方向键 = 3 个写入项（旧实现只选中 newStartIndex+0 = 1 个）
    expect(r.written).toEqual([0, 1, 2]);
    expect(r.newNotes.filter(n => n.type === 'Single')).toHaveLength(2);
    expect(r.newNotes.filter(n => n.type === 'LDirectional')).toHaveLength(1);
  });
});

describe('pasteChartNotes · ADR-0014 粘贴合法化 lane', () => {
  it('键音符粘贴到越界目标时夹进 0..6', () => {
    const clipboard: ChartNote[] = [{ type: 'Single', beat: 1, lane: 0, subBeat: 0 }];
    const r = pasteChartNotes([], clipboard, 1, -2);
    expect((r.newNotes[0] as { lane: number }).lane).toBe(0);
  });

  it('滑条可见端点夹轨，hidden 保持相对越界', () => {
    const clipboard: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 1, lane: 0, subBeat: 0 },
        { beat: 2, lane: -0.5, hidden: true, subBeat: 0 },
        { beat: 3, lane: 1, subBeat: 0 },
      ],
    }];
    const r = pasteChartNotes([], clipboard, 1, -1);
    const s = r.newNotes[0] as { connections: { lane: number }[] };
    expect(s.connections.map(c => c.lane)).toEqual([0, -0.5, 1]);
  });
});
