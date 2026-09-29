import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/rendering/coords';
import { findItemAt, findBpmLineAt, computeItemsInBox, computeBpmLinesInBox, pointInQuad, type HitTestDeps } from '@/src/rendering/hitTest/hitTest';
import type { ChartNote } from '@/src/chart/types';

const bpm120 = [{ beat: 0, bpm: 120 }];
// issue 50：测试用默认 surface（旧 DEFAULT_SURFACE 值）
const TEST_SURFACE = { w: 750, h: 900 };

/** 构造一个 scale=1、scrollY=0 的视图，画布坐标 == 虚拟坐标（x 含 trackBgX 偏移） */
function makeDeps(notes: ChartNote[], chartEndBeat = 100): { deps: HitTestDeps; viewport: { scrollX: number; scrollY: number; scale: number }; canvas: (lane: number, beat: number, subBeat?: number) => { x: number; y: number } } {
  const geometry = new ChartGeometry(bpm120, { endBeat: chartEndBeat } , TEST_SURFACE);
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

  // issue 77 二轮：段 = 逻辑段（跨过 hidden 的整段），两个子块命中都归一到**段起点**
  it('issue 77 二轮：跨 hidden 的段命中归一（子块 A→H 与 H→B 都返回同一 connIndex）', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { lane: 1, beat: 10 },
        { lane: 2, beat: 11, hidden: true },
        { lane: 3, beat: 12 },
      ],
    }];
    const { deps, canvas } = makeDeps(notes);
    const a = canvas(1, 10), h = canvas(2, 11), b = canvas(3, 12);
    const mid1 = { x: (a.x + h.x) / 2, y: (a.y + h.y) / 2 }; // 子块 A→H 中点
    const mid2 = { x: (h.x + b.x) / 2, y: (h.y + b.y) / 2 }; // 子块 H→B 中点
    expect(findItemAt(mid1.x, mid1.y, deps)).toEqual({ kind: 'slideRegion', noteIndex: 0, connIndex: 0 });
    expect(findItemAt(mid2.x, mid2.y, deps)).toEqual({ kind: 'slideRegion', noteIndex: 0, connIndex: 0 });
  });

  it('issue 77 二轮：整段入框 → slideRegion 用段起点下标（hidden 不产生第二条 region）', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [
        { lane: 1, beat: 10 },
        { lane: 2, beat: 11, hidden: true },
        { lane: 3, beat: 12 },
      ],
    }];
    const { deps, canvas } = makeDeps(notes);
    const a = canvas(1, 10), b = canvas(3, 12);
    const box = { x1: a.x - 5, y1: b.y - 5, x2: b.x + 5, y2: a.y + 5 };
    const regions = computeItemsInBox(box, deps).filter(it => it.kind === 'slideRegion');
    expect(regions).toEqual([{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }]);
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

// issue 85 / 160：键型 > 滑条结点 > 滑条段；同级后放置者。绘制上全谱段先于全谱结点。
describe('图层与命中优先级（issue 85）', () => {
  const slideOf = (a: { beat: number; lane: number }, b: { beat: number; lane: number }): ChartNote =>
    ({ type: 'Slide', connections: [a, b] });

  it('单键与滑条「段」重叠 → 命中单键（修复前返回 slideRegion）', () => {
    const notes: ChartNote[] = [
      slideOf({ beat: 40, lane: 3 }, { beat: 44, lane: 3 }), // 先放（下标 0）
      { type: 'Single', beat: 42, lane: 3 },                  // 后放，正压在连接带上
    ];
    const { deps, canvas } = makeDeps(notes);
    expect(findItemAt(canvas(3, 42).x, canvas(3, 42).y, deps)).toEqual({ kind: 'note', noteIndex: 1 });
  });

  it('单键与滑条「结点」重叠 → 命中单键（键型 > 滑条结点）', () => {
    const notes: ChartNote[] = [
      slideOf({ beat: 40, lane: 3 }, { beat: 44, lane: 3 }),
      { type: 'Single', beat: 40, lane: 3 },                  // 与首结点同位
    ];
    const { deps, canvas } = makeDeps(notes);
    expect(findItemAt(canvas(3, 40).x, canvas(3, 40).y, deps)).toEqual({ kind: 'note', noteIndex: 1 });
  });

  it('滑条 ↔ 滑条重叠 → 取**后放置**那条（下标更大）', () => {
    const notes: ChartNote[] = [
      slideOf({ beat: 40, lane: 3 }, { beat: 44, lane: 3 }),
      slideOf({ beat: 41, lane: 3 }, { beat: 45, lane: 3 }),
    ];
    const { deps, canvas } = makeDeps(notes);
    expect(findItemAt(canvas(3, 42).x, canvas(3, 42).y, deps)).toEqual({ kind: 'slideRegion', noteIndex: 1, connIndex: 0 });
  });

  // issue 160：绘制上后放段盖住先放端点，命中仍是 slideNode > slideRegion（先放端点点得中）
  it('issue 160：后放滑条的段压在先放端点上 → 仍命中先放 slideNode', () => {
    const notes: ChartNote[] = [
      slideOf({ beat: 40, lane: 3 }, { beat: 44, lane: 3 }), // 先放：端点在 beat 40
      slideOf({ beat: 38, lane: 3 }, { beat: 42, lane: 3 }), // 后放：段穿过 beat 40
    ];
    const { deps, canvas } = makeDeps(notes);
    expect(findItemAt(canvas(3, 40).x, canvas(3, 40).y, deps)).toEqual({ kind: 'slideNode', noteIndex: 0, connIndex: 0 });
  });

  it('同条滑条内：结点仍优先于段（回归锁）', () => {
    const notes: ChartNote[] = [slideOf({ beat: 40, lane: 3 }, { beat: 44, lane: 3 })];
    const { deps, canvas } = makeDeps(notes);
    expect(findItemAt(canvas(3, 40).x, canvas(3, 40).y, deps)).toEqual({ kind: 'slideNode', noteIndex: 0, connIndex: 0 });
  });

  it('两个单键重叠 → 取后放置者（与绘制顺序同序）', () => {
    const notes: ChartNote[] = [
      { type: 'Single', beat: 50, lane: 3 },
      { type: 'Single', beat: 50, lane: 4 },
    ];
    const { deps, canvas } = makeDeps(notes);
    const p3 = canvas(3, 50);
    // 两音符中心距 = 1 条轨道（30px），命中盒半宽 20 → 中间 10~20px 段是重叠区
    expect(findItemAt(p3.x + 15, p3.y, deps)).toEqual({ kind: 'note', noteIndex: 1 });
    expect(findItemAt(p3.x + 5, p3.y, deps)).toEqual({ kind: 'note', noteIndex: 0 }); // 不重叠区各归其位
  });

  it('visibleNotes：滑条/长条一律排在点音符之前（绘制顺序 = 键型在上）', () => {
    const notes: ChartNote[] = [
      { type: 'Single', beat: 42, lane: 3 },
      slideOf({ beat: 40, lane: 3 }, { beat: 44, lane: 3 }),
      { type: 'LDirectional', beat: 46, lane: 2, length: 2 } as ChartNote,
    ];
    const geometry = new ChartGeometry(bpm120, { endBeat: 100 } , TEST_SURFACE);
    const viewport = { scrollX: 0, scrollY: 0, scale: 1 };
    const yOf = (b: number) => geometry.noteVirtualY(b, 0, viewport.scale, 4);
    const ys = [yOf(38), yOf(48)];
    const bounds = { minX: -1e6, maxX: 1e6, minY: Math.min(...ys), maxY: Math.max(...ys) };
    const vis = geometry.visibleNotes(notes, viewport, 4, bounds);
    const types = vis.map(v => v.note.type);
    expect(types).toContain('Slide');
    expect(types).toContain('Single');
    expect(types.lastIndexOf('Slide')).toBeLessThan(types.indexOf('Single'));
    expect(types.lastIndexOf('Slide')).toBeLessThan(types.indexOf('LDirectional'));
  });
});

// issue 82：命中盒 = **音符墨迹矩形（36 × 21.6 设计 px）+ 2px 余量**，取代旧的
// 「图标半宽 18 + 4 = 半径 22 的圆」—— 旧口径纵向判定是墨迹半高(10.8) 的 2 倍，
// 离音符很远就亮起 hover。scale=1 / noteSize=1 下：半宽 20、半高 12.8。
describe('hover 命中盒 = 墨迹矩形 + 2px 余量（issue 82）', () => {
  const singleAt = (lane: number, beat: number): ChartNote[] =>
    [{ type: 'Single', lane, beat }];

  it('纵向：墨迹外一点即不命中（修复前半径 22 会命中）', () => {
    const notes = singleAt(3, 50);
    const { deps, canvas } = makeDeps(notes);
    const p = canvas(3, 50);
    expect(findItemAt(p.x, p.y - 12, deps)).toEqual({ kind: 'note', noteIndex: 0 }); // 半高 12.8 内
    expect(findItemAt(p.x, p.y + 12, deps)).toEqual({ kind: 'note', noteIndex: 0 });
    expect(findItemAt(p.x, p.y - 13, deps)).toBeNull(); // 修复前（半径 22）会命中
    expect(findItemAt(p.x, p.y + 13, deps)).toBeNull();
    expect(findItemAt(p.x, p.y - 21, deps)).toBeNull(); // 旧口径边界内 → 明确不再命中
  });

  it('横向：半宽 20 内命中、外不命中', () => {
    const notes = singleAt(3, 50);
    const { deps, canvas } = makeDeps(notes);
    const p = canvas(3, 50);
    expect(findItemAt(p.x + 19, p.y, deps)).toEqual({ kind: 'note', noteIndex: 0 });
    expect(findItemAt(p.x - 19, p.y, deps)).toEqual({ kind: 'note', noteIndex: 0 });
    expect(findItemAt(p.x + 21, p.y, deps)).toBeNull(); // 修复前（半径 22）会命中
  });

  it('墨迹矩形角内命中、角外不命中（矩形判定，非圆）', () => {
    const notes = singleAt(3, 50);
    const { deps, canvas } = makeDeps(notes);
    const p = canvas(3, 50);
    expect(findItemAt(p.x + 19, p.y + 12, deps)).toEqual({ kind: 'note', noteIndex: 0 }); // 角内
    expect(findItemAt(p.x + 21, p.y + 12, deps)).toBeNull();                              // 横向出界
    expect(findItemAt(p.x + 19, p.y + 13, deps)).toBeNull();                              // 纵向出界
  });

  it('命中盒随 noteSize 缩放（0.5 档：半高 7.4 / 2 档：半高 23.6）', () => {
    const notes = singleAt(3, 50);
    const { deps, canvas } = makeDeps(notes);
    const p = canvas(3, 50);
    // 缩小：半高 = 10.8 × 0.5 + 2 = 7.4
    const small = { ...deps, noteSize: 0.5 };
    expect(findItemAt(p.x, p.y - 7, small)).toEqual({ kind: 'note', noteIndex: 0 });
    expect(findItemAt(p.x, p.y - 8, small)).toBeNull();
    // 与渲染同比例：缩小后**纵向**判定同步收紧（旧口径恒 22，与 noteSize 脱钩）
    expect(findItemAt(p.x, p.y - 20, small)).toBeNull();
    // 放大：半高 = 10.8 × 2 + 2 = 23.6
    const big = { ...deps, noteSize: 2 };
    expect(findItemAt(p.x, p.y - 23, big)).toEqual({ kind: 'note', noteIndex: 0 });
    expect(findItemAt(p.x, p.y - 24, big)).toBeNull();
  });

  it('命中盒随 viewport.scale 缩放（scale 0.5：半高 6.4）', () => {
    const notes = singleAt(3, 50);
    const geometry = new ChartGeometry(bpm120, { endBeat: 100 } , TEST_SURFACE);
    const viewport = { scrollX: 0, scrollY: 0, scale: 0.5 };
    const deps: HitTestDeps = { geometry, viewport, beatDisplay: 4, notes };
    const p = geometry.virtualToCanvas(
      geometry.noteVirtualX(3),
      geometry.noteVirtualY(50, 0, viewport.scale, 4),
      viewport,
    );
    expect(findItemAt(p.x, p.y - 6, deps)).toEqual({ kind: 'note', noteIndex: 0 });
    expect(findItemAt(p.x, p.y - 7, deps)).toBeNull();
  });

  it('滑条结点同样用墨迹盒（纵向收紧；取远离连接带的一侧量）', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [{ beat: 40, lane: 3 }, { beat: 44, lane: 3 }],
    }];
    const { deps, canvas } = makeDeps(notes);
    const head = canvas(3, 40);
    const tail = canvas(3, 44);
    const away = head.y < tail.y ? -1 : 1; // 连接带在另一侧，往这边量才只判结点
    expect(findItemAt(head.x, head.y, deps)).toEqual({ kind: 'slideNode', noteIndex: 0, connIndex: 0 });
    expect(findItemAt(head.x, head.y + away * 12, deps)).toEqual({ kind: 'slideNode', noteIndex: 0, connIndex: 0 });
    expect(findItemAt(head.x, head.y + away * 13, deps)).toBeNull();
    // 横向：半宽 20 内是结点，21 起既不是结点（连接带半宽只有 15）→ null
    expect(findItemAt(head.x + 19, head.y, deps)).toEqual({ kind: 'slideNode', noteIndex: 0, connIndex: 0 });
    expect(findItemAt(head.x + 21, head.y, deps)).toBeNull();
  });

  it('滑条段（连接带）判定不变：段中部仍命中 slideRegion', () => {
    const notes: ChartNote[] = [{
      type: 'Slide',
      connections: [{ beat: 40, lane: 3 }, { beat: 44, lane: 3 }],
    }];
    const { deps, canvas } = makeDeps(notes);
    const mid = canvas(3, 42);
    expect(findItemAt(mid.x, mid.y, deps)).toEqual({ kind: 'slideRegion', noteIndex: 0, connIndex: 0 });
  });

  it('issue 62 回归：方向键整组（length=3）三格仍各自命中', () => {
    const notes: ChartNote[] = [
      { type: 'RDirectional', beat: 50, lane: 2, subBeat: 0, length: 3 } as ChartNote,
    ];
    const { deps, canvas } = makeDeps(notes);
    for (const lane of [2, 3, 4]) {
      const p = canvas(lane, 50);
      expect(findItemAt(p.x, p.y, deps)).toEqual({ kind: 'note', noteIndex: 0 });
    }
  });
});
