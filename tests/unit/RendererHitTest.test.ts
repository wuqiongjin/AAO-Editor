import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '../../src/chart/geometry/ChartGeometry';
import { makeCoords } from '../../src/visual/coords';
import { findItemAt, findBpmLineAt, computeItemsInBox, computeBpmLinesInBox, pointInQuad, type HitTestDeps } from '../../src/visual/hitTest';
import type { ChartNote } from '../../src/chart/types';

const bpm120 = [{ beat: 0, bpm: 120 }];
// issue 50：测试用默认 surface（旧 DEFAULT_SURFACE 值）
const TEST_SURFACE = { w: 750, h: 900 };

/** 构造一个 scale=1、scrollY=0 的视图，画布坐标 == 虚拟坐标（x 含 trackBgX 偏移） */
function makeDeps(notes: ChartNote[], chartEndBeat = 100): { deps: HitTestDeps; viewport: { scrollX: number; scrollY: number; scale: number }; canvas: (lane: number, beat: number, subBeat?: number) => { x: number; y: number } } {
  const geometry = new ChartGeometry(bpm120, chartEndBeat, TEST_SURFACE);
  const viewport = { scrollX: 0, scrollY: 0, scale: 1 };
  const beatDisplay = 4;
  const canvas = (lane: number, beat: number, subBeat = 0) =>
    geometry.virtualToCanvas(geometry.noteVirtualX(lane), geometry.noteVirtualY(beat, subBeat, viewport.scale, beatDisplay), viewport);
  return { deps: { geometry, viewport, beatDisplay, notes }, viewport, canvas };
}

describe('pointInQuad 射线法', () => {
  it('矩形中心在内、外部点在外', () => {
    const quad = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(pointInQuad(5, 5, quad)).toBe(true);
    expect(pointInQuad(11, 5, quad)).toBe(false);
    expect(pointInQuad(-1, 5, quad)).toBe(false);
  });
});

describe('findItemAt', () => {
  it('命中普通音符返回 {kind:note}', () => {
    const notes: ChartNote[] = [{ type: 'Single', lane: 0, beat: 50 }];
    const { deps, canvas } = makeDeps(notes);
    const p = canvas(0, 50);
    expect(findItemAt(p.x, p.y, deps)).toEqual({ kind: 'note', noteIndex: 0 });
  });

  it('空点击返回 null', () => {
    const notes: ChartNote[] = [{ type: 'Single', lane: 0, beat: 50 }];
    const { deps } = makeDeps(notes);
    expect(findItemAt(0, 0, deps)).toBeNull();
  });

  it('滑条结点优先命中 slideNode', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { lane: 0, beat: 10 },
        { lane: 3, beat: 12 },
        { lane: 6, beat: 14 },
      ],
    }];
    const { deps, canvas } = makeDeps(notes);
    const p = canvas(3, 12); // 中间结点
    expect(findItemAt(p.x, p.y, deps)).toEqual({ kind: 'slideNode', noteIndex: 0, connIndex: 1 });
  });

  it('命中滑条连接带区域返回 slideRegion', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { lane: 0, beat: 10 },
        { lane: 3, beat: 12 },
      ],
    }];
    const { deps, canvas } = makeDeps(notes);
    const p1 = canvas(0, 10);
    const p2 = canvas(3, 12);
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    expect(findItemAt(mid.x, mid.y, deps)).toEqual({ kind: 'slideRegion', noteIndex: 0, connIndex: 0 });
  });

  // issue 59：BPM 线画在音符层**之下**，且 56 定过指针态不选中 / 不参与 hover → findItemAt 跳过 BPM
  it('BPM 不在 findItemAt 判定内（交给 findBpmLineAt，保证"音符 > BPM 线"）', () => {
    const notes: ChartNote[] = [{ type: 'BPM', beat: 40, bpm: 120 }];
    const { deps, canvas } = makeDeps(notes);
    const p = canvas(0, 40);
    expect(findItemAt(p.x, p.y, deps)).toBeNull();
    expect(findBpmLineAt(p.x, p.y, deps)).toEqual({ kind: 'note', noteIndex: 0 });
  });

  it('BPM 线压着音符时，findItemAt 先返回音符（BPM 不抢）', () => {
    const notes: ChartNote[] = [
      { type: 'BPM', beat: 40, bpm: 120 },
      { type: 'Single', lane: 3, beat: 40 },
    ];
    const { deps, canvas } = makeDeps(notes);
    expect(findItemAt(canvas(3, 40).x, canvas(3, 40).y, deps)).toEqual({ kind: 'note', noteIndex: 1 });
  });
});

// issue 59：删除 / 音符代码两态下，BPM 线按**整条线**命中（findItemAt 只认 lane 0 圆心一点）
describe('findBpmLineAt', () => {
  const notes: ChartNote[] = [
    { type: 'BPM', beat: 40, bpm: 120 },
    { type: 'BPM', beat: 60, bpm: 150 },
  ];

  it('线中段 / 右段同样命中（findItemAt 在此返回 null）', () => {
    const { deps, canvas } = makeDeps(notes);
    const left = canvas(0, 40);
    const right = canvas(6, 40);
    expect(findItemAt((left.x + right.x) / 2, left.y, deps)).toBeNull(); // 旧行为：线中段打不中
    expect(findBpmLineAt((left.x + right.x) / 2, left.y, deps)).toEqual({ kind: 'note', noteIndex: 0 });
    expect(findBpmLineAt(right.x, right.y, deps)).toEqual({ kind: 'note', noteIndex: 0 });
  });

  it('纵向超出容差 / 轨道外（沟槽）→ 不命中', () => {
    const { deps, canvas } = makeDeps(notes);
    const p = canvas(3, 40);
    expect(findBpmLineAt(p.x, p.y + 20, deps)).toBeNull();
    const { trackBgX } = deps.geometry.trackGeometry(1);
    expect(findBpmLineAt(trackBgX - 5, p.y, deps)).toBeNull();
  });

  it('多条 BPM 线各归其位', () => {
    const { deps, canvas } = makeDeps(notes);
    expect(findBpmLineAt(canvas(3, 60).x, canvas(3, 60).y, deps)).toEqual({ kind: 'note', noteIndex: 1 });
  });

  it('非 BPM 音符不参与', () => {
    const keys: ChartNote[] = [{ type: 'Single', lane: 3, beat: 40 }];
    const { deps, canvas } = makeDeps(keys);
    expect(findBpmLineAt(canvas(3, 40).x, canvas(3, 40).y, deps)).toBeNull();
  });
});

describe('computeItemsInBox', () => {
  it('框选命中普通音符与滑条结点', () => {
    const notes: ChartNote[] = [
      { type: 'Single', lane: 0, beat: 50 },
      { type: 'Single', lane: 6, beat: 60 },
    ];
    const { deps, canvas } = makeDeps(notes);
    const p1 = canvas(0, 50);
    const p2 = canvas(6, 60);
    const box = { x1: p1.x - 5, y1: p2.y - 5, x2: p2.x + 5, y2: p1.y + 5 };
    const items = computeItemsInBox(box, deps);
    expect(items).toContainEqual({ kind: 'note', noteIndex: 0 });
    expect(items).toContainEqual({ kind: 'note', noteIndex: 1 });
  });

  // issue 71：BPM 不是音符，选中无意义 → **任何**框选都不再把它选进选区
  it('issue 71：BPM 线不再入选（即便被整条框住）', () => {
    const notes: ChartNote[] = [{ type: 'BPM', beat: 40, bpm: 120 }];
    const { deps } = makeDeps(notes);
    const { trackBgX, trackBgWidth } = deps.geometry.trackGeometry(1);
    const lineY = deps.geometry.virtualToCanvas(0, deps.geometry.noteVirtualY(40, 0, 1, 4), deps.viewport).y;

    const full = { x1: trackBgX - 10, y1: lineY - 5, x2: trackBgX + trackBgWidth + 10, y2: lineY + 5 };
    expect(computeItemsInBox(full, deps)).toEqual([]); // 完整覆盖也不入选
  });

  it('issue 71：computeBpmLinesInBox（删除路径专用）—— 只有被**整条框住**才收集', () => {
    const notes: ChartNote[] = [{ type: 'BPM', beat: 40, bpm: 120 }];
    const { deps } = makeDeps(notes);
    const { trackBgX, trackBgWidth } = deps.geometry.trackGeometry(1);
    const lineY = deps.geometry.virtualToCanvas(0, deps.geometry.noteVirtualY(40, 0, 1, 4), deps.viewport).y;

    // ① 完整覆盖整条线 → 收集
    const full = { x1: trackBgX - 10, y1: lineY - 5, x2: trackBgX + trackBgWidth + 10, y2: lineY + 5 };
    expect(computeBpmLinesInBox(full, deps)).toEqual([{ kind: 'note', noteIndex: 0 }]);

    // ② 只框住 lane 0 那一点 → 不收集
    const lane0Only = { x1: trackBgX - 5, y1: lineY - 5, x2: trackBgX + 30, y2: lineY + 5 };
    expect(computeBpmLinesInBox(lane0Only, deps)).toEqual([]);

    // ③ Y 覆盖但 X 差一截（未盖到轨道右缘）→ 不收集
    const partialX = { x1: trackBgX - 10, y1: lineY - 5, x2: trackBgX + trackBgWidth - 20, y2: lineY + 5 };
    expect(computeBpmLinesInBox(partialX, deps)).toEqual([]);

    // ④ X 覆盖整条但 Y 差开 → 不收集
    const offY = { x1: trackBgX - 10, y1: lineY + 20, x2: trackBgX + trackBgWidth + 10, y2: lineY + 40 };
    expect(computeBpmLinesInBox(offY, deps)).toEqual([]);
  });

  it('issue 71：混排谱面框选只带音符，不带 BPM 线', () => {
    const notes: ChartNote[] = [
      { type: 'BPM', beat: 40, bpm: 120 },
      { type: 'Single', lane: 3, beat: 40 },
    ];
    const { deps } = makeDeps(notes);
    const { trackBgX, trackBgWidth } = deps.geometry.trackGeometry(1);
    const lineY = deps.geometry.virtualToCanvas(0, deps.geometry.noteVirtualY(40, 0, 1, 4), deps.viewport).y;
    const full = { x1: trackBgX - 10, y1: lineY - 5, x2: trackBgX + trackBgWidth + 10, y2: lineY + 5 };
    expect(computeItemsInBox(full, deps)).toEqual([{ kind: 'note', noteIndex: 1 }]);
    expect(computeBpmLinesInBox(full, deps)).toEqual([{ kind: 'note', noteIndex: 0 }]);
  });

  it('滑条两端点在框内返回 slideRegion', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { lane: 0, beat: 10 },
        { lane: 3, beat: 12 },
      ],
    }];
    const { deps, canvas } = makeDeps(notes);
    const p1 = canvas(0, 10);
    const p2 = canvas(3, 12);
    // canvas y 向下增大：beat 越小 y 越大（p1.y > p2.y）；框需覆盖 [p2.y-5, p1.y+5]
    const box = { x1: p1.x - 5, y1: p2.y - 5, x2: p2.x + 5, y2: p1.y + 5 };
    const items = computeItemsInBox(box, deps);
    expect(items).toContainEqual({ kind: 'slideNode', noteIndex: 0, connIndex: 0 });
    expect(items).toContainEqual({ kind: 'slideNode', noteIndex: 0, connIndex: 1 });
    expect(items).toContainEqual({ kind: 'slideRegion', noteIndex: 0, connIndex: 0 });
  });
});

describe('makeCoords 薄封装', () => {
  it('getLaneBeatFromCanvas 在轨道内返回 lane/preciseBeat', () => {
    const notes: ChartNote[] = [];
    const { deps } = makeDeps(notes);
    const c = makeCoords(deps.geometry, deps.viewport, deps.beatDisplay, deps.notes);
    const { trackBgX } = deps.geometry.trackGeometry(1);
    const pos = c.getLaneBeatFromCanvas(trackBgX + 2 * 30 + 15, deps.geometry.virtualToCanvas(0, deps.geometry.beatToVirtualY(50, 1), deps.viewport).y);
    expect(pos).not.toBeNull();
    expect(pos!.lane).toBe(2);
  });

  it('getVisibleNotes 委托给 geometry.visibleNotes', () => {
    const notes: ChartNote[] = [{ type: 'Single', lane: 0, beat: 100 }];
    const { deps } = makeDeps(notes, 100);
    const c = makeCoords(deps.geometry, deps.viewport, deps.beatDisplay, deps.notes);
    const visible = c.getVisibleNotes();
    expect(visible.map(n => n.index)).toEqual([0]);
  });
});

// issue 62：方向滑键是**一整组**（根轨 + 沿方向再占 length-1 条），命中/框选都必须认整组，
// 否则"框到箭头端不算、按住箭头端拖不起来"，与 56 的"整组一个描边矩形"自相矛盾。
describe('方向滑键整组命中（issue 62）', () => {
  const dir = (type: 'LDirectional' | 'RDirectional', lane: number, length: number): ChartNote =>
    ({ type, beat: 50, lane, subBeat: 0, length } as ChartNote);

  it('点选：按住非根轨（箭头端）同样命中该键', () => {
    const notes: ChartNote[] = [dir('RDirectional', 2, 3)]; // 占 2/3/4
    const { deps, canvas } = makeDeps(notes);
    for (const lane of [2, 3, 4]) {
      const p = canvas(lane, 50);
      expect(findItemAt(p.x, p.y, deps)).toEqual({ kind: 'note', noteIndex: 0 });
    }
    // 组外一轨不命中
    const out = canvas(5, 50);
    expect(findItemAt(out.x, out.y, deps)).toBeNull();
  });

  it('框选：只框住最外侧本体即入选（左方向键向 -lane 展开）', () => {
    const notes: ChartNote[] = [dir('LDirectional', 4, 3)]; // 占 4/3/2
    const { deps, canvas } = makeDeps(notes);
    const tip = canvas(2, 50);
    const box = { x1: tip.x - 6, y1: tip.y - 6, x2: tip.x + 6, y2: tip.y + 6 };
    expect(computeItemsInBox(box, deps)).toEqual([{ kind: 'note', noteIndex: 0 }]);
  });

  it('length=1 退化为单点命中（根轨即全部）', () => {
    const notes: ChartNote[] = [dir('LDirectional', 4, 1)];
    const { deps, canvas } = makeDeps(notes);
    expect(findItemAt(canvas(4, 50).x, canvas(4, 50).y, deps)).toEqual({ kind: 'note', noteIndex: 0 });
    const p = canvas(3, 50);
    expect(findItemAt(p.x, p.y, deps)).toBeNull();
  });
});
