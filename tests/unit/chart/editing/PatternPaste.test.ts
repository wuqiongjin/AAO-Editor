// issue 186 锁测：片段粘贴（ADR-0023 §2）。
// 口径：片段只**构造载荷**，落点语义（锚点 / lane 夹取 / 越末端整组拒绝 / 同拍原位替换）
// 全走既有 `pasteChartNotes` —— 故本文件一半在锁"带不带 BPM"，一半在锁"与剪贴板粘贴同输入同输出"。
import { describe, expect, it } from 'vitest';
import { clickOps, type ClickInput } from '@/src/chart/editing/ToolActionMatrix';
import type { Pattern } from '@/src/chart/patterns/types';
import type { ChartNote } from '@/src/chart/types';

const single = (beat: number, lane: number): ChartNote => ({ type: 'Single', beat, lane });
const bpm = (beat: number, value: number): ChartNote => ({ type: 'BPM', beat, bpm: value });

/** 片段夹具：两个音符占 beat 2–3（源谱面的绝对拍，`startBpm` 语境相对它自己的起点） */
const makePattern = (overrides: Partial<Pattern> = {}): Pattern => ({
  id: 'p1',
  name: '片段 1',
  createdAt: 1,
  notes: [single(2, 3), single(3, 4)],
  bpmContext: { startBpm: 120, events: [] },
  ...overrides,
});

const input = (patch: Partial<ClickInput>): ClickInput => ({
  tool: 'paste', notes: [], hit: null, pos: null,
  slideBuffer: null, lastBpm: 120, clipboard: [],
  chartEndBeat: 1e9, beatDisplay: 4,
  selectedItems: [],
  ...patch,
});

/** 一次片段粘贴 → 写进谱面的音符数组（断言用；无 setNotes = 什么都没写） */
const pastedNotes = (ops: ReturnType<typeof clickOps>): ChartNote[] | null => {
  const op = ops.find(o => o.t === 'setNotes');
  return op ? op.notes : null;
};
const bpmLines = (notes: ChartNote[] | null) => (notes ?? []).filter(n => n.type === 'BPM');
const notesOnly = (notes: ChartNote[] | null) => (notes ?? []).filter(n => n.type !== 'BPM');

describe('issue 186 · 带 BPM 的写入判定', () => {
  const target = [bpm(0, 120)];

  it('startBpm 与目标落点生效 BPM 相同 → 不写线（同速粘贴不长出多余横线）', () => {
    const ops = clickOps(input({
      notes: target, pos: { beat: 8, lane: 3 },
      pastePattern: { pattern: makePattern(), withBpm: true },
    }));
    expect(bpmLines(pastedNotes(ops))).toHaveLength(1); // 只剩目标自己的 beat 0
    expect(pastedNotes(ops)).toEqual([bpm(0, 120), single(8, 3), single(9, 4)]);
  });

  it('startBpm 不同 → 在落点写一条（数值绝对值，不按目标速度缩放）', () => {
    const ops = clickOps(input({
      notes: target, pos: { beat: 8, lane: 3 },
      pastePattern: { pattern: makePattern({ bpmContext: { startBpm: 200, events: [] } }), withBpm: true },
    }));
    expect(bpmLines(pastedNotes(ops))).toEqual([bpm(0, 120), bpm(8, 200)]);
  });

  it('负 startBpm 也照原值写（倒流区片段不拦、不换算）', () => {
    const ops = clickOps(input({
      notes: target, pos: { beat: 8, lane: 3 },
      pastePattern: { pattern: makePattern({ bpmContext: { startBpm: -120, events: [] } }), withBpm: true },
    }));
    expect(bpmLines(pastedNotes(ops))).toContainEqual(bpm(8, -120));
  });

  it('events 按同一 deltaBeat 平移写入（起点相同则不重复写 startBpm）', () => {
    const pattern = makePattern({
      bpmContext: { startBpm: 120, events: [{ deltaBeat: 1, bpm: 180 }, { deltaBeat: 2, bpm: 120 }] },
    });
    const ops = clickOps(input({ notes: target, pos: { beat: 8, lane: 3 }, pastePattern: { pattern, withBpm: true } }));
    expect(bpmLines(pastedNotes(ops))).toEqual([bpm(0, 120), bpm(9, 180), bpm(10, 120)]);
    // 音符与 BPM 共用同一次平移：组内相对位置不变
    expect(notesOnly(pastedNotes(ops))).toEqual([single(8, 3), single(9, 4)]);
  });

  it('同拍已有 BPM → 原位替换该条（不新增）', () => {
    const ops = clickOps(input({
      notes: [bpm(0, 120), bpm(9, 100)], pos: { beat: 8, lane: 3 },
      pastePattern: { pattern: makePattern({ bpmContext: { startBpm: 120, events: [{ deltaBeat: 1, bpm: 180 }] } }), withBpm: true },
    }));
    const lines = bpmLines(pastedNotes(ops));
    expect(lines).toHaveLength(2);
    expect(lines).toContainEqual(bpm(9, 180));
    expect(lines).not.toContainEqual(bpm(9, 100));
  });

  it('不补"恢复 BPM"：片段尾部没有恢复线，粘贴后也不会长出（ADR-0023 §2）', () => {
    const ops = clickOps(input({
      notes: [bpm(0, 120)], pos: { beat: 8, lane: 3 },
      pastePattern: { pattern: makePattern({ bpmContext: { startBpm: -120, events: [{ deltaBeat: 1, bpm: -60 }] } }), withBpm: true },
    }));
    expect(bpmLines(pastedNotes(ops))).toEqual([bpm(0, 120), bpm(8, -120), bpm(9, -60)]);
  });

  it('落点在首条 BPM 之前：目标生效值按 DEFAULT_BPM 比（同速仍不写线）', () => {
    const notes = [bpm(20, 180)];
    const ops = clickOps(input({ notes, pos: { beat: 4, lane: 3 }, pastePattern: { pattern: makePattern(), withBpm: true } }));
    expect(bpmLines(pastedNotes(ops))).toEqual([bpm(20, 180)]);
  });
});

describe('issue 186 · 不含 BPM', () => {
  it('一条 BPM 都不写（哪怕 startBpm 不同、跨度内有事件）', () => {
    const pattern = makePattern({ bpmContext: { startBpm: 200, events: [{ deltaBeat: 1, bpm: -120 }] } });
    const ops = clickOps(input({
      notes: [bpm(0, 120)], pos: { beat: 8, lane: 3 },
      pastePattern: { pattern, withBpm: false },
    }));
    expect(bpmLines(pastedNotes(ops))).toEqual([bpm(0, 120)]);
    expect(notesOnly(pastedNotes(ops))).toEqual([single(8, 3), single(9, 4)]);
  });
});

describe('issue 186 · 落点规则全部沿用既有粘贴', () => {
  it('越谱面末端仍整组拒绝（只清选区，不写谱面）', () => {
    const ops = clickOps(input({
      notes: [bpm(0, 120)], pos: { beat: 9, lane: 3 }, chartEndBeat: 10,
      pastePattern: { pattern: makePattern(), withBpm: true },
    }));
    // 组高 1 拍：落点 9 → 组尾 10 恰好不越界
    expect(pastedNotes(ops)).not.toBeNull();

    const rejected = clickOps(input({
      notes: [bpm(0, 120)], pos: { beat: 9.5, lane: 3 }, chartEndBeat: 10,
      pastePattern: { pattern: makePattern(), withBpm: true },
    }));
    expect(rejected).toEqual([{ t: 'setSelection', items: [] }]);
  });

  it('lane 仍只夹取（组超出右缘 → 整体左移，不塌缩）', () => {
    const pattern = makePattern({ notes: [single(2, 5), single(3, 6)] });
    const ops = clickOps(input({ notes: [bpm(0, 120)], pos: { beat: 8, lane: 4 }, pastePattern: { pattern, withBpm: true } }));
    expect(notesOnly(pastedNotes(ops)).map(n => (n as { lane: number }).lane)).toEqual([4, 5]);
  });

  it('锚点结果与剪贴板粘贴同输入同输出（含带 BPM 的载荷：多出来的只有 BPM 线）', () => {
    // 用会真的写线的语境（异值 + 事件），否则这条断言退化成"两边都没写"
    const pattern = makePattern({
      bpmContext: { startBpm: 200, events: [{ deltaBeat: 1, bpm: -120 }] },
    });
    const base = { notes: [bpm(0, 120)], pos: { beat: 8, lane: 3 }, beatDisplay: 4 } as const;
    const viaClipboard = clickOps(input({ ...base, clipboard: pattern.notes }));

    // ① 不含 BPM：逐字相同
    const plain = clickOps(input({ ...base, pastePattern: { pattern, withBpm: false } }));
    expect(pastedNotes(plain)).toEqual(pastedNotes(viaClipboard));

    // ② 带 BPM：音符落点一字不差，BPM 只是额外写进来的线
    const withBpm = clickOps(input({ ...base, pastePattern: { pattern, withBpm: true } }));
    expect(notesOnly(pastedNotes(withBpm))).toEqual(notesOnly(pastedNotes(viaClipboard)));
  });

  it('选区只收音符：片段带进来的 BPM 不进选区（issue 71）', () => {
    const pattern = makePattern({ bpmContext: { startBpm: 200, events: [{ deltaBeat: 1, bpm: 180 }] } });
    const ops = clickOps(input({ notes: [bpm(0, 120)], pos: { beat: 8, lane: 3 }, pastePattern: { pattern, withBpm: true } }));
    const notes = pastedNotes(ops)!;
    const items = ops.find(o => o.t === 'setSelection') as { items: { noteIndex: number }[] };
    expect(items.items).toEqual([
      { kind: 'note', noteIndex: notes.findIndex(n => n.type === 'Single' && n.beat === 8) },
      { kind: 'note', noteIndex: notes.findIndex(n => n.type === 'Single' && n.beat === 9) },
    ]);
  });

  it('空片段 / 落点非法 → 只清选区', () => {
    expect(clickOps(input({
      notes: [bpm(0, 120)], pos: { beat: 8, lane: 3 },
      pastePattern: { pattern: makePattern({ notes: [] }), withBpm: true },
    }))).toEqual([{ t: 'setSelection', items: [] }]);
    expect(clickOps(input({
      notes: [bpm(0, 120)], pos: null,
      pastePattern: { pattern: makePattern(), withBpm: true },
    }))).toEqual([{ t: 'setSelection', items: [] }]);
  });
});
