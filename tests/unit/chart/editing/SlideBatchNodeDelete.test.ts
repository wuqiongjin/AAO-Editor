import { describe, it, expect } from 'vitest';
import type { ChartNote, SlideNote } from '@/src/chart/types';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { computeItemsInBox, type HitTestDeps } from '@/src/rendering/hitTest/hitTest';
import { deleteSelection } from '@/src/chart/editing/SelectionEditing';

const bpm120 = [{ beat: 0, bpm: 120 }];
const TEST_SURFACE = { w: 750, h: 900 };

function makeDeps(notes: ChartNote[], chartEndBeat = 100): {
  deps: HitTestDeps;
  canvas: (lane: number, beat: number, subBeat?: number) => { x: number; y: number };
} {
  const geometry = new ChartGeometry(bpm120, { endBeat: chartEndBeat }, TEST_SURFACE);
  const viewport = { scrollX: 0, scrollY: 0, scale: 1 };
  const beatDisplay = 4;
  const canvas = (lane: number, beat: number, subBeat = 0) =>
    geometry.virtualToCanvas(
      geometry.noteVirtualX(lane),
      geometry.noteVirtualY(beat, subBeat, viewport.scale, beatDisplay),
      viewport,
    );
  return { deps: { geometry, viewport, beatDisplay, notes }, canvas };
}

function makeBox(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  pad = 10,
): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: Math.min(p1.x, p2.x) - pad,
    y1: Math.min(p1.y, p2.y) - pad,
    x2: Math.max(p1.x, p2.x) + pad,
    y2: Math.max(p1.y, p2.y) + pad,
  };
}

describe('issue 196 · 框选批量删滑条中间结点与 A′ 优先级规则', () => {
  it('症状 A（SP 段丢采样点）：框选两个可见结点删除后，采样点保留，与逐个删两结点结果逐字相等', () => {
    // 原始：beat 4 → 7.25，每 0.0625 拍一个结点，共 53 个
    // 可见结点：4 (0), 5.25 (20), 6.5 (40), 7.25 (52)，其余 49 个是 hidden 采样点
    const connections: SlideNote['connections'] = [];
    for (let i = 0; i <= 52; i++) {
      const beat = 4 + i * 0.0625;
      const isVisibleNode = i === 0 || i === 20 || i === 40 || i === 52;
      connections.push({
        beat,
        lane: 3,
        subBeat: 0,
        ...(isVisibleNode ? {} : { hidden: true }),
      });
    }
    const notes: ChartNote[] = [{ type: 'Slide', connections }];
    const { deps, canvas } = makeDeps(notes);

    // 框选范围：覆盖 5.25 (i=20) 和 6.5 (i=40) 及其之间的段
    const box = makeBox(canvas(0, 6.6), canvas(6, 5.2));

    const boxItems = computeItemsInBox(box, deps);
    // 确认框选产物同时包含结点与 region
    expect(boxItems).toContainEqual({ kind: 'slideNode', noteIndex: 0, connIndex: 20 });
    expect(boxItems).toContainEqual({ kind: 'slideNode', noteIndex: 0, connIndex: 40 });
    expect(boxItems).toContainEqual({ kind: 'slideRegion', noteIndex: 0, connIndex: 20 });

    // 只传两个 slideNode 条目时的结果（黄金标准 / 逐个删等价结果）
    const pureNodeResult = deleteSelection(notes, [
      { kind: 'slideNode', noteIndex: 0, connIndex: 20 },
      { kind: 'slideNode', noteIndex: 0, connIndex: 40 },
    ]);

    const boxDeleteResult = deleteSelection(notes, boxItems);

    // 框选删除与只删结点的结果逐字相等
    expect(boxDeleteResult).toEqual(pureNodeResult);

    // 53 个结点全在，20 与 40 原位转 hidden，采样点未被清空
    expect(boxDeleteResult).toHaveLength(1);
    const slide = boxDeleteResult[0] as SlideNote;
    expect(slide.connections).toHaveLength(53);
    expect(slide.connections[20]?.hidden).toBe(true);
    expect(slide.connections[40]?.hidden).toBe(true);
  });

  it('症状 B（普通滑条整条消失）：框选两个中间结点后转 hidden，整条滑条保留', () => {
    // 原始：1.75/5 → 2.25/0 → 3/4 → 3.75/4（无 hidden）
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 1.75, lane: 5, subBeat: 0 },
        { beat: 2.25, lane: 0, subBeat: 0 },
        { beat: 3, lane: 4, subBeat: 0 },
        { beat: 3.75, lane: 4, subBeat: 0 },
      ],
    }];
    const { deps, canvas } = makeDeps(notes);

    // 框选中间两个结点：2.25/0 与 3/4
    const box = makeBox(canvas(0, 3.2), canvas(6, 2.0));

    const boxItems = computeItemsInBox(box, deps);
    expect(boxItems).toContainEqual({ kind: 'slideNode', noteIndex: 0, connIndex: 1 });
    expect(boxItems).toContainEqual({ kind: 'slideNode', noteIndex: 0, connIndex: 2 });
    expect(boxItems).toContainEqual({ kind: 'slideRegion', noteIndex: 0, connIndex: 1 });

    const pureNodeResult = deleteSelection(notes, [
      { kind: 'slideNode', noteIndex: 0, connIndex: 1 },
      { kind: 'slideNode', noteIndex: 0, connIndex: 2 },
    ]);

    const boxDeleteResult = deleteSelection(notes, boxItems);

    expect(boxDeleteResult).toEqual(pureNodeResult);
    expect(boxDeleteResult).toHaveLength(1);
    const slide = boxDeleteResult[0] as SlideNote;
    expect(slide.connections).toHaveLength(4);
    expect(slide.connections.map(c => [c.beat, c.lane, c.hidden ?? false])).toEqual([
      [1.75, 5, false],
      [2.25, 0, true],
      [3, 4, true],
      [3.75, 4, false],
    ]);
  });

  it('回归（issue 80）：仅选中 slideRegion（单击段）仍清空段内 hidden 或拆条', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 1, lane: 1, subBeat: 0 },
        { beat: 2, lane: 1, subBeat: 0, hidden: true },
        { beat: 3, lane: 1, subBeat: 0 },
      ],
    }];
    const out = deleteSelection(notes, [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }]);
    expect(out).toHaveLength(1);
    const slide = out[0] as SlideNote;
    expect(slide.connections.map(c => [c.beat, c.lane])).toEqual([[1, 1], [3, 1]]);
    expect(slide.connections.some(c => c.hidden)).toBe(false);
  });

  it('回归：框选整条滑条删除仍整条消失', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { beat: 1.75, lane: 5, subBeat: 0 },
        { beat: 2.25, lane: 0, subBeat: 0 },
        { beat: 3, lane: 4, subBeat: 0 },
        { beat: 3.75, lane: 4, subBeat: 0 },
      ],
    }];
    const { deps, canvas } = makeDeps(notes);

    // 框选全部 4 个结点及所有连接段
    const box = makeBox(canvas(0, 4.0), canvas(6, 1.0));

    const boxItems = computeItemsInBox(box, deps);
    expect(boxItems.filter(it => it.kind === 'slideNode')).toHaveLength(4);

    const out = deleteSelection(notes, boxItems);
    expect(out).toEqual([]);
  });
});
