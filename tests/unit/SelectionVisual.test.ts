// issue 56（谱面画布音符选中状态整改）行锁测试：
// - a) 描边形态：贴合 sprite ink 的圆角矩形 / 滑条段沿平行四边形四边（斜段描斜的，不退化为包围盒）/ BPM 整条线
// - a) 缩放：描边随 noteSize 等比缩放；hidden 结点无任何描边
// - c) hover 层级：hover 只画亮面（mode=hover）、删除持工具态转危险色、已选中音符被 hover 整体转红、
//     幽灵态（放置/粘贴/镜像）不画、色觉辅助不影响（A8）
import { describe, it, expect } from 'vitest';
import { ChartGeometry, LANE_WIDTH } from '../../src/chart/geometry/ChartGeometry';
import { makeCoords } from '../../src/visual/coords';
import { collectSelectionOutlines, type SelectionOutline } from '../../src/visual/render';
import { findItemAt, computeItemsInBox, type HitTestDeps } from '../../src/visual/hitTest';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '../../src/visual/noteSkin';
import { SELECTION_OUTLINE } from '../../src/visual/selectionStyle';
import { NOTE_ICON_SIZE, DIRECTIONAL_ICON_SIZE, DIRECTIONAL_HEIGHT_SCALE, NOTE_HEIGHT_SCALE } from '../../src/visual/render';
import type { RenderCtx } from '../../src/visual/types';
import type { ChartNote, SelectionItem } from '../../src/chart/types';

const bpm120 = [{ beat: 0, bpm: 120 }];
const SURFACE = { w: 750, h: 900 };
const BEAT_DISPLAY = 4;
const ICONS = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));

interface Opts {
  notes: ChartNote[];
  select?: SelectionItem[];
  hover?: SelectionItem | null;
  armedTool?: string | null;
  noteSize?: number;
  colorAssist?: boolean;
  scale?: number;
  /** issue 67：框选手势进行中的矩形（画布坐标）；传了即启用"框选实时预览"描边 */
  selectionBox?: { x1: number; y1: number; x2: number; y2: number } | null;
  /** issue 74：右键按住未松手（右键 = 删除光标下的对象）→ hover 转 danger */
  rightButtonHeld?: boolean;
}

/** 收集本次描边（视口 scale=1 / scrollY=0，传入的全部音符都视为可见） */
function outlinesOf(o: Opts): SelectionOutline[] {
  const geometry = new ChartGeometry(bpm120, 100, SURFACE);
  const viewport = { scrollX: 0, scrollY: 0, scale: o.scale ?? 1, virtualWidth: 0, virtualHeight: 0 };
  const rc = {
    geometry,
    viewport,
    surface: SURFACE,
    dpr: 1,
    beatDisplay: BEAT_DISPLAY,
    chartEndBeat: 100,
    notes: o.notes,
    selectedItems: o.select ?? [],
    selectionBox: o.selectionBox ?? null,
    slideBuffer: null,
    hoverPos: null,
    hoverItem: o.hover ?? null,
    clipboard: [],
    markerBeat: null,
    markerSelected: false,
    armedTool: o.armedTool ?? null,
    rightButtonHeld: o.rightButtonHeld ?? false, // issue 74
    spriteIcon: { render: () => undefined, renderDecorator: () => undefined },
    noteIcons: ICONS,
    display: {
      noteSize: o.noteSize ?? 1,
      slideOpacity: 1,
      simultaneousClickLines: false,
      colorAssist: o.colorAssist ?? false,
    },
  } as unknown as RenderCtx;
  const c = makeCoords(geometry, viewport, BEAT_DISPLAY, o.notes);
  return collectSelectionOutlines(c, rc, o.notes.map((note, index) => ({ note, index })));
}

const single = (beat: number, lane = 3): ChartNote => ({ type: 'Single', lane, beat, subBeat: 0 }) as ChartNote;
const slide = (conns: { lane: number; beat: number; hidden?: boolean }[]): ChartNote =>
  ({ type: 'Slide', connections: conns }) as ChartNote;

// ---------------- a) 形态与缩放 ----------------
describe('选中描边形态（issue 56 a）', () => {
  it('单键选中 = 贴合 ink 的一个圆角矩形（不再是正圆）', () => {
    const out = outlinesOf({ notes: [single(50)], select: [{ kind: 'note', noteIndex: 0 }] });
    expect(out).toHaveLength(1);
    const o = out[0]!;
    expect(o.shape).toBe('rect');
    expect(o.mode).toBe('selected');
    // 尺寸 = sprite ink 尺寸 × spriteScale（scale × noteSize）
    const inkW = ICONS.tapFor(3).out?.w ?? NOTE_ICON_SIZE;
    const inkH = ICONS.tapFor(3).out?.h ?? NOTE_ICON_SIZE * NOTE_HEIGHT_SCALE;
    expect((o as { w: number }).w).toBeCloseTo(inkW, 6);
    expect((o as { h: number }).h).toBeCloseTo(inkH, 6);
  });

  it('描边随 noteSize 缩放（A5）：三档（0.5 / 1 / 2）严格等比', () => {
    const pick = (noteSize: number) =>
      outlinesOf({ notes: [single(50)], select: [{ kind: 'note', noteIndex: 0 }], noteSize })[0] as { w: number; h: number };
    const a = pick(1), half = pick(0.5), dbl = pick(2);
    expect(half.w).toBeCloseTo(a.w * 0.5, 6);
    expect(half.h).toBeCloseTo(a.h * 0.5, 6);
    expect(dbl.w).toBeCloseTo(a.w * 2, 6);
    expect(dbl.h).toBeCloseTo(a.h * 2, 6);
  });

  it('画布缩放：描边随 viewport.scale 等比（验收矩阵「画布缩放」轴）', () => {
    const pick = (scale: number) =>
      outlinesOf({ notes: [single(50)], select: [{ kind: 'note', noteIndex: 0 }], scale })[0] as { w: number; h: number };
    const a = pick(1), small = pick(0.5), big = pick(2);
    expect(small.w).toBeCloseTo(a.w * 0.5, 6);
    expect(big.h).toBeCloseTo(a.h * 2, 6);
  });

  it('方向键 = 整体一个矩形（用户 2026-09-09：覆盖所有本体 + 最外侧箭头）', () => {
    for (const len of [1, 2, 3]) {
      const note = { type: 'LDirectional', lane: 2, beat: 50, subBeat: 0, length: len } as ChartNote;
      const out = outlinesOf({ notes: [note], select: [{ kind: 'note', noteIndex: 0 }] });
      expect(out).toHaveLength(1);
      const o = out[0]!;
      expect(o.shape).toBe('rect');
      // 高度 = 单本体墨迹高度（与画布实绘一致）
      expect((o as { h: number }).h).toBeCloseTo(DIRECTIONAL_ICON_SIZE * DIRECTIONAL_HEIGHT_SCALE, 6);
      // 宽度 ≥ 单本体墨迹宽，length 越大宽度越大
      const ink = ICONS.dirInk('L');
      const singleBodyW = DIRECTIONAL_ICON_SIZE * ((ink.w - ink.inkLeft - ink.inkRight) / ink.w);
      expect((o as { w: number }).w).toBeGreaterThan(singleBodyW * 0.9);
      if (len >= 2) {
        // length=2/3 至少多覆盖一格 LANE_WIDTH
        expect((o as { w: number }).w).toBeGreaterThan(singleBodyW + 30 * 0.5);
      }
    }
  });

  it('整条滑条选中 = 逐子部分并集（3 结点 → 2 rect + 2 quad... 即 3 rect + 2 quad）', () => {
    const out = outlinesOf({
      notes: [slide([{ lane: 0, beat: 10 }, { lane: 3, beat: 12 }, { lane: 6, beat: 14 }])],
      select: [{ kind: 'note', noteIndex: 0 }],
    });
    expect(out.filter(o => o.shape === 'rect')).toHaveLength(3);
    expect(out.filter(o => o.shape === 'quad')).toHaveLength(2);
    for (const o of out) expect(o.mode).toBe('selected');
  });

  it('斜段沿平行四边形四边描边：不是轴对齐包围盒（A4）', () => {
    const notes = [slide([{ lane: 0, beat: 10 }, { lane: 3, beat: 12 }])];
    const out = outlinesOf({ notes, select: [{ kind: 'note', noteIndex: 0 }] });
    const quad = out.find(o => o.shape === 'quad') as { points: [number, number][] };
    // 平行四边形：上下边水平、左右边斜（两端 x 不同 → 四顶点不是包围盒四角）
    const [p1, p2, p3, p4] = quad.points;
    expect(p1[1]).toBeCloseTo(p2[1], 6);
    expect(p3[1]).toBeCloseTo(p4[1], 6);
    const shoelace = Math.abs(
      quad.points.reduce((acc, p, i) => {
        const q = quad.points[(i + 1) % quad.points.length]!;
        return acc + (p[0] * q[1] - q[0] * p[1]);
      }, 0) / 2,
    );
    const xs = quad.points.map(p => p[0]), ys = quad.points.map(p => p[1]);
    const aabb = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    expect(shoelace).toBeGreaterThan(0);
    expect(shoelace).toBeLessThan(aabb); // 斜段的平行四边形面积严格小于其包围盒
  });

  it('段宽与连接带同宽（× noteSize，A5）', () => {
    const notes = [slide([{ lane: 0, beat: 10 }, { lane: 0, beat: 14 }])];
    const base = outlinesOf({ notes, select: [{ kind: 'note', noteIndex: 0 }] }).find(o => o.shape === 'quad') as { points: [number, number][] };
    const big = outlinesOf({ notes, select: [{ kind: 'note', noteIndex: 0 }], noteSize: 2 }).find(o => o.shape === 'quad') as { points: [number, number][] };
    const widthOf = (p: [number, number][]) => Math.abs(p[1]![0] - p[0]![0]);
    expect(widthOf(base.points)).toBeCloseTo(LANE_WIDTH, 6);
    expect(widthOf(big.points)).toBeCloseTo(LANE_WIDTH * 2, 6);
  });

  it('Long ≡ Slide：同结构产生同一套描边（A4/Q47）', () => {
    const conns = [{ lane: 1, beat: 10 }, { lane: 4, beat: 13 }];
    const a = outlinesOf({ notes: [slide(conns)], select: [{ kind: 'note', noteIndex: 0 }] });
    const b = outlinesOf({
      notes: [{ type: 'Long', connections: conns } as ChartNote],
      select: [{ kind: 'note', noteIndex: 0 }],
    });
    expect(b).toEqual(a);
  });

  it('hidden 结点不画描边（A6）', () => {
    const notes = [slide([{ lane: 0, beat: 10 }, { lane: 3, beat: 12, hidden: true }, { lane: 6, beat: 14 }])];
    const out = outlinesOf({ notes, select: [{ kind: 'note', noteIndex: 0 }] });
    expect(out.filter(o => o.shape === 'rect')).toHaveLength(2); // 3 结点 - 1 hidden
    expect(out.filter(o => o.shape === 'quad')).toHaveLength(2); // 段照常
  });

  it('滑条结点矩形 = compact（用户 2026-09-09：避免外圈压住连接带）', () => {
    const notes = [slide([{ lane: 0, beat: 10 }, { lane: 3, beat: 12 }, { lane: 6, beat: 14 }])];
    const out = outlinesOf({ notes, select: [{ kind: 'note', noteIndex: 0 }] });
    // 3 个结点的 rect + 2 个段 quad 都标 compact=true（与连接带同款的描边都贴边、不外扩）
    const nodeRects = out.filter(o => o.shape === 'rect') as Array<{ compact?: boolean }>;
    const regionQuads = out.filter(o => o.shape === 'quad') as Array<{ compact?: boolean }>;
    for (const r of nodeRects) expect(r.compact).toBe(true);
    for (const q of regionQuads) expect(q.compact).toBe(true);
  });

  it('段被框选入选后仍按选中态绘制（compact 但 mode=selected）', () => {
    const notes = [slide([{ lane: 0, beat: 10 }, { lane: 3, beat: 12 }])];
    const out = outlinesOf({ notes, select: [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }] });
    expect(out).toHaveLength(1);
    expect(out[0]!.shape).toBe('quad');
    expect(out[0]!.mode).toBe('selected');
    expect((out[0]! as { compact?: boolean }).compact).toBe(true);
  });

  // issue 66 §2（用户 2026-09-09 拍板）：单键/方向键**也**走 compact（与 Slide 结点/段同口径）——
  // 旧的"外扩 outset + 暗底 halo"会盖住紧邻的其它音符（用户复报的"一圈遮罩"）。
  // 本用例由 56 的「≠ compact」翻转为「= compact」，锁住"全类型统一无遮罩"这个不变量。
  it('单键/方向键矩形 = compact（同 Slide：不外扩、无暗底，消除遮罩）', () => {
    const single = { type: 'Single', lane: 2, beat: 50, subBeat: 0 } as ChartNote;
    const sOut = outlinesOf({ notes: [single], select: [{ kind: 'note', noteIndex: 0 }] });
    expect((sOut[0] as { compact?: boolean }).compact).toBe(true);

    const dir = { type: 'LDirectional', lane: 2, beat: 50, subBeat: 0, length: 2 } as ChartNote;
    const dOut = outlinesOf({ notes: [dir], select: [{ kind: 'note', noteIndex: 0 }] });
    expect((dOut[0] as { compact?: boolean }).compact).toBe(true);
  });

  it('BPM 选中 = 整条横线改色（Q45）', () => {
    const out = outlinesOf({
      notes: [{ type: 'BPM', beat: 40, bpm: 120 } as ChartNote],
      select: [{ kind: 'note', noteIndex: 0 }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.shape).toBe('line');
    expect(out[0]!.mode).toBe('selected');
  });

  it('色觉辅助开关不改变描边（A8）', () => {
    const notes = [single(50.25), single(51)];
    const a = outlinesOf({ notes, select: [{ kind: 'note', noteIndex: 0 }, { kind: 'note', noteIndex: 1 }], colorAssist: false });
    const b = outlinesOf({ notes, select: [{ kind: 'note', noteIndex: 0 }, { kind: 'note', noteIndex: 1 }], colorAssist: true });
    expect(b).toHaveLength(a.length);
    for (let i = 0; i < a.length; i++) expect(b[i]!.mode).toBe(a[i]!.mode);
  });

  it('常量模块：浅黄共用一套、危险红独立；hover 比选中粗且外扩（A2/C7 + 用户 09-09 反馈）', () => {
    expect(SELECTION_OUTLINE.hoverAlpha).toBeLessThan(SELECTION_OUTLINE.selectedAlpha); // hover 仍比真实选中轻一档（Q11）
    expect(SELECTION_OUTLINE.hoverAlpha).toBeGreaterThanOrEqual(0.8); // 但不能淡到与危险红难辨
    expect(SELECTION_OUTLINE.hoverLineWidth).toBeGreaterThan(SELECTION_OUTLINE.lineWidth); // 加粗
    expect(SELECTION_OUTLINE.hoverOutset).toBeGreaterThan(0); // 与真实选中叠加时可辨
  });
});

// ---------------- c) hover 层级 ----------------
describe('hover 描边层级（issue 56 c）', () => {
  it('未选中音符被 hover → 一条 hover 描边（只画亮面）', () => {
    const out = outlinesOf({ notes: [single(50)], hover: { kind: 'note', noteIndex: 0 } });
    expect(out).toHaveLength(1);
    expect(out[0]!.mode).toBe('hover');
  });

  it('删除持工具态 hover → 危险色（Q48/Q49）', () => {
    const out = outlinesOf({ notes: [single(50)], hover: { kind: 'note', noteIndex: 0 }, armedTool: 'delete' });
    expect(out).toHaveLength(1);
    expect(out[0]!.mode).toBe('danger');
  });

  it('已选中音符被删除态 hover → 整体转红、覆盖浅黄（Q51）', () => {
    const out = outlinesOf({
      notes: [single(50)],
      select: [{ kind: 'note', noteIndex: 0 }],
      hover: { kind: 'note', noteIndex: 0 },
      armedTool: 'delete',
    });
    expect(out).toHaveLength(1); // 不是「选中 + hover」两圈
    expect(out[0]!.mode).toBe('danger');
  });

  it('已选中音符被 hover（非删除态）→ 选中 + hover 两圈（可辨，Q11）', () => {
    const out = outlinesOf({
      notes: [single(50)],
      select: [{ kind: 'note', noteIndex: 0 }],
      hover: { kind: 'note', noteIndex: 0 },
    });
    expect(out.map(o => o.mode)).toEqual(['selected', 'hover']);
  });

  it('hover 滑条：结点任何工具态都画；段只在删除工具下画（用户 2026-09-09）', () => {
    const notes = [slide([{ lane: 0, beat: 10 }, { lane: 3, beat: 12 }, { lane: 6, beat: 14 }])];
    const nodeHover: SelectionItem = { kind: 'slideNode', noteIndex: 0, connIndex: 1 };
    const regionHover: SelectionItem = { kind: 'slideRegion', noteIndex: 0, connIndex: 0 };

    // 结点 = 真正的可点对象 → 所有工具态都有 hover
    for (const tool of [null, 'single', 'delete', 'mirror', 'slide', 'bpm']) {
      const out = outlinesOf({ notes, hover: nodeHover, armedTool: tool });
      expect(out).toHaveLength(1);
      expect(out[0]!.shape).toBe('rect');
    }
    // 段（连接带）不是可点对象 → 除删除工具外一律无 hover
    for (const tool of [null, 'single', 'mirror', 'slide', 'bpm']) {
      expect(outlinesOf({ notes, hover: regionHover, armedTool: tool })).toHaveLength(0);
    }
    const danger = outlinesOf({ notes, hover: regionHover, armedTool: 'delete' });
    expect(danger).toHaveLength(1);
    expect(danger[0]!.shape).toBe('quad');
    expect(danger[0]!.mode).toBe('danger');
  });

  it('段被框选入选后照常按选中态绘制（不受"段无 hover"影响）', () => {
    const notes = [slide([{ lane: 0, beat: 10 }, { lane: 3, beat: 12 }])];
    const out = outlinesOf({ notes, select: [{ kind: 'slideRegion', noteIndex: 0, connIndex: 0 }] });
    expect(out).toHaveLength(1);
    expect(out[0]!.shape).toBe('quad');
    expect(out[0]!.mode).toBe('selected');
  });

  it('删除态 hover 滑条：已选中的段与结点一起转红（Q51 覆盖整条轮廓）', () => {
    const notes = [slide([{ lane: 0, beat: 10 }, { lane: 3, beat: 12 }, { lane: 6, beat: 14 }])];
    const out = outlinesOf({
      notes,
      select: [{ kind: 'note', noteIndex: 0 }],
      hover: { kind: 'slideNode', noteIndex: 0, connIndex: 1 },
      armedTool: 'delete',
    });
    expect(out.every(o => o.mode === 'danger')).toBe(true);
    expect(out).toHaveLength(5); // 3 结点 + 2 段
  });

  it('任何工具态都画 hover（幽灵态不再屏蔽）；仅删除态换成危险色', () => {
    const notes = [single(50)];
    const hover: SelectionItem = { kind: 'note', noteIndex: 0 };
    for (const tool of [null, 'single', 'flick', 'skill', 'ldirectional', 'rdirectional', 'paste', 'mirror', 'bpm', 'slide']) {
      const out = outlinesOf({ notes, hover, armedTool: tool });
      expect(out).toHaveLength(1);
      expect(out[0]!.mode).toBe('hover');
    }
    expect(outlinesOf({ notes, hover, armedTool: 'delete' })[0]!.mode).toBe('danger');
  });

  it('BPM 不参与 hover（Q14=A：单击无效果 → 不给"点得动"的暗示）；删除态亦然（C5）', () => {
    const notes = [{ type: 'BPM', beat: 40, bpm: 120 } as ChartNote];
    expect(outlinesOf({ notes, hover: { kind: 'note', noteIndex: 0 }, armedTool: 'delete' })).toHaveLength(0);
    expect(outlinesOf({ notes, hover: { kind: 'note', noteIndex: 0 } })).toHaveLength(0);
  });

  it('无选中、无 hover → 零描边（不进绘制路径）', () => {
    expect(outlinesOf({ notes: [single(50)] })).toHaveLength(0);
  });
});

// ---------------- A6：hidden 结点不可命中 ----------------
describe('hidden 结点不可选中 / 不可 hover（A6）', () => {
  const notes = [slide([{ lane: 0, beat: 10 }, { lane: 3, beat: 12, hidden: true }, { lane: 6, beat: 14 }])];
  const geometry = new ChartGeometry(bpm120, 100, SURFACE);
  const viewport = { scrollX: 0, scrollY: 0, scale: 1 };
  const deps: HitTestDeps = { geometry, viewport, beatDisplay: BEAT_DISPLAY, notes };
  const at = (lane: number, beat: number) =>
    geometry.virtualToCanvas(geometry.noteVirtualX(lane), geometry.noteVirtualY(beat, 0, viewport.scale, BEAT_DISPLAY), viewport);

  it('findItemAt 跳过 hidden 结点（命中落在相邻段上）', () => {
    const p = at(3, 12);
    const hit = findItemAt(p.x, p.y, deps);
    expect(hit).not.toEqual({ kind: 'slideNode', noteIndex: 0, connIndex: 1 });
  });

  it('可见结点照常命中', () => {
    const p = at(0, 10);
    expect(findItemAt(p.x, p.y, deps)).toEqual({ kind: 'slideNode', noteIndex: 0, connIndex: 0 });
  });

  it('computeItemsInBox 不把 hidden 结点收进选区', () => {
    const p1 = at(0, 10), p2 = at(6, 14);
    const box = { x1: p1.x - 10, y1: p2.y - 10, x2: p2.x + 10, y2: p1.y + 10 };
    const items = computeItemsInBox(box, deps);
    expect(items).not.toContainEqual({ kind: 'slideNode', noteIndex: 0, connIndex: 1 });
    expect(items).toContainEqual({ kind: 'slideNode', noteIndex: 0, connIndex: 0 });
    expect(items).toContainEqual({ kind: 'slideNode', noteIndex: 0, connIndex: 2 });
  });

  it('even if 选区里含 hidden 结点（脏数据），描边也不画它', () => {
    const out = outlinesOf({
      notes,
      select: [{ kind: 'slideNode', noteIndex: 0, connIndex: 1 }],
    });
    expect(out).toHaveLength(0);
  });
});

// ───────────────────────── issue 67：框选按住（未松手）时矩形内音符实时高亮 ─────────────────────────
// 新特性：左键按住拖出框选矩形期间，选区还没建立（要等 mouseup），
// 此刻框内的音符必须即时显示 hover 档描边，让用户看清"松手会选中谁"。
describe('框选实时预览描边（issue 67）', () => {
  const GEO = new ChartGeometry(bpm120, 100, SURFACE);
  const VP = { scrollX: 0, scrollY: 0, scale: 1 };
  /** lane/beat → 画布坐标（与 computeItemsInBox 同一几何） */
  const at = (lane: number, beat: number) =>
    GEO.virtualToCanvas(GEO.noteVirtualX(lane), GEO.noteVirtualY(beat, 0, VP.scale, BEAT_DISPLAY), VP);
  /** 包住一段 lane×beat 区间的框（四周留 10px 余量，确保音符中心落在框内） */
  const boxAround = (laneLo: number, beatHi: number, laneHi: number, beatLo: number) => {
    const a = at(laneLo, beatHi), b = at(laneHi, beatLo);
    return {
      x1: Math.min(a.x, b.x) - 10, y1: Math.min(a.y, b.y) - 10,
      x2: Math.max(a.x, b.x) + 10, y2: Math.max(a.y, b.y) + 10,
    };
  };

  it('框住未选中的单键 → 即时出现 hover 描边（松手前就有反馈）', () => {
    const out = outlinesOf({ notes: [single(50, 3)], selectionBox: boxAround(3, 51, 3, 49) });
    expect(out).toHaveLength(1);
    expect(out[0]!.shape).toBe('rect');
    expect(out[0]!.mode).toBe('hover'); // 尚未入选 → hover 档；松手后才转 selected
  });

  it('已选中的音符被框住 → 不叠第二圈 hover（仍只有一圈 selected）', () => {
    const out = outlinesOf({
      notes: [single(50, 3)],
      select: [{ kind: 'note', noteIndex: 0 }],
      selectionBox: boxAround(3, 51, 3, 49),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.mode).toBe('selected');
  });

  it('框外的音符不产生任何预览描边', () => {
    const out = outlinesOf({ notes: [single(50, 3)], selectionBox: boxAround(0, 12, 0, 10) });
    expect(out).toHaveLength(0);
  });

  // issue 71：BPM 不进选区 → 非删除态**不预览**它（画了却选不中 = 误导）
  it('issue 71：框住 BPM（整线覆盖）→ 非删除态不产生预览描边', () => {
    const { trackBgX, trackBgWidth } = GEO.trackGeometry(VP.scale);
    const y = GEO.virtualToCanvas(0, GEO.noteVirtualY(40, 0, VP.scale, BEAT_DISPLAY), VP).y;
    const box = { x1: trackBgX - 5, y1: y - 5, x2: trackBgX + trackBgWidth + 5, y2: y + 5 };
    const out = outlinesOf({ notes: [{ type: 'BPM', beat: 40, bpm: 120 } as ChartNote], selectionBox: box });
    expect(out).toHaveLength(0);
  });

  it('框住滑条 → 结点与段都出预览（段的预览不受"仅删除/音符代码工具"的鼠标 hover 限制）', () => {
    const out = outlinesOf({
      notes: [slide([{ lane: 1, beat: 10 }, { lane: 3, beat: 12 }])],
      selectionBox: boxAround(1, 13, 3, 9),
    });
    expect(out.filter(o => o.shape === 'rect').length).toBe(2); // 两个结点
    expect(out.filter(o => o.shape === 'quad').length).toBe(1); // 一个段
    for (const o of out) expect(o.mode).toBe('hover');
  });

  it('hidden 结点不进框选预览', () => {
    const out = outlinesOf({
      notes: [slide([{ lane: 1, beat: 10 }, { lane: 2, beat: 11, hidden: true }, { lane: 3, beat: 12 }])],
      selectionBox: boxAround(1, 13, 3, 9),
    });
    expect(out.filter(o => o.shape === 'rect').length).toBe(2); // 中间 hidden 不画
  });

  // 删除工具态下框选 = "这些会被删"的预告 → 预览用危险红（与鼠标 hover 同款，Q49/Q51），
  // 而不是默认的浅黄 hover。
  it('删除工具态下框选预览 = 危险红 danger（不是浅黄 hover）', () => {
    const out = outlinesOf({
      notes: [single(50, 3)], armedTool: 'delete', selectionBox: boxAround(3, 51, 3, 49),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.mode).toBe('danger');
  });

  it('删除态：已选中的音符被框住 → 整体转红（Q51 同款，覆盖浅黄选中）', () => {
    const out = outlinesOf({
      notes: [single(50, 3)],
      select: [{ kind: 'note', noteIndex: 0 }],
      armedTool: 'delete',
      selectionBox: boxAround(3, 51, 3, 49),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.mode).toBe('danger');
  });

  it('删除态：框住滑条 → 结点与段的预览都是 danger', () => {
    const out = outlinesOf({
      notes: [slide([{ lane: 1, beat: 10 }, { lane: 3, beat: 12 }])],
      armedTool: 'delete', selectionBox: boxAround(1, 13, 3, 9),
    });
    expect(out.length).toBeGreaterThan(0);
    for (const o of out) expect(o.mode).toBe('danger');
  });

  it('删除态：框住 BPM → 预览画红（区别于"鼠标 hover BPM 不画红"）', () => {
    const { trackBgX, trackBgWidth } = GEO.trackGeometry(VP.scale);
    const y = GEO.virtualToCanvas(0, GEO.noteVirtualY(40, 0, VP.scale, BEAT_DISPLAY), VP).y;
    const box = { x1: trackBgX - 5, y1: y - 5, x2: trackBgX + trackBgWidth + 5, y2: y + 5 };
    const out = outlinesOf({
      notes: [{ type: 'BPM', beat: 40, bpm: 120 } as ChartNote],
      armedTool: 'delete', selectionBox: box,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.mode).toBe('danger');
  });

  it('非删除工具态：框选预览仍是浅黄 hover（不受影响）', () => {
    const out = outlinesOf({ notes: [single(50, 3)], armedTool: 'mirror', selectionBox: boxAround(3, 51, 3, 49) });
    expect(out[0]!.mode).toBe('hover');
  });
});

// issue 74：右键按住（未松手）时，光标下对象的 hover 从浅黄切到删除红 ——
// 右键 = 删除该对象，按住期间就要给出"松手即删"的预览（非删除工具态同样生效）。
describe('右键按住 → hover 转删除红（issue 74）', () => {
  it('指针态 + 右键按住 → hover 变 danger（松开/未按 = hover）', () => {
    const hover = { kind: 'note' as const, noteIndex: 0 };
    const base = { notes: [single(50, 3)], hover };
    expect(outlinesOf(base)[0]!.mode).toBe('hover');
    expect(outlinesOf({ ...base, rightButtonHeld: true })[0]!.mode).toBe('danger');
  });

  it('任意持工具态同样生效（不只删除工具）', () => {
    const hover = { kind: 'note' as const, noteIndex: 0 };
    for (const armedTool of ['single', 'slide', 'mirror', 'paste'] as const) {
      const out = outlinesOf({ notes: [single(50, 3)], hover, armedTool, rightButtonHeld: true });
      expect(out[0]!.mode).toBe('danger');
    }
  });

  it('hover 到滑条结点 / 段 → 都转 danger', () => {
    const s = slide([{ lane: 1, beat: 10 }, { lane: 3, beat: 12 }]);
    const node = outlinesOf({
      notes: [s], hover: { kind: 'slideNode', noteIndex: 0, connIndex: 0 }, rightButtonHeld: true,
    });
    expect(node.some(o => o.mode === 'danger')).toBe(true);
    const region = outlinesOf({
      notes: [s], hover: { kind: 'slideRegion', noteIndex: 0, connIndex: 0 }, rightButtonHeld: true,
    });
    expect(region.some(o => o.mode === 'danger')).toBe(true);
  });

  it('BPM 线：右键按住也转红（右键能删它）', () => {
    const out = outlinesOf({
      notes: [{ type: 'BPM', beat: 40, bpm: 120 } as ChartNote],
      hover: { kind: 'note', noteIndex: 0 }, rightButtonHeld: true,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.mode).toBe('danger');
  });

  it('回归：未按右键时，非删除工具态的 hover 仍是浅黄', () => {
    const out = outlinesOf({
      notes: [single(50, 3)], hover: { kind: 'note' as const, noteIndex: 0 }, armedTool: 'single',
    });
    expect(out[0]!.mode).toBe('hover');
  });
});
